import { Router } from "express";
import { getEnvDiagnostics } from "../config/env.js";
import { getDataSource } from "../services/database.js";
import { getCacheStats } from "../services/stellar.js";

export const opsRouter = Router();

interface ReadinessComponent {
  ok: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface MainnetReadinessResponse {
  status: "ready" | "not_ready";
  requestId?: string;
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
  components: {
    env: ReadinessComponent;
    db: ReadinessComponent;
    cache: ReadinessComponent;
    deploy: ReadinessComponent & {
      productionSecrets?: {
        mainnetContractId: boolean;
        renderBackendDeployHookUrl: boolean;
      };
      contractIdMatch?: boolean;
      databasePoolMax?: number;
      readCacheTtlMs?: number;
      readCacheMaxEntries?: number;
    };
  };
}

opsRouter.get("/mainnet-readiness", async (_req, res) => {
  const requestId = res.locals.requestId;
  const envDiagnostics = getEnvDiagnostics();

  const envComponent: ReadinessComponent = envDiagnostics.ok
    ? { ok: true }
    : { ok: false, message: "invalid_environment", details: { issues: envDiagnostics.issues } };

  const cacheStats = getCacheStats();
  const cacheComponent: ReadinessComponent = {
    ok: true,
    message: "cache_available",
    details: cacheStats
  };

  const productionSecrets = {
    mainnetContractId: Boolean(process.env.MAINNET_CONTRACT_ID?.trim()),
    renderBackendDeployHookUrl: Boolean(process.env.RENDER_BACKEND_DEPLOY_HOOK_URL?.trim())
  };

  const isProduction = process.env.NODE_ENV === "production";
  const productionReady = !isProduction || Object.values(productionSecrets).every(Boolean);

  const deployComponent: MainnetReadinessResponse["components"]["deploy"] = {
    ok: productionReady,
    message: "production_config_audit",
    productionSecrets,
    contractIdMatch: process.env.MAINNET_CONTRACT_ID && process.env.CONTRACT_ID
      ? process.env.MAINNET_CONTRACT_ID === process.env.CONTRACT_ID
      : undefined,
    databasePoolMax: process.env.DATABASE_POOL_MAX ? Number(process.env.DATABASE_POOL_MAX) : undefined,
    readCacheTtlMs: process.env.READ_CACHE_TTL_MS ? Number(process.env.READ_CACHE_TTL_MS) : undefined,
    readCacheMaxEntries: process.env.READ_CACHE_MAX_ENTRIES ? Number(process.env.READ_CACHE_MAX_ENTRIES) : undefined
  };

  let dbComponent: ReadinessComponent = { ok: false, message: "unknown" };

  try {
    const ds = getDataSource();
    const queryResult = await ds.query("SELECT 1 AS one");
    dbComponent = {
      ok: true,
      message: "database_query_ok",
      details: { rowCount: Array.isArray(queryResult) ? queryResult.length : undefined }
    };
  } catch (error) {
    dbComponent = {
      ok: false,
      message: "database_unavailable",
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }

  const ready = envDiagnostics.ok && dbComponent.ok && productionReady;

  const response: MainnetReadinessResponse = {
    status: ready ? "ready" : "not_ready",
    requestId,
    components: {
      env: envComponent,
      db: dbComponent,
      cache: cacheComponent,
      deploy: deployComponent
    }
  };

  if (!ready) {
    const missing = [] as string[];
    if (!envDiagnostics.ok) missing.push("env");
    if (!dbComponent.ok) missing.push("db");
    if (!productionReady) missing.push("production_secrets");

    res.status(503).json({
      ...response,
      error: "mainnet_readiness_failed",
      message: "Mainnet readiness validation failed. Review the component details.",
      details: { missing }
    });
    return;
  }

  res.json(response);
});
