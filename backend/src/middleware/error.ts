import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { ZodError } from "zod";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { logger } from "../services/logger.js";
import { RpcError, RpcTimeoutError } from "../services/stellar.js";
import { sanitizeInboundRequestId } from "./request-id.js";

const isProduction = process.env.NODE_ENV === "production";

function formatZodError(err: ZodError) {
  const flattened = err.flatten();
  return {
    code: "VALIDATION_ERROR",
    error: "validation_error",
    message: "Invalid request payload.",
    details: { fieldErrors: flattened.fieldErrors, formErrors: flattened.formErrors },
  };
}

/**
 * Issue #1640: stable error envelope for route-local failures.
 *
 * Routes that answer a failure themselves (instead of throwing to
 * `errorHandler`) must still emit the same machine-readable shape:
 * `{ error, code, message, requestId, details }`. `error` keeps its existing
 * snake_case value for backwards compatibility and `code` is its stable
 * UPPER_SNAKE form, so clients can branch on `code` across every route family.
 * `extra` carries route-specific top-level fields that predate this contract
 * (e.g. `decision` on a blocked deletion); it can never override the envelope.
 */
export function sendErrorResponse(
  res: Response,
  status: number,
  error: string,
  message: string,
  details: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const requestId = (res.locals.requestId as string | undefined) ?? randomUUID();
  res.locals.requestId = requestId;
  if (typeof res.getHeader === "function" && !res.getHeader("x-request-id")) {
    res.setHeader("x-request-id", requestId);
  }
  return res.status(status).json({
    ...extra,
    error,
    code: error.toUpperCase(),
    message,
    requestId,
    details,
  });
}

/**
 * Issue #1460: stable unknown-route response contract.
 *
 * The body is intentionally static. The previous implementation echoed the
 * request line (`Route not found: ${req.method} ${req.originalUrl}`), which
 * (a) turned the response into an attacker-controlled reflection surface and
 * (b) leaked internal routing detail. Clients branch on the machine-readable
 * `error`/`code` fields, never on the message, so the message is fixed.
 *
 * Must stay byte-for-byte in step with docs/runbooks/api-evolution-runbook.md
 * ("Unknown-route contract").
 */
export function notFoundHandler(_req: Request, res: Response) {
  const requestId = res.locals.requestId ?? randomUUID();
  res.status(404).json({
    error: "not_found",
    code: "NOT_FOUND",
    message: "The requested resource does not exist.",
    requestId,
    details: {},
  });
}

/**
 * Maps an AppError to an HTTP status code.
 *
 * ASSUMPTION: this only knows about the ErrorCode/ErrorType members
 * already referenced in the original handler (NOT_FOUND, VALIDATION,
 * AUTH). If lib/errors.js defines more (CONFLICT, FORBIDDEN,
 * RATE_LIMITED, etc.), add them below — otherwise they'll silently fall
 * through to 500.
 *
 * Checks for an explicit `statusCode` on the error first. Longer term
 * it's more robust to have AppError carry its own status at the point
 * it's thrown (`throw new AppError(..., { statusCode: 409 })`) than to
 * have this handler reverse-engineer HTTP semantics from a business enum
 * — this function supports that without requiring it.
 */
