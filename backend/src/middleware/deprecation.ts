import type { NextFunction, Request, Response } from "express";

/**
 * Issue #1459: API deprecation response headers.
 *
 * Endpoints that are scheduled for removal advertise it on every response so
 * clients can migrate before the sunset date without having to parse release
 * notes. Headers follow the relevant IETF specs:
 *
 *   - `Deprecation` (RFC 9745) — the IMF-fixdate the endpoint became
 *     deprecated. Clients should treat any value as "migrate now".
 *   - `Sunset` (RFC 8594) — the IMF-fixdate after which the endpoint may stop
 *     responding.
 *   - `Link` with `rel="deprecation"` — where the replacement lives.
 *
 * The registry below is the single source of truth. To schedule an endpoint
 * for removal, add an entry and mount `deprecationHeaders("<key>")` on the
 * route. Nothing here weakens auth, validation, or rate limiting: the
 * middleware is purely additive and never short-circuits the request.
 */

export type DeprecationPolicyKey = keyof typeof API_DEPRECATIONS;

export interface DeprecationPolicy {
  /** Stable identifier referenced from config, tests, and docs. */
  key: string;
  /** When the endpoint was announced deprecated. */
  deprecatedAt: string | Date;
  /** When the endpoint is scheduled to stop responding. Must be after `deprecatedAt`. */
  sunset: string | Date;
  /** Replacement endpoint path or migration guide URL. */
  replacement: string;
  /** Short human-readable note surfaced in documentation. */
  documentation?: string;
}

/**
 * Single source of truth for deprecations. Registering a route here is a
 * prerequisite for the `Deprecation`/`Sunset` headers being emitted; the
 * registry is validated at module load so an invalid date fails fast at boot
 * rather than on the first request.
 */
export const API_DEPRECATIONS: Record<string, DeprecationPolicy> = {
  "health-alias": {
    key: "health-alias",
    // `GET /health` is a backwards-compatibility alias for `GET /health/ready`
    // (see routes/health.ts). New monitors/automation should target
    // `/health/ready` directly; the alias is retained until the sunset date.
    deprecatedAt: "2026-01-01T00:00:00.000Z",
    sunset: "2027-01-01T00:00:00.000Z",
    replacement: "/health/ready",
    documentation:
      "GET /health is a backwards-compatibility alias for GET /health/ready and is scheduled for removal.",
  },
  "wallet-login-address-only": {
    key: "wallet-login-address-only",
    // Issue #1232: signing in with nothing but a public wallet address proves
    // no ownership. The signed flow (`/auth/wallet/challenge` +
    // `/auth/wallet/verify`) is the replacement; this endpoint is kept only
    // until existing clients migrate.
    deprecatedAt: "2026-11-22T00:00:00.000Z",
    sunset: "2027-06-30T00:00:00.000Z",
    replacement: "/auth/wallet/verify",
    documentation:
      "POST /users/login authenticates from a public wallet address alone. Use the signed wallet challenge flow instead.",
  },
};

/** HTTP-date (IMF-fixdate) formatter used by RFC 9745 / RFC 8594 headers. */
export function toHttpDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid deprecation date: ${String(value)}`);
  }
  return date.toUTCString();
}

/**
 * Builds the full set of deprecation headers for a policy. Throws when the
 * policy is malformed (invalid date, or sunset not after the deprecation
 * date) so misconfiguration is loud instead of silently serving no headers.
 */
export function buildDeprecationHeaders(policy: DeprecationPolicy): Record<string, string> {
  const deprecatedAt = toHttpDate(policy.deprecatedAt);
  const sunset = toHttpDate(policy.sunset);

  if (new Date(policy.sunset).getTime() <= new Date(policy.deprecatedAt).getTime()) {
    throw new RangeError(
      `Deprecation policy "${policy.key}" must sunset after it is deprecated.`,
    );
  }

  return {
    Deprecation: deprecatedAt,
    Sunset: sunset,
    Link: `<${policy.replacement}>; rel="deprecation"`,
  };
}

// Validate the registry once at import time. A bad policy is a deploy-time
// programming error, not a per-request failure mode.
for (const policy of Object.values(API_DEPRECATIONS)) {
  buildDeprecationHeaders(policy);
}

/**
 * Express middleware that advertises a deprecation on the response. Accepts a
 * registry key (preferred) or an inline policy. Unknown keys throw when the
 * middleware is constructed — i.e. during app boot — so typos can't silently
 * produce an endpoint that is documented as deprecated but never advertises it.
 */
export function deprecationHeaders(
  policy: DeprecationPolicy | keyof typeof API_DEPRECATIONS,
) {
  let resolved: DeprecationPolicy | undefined;
  if (typeof policy === "string") {
    resolved = API_DEPRECATIONS[policy];
    if (!resolved) {
      throw new Error(`Unknown deprecation policy: ${policy}`);
    }
  } else {
    resolved = policy;
  }

  const headers = buildDeprecationHeaders(resolved);
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}

/** Snapshot of every registered deprecation, for docs and contract tests. */
export function listDeprecations(): DeprecationPolicy[] {
  return Object.values(API_DEPRECATIONS);
}
