/**
 * Collaboration routes – invitations cancel is on auth-email;
 * this module exposes project deletion safeguards (#1296) and
 * permissions introspection (#1300).
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
  resolveCollaboratorRole,
  assertPermission,
  type CollaboratorRole,
} from "../services/collaboration/permissions.js";

export const collaborationRouter = Router();

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
  /** Optional role check – owner/admin required for delete */
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
});

collaborationRouter.post(
  "/projects/:projectId/delete",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = deleteBodySchema.parse(req.body);
      const projectId = req.params.projectId as string;

      if (body.financial.projectId !== projectId) {
        return res.status(400).json({ error: "project_id_mismatch" });
      }

      // Server-side permission enforcement (#1300)
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
        decision,
      });
    } catch (error) {
      return next(error);
    }
  }
);

export { resolveCollaboratorRole };
