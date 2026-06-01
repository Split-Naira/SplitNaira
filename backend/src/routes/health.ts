import { Router } from "express";
import { getEnvDiagnostics } from "../config/env.js";
import { getDataSource } from "../services/database.js";
import { checkSorobanReachability } from "../services/stellar.js";

export const healthRouter = Router();

const SERVICE_VERSION = process.env.npm_package_version ?? "unknown";

let startupComplete = false;

/** Mark startup complete after DB and background services are initialised. */
export function markStartupComplete(): void {
  startupComplete = true;
}

export function isStartupComplete(): boolean {
  return startupComplete;
}

/**
 * Health endpoint - indicates service is running
 */
healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    version: SERVICE_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
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
healthRouter.get("/ready", async (_req, res, next) => {
  const requestId = res.locals.requestId;
  const components = {
    env: { ok: true },
    db: { ok: false, message: "" },
    rpc: { ok: false, message: "" },
    contract: { ok: false, message: "" }
  };

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

  try {
    const ds = getDataSource();
    // Simple readiness check: execute a lightweight query to verify DB connectivity.
    try {
      // Use a deterministic column name so result parsing is consistent across PG versions
      const rows = await ds.query('SELECT 1 AS one');
      components.db = { ok: true, message: 'query_ok', rows: Array.isArray(rows) ? rows.length : undefined };
    } catch (queryErr) {
      const message = queryErr instanceof Error ? queryErr.message : String(queryErr);
      components.db = { ok: false, message: `query_failed: ${message}` };
      res.status(503).json({
        status: "not_ready",
        error: "database_unavailable",
        message: "Database query failed; check DATABASE_URL and connectivity.",
        components,
        requestId,
        details: { error: message }
      });
      return;
    }
  } catch (dbError) {
    components.db = {
      ok: false,
      message: dbError instanceof Error ? dbError.message : "Database connection is not available."
    };
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

  try {
    const soroban = await checkSorobanReachability();
    components.rpc = { ok: soroban.rpc.ok, message: soroban.rpc.message ?? "reachable" };
    components.contract = {
      ok: soroban.contract.ok,
      message: soroban.contract.message ?? "simulation_ok"
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
    next(error);
    return;
  }

  res.json({ status: "ready", components });
});
