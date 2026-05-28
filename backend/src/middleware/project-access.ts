/**
 * Project access control middleware (#295).
 *
 * Prevents unauthorized enumeration of private group data by verifying
 * that the requesting Stellar address is either:
 *   1. The project owner, or
 *   2. A listed collaborator on the project
 *
 * The requester's address is read from the `X-Stellar-Address` request header.
 * Callers MUST sign a recent challenge nonce to prove ownership before sending
 * this header (enforced by the wallet-level Freighter signature flow).
 *
 * Routes that serve non-sensitive aggregate data (e.g. allowlist, public
 * project list) should NOT apply this middleware.
 */

import type { Request, Response, NextFunction } from "express";
import {
  STELLAR_ADDRESS_HEADER,
  canAccessProject,
  createUnauthorizedProjectAccessError,
  parseStellarAddressHeader,
  type ProjectAccessTarget,
} from "../services/auth.js";
import { logger } from "../services/logger.js";

export { STELLAR_ADDRESS_HEADER, type ProjectAccessTarget };

/**
 * Validates that the `X-Stellar-Address` header contains a well-formed
 * Stellar address and attaches it to `res.locals.requesterAddress`.
 *
 * Returns 401 if the header is absent or malformed.
 */
export function requireStellarAddress(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const result = parseStellarAddressHeader(
    req.headers[STELLAR_ADDRESS_HEADER] as string | string[] | undefined,
  );

  if (!result.ok) {
    next(result.error);
    return;
  }

  res.locals.requesterAddress = result.address;
  next();
}

/**
 * Returns a middleware that verifies the requester (from `res.locals.requesterAddress`)
 * is either the project owner or a collaborator.
 *
 * `resolveProject` receives the raw `:projectId` param and should return the
 * access target or `null` when the project does not exist.
 *
 * Usage:
 * ```ts
 * splitsRouter.get(
 *   "/:projectId/private",
 *   requireStellarAddress,
 *   requireProjectAccess(async (id) => fetchProjectAccessTarget(id)),
 *   handler,
 * );
 * ```
 */
export function requireProjectAccess(
  resolveProject: (projectId: string) => Promise<ProjectAccessTarget | null>,
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const requester: string = res.locals.requesterAddress;
    const projectId = req.params.projectId as string | undefined;

    if (!projectId) {
      next();
      return;
    }

    try {
      const target = await resolveProject(projectId);

      if (!target) {
        // Project not found — let the route handler return 404
        next();
        return;
      }

      if (!canAccessProject(requester, target)) {
        logger.warn("Unauthorized project access attempt blocked", {
          requester,
          projectId,
          requestId: res.locals.requestId,
          ip: req.ip,
        });
        next(createUnauthorizedProjectAccessError());
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