function resolveAppErrorStatus(err: AppError): number {
  const explicitStatus = (err as AppError & { statusCode?: unknown }).statusCode;
  if (typeof explicitStatus === "number") {
    return explicitStatus;
  }

  if (err.code === ErrorCode.NOT_FOUND) return 404;
  if (err.type === ErrorType.VALIDATION) return 400;
  // Auth *failures* (missing/invalid credentials) are 401, not 400. The
  // original mapping returned 400 here, which tells the client "your
  // request is malformed" instead of "you're not authenticated" — the
  // wrong signal for e.g. a frontend deciding whether to redirect to login.
  if (err.type === ErrorType.AUTH) return 401;
  if (err.type === ErrorType.CONFLICT) return 409;
  return 500;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // If a response has already started streaming, sending another JSON
  // body throws "Cannot set headers after they are sent" and crashes the
  // process instead of gracefully handling the error. Hand off to
  // Express's default handler in that case.
  if (res.headersSent) {
    return next(err);
  }

  // Issue #1032: Every error response must carry a non-empty requestId.
  // When a parse error fires before the requestId middleware has run,
  // res.locals.requestId is undefined — generate one so the response is
  // still correlatable. #1640: in that case honour a safe client-supplied
  // correlation id (same sanitisation as requestIdMiddleware), so a client can
  // still match the failure to the request it sent.
  const requestId =
    res.locals.requestId ??
    sanitizeInboundRequestId(req.header?.("x-request-id")) ??
    sanitizeInboundRequestId(req.header?.("x-correlation-id")) ??
    randomUUID();
  res.locals.requestId = requestId;
  if (!res.getHeader("x-request-id")) {
    res.setHeader("x-request-id", requestId);
  }

  // Real instanceof check instead of duck-typing on err.name/err.issues —
  // ZodError is a real exported class, so this is both simpler and more
  // reliable than reflecting on shape.
  if (err instanceof ZodError) {
    return res.status(400).json({
      ...formatZodError(err),
      requestId,
    });
  }

  if (err instanceof AppError) {
    const status = resolveAppErrorStatus(err);

    // Client-caused errors (bad input, bad/missing auth, not found) are
    // expected traffic, not bugs in our code — log them at `warn` so they
    // don't pollute error-rate alerts the way a genuine 500 should.
    const logLevel = status >= 500 ? "error" : "warn";
    logger[logLevel]("Application error", {
      requestId,
      path: req.originalUrl,
      method: req.method,
      type: err.type,
      code: err.code,
      message: err.message,
      details: err.details,
    });

    return res.status(status).json({
      error: err.code.toLowerCase(),
      code: err.code,
      message: err.message,
      requestId,
      // Previously `err.details || { remediation: err.remediation }` —
      // if details existed but had no remediation baked in, remediation
      // was silently dropped. Merge both instead of picking one.
      details: {
        ...(err.details && typeof err.details === "object" ? err.details : {}),
        ...(err.remediation ? { remediation: err.remediation } : {}),
      },
    });
  }

  // Express body-parser malformed-JSON (400) — thrown by express.json()
  // when the request body contains invalid JSON syntax.  Handle it before
  // the generic "unhandled error" path so clients always get a predictable
  // 400 error shape instead of a 500.  (Issue #1028)
  const parseError = err as { type?: string; status?: number; statusCode?: number; message?: string };
  if (parseError.type === "entity.parse.failed") {
    logger.warn("Malformed JSON payload", {
      requestId,
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(400).json({
      error: "invalid_json",
      code: "INVALID_JSON",
      message: "Malformed JSON in request body.",
      requestId,
      details: {},
    });
  }

  // Express body-parser entity-too-large (413) — thrown by express.json()
  // when the request body exceeds its configured size limit (default 1mb).
  // Handle it before the generic "unhandled error" path so the correct 413
  // status is returned instead of an opaque 500. (Issue #840)
  const entityTooLarge = err as { type?: string; status?: number };
  if (entityTooLarge.type === "entity.too.large" && entityTooLarge.status === 413) {
    logger.warn("Request body too large", {
      requestId,
      path: req.originalUrl,
      method: req.method,
      contentLength: req.headers["content-length"],
    });
    return res.status(413).json({
      error: "payload_too_large",
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the maximum allowed size (1 MB).",
      requestId,
      details: {},
    });
  }

  // Issue #1260: PostgreSQL unique-constraint violation (SQLSTATE 23505).
  // These are thrown by TypeORM when a concurrent INSERT races past an
  // application-level check and hits the database index.  Map them to 409
  // so clients and callers get a predictable, machine-readable conflict
  // signal instead of an opaque 500.
  //
  // We match on the stable pg error code rather than message text because
  // TypeORM wraps the error in its own QueryFailedError and the message
  // format has varied across versions.
  const pgError = err as { code?: unknown; message?: string };
  if (pgError.code === "23505") {
    logger.warn("Database unique constraint violation", {
      requestId,
      path: req.originalUrl,
      method: req.method,
      constraint: (err as { constraint?: string }).constraint,
    });
    return res.status(409).json({
      error: "conflict",
      code: "DUPLICATE_RESOURCE",
      message: "A resource with this identifier already exists.",
      requestId,
      details: {},
    });
  }

  // RPC errors are expected, transient failure modes of talking to an
  // external dependency (Horizon/soroban-rpc), not bugs in this service.
  // Handling them here — before the generic "unhandled error" path below
  // — means they're logged at a level that reflects "dependency hiccup"
  // rather than "our code broke", and they're never reported to Sentry as
  // an unhandled exception.
  if (err instanceof RpcTimeoutError) {
    logger.warn("RPC timeout", { requestId, path: req.originalUrl, message: err.message });
    return res.status(504).json({
      error: "timeout_error",
      code: "RPC_TIMEOUT",
      message: err.message,
      requestId,
      details: {},
    });
  }

  if (err instanceof RpcError) {
    logger.warn("RPC error", {
      requestId,
      path: req.originalUrl,
      statusCode: err.statusCode,
      message: err.message,
    });
    return res.status(err.statusCode).json({
      error: "rpc_error",
      code: "RPC_ERROR",
      message: err.message,
      requestId,
      details: {},
    });
  }

  // Anything left is genuinely unexpected. A thrown value isn't
  // guaranteed to be an Error instance (`throw "oops"` is legal JS), so
  // normalize it before touching .stack/.message.
  const normalizedErr = err instanceof Error ? err : new Error(String(err));

  logger.error("Unhandled error", {
    requestId,
    path: req.originalUrl,
    method: req.method,
    err: normalizedErr.stack || normalizedErr.message,
  });

  if (process.env.SENTRY_DSN) {
    void import("@sentry/node").then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag("requestId", requestId);
        Sentry.captureException(normalizedErr);
      });
    });
  }

  res.status(500).json({
    error: "internal_error",
    code: "INTERNAL_ERROR",
    // Never leak internal error messages (stack traces, DB connection
    // errors, third-party error text) to the client in production — the
    // real message is already captured in the log line above. In dev, show
    // it for faster debugging.
    message: isProduction ? "Unexpected server error." : normalizedErr.message,
    requestId,
    details: {},
  });
}
