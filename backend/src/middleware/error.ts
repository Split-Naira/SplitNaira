import type { NextFunction, Request, Response } from "express";
import { RequestValidationError } from "../services/stellar.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: "not_found",
    message: "Route not found.",
    requestId: res.locals.requestId
  });
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = res.locals.requestId;

  if (err instanceof RequestValidationError) {
    res.status(400).json({
      error: "validation_error",
      message: err.message,
      requestId
    });
    return;
  }

  console.error({ requestId, err });
  res.status(500).json({
    error: "internal_error",
    message: "Unexpected server error.",
    requestId
  });
}
