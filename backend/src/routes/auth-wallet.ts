import { Router, type NextFunction, type Request, type Response } from "express";
import { IsNull } from "typeorm";
import { z } from "zod";

import { getDataSource } from "../services/database.js";
import { User } from "../entities/User.js";
import { signToken } from "../services/jwt.js";
import { logAuthEvent } from "../services/auth-events.js";
import { logger } from "../services/logger.js";
import { stellarAddressSchema } from "../schemas/user.schemas.js";
import {
  WalletChallengeStore,
  walletChallengeStore,
  type WalletChallengeFailureReason,
} from "../services/wallet-challenge.js";

const challengeRequestSchema = z
  .object({
    walletAddress: stellarAddressSchema,
  })
  .strict();

const challengeVerifySchema = z
  .object({
    walletAddress: stellarAddressSchema,
    challengeId: z.string().uuid(),
    signature: z.string().min(1).max(512),
  })
  .strict();

const FAILURE_DETAILS: Record<WalletChallengeFailureReason, { code: string; message: string }> = {
  unknown: {
    code: "WALLET_CHALLENGE_UNKNOWN",
    message: "Challenge not found. Request a new challenge and try again.",
  },
  expired: {
    code: "WALLET_CHALLENGE_EXPIRED",
    message: "Challenge has expired. Request a new challenge and try again.",
  },
  wallet_mismatch: {
    code: "WALLET_CHALLENGE_WALLET_MISMATCH",
    message: "This challenge was issued for a different wallet.",
  },
  invalid_signature: {
    code: "WALLET_CHALLENGE_INVALID_SIGNATURE",
    message: "Invalid wallet signature.",
  },
};

function sendChallengeFailure(res: Response, reason: WalletChallengeFailureReason): Response {
  const { code, message } = FAILURE_DETAILS[reason];
  return res.status(401).json({
    error: "unauthorized",
    code,
    message,
    requestId: res.locals.requestId,
    details: { reason },
  });
}

/**
 * Signed wallet login (Issue #1232).
 *
 *   POST /auth/wallet/challenge  -> { challengeId, challenge, expiresAt }
 *   POST /auth/wallet/verify     -> { ...user, token }
 *
 * The JWT is minted only after the Ed25519 signature over the challenge is
 * verified against the address the challenge was issued for. Unknown, expired,
 * reused, mismatched, and malformed challenges all fail closed with 401.
 */
export function createAuthWalletRouter(store: WalletChallengeStore = walletChallengeStore): Router {
  const router = Router();

  router.post("/challenge", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress } = challengeRequestSchema.parse(req.body);
      const challenge = store.issue(walletAddress);

      logAuthEvent(res, "wallet_challenge_issued", "success");

      return res.status(201).json({
        challengeId: challenge.challengeId,
        walletAddress: challenge.walletAddress,
        challenge: challenge.challenge,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        expiresInSeconds: Math.round(
          (new Date(challenge.expiresAt).getTime() - new Date(challenge.issuedAt).getTime()) / 1000
        ),
        requestId: res.locals.requestId,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/verify", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress, challengeId, signature } = challengeVerifySchema.parse(req.body);

      const verification = store.verifyAndConsume({ walletAddress, challengeId, signature });
      if (!verification.ok) {
        logAuthEvent(res, "wallet_signature_verified", "failure", {
          reason: verification.reason.toUpperCase(),
        });
        return sendChallengeFailure(res, verification.reason);
      }

      // Signature is valid, so the wallet owns this address. A public wallet
      // address on its own is still not enough to sign in: the account must
      // exist, be active, and not be soft-deleted. Unknown and inactive
      // accounts share one generic response, matching POST /users/login.
      const user = await getDataSource()
        .getRepository(User)
        .findOne({
          where: { walletAddress, deletedAt: IsNull() },
        });

      if (!user || !user.isActive) {
        logAuthEvent(res, "wallet_signature_verified", "success");
        return res.status(401).json({
          error: "unauthorized",
          code: "UNAUTHORIZED",
          message: "Unable to sign in. Check your details or try again later.",
          requestId: res.locals.requestId,
          details: {},
        });
      }

      logger.info("User signed in with wallet challenge", {
        userId: user.id,
        walletAddress: user.walletAddress,
      });
      logAuthEvent(res, "wallet_signature_verified", "success", { userId: user.id });

      return res.status(200).json({
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        alias: user.alias,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        token: signToken(user.walletAddress, user.sessionVersion ?? 0),
        requestId: res.locals.requestId,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const authWalletRouter = createAuthWalletRouter();
