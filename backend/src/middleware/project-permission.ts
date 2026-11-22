/**
 * Project permission middleware (#1300).
 *
 * Server-side enforcement for the collaborator permissions matrix.
 *
 * The role is resolved from the *authenticated* requester address against the
 * project's stored collaboration record — never from a request body. A caller
 * that can name its own role can grant itself one, which is exactly what the
 * matrix exists to prevent.
 *
 * Composed after `requireStellarAddress`, which validates the
 * `X-Stellar-Address` header and puts the verified address on `res.locals`.
 */

import type { NextFunction, Request, Response } from "express";
import {
  assertProjectPermission,
  type ProjectPermission,
  type ProjectRoleContext,
} from "../services/collaboration/permissions.js";
import { sendErrorResponse } from "./error.js";

/**
 * Authoritative source for a project's collaboration record, or `null` when the
 * project is unknown. Implementations read stored/on-chain state; they must
 * never derive the record from the request being authorized.
 */
export type ProjectRoleContextResolver = (
  projectId: string,
) => Promise<ProjectRoleContext | null>;

/**
 * Middleware allowing the request only when the authenticated requester's
 * *resolved* role grants `permission`.
 *
 * Fails closed. An unresolvable project, an unrecognised requester, or a
 * resolver error all deny the request — none of them falls back to a
 * privileged default.
 */
export function createProjectPermissionMiddleware(
  permission: ProjectPermission,
  resolveContext: ProjectRoleContextResolver,
) {
  return async function projectPermission(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const requesterAddress: string | undefined = res.locals.requesterAddress;

    if (!requesterAddress) {
      sendErrorResponse(
        res,
        401,
        "unauthorized",
        "Authenticate with a signed X-Stellar-Address header before this action.",
      );
      return;
    }

    const projectId = req.params.projectId as string | undefined;
    if (!projectId) {
      sendErrorResponse(res, 400, "project_id_required", "A project id is required.");
      return;
    }

    let context: ProjectRoleContext | null = null;
    try {
      context = await resolveContext(projectId);
    } catch {
      // An unavailable authority is not a reason to assume access.
      context = null;
    }

    try {
      const role = assertProjectPermission(context, requesterAddress, permission);
      res.locals.collaboratorRole = role;
      next();
    } catch (err: unknown) {
      const e = err as { role?: string | null; reason?: string };
      const role = e.role ?? null;
      const reason = e.reason ?? "insufficient_role";
      // Top-level permission/role/reason predate #1640 and are kept for clients.
      sendErrorResponse(
        res,
        403,
        "permission_denied",
        "You do not have permission to perform this action on the project.",
        { permission, role, reason },
        { permission, role, reason },
      );
    }
  };
}
