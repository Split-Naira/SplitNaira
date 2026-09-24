import type { RequestHandler } from "express";
import {
  decrementInflightRequests,
  incrementInflightRequests,
  recordRequestMetrics,
  recordRequestPayloadRejected,
  recordRequestPayloadSize,
} from "../services/metrics.js";

function sanitizeRoute(req: Parameters<RequestHandler>[0]): string {
  const baseUrl = req.baseUrl ?? "";
  const routePath = req.route?.path ?? req.path;
  const route = `${baseUrl}${routePath}`.replace(/\/$/, "") || "/";
  return route;
}

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  incrementInflightRequests();
  const start = process.hrtime.bigint();
  let ended = false;

  const finalize = () => {
    if (ended) return;
    ended = true;
    decrementInflightRequests();
  };

  res.once("finish", () => {
    const elapsedNs = Number(process.hrtime.bigint() - start);
    const elapsedMs = elapsedNs / 1_000_000;
    const route = sanitizeRoute(req);
    recordRequestMetrics(req.method, route, res.statusCode, elapsedMs);
    finalize();
  });

  res.once("close", finalize);
  next();
};

/**
 * Issue #1090: route groups used as the `route_group` label for payload size
 * telemetry. Longest-prefix entries come first (`/splits/admin` before
 * `/splits`). Anything unmatched is reported as `other`, which keeps label
 * cardinality bounded even for scanner traffic hitting random paths.
 */
const ROUTE_GROUPS: ReadonlyArray<readonly [prefix: string, group: string]> = [
  ["/splits/admin", "splits_admin"],
  ["/splits", "splits"],
  ["/users", "users"],
  ["/auth", "auth"],
  ["/transactions", "transactions"],
  ["/events", "events"],
  ["/api/ledger", "ledger"],
  ["/api/openapi.json", "docs"],
  ["/api/docs", "docs"],
  ["/docs", "docs"],
  ["/ops", "ops"],
  ["/health", "health"],
  ["/metrics", "metrics"],
];

export function resolveRouteGroup(path: string): string {
  if (path === "/" || path === "") return "root";
  for (const [prefix, group] of ROUTE_GROUPS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return group;
  }
  return "other";
}

function parseContentLength(header: string | undefined): number | null {
  if (header === undefined || !/^\d+$/.test(header)) return null;
  const bytes = Number(header);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/**
 * Records the declared request body size (Content-Length) per route group,
 * plus a rejection counter for 413 responses.
 *
 * Must be mounted BEFORE `express.json()`: the body parser rejects oversized
 * bodies with an error that skips every later middleware, so a later mount
 * would never see the requests this telemetry most needs to count.
 *
 * Requests without a Content-Length (bodiless GETs, chunked uploads) are not
 * recorded; `express.json()` still enforces the size limit on those.
 */
export const payloadSizeMetricsMiddleware: RequestHandler = (req, res, next) => {
  const bytes = parseContentLength(req.headers["content-length"]);
  if (bytes === null) {
    next();
    return;
  }

  const routeGroup = resolveRouteGroup(req.path);
  recordRequestPayloadSize(routeGroup, bytes);
  res.once("finish", () => {
    if (res.statusCode === 413) recordRequestPayloadRejected(routeGroup);
  });
  next();
};
