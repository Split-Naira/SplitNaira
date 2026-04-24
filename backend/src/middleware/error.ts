import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";

import { RpcError } from "../services/stellar.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: "not_found",
    code: ErrorCode.NOT_FOUND,
    type: ErrorType.RPC,
    message: "Route not found.",
    requestId: res.locals.requestId
  });
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = res.locals.requestId;
  
  // Use property check instead of instanceof for better compatibility with different module instances/mocks
  const isAppError = err && typeof err === "object" && "type" in err && "code" in err;

  if (isAppError) {
    const appError = err as AppError;
    const status = appError.type === ErrorType.VALIDATION || appError.type === ErrorType.AUTH ? 400 : 500;
    
    // Log structured error
    console.error({
      requestId,
      type: err.type,
      code: err.code,
      message: err.message,
      details: err.details
    });

    return res.status(status).json({
      error: err.code.toLowerCase(),
      code: err.code,
      type: err.type,
      message: err.message,
      remediation: err.remediation,
      requestId
    });
  }

  // Fallback for generic errors
  console.error({ requestId, err: err.stack || err.message || err });

  if (err instanceof RpcError) {
    return res.status(err.statusCode).json({
      error: "rpc_error",
      message: err.message,
      requestId
    });
  }

  res.status(500).json({
    error: "internal_error",
    code: ErrorCode.INTERNAL_ERROR,
    type: ErrorType.INTERNAL,
    message: err.message || "Unexpected server error.",
    requestId
  });
}
