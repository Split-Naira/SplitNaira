/**
 * Rate limiting middleware (#290 — DDoS protection).
 *
 * Layered strategy:
 *   1. `globalLimiter`  — hard ceiling on all inbound traffic. Applied first
 *      at the app level so it catches every route including unknown paths.
 *   2. `readLimiter`    — general read endpoints.
 *   3. `writeLimiter`   — state-changing / mutation endpoints.
 *   4. `adminLimiter`   — admin-only surfaces.
 *   5. `authLimiter`    — strict per-IP limit for wallet / auth flows to
 *      prevent credential-stuffing and replay-attack bursts.
 *
 * All limits are configurable via environment variables so they can be
 * tightened in production without a code deploy.
 */

import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

function rateLimitHandler(req: Request, res: Response) {
  return res.status(429).json({
    error: "rate_limited",
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later.",
    retryAfter: res.getHeader("Retry-After"),
    requestId: res.locals.requestId as string | undefined,
  });
}

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);

/**
 * Global safety-net limiter — applied to EVERY route.
 * Protects the process from catastrophic volumetric floods.
 * Default: 500 req / 15 min per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 500),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Skip well-known health check calls from internal monitors
  skip: (req) => req.path === "/health" && req.method === "GET",
});

/** General read endpoints — 100 requests per 15 minutes. */
export const readLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_MAX ?? 100),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Write / mutation endpoints — 30 requests per 15 minutes. */
export const writeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_WRITE_MAX ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Admin endpoints — 20 requests per 15 minutes. */
export const adminLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_ADMIN_MAX ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** SSE connection limiter — protects event stream endpoints from excessive connection rate. */
export const sseConnectionLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_SSE_MAX ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/**
 * Auth / wallet endpoints — strict burst cap to prevent credential stuffing
 * and replay-attack floods.
 * Default: 10 requests per 5 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? 5 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
