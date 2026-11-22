import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import { sendErrorResponse } from "./error.js";

export const PAYMENTS_ADMIN_API_KEY_HEADER = "x-admin-api-key";

export function hashIp(ip: string | undefined): string {
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
    sendErrorResponse(res, 401, "admin_auth_required", "Payments admin authentication failed.");
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
  sendErrorResponse(
    res,
    503,
    "payments_admin_writes_disabled",
    "Payments admin write operations are temporarily disabled.",
    { rollbackAware: true },
  );
}
