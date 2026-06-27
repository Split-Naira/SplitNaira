import type { NextFunction, Request, Response } from "express";
import { getDataSource } from "../services/database.js";
import { AuditLog } from "../entities/AuditLog.js";
import { hashIp } from "./payments-admin.js";
import { logger } from "../services/logger.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function deriveAction(req: Request): string {
  const path = req.path.replace(/^\/+/, "");
  const segments = path.split("/").filter(Boolean);
  const resource = segments[segments.length - 1] ?? "unknown";
  return resource.replace(/-/g, "_");
}

function buildPayload(req: Request): Record<string, unknown> | null {
  const body = req.body;
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return { value: body };
}

async function persistAuditLog(req: Request, res: Response): Promise<void> {
  try {
    const dataSource = getDataSource();
    const repository = dataSource.getRepository(AuditLog);
    const entry = repository.create({
      action: deriveAction(req),
      ipHash: hashIp(req.ip),
      requestId: String(res.locals.requestId ?? ""),
      payload: buildPayload(req)
    });
    await repository.save(entry);
  } catch (error) {
    logger.error("Failed to persist admin audit log", { error, path: req.originalUrl });
  }
}

/**
 * Records an audit log row after each successful admin mutation under /splits/admin.
 * Failed or rejected requests are not logged.
 */
export function auditAdminMutationsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!MUTATION_METHODS.has(req.method)) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void persistAuditLog(req, res);
    }
  });

  next();
}
