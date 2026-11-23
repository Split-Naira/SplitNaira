import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getDataSource } from "../services/database.js";
import { User } from "../entities/User.js";
import {
  getEmailProvider,
  signEmailFlowToken,
  verifyEmailFlowToken,
} from "../services/email-provider.js";
import {
  acceptInvitationByTokenJti,
  cancelInvitation,
  listPendingInvitations,
  registerInvitation,
} from "../services/collaboration/invitation-registry.js";
import { createHash } from "node:crypto";
import { IsNull } from "typeorm";
import { getMaxSessionVersionForEmail, revokeSessionsForEmail } from "../services/session-revocation.js";
import { verificationResendCooldown } from "../services/verification-resend-cooldown.js";
import { logAuthEvent } from "../services/auth-events.js";
import { sendErrorResponse } from "../middleware/error.js";
import {
  consumeEmailVerificationToken,
  hashEmailVerificationToken,
  invalidateEmailVerificationToken,
  issueEmailVerificationToken,
  rotateEmailVerificationToken,
} from "../services/email-verification-token.js";

export const authEmailRouter = Router();

/**
 * #1640: every rejected email-flow token gets the same stable envelope. The
 * message is deliberately generic so it never reveals *why* the token failed
 * (expired, reused, superseded, or never issued).
 */
function sendInvalidToken(res: Response) {
  return sendErrorResponse(res, 400, "invalid_or_expired_token", "The link is invalid or has expired.");
}

