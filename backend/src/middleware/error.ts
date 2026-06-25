import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { logger } from "../services/logger.js";
import { RpcError } from "../services/stellar.js";

function formatZodError(err: ZodError) {
  const flattened = err.flatten();
  return {
    code: "VALIDATION_ERROR",
    error: "validation_error",
    message: "Invalid request payload.",
    details: { fieldErrors: flattened.fieldErrors, formErrors: flattened.formErrors },
  };
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: "not_found",
    message: "Route not found.",
    requestId: res.locals.requestId,
    details: {}
  });
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = res.locals.requestId;

  if (err && typeof err === "object" && "errors" in err && Array.isArray((err as ZodError).errors)) {
    return res.status(400).json({
      ...formatZodError(err as unknown as ZodError),
      requestId,
    });
  }

  const isAppError = err && typeof err === "object" && "type" in err && "code" in err;

  if (isAppError) {
    const appError = err as AppError;
    const status =
      appError.code === ErrorCode.NOT_FOUND
        ? 404
        : appError.type === ErrorType.VALIDATION || appError.type === ErrorType.AUTH
          ? 400
          : 500;

    logger.error("Application error", {
      requestId,
      type: err.type,
      code: err.code,
      message: err.message,
      details: err.details
    });

    return res.status(status).json({
      error: err.code.toLowerCase(),
      code: err.code,
      message: err.message,
      requestId,
      details: err.details || { remediation: err.remediation }
    });
  }

  logger.error("Unhandled error", { requestId, err: err.stack || err.message || err });
  if (process.env.SENTRY_DSN) {
    void import("@sentry/node").then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag("requestId", requestId);
        Sentry.captureException(err);
      });
    });
  }

  if (err instanceof RpcError) {
    return res.status(err.statusCode).json({
      error: "rpc_error",
      message: err.message,
      requestId,
      details: {}
    });
  }

  res.status(500).json({
    error: "internal_error",
    message: err.message || "Unexpected server error.",
    requestId,
    details: {}
  });
}
