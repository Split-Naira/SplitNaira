/**
 * Issue #1262: Structured audit logging for privileged operations.
 *
 * Records actor, action, target, request ID, and outcome for every admin
 * mutation. Secrets and sensitive payload fields are redacted before
 * persistence so the audit log itself is safe to query by operators.
 *
 * Consistent event names:
 *   - Derived from the final path segment with hyphens replaced by underscores.
 *   - Always lowercase.
 *
 * Redacted fields (case-insensitive key match):
 *   - `apiKey`, `api_key`, `secret`, `token`, `password`, `privateKey`,
 *     `private_key`, `seed`, `xdr`, `signedXdr`, `signature`, `sig`,
 *     `authorization`, `bearerToken`, `privatePayload`
 */

import type { NextFunction, Request, Response } from "express";
import { getDataSource } from "../services/database.js";
import { AuditLog } from "../entities/AuditLog.js";
import { hashIp } from "./payments-admin.js";
import { logger } from "../services/logger.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Keys whose values must never appear in the audit log payload.
 * Matching is case-insensitive and normalises camelCase / snake_case.
 */
const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "token",
  "password",
  "privatekey",
  "private_key",
  "seed",
  "xdr",
  "signature",
  "sig",
  "secretkey",
  "secret_key",
  "mnemonic",
  "authorization",
  "bearertoken",
  "signedxdr",
  "signedtransactionxdr",
  "privatepayload",
]);

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""));
}

/**
 * Redacts known-sensitive fields recursively, including values inside arrays.
 *
 * Returns a new object; the original is never mutated.
 */
export function redactSensitivePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redactValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(redactValue);
    }
    if (value === null || typeof value !== "object") {
      return value;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = isRedactedKey(key) ? "[REDACTED]" : redactValue(nestedValue);
    }
    return redacted;
  };

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    redacted[key] = isRedactedKey(key) ? "[REDACTED]" : redactValue(value);
  }
  return redacted;
}

/**
 * Derives a consistent, lowercase snake_case event name from the request path.
 * e.g. `/splits/admin/pause-distributions` → `pause_distributions`
 */
export function deriveEventName(req: Request): string {
  const path = req.path.replace(/^\/+/, "");
  const segments = path.split("/").filter(Boolean);
  const resource = segments[segments.length - 1] ?? "unknown";
  return resource.replace(/-/g, "_").toLowerCase();
}

/**
 * Extracts the actor identity from the request.
 *
 * For admin routes the actor is the wallet address supplied in the payload
 * (if any) or extracted from authenticated request context. Falls back to
 * `null` when no principal is identifiable (anonymous admin key usage).
 */
function extractActor(req: Request): string | null {
  // Authenticated JWT routes attach `req.user`
  const user = (req as Request & { user?: { walletAddress?: string } }).user;
  if (user?.walletAddress) {
    return user.walletAddress;
  }

  // Admin payloads often include an `admin` wallet address field
  const body = req.body as Record<string, unknown> | null | undefined;
  if (body && typeof body === "object") {
    if (typeof body.admin === "string" && body.admin.length > 0) {
      return body.admin;
    }
  }

  return null;
}

function buildPayload(req: Request): Record<string, unknown> | null {
  const body = req.body;
  if (body === undefined || body === null) {
    return null;
  }

  let raw: Record<string, unknown>;
  if (typeof body === "object" && !Array.isArray(body)) {
    raw = body as Record<string, unknown>;
  } else {
    raw = { value: body };
  }

  // Issue #1262: always redact sensitive fields before persistence.
  return redactSensitivePayload(raw);
}

function buildFailureMetadata(req: Request, res: Response): Record<string, unknown> {
  return {
    action: deriveEventName(req),
    requestId: String(res.locals.requestId ?? ""),
    route: req.originalUrl,
    statusCode: res.statusCode,
  };
}

async function persistAuditLog(
  req: Request,
  res: Response,
  outcome: "success" | "failure" | "blocked"
): Promise<void> {
  try {
    const dataSource = getDataSource();
    const repository = dataSource.getRepository(AuditLog);
    const entry = repository.create({
      action: deriveEventName(req),
      ipHash: hashIp(req.ip),
      requestId: String(res.locals.requestId ?? ""),
      // Issue #1262: record the authenticated actor
      actor: extractActor(req),
      // Issue #1262: record the stable outcome category
      outcome,
      payload: outcome === "success" ? buildPayload(req) : buildFailureMetadata(req, res),
    });
    await repository.save(entry);
  } catch (error) {
    logger.error("Failed to persist admin audit log", { error, path: req.originalUrl });
  }
}

/**
 * Records an audit log row after each admin mutation under /splits/admin.
 *
 * - Successful mutations (2xx): logged with redacted request payload.
 * - Failed mutations (non-2xx, non-5xx): logged with sanitized failure
 *   metadata (action, requestId, route, statusCode).
 * - Blocked mutations (503 write-disabled): logged with outcome `blocked`.
 *
 * The middleware never exposes raw tokens, headers, or credentials — the
 * `redactSensitivePayload` helper strips known-sensitive keys before write.
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
    let outcome: "success" | "failure" | "blocked";
    if (res.statusCode >= 200 && res.statusCode < 300) {
      outcome = "success";
    } else if (res.statusCode === 503) {
      outcome = "blocked";
    } else {
      outcome = "failure";
    }
    void persistAuditLog(req, res, outcome);
  });

  next();
}
