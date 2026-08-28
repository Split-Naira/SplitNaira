import { createHash } from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { IdempotencyStore, idempotencyStore as defaultStore } from "../services/idempotency.js";
import { incrementIdempotencyConflicts, incrementIdempotencyReplays } from "../services/metrics.js";

const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 255;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/**
 * Deterministic JSON stringify with sorted object keys so two logically
 * identical retries hash the same way even if a client/proxy reorders keys.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(req: Request): string {
  return createHash("sha256")
    .update(`${req.method}:${req.originalUrl}:${stableStringify(req.body)}`)
    .digest("hex");
}

function conflictError(code: ErrorCode, message: string): AppError {
  const error = new AppError(ErrorType.CONFLICT, code, message);
  (error as AppError & { statusCode?: number }).statusCode = 409;
  return error;
}

/**
 * Enforces an idempotency contract on the route it's mounted on:
 *  - No `Idempotency-Key` header: request proceeds as normal (opt-in).
 *  - New key: request proceeds; a successful (2xx) response is cached.
 *  - Same key + same payload, already completed: the cached response is
 *    replayed verbatim without re-running the handler.
 *  - Same key + different payload: rejected with a stable 409 conflict.
 *  - Same key while the original request is still in flight: rejected with
 *    a stable 409 so a concurrent retry can't race the first attempt.
 *  - Key TTL (default 24h, `IDEMPOTENCY_KEY_TTL_MS`) expires: treated as new.
 */
export function idempotencyMiddleware(store: IdempotencyStore = defaultStore): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.header(IDEMPOTENCY_HEADER);
    if (!rawKey) {
      next();
      return;
    }

    const key = rawKey.trim();
    if (key.length === 0 || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
      next(
        new AppError(
          ErrorType.VALIDATION,
          ErrorCode.VALIDATION_ERROR,
          "Idempotency-Key must be 1-255 characters using only letters, numbers, '-', '_', '.', or ':'."
        )
      );
      return;
    }

    const scope = `${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const requestHash = hashRequest(req);
    const existing = store.get(scope, key);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        incrementIdempotencyConflicts();
        next(
          conflictError(
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
            "Idempotency-Key was already used with a different request payload."
          )
        );
        return;
      }

      if (existing.status === "in_progress") {
        incrementIdempotencyConflicts();
        next(
          conflictError(
            ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
            "A request with this Idempotency-Key is still being processed."
          )
        );
        return;
      }

      incrementIdempotencyReplays();
      res.setHeader("Idempotency-Replayed", "true");
      res.status(existing.statusCode ?? 200).json(existing.body);
      return;
    }

    store.markInProgress(scope, key, requestHash);

    let settled = false;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      settled = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.complete(scope, key, requestHash, res.statusCode, body);
      } else {
        store.remove(scope, key);
      }
      return originalJson(body);
    }) as Response["json"];

    res.on("close", () => {
      if (!settled) {
        store.remove(scope, key);
      }
    });

    next();
  };
}
