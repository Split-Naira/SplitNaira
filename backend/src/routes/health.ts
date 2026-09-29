import { Router, type NextFunction, type Response } from "express";
import { getEnvDiagnostics } from "../config/env.js";
import { getDataSource } from "../services/database.js";
import { checkSorobanReachability } from "../services/stellar.js";
import { getServiceHealth } from "../services/EventListenerService.js";

export const healthRouter = Router();

const SERVICE_VERSION = process.env.npm_package_version ?? "unknown";

let startupComplete = false;
let shuttingDown = false;

/** Mark startup complete after DB and background services are initialised. */
export function markStartupComplete(): void {
  startupComplete = true;
}

export function resetStartupComplete(): void {
  startupComplete = false;
}

export function isStartupComplete(): boolean {
  return startupComplete;
}

/**
 * Marks the service as shutting down so `/health/ready` starts failing
 * immediately, before in-flight work (DB close, SSE drain, server.close)
 * completes. Load balancers stop routing new traffic here without waiting
 * for the process to actually exit.
 */
export function markShuttingDown(): void {
  shuttingDown = true;
}

export function resetShuttingDown(): void {
  shuttingDown = false;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Health endpoint - alias for readiness to preserve backward compatibility.
 */
healthRouter.get("/", async (_req, res, next) => {
  await handleReadiness(_req, res, next);
});

/**
 * Liveness endpoint - indicates service is not in a broken state
 */
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Startup endpoint - indicates initialisation (DB, listeners) is complete.
 * Used by orchestrators that distinguish startup from liveness/readiness.
 */
healthRouter.get("/startup", (_req, res) => {
  if (!startupComplete) {
    res.status(503).json({ status: "starting" });
    return;
  }
  res.json({ status: "started" });
});

/**
 * Readiness endpoint - indicates service is ready to serve traffic
 */
healthRouter.get("/ready", handleReadiness);

// ─── Issue #935: degraded-mode health response contract ────────────────────
//
// Status code / overall-status policy (documented in docs/runbooks/observability.md):
//   - "ready"     -> 200. Every dependency is "up" (or "degraded" event
//                    listener/component logic below doesn't apply).
//   - "degraded"  -> 200. The service is still usable - every hard-failure
//                    check below passed - but at least one dependency
//                    (db/rpc/contract/eventListener) is slow or in a
//                    non-fatal failure state. Callers should keep routing
//                    traffic here; on-call should investigate but this is
//                    not a page-worthy outage on its own.
//   - "not_ready" -> 503. Unchanged from the previous binary contract: env
//                    invalid, or db/rpc/contract fully unreachable.
//
// A dependency is "up" if it responds successfully within its configured
// latency threshold, "degraded" if it responds successfully but slower than
// that threshold, and "down" if it errors or times out entirely. `env` has
// no natural degraded state (config is either valid or it isn't), so it
// stays a simple `{ ok: boolean }`.

/**
 * Per-dependency health status.
 *
 * `up` / `degraded` / `down` describe a dependency that was actually probed,
 * mirroring EventListenerService's ServiceStatus naming (`degraded` means it
 * responded, but slower than its latency threshold).
 *
 * `unknown` means no probe ran for that dependency on this request — the
 * shutdown/startup gates and an invalid env check all return before `db`/`rpc`/
 * `contract` are touched, a `db` failure returns before the Soroban checks run,
 * and a failed RPC check skips the contract simulation. Reporting those as
 * `down` claimed a dependency *failure* that was never observed, which is the
 * opposite of what an operator needs from a diagnostics endpoint.
 */
export type ComponentStatus = "up" | "degraded" | "down" | "unknown";

/** Message used for a dependency that was not probed on this request. */
const NOT_CHECKED = "not_checked: no probe ran on this request";

export interface ComponentHealth {
  status: ComponentStatus;
  /** Round-trip latency for the underlying check, in milliseconds, when available. */
  latencyMs?: number;
  /** Redacted, human-readable detail. Never contains secrets or raw connection strings. */
  message?: string;
}

const DEFAULT_DB_DEGRADED_LATENCY_MS = 500;
const DEFAULT_RPC_DEGRADED_LATENCY_MS = 1500;

// ─── Issue #843: per-dependency timeout ────────────────────────────────────
//
// A hung DB or RPC should fail fast (within these timeouts) rather than
// block the readiness endpoint indefinitely. Without this, a slow DB
// connection would keep an orchestrator waiting instead of failing over.
// See docs/runbooks/observability.md for expected orchestrator behaviour.
const DEFAULT_DB_CHECK_TIMEOUT_MS = 2000;
const DEFAULT_RPC_CHECK_TIMEOUT_MS = 5000;

/**
 * Races a promise against a timeout. If the promise doesn't settle within
 * `ms`, the returned promise rejects with a descriptive timeout error.
 * Always clears the timer to avoid leaking memory.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

function getDbCheckTimeoutMs(): number {
  return readPositiveIntEnv("HEALTH_DB_CHECK_TIMEOUT_MS", DEFAULT_DB_CHECK_TIMEOUT_MS);
}

function getRpcCheckTimeoutMs(): number {
  return readPositiveIntEnv("HEALTH_RPC_CHECK_TIMEOUT_MS", DEFAULT_RPC_CHECK_TIMEOUT_MS);
}

/**
 * Reads a positive-integer value from an env var, falling back to
 * `fallback` when unset or invalid. Read fresh on every request (rather
 * than cached at module load) so it stays in step with `config/env.js`'s
 * own "read process.env directly, no restart required for test overrides"
 * convention and so tests can override it per-case.
 */
function readPositiveIntEnv(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDbDegradedLatencyMs(): number {
  return readPositiveIntEnv("HEALTH_DB_DEGRADED_LATENCY_MS", DEFAULT_DB_DEGRADED_LATENCY_MS);
}

function getRpcDegradedLatencyMs(): number {
  return readPositiveIntEnv("HEALTH_RPC_DEGRADED_LATENCY_MS", DEFAULT_RPC_DEGRADED_LATENCY_MS);
}

/**
 * Issue #935: dependency-level messages in the readiness response are
 * public-ish (consumed by orchestrators, and reachable by anyone who can hit
 * the endpoint), so any secret that a driver/RPC error message might echo
 * back must be scrubbed before it lands in `components.*.message`.
 *
 * Redacts:
 *  - Full literal values of DATABASE_URL / SOROBAN_RPC_URL / HORIZON_URL /
 *    PAYMENTS_ADMIN_API_KEY, if the underlying error message happens to
 *    embed them verbatim (e.g. a pg connection error echoing the DSN).
 *  - Any `scheme://user:pass@host` credential segment, as a defence-in-depth
 *    fallback for connection strings not caught by the exact-value check
 *    above (e.g. a differently-cased or partially-normalised URL).
 */
function redactSecrets(message: string): string {
  let redacted = message;

  const literalSecrets = [
    process.env.DATABASE_URL,
    process.env.SOROBAN_RPC_URL,
    process.env.HORIZON_URL,
    process.env.PAYMENTS_ADMIN_API_KEY
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const secret of literalSecrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  // Generic connection-string credential pattern: scheme://user:pass@host
  redacted = redacted.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@\s/]+@/g, "$1[REDACTED]@");

  return redacted;
}

async function handleReadiness(_req: unknown, res: Response, _next: NextFunction) {
  const requestId = res.locals.requestId;
  const components: {
    env: { ok: boolean };
    db: ComponentHealth;
    rpc: ComponentHealth;
    contract: ComponentHealth;
  } = {
    env: { ok: true },
    // "unknown" until a probe actually runs. Every early return below leaves
    // whatever is still unprobed as "unknown" rather than asserting "down".
    db: { status: "unknown", message: NOT_CHECKED },
    rpc: { status: "unknown", message: NOT_CHECKED },
    contract: { status: "unknown", message: NOT_CHECKED }
  };

  if (shuttingDown) {
    res.status(503).json({
      status: "not_ready",
      error: "shutting_down",
      message: "Service received a shutdown signal and is no longer accepting traffic.",
      components,
      requestId,
      details: {}
    });
    return;
  }

  if (!startupComplete) {
    res.status(503).json({
      status: "not_ready",
      error: "starting",
      message: "Service startup has not completed.",
      components,
      requestId,
      details: {}
    });
    return;
  }

  const envDiagnostics = getEnvDiagnostics();
  if (!envDiagnostics.ok) {
    components.env = { ok: false };
    res.status(503).json({
      status: "not_ready",
      error: "missing_config",
      message: "Required environment variables are missing or malformed.",
      components,
      issues: envDiagnostics.issues,
      requestId,
      details: {}
    });
    return;
  }

  const dbDegradedLatencyMs = getDbDegradedLatencyMs();

  try {
    const ds = getDataSource();
    if (!ds.isInitialized) {
      throw new Error("Database connection is not initialized.");
    }

    try {
      const dbStart = Date.now();
      const dbCheckTimeoutMs = getDbCheckTimeoutMs();
      const rows = await withTimeout(
        ds.query('SELECT 1 AS one'),
        dbCheckTimeoutMs,
        "Database health check"
      );
      const latencyMs = Date.now() - dbStart;
      components.db = {
        status: latencyMs > dbDegradedLatencyMs ? "degraded" : "up",
        latencyMs,
        message: Array.isArray(rows) ? "query_ok" : "query_ok_unexpected_shape"
      };
    } catch (queryErr) {
      const message = queryErr instanceof Error ? queryErr.message : String(queryErr);
      const isTimeout = message.includes("timed out after");
      components.db = {
        status: "down",
        message: redactSecrets(isTimeout ? `timeout: ${message}` : `query_failed: ${message}`)
      };
      res.status(503).json({
        status: "not_ready",
        error: "database_unavailable",
        message: isTimeout
          ? "Database health check timed out; verify DATABASE_URL and connectivity."
          : "Database query failed; check DATABASE_URL and connectivity.",
        components,
        requestId,
        details: { error: redactSecrets(message) }
      });
      return;
    }
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : "Database connection is not available.";
    components.db = { status: "down", message: redactSecrets(message) };
    res.status(503).json({
      status: "not_ready",
      error: "database_unavailable",
      message: "Database connection is not available.",
      components,
      requestId,
      details: {}
    });
    return;
  }

  const rpcDegradedLatencyMs = getRpcDegradedLatencyMs();

  try {
    const rpcCheckTimeoutMs = getRpcCheckTimeoutMs();
    const soroban = await withTimeout(
      checkSorobanReachability(),
      rpcCheckTimeoutMs,
      "Soroban RPC health check"
    );

    components.rpc = soroban.rpc.ok
      ? {
          status: (soroban.rpc.latencyMs ?? 0) > rpcDegradedLatencyMs ? "degraded" : "up",
          latencyMs: soroban.rpc.latencyMs,
          message: redactSecrets(soroban.rpc.message ?? "reachable")
        }
      : {
          status: "down",
          latencyMs: soroban.rpc.latencyMs,
          message: redactSecrets(soroban.rpc.message ?? "unreachable")
        };

    components.contract = soroban.contract.ok
      ? {
          status: (soroban.contract.latencyMs ?? 0) > rpcDegradedLatencyMs ? "degraded" : "up",
          latencyMs: soroban.contract.latencyMs,
          message: redactSecrets(soroban.contract.message ?? "simulation_ok")
        }
      : {
          status: "down",
          latencyMs: soroban.contract.latencyMs,
          message: redactSecrets(soroban.contract.message ?? "simulation_failed")
        };

    if (!soroban.rpc.ok || !soroban.contract.ok) {
      res.status(503).json({
        status: "not_ready",
        error: !soroban.rpc.ok ? "rpc_unavailable" : "contract_unreachable",
        message: "Soroban RPC or contract simulation is not ready.",
        components,
        requestId,
        details: {}
      });
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes("timed out after");
    components.rpc = {
      status: "down",
      message: redactSecrets(isTimeout ? `timeout: ${message}` : `rpc_check_failed: ${message}`)
    };
    components.contract = {
      status: "unknown",
      message: "not_checked: the Soroban RPC check failed, so the contract simulation was skipped"
    };
    res.status(503).json({
      status: "not_ready",
      error: "rpc_unavailable",
      message: isTimeout
        ? "Soroban RPC health check timed out."
        : "Soroban RPC or contract simulation is not ready.",
      components,
      requestId,
      details: { error: redactSecrets(message) }
    });
    return;
  }

  // Surface the background event listener's health. A degraded listener (e.g.
  // during a Soroban RPC outage with active back-off) does not make the API
  // unready for reads, so it never triggers a 503 here - but (Issue #935) it
  // now does pull the *overall* status down to "degraded" alongside a slow
  // db/rpc/contract, since ops should be aware something needs attention even
  // though traffic keeps flowing.
  const eventListener = getServiceHealth();

  const anyDegraded =
    components.db.status === "degraded" ||
    components.rpc.status === "degraded" ||
    components.contract.status === "degraded" ||
    eventListener.status === "degraded";

  res.json({
    status: anyDegraded ? "degraded" : "ready",
    version: SERVICE_VERSION,
    components: { ...components, eventListener },
    // Issue #1281: every 503 body above carries a requestId, but the 200
    // bodies did not — so a `degraded` response pasted into an incident
    // thread had no correlation id to join it back to the logs. Both
    // outcomes now carry one.
    requestId
  });
}
