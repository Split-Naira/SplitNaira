import { z, ZodError } from "zod";
import { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger.js";

export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

// In-process counter — exposed for tests and metrics endpoints.
let _validationFailureCount = 0;

export function getValidationFailureCount(): number {
  return _validationFailureCount;
}

export function resetValidationFailureCount(): void {
  _validationFailureCount = 0;
}

/**
 * Wraps a route handler and validates its JSON response body against
 * a Zod schema before sending it to the client.
 *
 * Behaviour on schema mismatch:
 *  - Always increments the in-process failure counter and logs the diff.
 *  - Returns 500 when strict mode is active (production default, or when
 *    STRICT_RESPONSE_VALIDATION=true is set explicitly).
 *  - In non-strict mode, logs-only and forwards the original body so
 *    development iteration is not blocked by partial coverage.
 *
 * Enable strict mode: set STRICT_RESPONSE_VALIDATION=true
 * Disable in production: set STRICT_RESPONSE_VALIDATION=false (not recommended)
 *
 * NOTE on Streaming Routes:
 * Persistent streaming routes (such as SSE endpoints `GET /events`,
 * `GET /events/transactions/:txHash`, and Prometheus `GET /metrics`) stream
 * chunks directly over open connections with `text/event-stream` or `text/plain`
 * content types. These are intentionally exempt from `withResponseValidation`
 * single-payload JSON checking.
 */
export function withResponseValidation<T>(
  schema: z.ZodType<T>,
  handler: RouteHandler,
): RouteHandler {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (body: unknown) => {
      // Bypasses schema validation for error responses (4xx, 5xx), which follow
      // their own standardized error envelope schemas and should not trigger false
      // mismatches against success schemas.
      if (res.statusCode >= 400) {
        return originalJson(body);
      }

      const result = schema.safeParse(body);

      if (!result.success) {
        _validationFailureCount += 1;

        const formatted = formatZodError(result.error);
        const requestId = res.locals.requestId as string | undefined;

        logger.error("Response schema validation failed", {
          requestId,
          method: req.method,
          path: req.path,
          errors: formatted,
          validationFailureCount: _validationFailureCount,
        });

        if (isStrictMode()) {
          res.status(500);
          return originalJson({
            error: "internal_error",
            message: "Response schema validation failed.",
            requestId,
            details: {},
          });
        }
      }

      return originalJson(body);
    };

    return handler(req, res, next);
  };
}

function isStrictMode(): boolean {
  const explicit = process.env.STRICT_RESPONSE_VALIDATION;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Default: strict in production, lenient elsewhere.
  return process.env.NODE_ENV === "production";
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => `  [${i.path.join(".")}] ${i.message}`)
    .join("\n");
}
