import type { RequestHandler } from "express";
import { randomUUID } from "crypto";

/**
 * Generates (or propagates) a request correlation id.
 * - Accepts inbound `x-request-id`
 * - Always sets `res.locals.requestId`
 * - Mirrors it back in the response header
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const requestId = typeof incoming === "string" && incoming.trim().length > 0
    ? incoming.trim()
    : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};

