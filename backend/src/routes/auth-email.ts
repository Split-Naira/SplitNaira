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
  registerInvitation,
} from "../services/collaboration/invitation-registry.js";
import { createHash } from "node:crypto";


export const authEmailRouter = Router();

const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email format"),
  resetUrlBase: z.string().url().optional(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
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
      return res.status(202).json({ success: true });
    }

    const token = signEmailFlowToken(email, "password_reset");
    const base = resetUrlBase ?? process.env.PASSWORD_RESET_URL_BASE ?? "https://app.splitnaira.com/reset-password";
    const resetUrl = `${base}?token=${encodeURIComponent(token)}`;

    await getEmailProvider().sendPasswordResetEmail({
      to: email,
      token,
      resetUrl,
    });

    return res.status(202).json({ success: true });
  } catch (error) {
    return next(error);
  }
});

authEmailRouter.post("/password-reset/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = passwordResetConfirmSchema.parse(req.body);
    const payload = verifyEmailFlowToken(token, "password_reset");
    if (!payload) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }
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
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    // Issue #1299 – reject cancelled invitations
    const tokenJti = createHash("sha256").update(token).digest("hex").slice(0, 32);
    try {
      acceptInvitationByTokenJti(tokenJti);
    } catch (err: unknown) {
      const e = err as { code?: string; status?: number; message?: string };
      if (e.code === "invitation_cancelled") {
        return res.status(410).json({ error: "invitation_cancelled", message: "This invitation was cancelled by the sender." });
      }
      // invitation_not_tracked: legacy tokens without registry entry still OK
      if (e.code && e.code !== "invitation_not_tracked") {
        return res.status(e.status ?? 400).json({ error: e.code });
      }
    }

    return res.status(200).json({ success: true, email: payload.email });
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
      return res.status(e.status ?? 400).json({ error: e.code ?? "cancel_failed" });
    }
  } catch (error) {
    return next(error);
  }
});