const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email format"),
  resetUrlBase: z.string().url().optional(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

const emailVerificationResendSchema = z.object({
  email: z.string().email("Invalid email format"),
  verifyUrlBase: z.string().url().optional(),
});

const emailVerificationConfirmSchema = z.object({
  token: z.string().min(1),
});

const invitationRequestSchema = z.object({
  email: z.string().email("Invalid email format"),
  inviterWalletAddress: z.string().optional(),
  inviteUrlBase: z.string().url().optional(),
});

const invitationAcceptSchema = z.object({
  token: z.string().min(1),
});

authEmailRouter.post("/password-reset/request", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, resetUrlBase } = passwordResetRequestSchema.parse(req.body);

    const user = await getDataSource().getRepository(User).findOne({
      where: { email },
    });

    if (!user) {
      // Same response as the known-account path; only the server log differs.
      logAuthEvent(res, "password_reset_requested", "success", { email, reason: "no_account" });
      return res.status(202).json({ success: true });
    }

    // Bind the token to the current session version so it can only be
    // confirmed once (#1446); see /password-reset/confirm.
    const sessionVersion = (await getMaxSessionVersionForEmail(email)) ?? 0;
    const token = signEmailFlowToken(email, "password_reset", { sv: sessionVersion });
    const base = resetUrlBase ?? process.env.PASSWORD_RESET_URL_BASE ?? "https://app.splitnaira.com/reset-password";
    const resetUrl = `${base}?token=${encodeURIComponent(token)}`;

    await getEmailProvider().sendPasswordResetEmail({
      to: email,
      token,
      resetUrl,
    });

    logAuthEvent(res, "password_reset_requested", "success", { userId: user.id, email });
    return res.status(202).json({ success: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * Confirms a password reset and revokes sessions (#1446).
 *
 * On success, every wallet JWT issued to every account registered with the
 * token's email is invalidated (their `sessionVersion` is bumped), and no new
 * session is issued: the user has to log in again. The bump also makes the
 * reset token single-use, so a replayed or concurrent confirm with the same
 * token gets `400 invalid_or_expired_token`.
 *
 * Not affected, on purpose: invitation and email verification tokens (they
 * aren't sessions), and accounts registered under a different email.
 */
authEmailRouter.post("/password-reset/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = passwordResetConfirmSchema.parse(req.body);
    const payload = verifyEmailFlowToken(token, "password_reset");
    if (!payload) {
      logAuthEvent(res, "password_reset_confirmed", "failure", { reason: "invalid_or_expired_token" });
      return sendInvalidToken(res);
    }

    // Tokens issued before #1446 carry no `sv`; they were issued against version 0.
    const revoked = await revokeSessionsForEmail(payload.email, payload.sv ?? 0);
    if (revoked === 0) {
      // Already used, superseded by a newer reset, or no account left for this email.
      logAuthEvent(res, "password_reset_confirmed", "failure", { email: payload.email, reason: "invalid_or_expired_token" });
      return sendInvalidToken(res);
    }

    logAuthEvent(res, "password_reset_confirmed", "success", { email: payload.email, sessionsRevoked: true });
    return res.status(200).json({ success: true, email: payload.email, sessionsRevoked: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * Sends (or re-sends) an email verification link, with a per-email server-side
 * cooldown (#1443).
 *
 * - Within the cooldown: `429 resend_cooldown` with `retryAfterSeconds` in the
 *   body and a `Retry-After` header.
 * - Otherwise: `202 { success: true, retryAfterSeconds }`, where
 *   `retryAfterSeconds` says how long until the next resend is allowed.
 *
 * The response, and the cooldown, are the same whether or not the email
 * belongs to an account or is already verified, so this endpoint can't be
 * used to find out which emails are registered.
 */
authEmailRouter.post("/email-verification/resend", async (req: Request, res: Response, next: NextFunction) => {
  let acquired = false;
  let email = "";
  try {
    const body = emailVerificationResendSchema.parse(req.body);
    email = body.email;

    // Claimed synchronously, before any await, so concurrent requests for
    // the same email can't both pass the check.
    const slot = verificationResendCooldown.tryAcquire(email);
    if (!slot.ok) {
      const retryAfterSeconds = Math.ceil(slot.retryAfterMs / 1000);
      logAuthEvent(res, "email_verification_resent", "failure", { email, reason: "RESEND_COOLDOWN" });
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "resend_cooldown",
        code: "RESEND_COOLDOWN",
        message: `Please wait ${retryAfterSeconds}s before requesting another verification email.`,
        retryAfterSeconds,
        requestId: res.locals.requestId,
        details: { retryAfterSeconds },
      });
    }
    acquired = true;

    const user = await getDataSource().getRepository(User).findOne({
      where: { email, deletedAt: IsNull() },
    });

    if (user && !user.emailVerifiedAt) {
      // Issue first, then make it the only live token for this address
      // (#1444). A previous link stops working the moment the upsert commits,
      // even if this request's email never arrives.
      const issued = issueEmailVerificationToken(email);
      await rotateEmailVerificationToken(email, issued);

      const base =
        body.verifyUrlBase ?? process.env.EMAIL_VERIFICATION_URL_BASE ?? "https://app.splitnaira.com/verify-email";
      try {
        await getEmailProvider().sendVerificationEmail({
          to: email,
          token: issued.token,
          verifyUrl: `${base}?token=${encodeURIComponent(issued.token)}`,
        });
      } catch (error) {
        // Leave no live token behind that nobody received. Best-effort: the
        // original send error is the one the caller needs to see.
        await invalidateEmailVerificationToken(email, issued.tokenHash).catch(() => undefined);
        throw error;
      }
    }

    logAuthEvent(res, "email_verification_resent", "success", { userId: user?.id, email });
    return res.status(202).json({
      success: true,
      retryAfterSeconds: Math.ceil(verificationResendCooldown.cooldownMs / 1000),
    });
  } catch (error) {
    // A failed lookup or send shouldn't lock the user out for the whole
    // cooldown; give the slot back so they can retry.
    if (acquired) verificationResendCooldown.release(email);
    return next(error);
  }
});

/**
 * Marks every account registered with the token's email as verified (#1443).
 *
 * The token is consumed before the account is marked verified (#1444): the
 * conditional update is what makes a replay, a superseded link, and one of two
 * concurrent confirms fail closed. A confirmation always applies to the email
 * inside the signed token, never to a value from the request body, so a token
 * issued for one address cannot verify another.
 */
authEmailRouter.post("/email-verification/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = emailVerificationConfirmSchema.parse(req.body);
    const payload = verifyEmailFlowToken(token, "email_verification");
    if (!payload) {
      logAuthEvent(res, "email_verified", "failure", { reason: "invalid_or_expired_token" });
      return sendInvalidToken(res);
    }

    const consumed = await consumeEmailVerificationToken(
      payload.email,
      hashEmailVerificationToken(token),
    );
    if (!consumed) {
      // Reused, superseded, expired, or never issued.
      return sendInvalidToken(res);
    }

    await getDataSource()
      .getRepository(User)
      .update({ email: payload.email, emailVerifiedAt: IsNull() }, { emailVerifiedAt: new Date() });

    logAuthEvent(res, "email_verified", "success", { email: payload.email });
    return res.status(200).json({ success: true, email: payload.email });
  } catch (error) {
    return next(error);
  }
});

authEmailRouter.post("/invitations", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = invitationRequestSchema.extend({
      projectId: z.string().max(32).optional(),
    }).parse(req.body);
    const { email, inviterWalletAddress, inviteUrlBase, projectId } = body as {
      email: string;
      inviterWalletAddress?: string;
      inviteUrlBase?: string;
      projectId?: string;
    };
    const token = signEmailFlowToken(email, "invitation");
    const tokenJti = createHash("sha256").update(token).digest("hex").slice(0, 32);
    const record = registerInvitation({
      email,
      tokenJti,
      projectId,
      inviterWalletAddress,
    });
    const base = inviteUrlBase ?? process.env.INVITATION_URL_BASE ?? "https://app.splitnaira.com/invite";
    const inviteUrl = `${base}?token=${encodeURIComponent(token)}`;

    await getEmailProvider().sendInvitationEmail({
      to: email,
      token,
      inviteUrl,
      inviterWalletAddress,
    });

    return res.status(202).json({ success: true, invitationId: record.id });
  } catch (error) {
    return next(error);
  }
});

authEmailRouter.post("/invitations/accept", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = invitationAcceptSchema.parse(req.body);
    const payload = verifyEmailFlowToken(token, "invitation");
    if (!payload) {
      return sendInvalidToken(res);
    }

    // Issue #1299 – reject cancelled invitations
    const tokenJti = createHash("sha256").update(token).digest("hex").slice(0, 32);
    try {
      acceptInvitationByTokenJti(tokenJti);
    } catch (err: unknown) {
      const e = err as { code?: string; status?: number; message?: string };
      if (e.code === "invitation_cancelled") {
        return sendErrorResponse(res, 410, "invitation_cancelled", "This invitation was cancelled by the sender.");
      }
      // invitation_not_tracked: legacy tokens without registry entry still OK
      if (e.code && e.code !== "invitation_not_tracked") {
        return sendErrorResponse(res, e.status ?? 400, e.code, e.message ?? "The invitation could not be accepted.");
      }
    }

    return res.status(200).json({ success: true, email: payload.email });
  } catch (error) {
    return next(error);
  }
});

/**
 * List the invitations still awaiting a response, so an owner can find the one
 * they need to cancel (#1299). Invitation ids are opaque, so without this the
 * cancel endpoint is only reachable if the caller already stored the id.
 */
authEmailRouter.get("/invitations/pending", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filterSchema = z.object({
      projectId: z.string().min(1).optional(),
      inviterWalletAddress: z.string().min(1).optional(),
    });
    const filter = filterSchema.parse(req.query);
    const pending = listPendingInvitations(filter);

    return res.status(200).json({
      count: pending.length,
      invitations: pending.map((record) => ({
        id: record.id,
        email: record.email,
        projectId: record.projectId ?? null,
        inviterWalletAddress: record.inviterWalletAddress ?? null,
        createdAt: record.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Issue #1299 – Cancel a pending collaborator invitation (authorized inviter only).
 */
authEmailRouter.post("/invitations/:invitationId/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      actorWalletAddress: z.string().min(1, "actorWalletAddress is required"),
    });
    const { actorWalletAddress } = schema.parse(req.body);
    const invitationId = req.params.invitationId as string;

    try {
      // `projectOwnerAddress` is deliberately not accepted from the request
      // body: it is an authorization claim, and a caller that can assert
      // ownership can cancel invitations it does not own. Invitations recorded
      // without an inviter therefore stay uncancellable here rather than being
      // cancellable by anyone (#1299).
      const record = cancelInvitation({ invitationId, actorWalletAddress });
      return res.status(200).json({
        success: true,
        invitation: {
          id: record.id,
          email: record.email,
          status: record.status,
          cancelledAt: record.cancelledAt,
          cancelledBy: record.cancelledBy,
        },
      });
    } catch (err: unknown) {
      const e = err as { code?: string; status?: number };
      if (e.code === "inviter_unknown") {
        return sendErrorResponse(
          res,
          403,
          "inviter_unknown",
          "This invitation has no recorded inviter, so it can only be cancelled by the project owner.",
        );
      }
      return sendErrorResponse(
        res,
        e.status ?? 400,
        e.code ?? "cancel_failed",
        "The invitation could not be cancelled.",
      );
    }
  } catch (error) {
    return next(error);
  }
});

