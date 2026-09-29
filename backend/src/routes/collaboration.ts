/**
 * Collaboration routes – invitations cancel is on auth-email; this module
 * exposes project deletion safeguards (#1296) and permissions introspection
 * plus server-side permission enforcement (#1300).
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  CONFIRMATION_PHRASE,
  requestProjectDeletion,
  type ProjectFinancialSnapshot,
} from "../services/collaboration/project-deletion.js";
import { getPermissionsMatrix } from "../services/collaboration/permissions.js";
import {
  getPermissionsMatrix,
  resolveCollaboratorRole,
  assertPermission,
  type CollaboratorRole,
} from "../services/collaboration/permissions.js";
import {
  reinvite,
  acceptInvitationByTokenJti,
  cancelInvitation,
} from "../services/collaboration/invitation-registry.js";
import {
  setProjectOwner,
  transferOwnership,
  isCurrentOwner,
  listOwnershipAudit,
} from "../services/splits/ownership-transfer.js";

export const collaborationRouter = Router();

/**
 * Authoritative source for a project's collaboration record, wired at startup.
 *
 * Until it is registered the delete route fails closed: without a record there
 * is no role to resolve, and assuming one is how the client-supplied `role`
 * field used to work (#1300).
 */
let resolveProjectRoleContext: ProjectRoleContextResolver | null = null;

export function setProjectRoleContextResolver(
  resolver: ProjectRoleContextResolver,
): void {
  resolveProjectRoleContext = resolver;
}

const resolveRoleContext: ProjectRoleContextResolver = (projectId) =>
  resolveProjectRoleContext
    ? resolveProjectRoleContext(projectId)
    : Promise.resolve(null);


collaborationRouter.get("/permissions/matrix", (_req, res) => {
  res.status(200).json({ roles: getPermissionsMatrix() });
});

const deleteBodySchema = z.object({
  actor: z.string().min(1),
  confirmed: z.boolean(),
  confirmationText: z.string().optional(),
  financial: z.object({
    projectId: z.string().min(1),
    hasDeposits: z.boolean(),
    hasDistributions: z.boolean(),
    hasClaims: z.boolean(),
    transactionCount: z.number().int().nonnegative(),
    totalVolumeStroops: z.string().optional(),
  }),
});


collaborationRouter.post(
  "/projects/:projectId/delete",
  // The acting role is resolved from the verified requester address against the
  // project's stored collaboration record — never from the request body.
  requireStellarAddress,
  createProjectPermissionMiddleware("project:delete", resolveRoleContext),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = deleteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;

      if (body.financial.projectId !== projectId) {
        return res.status(400).json({ error: "project_id_mismatch" });
      }

      const role: CollaboratorRole = body.role ?? "owner";
      try {
        assertPermission(role, "project:delete");
      } catch {
        return res.status(403).json({ error: "permission_denied" });
      }

      const snapshot: ProjectFinancialSnapshot = body.financial;
      const decision = requestProjectDeletion({
        snapshot,
        actor: body.actor,
        confirmed: body.confirmed,
        confirmationText: body.confirmationText,
      });

      if (!decision.allowed) {
        return res.status(409).json({
          error: "deletion_blocked",
          decision,
          confirmationPhrase: CONFIRMATION_PHRASE,
        });
      }

      return res.status(200).json({
        success: true,
        role: res.locals.collaboratorRole,
        decision,
      });
    } catch (error) {
      return next(error);
    }
  },
);

const inviteBodySchema = z.object({
  email: z.string().email(),
  tokenJti: z.string().min(1),
  inviterWalletAddress: z.string().min(1),
  ttlMs: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

collaborationRouter.post(
  "/projects/:projectId/invitations",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = inviteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const record = reinvite({
        email: body.email,
        tokenJti: body.tokenJti,
        projectId,
        inviterWalletAddress: body.inviterWalletAddress,
        ttlMs: body.ttlMs,
        expiresAt: body.expiresAt,
      });
      return res.status(201).json({ invitation: record });
    } catch (error) {
      return next(error);
    }
  },
);

collaborationRouter.post(
  "/invitations/accept",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ tokenJti: z.string().min(1) }).parse(req.body);
      const record = acceptInvitationByTokenJti(body.tokenJti);
      return res.status(200).json({ invitation: record });
    } catch (error) {
      const err = error as { code?: string; status?: number; message?: string };
      if (err.status) {
        return res
          .status(err.status)
          .json({ error: err.code, message: err.message });
      }
      return next(error);
    }
  },
);

collaborationRouter.post(
  "/invitations/:invitationId/cancel",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ actorWalletAddress: z.string().min(1) })
        .parse(req.body);
      const record = cancelInvitation({
        invitationId: req.params.invitationId as string,
        actorWalletAddress: body.actorWalletAddress,
      });
      return res.status(200).json({ invitation: record });
    } catch (error) {
      const err = error as { code?: string; status?: number; message?: string };
      if (err.status) {
        return res
          .status(err.status)
          .json({ error: err.code, message: err.message });
      }
      return next(error);
    }
  },
);

const transferBodySchema = z.object({
  actor: z.string().min(1),
  newOwner: z.string().min(1),
  /** Seeds current owner when not yet synced from chain. */
  currentOwner: z.string().min(1).optional(),
});

collaborationRouter.post(
  "/projects/:projectId/transfer-ownership",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = transferBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      if (body.currentOwner) {
        setProjectOwner(projectId, body.currentOwner);
      }
      const record = transferOwnership({
        projectId,
        actor: body.actor,
        newOwner: body.newOwner,
      });
      return res.status(200).json({
        transfer: record,
        isNewOwner: isCurrentOwner(projectId, body.newOwner),
        audit: listOwnershipAudit(projectId),
      });
    } catch (error) {
      const err = error as { code?: string; status?: number; message?: string };
      if (err.status) {
        return res
          .status(err.status)
          .json({ error: err.code, message: err.message });
      }
      return next(error);
    }
  },
);

export { resolveCollaboratorRole };
