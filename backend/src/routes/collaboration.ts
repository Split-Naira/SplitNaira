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
import {
  getPermissionsMatrix,
} from "../services/collaboration/permissions.js";
import {
  reinvite,
  acceptInvitationByTokenJti,
  cancelInvitation,
  getInvitationById,
} from "../services/collaboration/invitation-registry.js";
import {
  setProjectOwner,
  transferOwnership,
  isCurrentOwner,
  listOwnershipAudit,
} from "../services/splits/ownership-transfer.js";
import { requireStellarAddress } from "../middleware/project-access.js";
import {
  createProjectPermissionMiddleware,
  type ProjectRoleContextResolver,
} from "../middleware/project-permission.js";
import { stellarAddressSchema } from "../schemas/splits.js";

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

type ProjectDeletionSnapshotResolver = (
  projectId: string,
) => Promise<ProjectFinancialSnapshot | null>;

let resolveProjectDeletionSnapshot: ProjectDeletionSnapshotResolver | null = null;

export function setProjectDeletionSnapshotResolver(
  resolver: ProjectDeletionSnapshotResolver | null,
): void {
  resolveProjectDeletionSnapshot = resolver;
}


collaborationRouter.get("/permissions/matrix", (_req, res) => {
  res.status(200).json({ roles: getPermissionsMatrix() });
});

const deleteBodySchema = z.object({
  confirmed: z.boolean(),
  confirmationText: z.string().optional(),
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
      if (!resolveProjectDeletionSnapshot) {
        return res.status(503).json({
          error: "deletion_state_unavailable",
          message: "Project financial history could not be verified. Deletion is disabled until authoritative history is available.",
        });
      }

      const snapshot = await resolveProjectDeletionSnapshot(projectId);
      if (!snapshot || snapshot.projectId !== projectId) {
        return res.status(404).json({ error: "project_not_found" });
      }

      const decision = requestProjectDeletion({
        snapshot,
        actor: res.locals.requesterAddress,
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
  ttlMs: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

collaborationRouter.post(
  "/projects/:projectId/invitations",
  requireStellarAddress,
  createProjectPermissionMiddleware("project:invite", resolveRoleContext),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = inviteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const record = reinvite({
        email: body.email,
        tokenJti: body.tokenJti,
        projectId,
        inviterWalletAddress: res.locals.requesterAddress,
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
  requireStellarAddress,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitationId = req.params.invitationId as string;
      const invitation = getInvitationById(invitationId);
      if (!invitation) {
        return res.status(404).json({ error: "invitation_not_found" });
      }
      const projectContext = invitation.projectId
        ? await resolveRoleContext(invitation.projectId)
        : null;
      const record = cancelInvitation({
        invitationId,
        actorWalletAddress: res.locals.requesterAddress,
        projectOwnerAddress: projectContext?.owner,
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
  newOwner: stellarAddressSchema,
});

collaborationRouter.post(
  "/projects/:projectId/transfer-ownership",
  requireStellarAddress,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = transferBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const requesterAddress = res.locals.requesterAddress as string;
      const projectContext = await resolveRoleContext(projectId);
      if (!projectContext) {
        return res.status(404).json({ error: "project_owner_unknown" });
      }
      setProjectOwner(projectId, projectContext.owner);
      const record = transferOwnership({
        projectId,
        actor: requesterAddress,
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

