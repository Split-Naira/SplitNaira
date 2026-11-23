import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { IsNull } from "typeorm";
import { getDataSource } from "../services/database.js";
import { User } from "../entities/User.js";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";
import { sendErrorResponse } from "../middleware/error.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import {
  getEmailProvider,
  maskEmail,
  signEmailFlowToken,
  verifyEmailFlowToken,
} from "../services/email-provider.js";
import { revokeSessionForWallet } from "../services/session-revocation.js";
import { hashEmailForLog, logAuthEvent } from "../services/auth-events.js";
import { recordAuthAudit } from "../services/auth-audit.js";
import { logger } from "../services/logger.js";

export const authAccountRouter = Router();

const emailChangeRequestSchema = z.object({
  newEmail: z.string().trim().email("Invalid email format").max(128),
});

const emailChangeConfirmSchema = z.object({
  token: z.string().min(1),
});

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Logs the caller out by invalidating the wallet's JWTs (#1451).
 *
 * Wallet JWTs are stateless, so "this session" can't be deleted on its own;
 * logout bumps the account's `sessionVersion` (the mechanism from #1446). The
 * effect is the same everywhere at once:
 *   - the token that made the request stops working;
 *   - every other tab/device holding a token for this wallet gets
 *     `401 SESSION_REVOKED` on its next request, the same response a password
 *     reset produces, so clients need only one "signed out" code path;
 *   - the next `POST /users/login` issues a token with the new version.
 *
 * The bump is conditional on the version in the presented token. Two tabs
 * logging out at once bump it once, and a logout holding an old token can't
 * revoke a session that was created after it.
 */
authAccountRouter.post(
  "/logout",
  authJwtMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress, sessionVersion } = req.user!;
      const revoked = await revokeSessionForWallet(walletAddress, sessionVersion ?? 0);

      logAuthEvent(res, "logout", "success", { sessionsRevoked: revoked > 0 });
      return res.status(200).json({
        success: true,
        sessionsRevoked: revoked > 0,
        requestId: res.locals.requestId,
      });
    } catch (error) {
      logAuthEvent(res, "logout", "failure", { reason: "INTERNAL_ERROR" });
      return next(error);
    }
  }
);

/**
 * Starts an email change (#1448). Nothing changes on the account yet:
 *   1. a confirmation link goes to the NEW address, proving the caller controls it;
 *   2. a notice goes to the PRIOR address (if the account has one), so its
 *      owner can notice a change they didn't ask for;
 *   3. the request is written to the audit log.
 *
 * The link is bound to the account, its current address and its session
 * version (see `/email-change/confirm`). Duplicate addresses across accounts
 * are allowed, so the response never depends on whether the new address is
 * already in use.
 */
authAccountRouter.post(
  "/email-change/request",
  authJwtMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { newEmail } = emailChangeRequestSchema.parse(req.body);
      const nextEmail = normalizeEmail(newEmail);
      const { walletAddress } = req.user!;

      const user = await getDataSource()
        .getRepository(User)
        .findOne({ where: { walletAddress, deletedAt: IsNull() } });
      if (!user) {
        throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, "User not found.");
      }

      const prevEmail = normalizeEmail(user.email);
      if (nextEmail === prevEmail) {
        logAuthEvent(res, "email_change_requested", "failure", {
          userId: user.id,
          reason: "email_unchanged",
        });
        return res.status(400).json({
          error: "email_unchanged",
          code: "EMAIL_UNCHANGED",
          message: "That is already the email address on this account.",
          requestId: res.locals.requestId,
          details: {},
        });
      }

      const token = signEmailFlowToken(nextEmail, "email_change", {
        sv: user.sessionVersion ?? 0,
        uid: user.id,
        prev: prevEmail,
      });
      const base =
        process.env.EMAIL_CHANGE_URL_BASE ?? "https://app.splitnaira.com/confirm-email-change";
      const provider = getEmailProvider();

      await provider.sendEmailChangeConfirmationEmail({
        to: nextEmail,
        token,
        confirmUrl: `${base}?token=${encodeURIComponent(token)}`,
      });

      if (user.email) {
        // Best effort: failing to warn the old address must not block the user's own change.
        try {
          await provider.sendEmailChangeNoticeEmail({
            to: user.email,
            kind: "requested",
            newEmailMasked: maskEmail(nextEmail),
          });
        } catch (noticeError) {
          logger.warn("Email change notice to prior address failed", {
            requestId: res.locals.requestId,
            error: noticeError instanceof Error ? noticeError.message : String(noticeError),
          });
        }
      }

      await recordAuthAudit(req, res, "email_change_requested", {
        userId: user.id,
        oldEmailHash: prevEmail ? hashEmailForLog(prevEmail) : null,
        newEmailHash: hashEmailForLog(nextEmail),
      });
      logAuthEvent(res, "email_change_requested", "success", { userId: user.id, email: nextEmail });

      return res.status(202).json({ success: true, requestId: res.locals.requestId });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * Completes an email change (#1448) from the link sent to the new address.
 * No bearer token is needed: the link itself proves control of the new
 * address, like the other email links, and is bound to one account.
 *
 * The link is rejected (`400 invalid_or_expired_token`) unless the account
 * still has the address and session version it had when the link was issued.
 * That makes it single-use (once the address changes, replaying it matches
 * nothing) and dead after a logout or password reset. The update itself is
 * conditional on the same values, so concurrent confirms can't both apply.
 */
authAccountRouter.post(
  "/email-change/confirm",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = emailChangeConfirmSchema.parse(req.body);
      const payload = verifyEmailFlowToken(token, "email_change");
      const invalid = () => {
        logAuthEvent(res, "email_change_confirmed", "failure", {
          reason: "invalid_or_expired_token",
        });
        return sendErrorResponse(
          res,
          400,
          "invalid_or_expired_token",
          "The link is invalid or has expired.",
        );
      };
      if (!payload || !payload.uid || payload.prev === undefined || payload.sv === undefined) {
        return invalid();
      }

      const repository = getDataSource().getRepository(User);
      const user = await repository.findOne({ where: { id: payload.uid, deletedAt: IsNull() } });
      if (
        !user ||
        (user.sessionVersion ?? 0) !== payload.sv ||
        normalizeEmail(user.email) !== payload.prev
      ) {
        return invalid();
      }

      const previousEmail = user.email;
      const result = await repository.update(
        {
          id: user.id,
          sessionVersion: payload.sv,
          email: user.email ? user.email : IsNull(),
        },
        { email: payload.email, emailVerifiedAt: new Date() }
      );
      if (!result.affected) {
        return invalid();
      }

      if (previousEmail) {
        try {
          await getEmailProvider().sendEmailChangeNoticeEmail({
            to: previousEmail,
            kind: "completed",
            newEmailMasked: maskEmail(payload.email),
          });
        } catch (noticeError) {
          logger.warn("Email change notice to prior address failed", {
            requestId: res.locals.requestId,
            error: noticeError instanceof Error ? noticeError.message : String(noticeError),
          });
        }
      }

      await recordAuthAudit(req, res, "email_changed", {
        userId: user.id,
        oldEmailHash: payload.prev ? hashEmailForLog(payload.prev) : null,
        newEmailHash: hashEmailForLog(payload.email),
      });
      logAuthEvent(res, "email_change_confirmed", "success", {
        userId: user.id,
        email: payload.email,
      });

      return res
        .status(200)
        .json({ success: true, email: payload.email, requestId: res.locals.requestId });
    } catch (error) {
      return next(error);
    }
  }
);
