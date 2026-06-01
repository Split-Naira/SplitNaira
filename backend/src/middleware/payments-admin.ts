import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";

export const PAYMENTS_ADMIN_API_KEY_HEADER = "x-admin-api-key";

function hashIp(ip: string | undefined): string {
  if (!ip) return "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function hasMatchingApiKey(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function logBlockedAdminRequest(req: Request, res: Response, reason: string): void {
  logger.warn("Blocked payments admin request", {
    reason,
    method: req.method,
    path: req.originalUrl,
    requestId: res.locals.requestId,
    ip: hashIp(req.ip)
  });
}

export function requirePaymentsAdminAccess(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const env = getEnv();
  const expectedKey = env.PAYMENTS_ADMIN_API_KEY?.trim();

  if (!expectedKey) {
    next();
    return;
  }

  const providedKey = req.header(PAYMENTS_ADMIN_API_KEY_HEADER)?.trim();
  if (!providedKey || !hasMatchingApiKey(expectedKey, providedKey)) {
    logBlockedAdminRequest(req, res, "invalid_api_key");
    res.status(401).json({
      error: "admin_auth_required",
      message: "Payments admin authentication failed.",
      requestId: res.locals.requestId,
      details: {}
    });
    return;
  }

  next();
}

export function enforcePaymentsAdminWriteEnabled(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const env = getEnv();
  if (env.PAYMENTS_ADMIN_WRITE_ENABLED !== "false") {
    next();
    return;
  }

  logBlockedAdminRequest(req, res, "writes_disabled");
  res.status(503).json({
    error: "payments_admin_writes_disabled",
    message: "Payments admin write operations are temporarily disabled.",
    requestId: res.locals.requestId,
    details: {
      rollbackAware: true
    }
  });
}
