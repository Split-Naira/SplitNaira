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
  getProjectOwner,
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
import { withResponseValidation } from "../middleware/validateResponse.js";
import { sendErrorResponse } from "../middleware/error.js";
import {
  InvitationResponseSchema,
  OwnershipTransferResponseSchema,
  PermissionsMatrixResponseSchema,
  ProjectDeletionResponseSchema,
} from "../schemas/collaboration.schemas.js";

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


collaborationRouter.get(
  "/permissions/matrix",
  withResponseValidation(PermissionsMatrixResponseSchema, (_req, res) => {
    res.status(200).json({ roles: getPermissionsMatrix() });
  }),
);

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
  withResponseValidation(ProjectDeletionResponseSchema, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = deleteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      if (!resolveProjectDeletionSnapshot) {
        return sendErrorResponse(
          res,
          503,
          "deletion_state_unavailable",
          "Project financial history could not be verified. Deletion is disabled until authoritative history is available.",
        );
      }

      const snapshot = await resolveProjectDeletionSnapshot(projectId);
      if (!snapshot || snapshot.projectId !== projectId) {
        return sendErrorResponse(res, 404, "project_not_found", "Project not found.");
      }

      const decision = requestProjectDeletion({
        snapshot,
        actor: res.locals.requesterAddress,
        confirmed: body.confirmed,
        confirmationText: body.confirmationText,
      });

      if (!decision.allowed) {
        return sendErrorResponse(
          res,
          409,
          "deletion_blocked",
          "Project deletion is blocked; see decision for the reasons.",
          {},
          { decision, confirmationPhrase: CONFIRMATION_PHRASE },
        );
      }

      return res.status(200).json({
        success: true,
        role: res.locals.collaboratorRole,
        decision,
      });
    } catch (error) {
      return next(error);
    }
  }),
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
  withResponseValidation(InvitationResponseSchema, (req: Request, res: Response, next: NextFunction) => {
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
  }),
);

collaborationRouter.post(
  "/invitations/accept",
  withResponseValidation(InvitationResponseSchema, (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ tokenJti: z.string().min(1) }).parse(req.body);
      const record = acceptInvitationByTokenJti(body.tokenJti);
      return res.status(200).json({ invitation: record });
    } catch (error) {
      const err = error as { code?: string; status?: number; message?: string };
      if (err.status) {
        return sendErrorResponse(
          res,
          err.status,
          err.code ?? "request_failed",
          err.message ?? "The collaboration request could not be completed.",
        );
      }
      return next(error);
    }
  }),
);

collaborationRouter.post(
  "/invitations/:invitationId/cancel",
  requireStellarAddress,
  withResponseValidation(InvitationResponseSchema, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitationId = req.params.invitationId as string;
      const invitation = getInvitationById(invitationId);
      if (!invitation) {
        return sendErrorResponse(res, 404, "invitation_not_found", "Invitation not found.");
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
        return sendErrorResponse(
          res,
          err.status,
          err.code ?? "request_failed",
          err.message ?? "The collaboration request could not be completed.",
        );
      }
      return next(error);
    }
  }),
);

const transferBodySchema = z.object({
  newOwner: stellarAddressSchema,
});

collaborationRouter.post(
  "/projects/:projectId/transfer-ownership",
  requireStellarAddress,
  withResponseValidation(OwnershipTransferResponseSchema, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = transferBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;
      const requesterAddress = res.locals.requesterAddress as string;
      const projectContext = await resolveRoleContext(projectId);
      if (!projectContext) {
        return sendErrorResponse(res, 404, "project_owner_unknown", "Project owner is not known.");
      }
      // Seed the owner only when this process has never seen the project.
      // Re-seeding from the role context on every request would overwrite the
      // owner recorded by a prior transfer, handing the previous owner their
      // transfer rights back.
      if (!getProjectOwner(projectId)) {
        setProjectOwner(projectId, projectContext.owner);
      }
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
        return sendErrorResponse(
          res,
          err.status,
          err.code ?? "request_failed",
          err.message ?? "The collaboration request could not be completed.",
        );
      }
      return next(error);
    }
  }),
);

