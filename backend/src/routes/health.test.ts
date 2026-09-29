import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #935: unit-level tests for the degraded-mode health response
// contract. These mock getDataSource()/checkSorobanReachability() directly
// (no real Postgres/RPC connection) so "slow but successful" states can be
// simulated deterministically and the suite runs locally without CI-only
// dependencies. See src/__tests__/health.ready.integration.test.ts for the
// real-Postgres integration counterpart (CI-gated).
//
// EventListenerService.js is mocked without `importOriginal` so this suite
// never has to load/transform the real module.

vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(),
}));

vi.mock("../services/stellar.js", () => ({
  checkSorobanReachability: vi.fn(),
}));

vi.mock("../services/EventListenerService.js", () => ({
  getServiceHealth: vi.fn(),
}));

vi.mock("../config/env.js", () => ({
  getEnvDiagnostics: vi.fn(),
}));

import { getDataSource } from "../services/database.js";
import { checkSorobanReachability } from "../services/stellar.js";
import { getServiceHealth } from "../services/EventListenerService.js";
import { getEnvDiagnostics } from "../config/env.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler } from "../middleware/error.js";
import {
  healthRouter,
  markShuttingDown,
  markStartupComplete,
  resetShuttingDown,
  resetStartupComplete,
} from "./health.js";

function buildApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use("/health", healthRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

// Fixture "secrets" - if any of these literal strings show up anywhere in a
// response body, that's a leak. Deliberately shaped like real config values
// (a full Postgres DSN with embedded credentials, an RPC URL with an
// API-key-looking path segment) so the redaction test is meaningful.
const FIXTURE_DATABASE_URL = "postgresql://dbuser:sup3rSecretPW@db.internal.example:5432/splitnaira";
const FIXTURE_RPC_URL = "https://rpc.example.com/v1/apikey_abc123SECRET";

function mockDb(query: () => Promise<unknown>) {
  vi.mocked(getDataSource).mockReturnValue({
    isInitialized: true,
    query,
  } as unknown as ReturnType<typeof getDataSource>);
}

function mockFastDb() {
  mockDb(() => Promise.resolve([{ one: 1 }]));
}

function mockHungDb() {
  mockDb(
    () =>
      new Promise(() => {
        // Never resolves — simulates a hung database connection.
      })
  );
}

function mockSlowDb(delayMs: number) {
  mockDb(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve([{ one: 1 }]), delayMs);
      })
  );
}

function mockDownDb(message: string) {
  mockDb(() => Promise.reject(new Error(message)));
}

function mockFastRpc() {
  vi.mocked(checkSorobanReachability).mockResolvedValue({
    rpc: { ok: true, latencyMs: 10 },
    contract: { ok: true, latencyMs: 10 },
  });
}

function mockHungRpc() {
  vi.mocked(checkSorobanReachability).mockImplementation(
    () =>
      new Promise(() => {
        // Never resolves — simulates a hung RPC connection.
      })
  );
}

describe("GET /health/ready - degraded health contract (Issue #935)", () => {
  beforeEach(() => {
    markStartupComplete();
    vi.mocked(getEnvDiagnostics).mockReturnValue({ ok: true });
    vi.mocked(getServiceHealth).mockReturnValue({
      status: "healthy",
      lastSuccessfulPoll: new Date().toISOString(),
      consecutiveErrors: 0,
    });
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    process.env.SOROBAN_RPC_URL = FIXTURE_RPC_URL;
  });

  afterEach(() => {
    resetStartupComplete();
    vi.resetAllMocks();
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    delete process.env.DATABASE_URL;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("is fully ready: 200, all components up", async () => {
    mockFastDb();
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.components.env.ok).toBe(true);
    expect(res.body.components.db).toMatchObject({ status: "up" });
    expect(res.body.components.rpc).toMatchObject({ status: "up" });
    expect(res.body.components.contract).toMatchObject({ status: "up" });
    expect(res.body.components.eventListener.status).toBe("healthy");
  });

  it("is degraded via a slow database: 200, db degraded, overall degraded", async () => {
    process.env.HEALTH_DB_DEGRADED_LATENCY_MS = "5";
    mockSlowDb(40);
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.components.db.status).toBe("degraded");
    expect(res.body.components.db.latencyMs).toBeGreaterThanOrEqual(30);
    // Unaffected dependencies stay "up".
    expect(res.body.components.rpc.status).toBe("up");
  });

  it("is degraded via a slow Soroban RPC: 200, rpc degraded, overall degraded", async () => {
    mockFastDb();
    process.env.HEALTH_RPC_DEGRADED_LATENCY_MS = "5";
    vi.mocked(checkSorobanReachability).mockResolvedValue({
      rpc: { ok: true, latencyMs: 50 },
      contract: { ok: true, latencyMs: 3 },
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.components.rpc.status).toBe("degraded");
    expect(res.body.components.rpc.latencyMs).toBe(50);
    expect(res.body.components.contract.status).toBe("up");
  });

  it("is degraded when only the background event listener is degraded", async () => {
    mockFastDb();
    mockFastRpc();
    vi.mocked(getServiceHealth).mockReturnValue({
      status: "degraded",
      lastSuccessfulPoll: null,
      consecutiveErrors: 3,
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.components.eventListener.status).toBe("degraded");
  });

  it("is not_ready via database down: 503 (unchanged existing behavior)", async () => {
    mockDownDb(`connection error near ${FIXTURE_DATABASE_URL}`);
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("database_unavailable");
    expect(res.body.components.db.status).toBe("down");
  });

  it("is not_ready via Soroban RPC down: 503 (unchanged existing behavior)", async () => {
    mockFastDb();
    vi.mocked(checkSorobanReachability).mockResolvedValue({
      rpc: { ok: false, message: `unreachable: ${FIXTURE_RPC_URL}` },
      contract: { ok: false, message: "Skipped because Soroban RPC is unreachable" },
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("rpc_unavailable");
    expect(res.body.components.rpc.status).toBe("down");
  });

  it("is not_ready via contract simulation down: 503 (unchanged existing behavior)", async () => {
    mockFastDb();
    vi.mocked(checkSorobanReachability).mockResolvedValue({
      rpc: { ok: true, latencyMs: 12 },
      contract: { ok: false, message: "contract not found" },
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("contract_unreachable");
    expect(res.body.components.contract.status).toBe("down");
  });

  it("is not_ready when env diagnostics are invalid (unchanged existing behavior)", async () => {
    vi.mocked(getEnvDiagnostics).mockReturnValue({
      ok: false,
      issues: [{ key: "DATABASE_URL", message: "invalid" }],
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("missing_config");
  });

  it("never leaks DATABASE_URL / RPC endpoint / credentials into dependency messages", async () => {
    mockDownDb(`password authentication failed, dsn=${FIXTURE_DATABASE_URL}`);
    vi.mocked(checkSorobanReachability).mockResolvedValue({
      rpc: { ok: false, message: `could not reach ${FIXTURE_RPC_URL}` },
      contract: { ok: false, message: "Skipped because Soroban RPC is unreachable" },
    });

    const res = await request(app).get("/health/ready");
    const serialized = JSON.stringify(res.body);

    expect(serialized).not.toContain(FIXTURE_DATABASE_URL);
    expect(serialized).not.toContain(FIXTURE_RPC_URL);
    expect(serialized).not.toContain("sup3rSecretPW");
    expect(serialized).not.toContain("apikey_abc123SECRET");
  });
});

// ─── Issue #843: readiness dependency timeout tests ───────────────────────

describe("GET /health/ready - dependency timeout (Issue #843)", () => {
  beforeEach(() => {
    markStartupComplete();
    vi.mocked(getEnvDiagnostics).mockReturnValue({ ok: true });
    vi.mocked(getServiceHealth).mockReturnValue({
      status: "healthy",
      lastSuccessfulPoll: new Date().toISOString(),
      consecutiveErrors: 0,
    });
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    process.env.SOROBAN_RPC_URL = FIXTURE_RPC_URL;
  });

  afterEach(() => {
    resetStartupComplete();
    vi.resetAllMocks();
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    delete process.env.DATABASE_URL;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("fails fast (503) when database check hangs, not waiting for request-level timeout", async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = "100";
    mockHungDb();
    mockFastRpc();

    const start = Date.now();
    const res = await request(app).get("/health/ready");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("database_unavailable");
    expect(res.body.components.db.status).toBe("down");
    expect(res.body.components.db.message).toContain("timeout");
    // Should complete well before the 30s request-level timeout
    expect(elapsed).toBeLessThan(5000);
  });

  it("fails fast (503) when Soroban RPC check hangs", async () => {
    process.env.HEALTH_RPC_CHECK_TIMEOUT_MS = "100";
    mockFastDb();
    mockHungRpc();

    const start = Date.now();
    const res = await request(app).get("/health/ready");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("rpc_unavailable");
    expect(res.body.components.rpc.status).toBe("down");
    expect(res.body.components.rpc.message).toContain("timeout");
    expect(elapsed).toBeLessThan(5000);
  });

  it("includes requestId correlation ID in timeout response for diagnostics", async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = "100";
    mockHungDb();
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("requestId");
    expect(typeof res.body.requestId).toBe("string");
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it("uses configurable db timeout from HEALTH_DB_CHECK_TIMEOUT_MS", async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = "50";
    mockHungDb();
    mockFastRpc();

    const start = Date.now();
    const res = await request(app).get("/health/ready");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(503);
    // Should complete in roughly 50ms (+ overhead)
    expect(elapsed).toBeLessThan(2000);
  });

  it("falls back to default 2000ms db timeout when env var is unset", async () => {
    // Don't set HEALTH_DB_CHECK_TIMEOUT_MS — use the default
    mockFastRpc();
    // DB responds quickly, so default timeout shouldn't fire
    mockFastDb();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status === "ready" || res.body.status === "degraded").toBe(true);
  });

  it("defaults db timeout when env var is an invalid value", async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = "invalid";
    mockFastDb();
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    // Should not crash — uses the fallback timeout and responds normally
    expect([200, 503]).toContain(res.status);
  });
});

// ─── Issue #1281: diagnostics must not invent dependency failures ─────────
//
// The readiness body reports one component per dependency, and every early
// return used to leave db/rpc/contract at their initial "down" value even
// though no probe had run — a `starting` response read as "the database, the
// RPC and the contract are all down". These tests pin "unknown" for anything
// that was not actually probed, and pin that a probe that *did* fail is still
// reported as "down".

describe("GET /health/ready - unprobed dependencies are 'unknown', not 'down' (Issue #1281)", () => {
  const UNPROBED = ["db", "rpc", "contract"] as const;

  beforeEach(() => {
    markStartupComplete();
    vi.mocked(getEnvDiagnostics).mockReturnValue({ ok: true });
    vi.mocked(getServiceHealth).mockReturnValue({
      status: "healthy",
      lastSuccessfulPoll: new Date().toISOString(),
      consecutiveErrors: 0,
    });
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    process.env.SOROBAN_RPC_URL = FIXTURE_RPC_URL;
  });

  afterEach(() => {
    resetStartupComplete();
    resetShuttingDown();
    vi.resetAllMocks();
    delete process.env.HEALTH_DB_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_RPC_DEGRADED_LATENCY_MS;
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS;
    delete process.env.HEALTH_RPC_CHECK_TIMEOUT_MS;
    delete process.env.DATABASE_URL;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("reports db/rpc/contract as unknown while startup is incomplete", async () => {
    resetStartupComplete();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("starting");

    for (const name of UNPROBED) {
      expect(res.body.components[name].status).toBe("unknown");
      expect(res.body.components[name].message).toContain("not_checked");
    }

    // The point of "unknown" — nothing was probed, so nothing may be blamed.
    expect(vi.mocked(getDataSource)).not.toHaveBeenCalled();
    expect(vi.mocked(checkSorobanReachability)).not.toHaveBeenCalled();
  });

  it("reports db/rpc/contract as unknown while shutting down", async () => {
    markShuttingDown();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("shutting_down");

    for (const name of UNPROBED) {
      expect(res.body.components[name].status).toBe("unknown");
    }
    expect(vi.mocked(getDataSource)).not.toHaveBeenCalled();
    expect(vi.mocked(checkSorobanReachability)).not.toHaveBeenCalled();
  });

  it("reports the unprobed dependencies as unknown when env config is invalid", async () => {
    vi.mocked(getEnvDiagnostics).mockReturnValue({
      ok: false,
      issues: [{ key: "DATABASE_URL", message: "invalid" }],
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("missing_config");
    // env *was* checked, and it failed — that one stays a real verdict.
    expect(res.body.components.env.ok).toBe(false);
    for (const name of UNPROBED) {
      expect(res.body.components[name].status).toBe("unknown");
    }
    expect(vi.mocked(getDataSource)).not.toHaveBeenCalled();
  });

  it("does not report the contract as down when the RPC check threw and skipped it", async () => {
    mockFastDb();
    vi.mocked(checkSorobanReachability).mockRejectedValue(
      new Error(`probe blew up: ${FIXTURE_RPC_URL}`)
    );

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("rpc_unavailable");
    // rpc was probed and threw => down. contract never ran => unknown.
    expect(res.body.components.rpc.status).toBe("down");
    expect(res.body.components.contract.status).toBe("unknown");
    expect(res.body.components.contract.message).toContain("not_checked");
    // The thrown message still gets scrubbed on its way into the body.
    expect(JSON.stringify(res.body)).not.toContain(FIXTURE_RPC_URL);
  });

  it("keeps the service's own verdict when the service says the contract check was skipped", async () => {
    mockFastDb();
    // The real checkSorobanReachability *returns* (rather than throwing) with an
    // explicit "Skipped because Soroban RPC is unreachable" message when the RPC
    // lookup fails, so that contract verdict belongs to the service and the
    // route must not overwrite it.
    vi.mocked(checkSorobanReachability).mockResolvedValue({
      rpc: { ok: false, message: `unreachable: ${FIXTURE_RPC_URL}` },
      contract: { ok: false, message: "Skipped because Soroban RPC is unreachable" },
    });

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("rpc_unavailable");
    expect(res.body.components.rpc.status).toBe("down");
    expect(res.body.components.contract.status).toBe("down");
    expect(res.body.components.contract.message).toContain("Skipped");
  });

  it("reports rpc/contract as unknown when the database is unreachable", async () => {
    mockDownDb(`connection error near ${FIXTURE_DATABASE_URL}`);
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.components.db.status).toBe("down");
    expect(res.body.components.rpc.status).toBe("unknown");
    expect(res.body.components.contract.status).toBe("unknown");
    // The DB failure short-circuits the request — the RPC is never contacted.
    expect(vi.mocked(checkSorobanReachability)).not.toHaveBeenCalled();
  });

  it("still reports a probed dependency as down (no regression)", async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = "100";
    mockHungDb();
    mockFastRpc();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.components.db.status).toBe("down");
    expect(res.body.components.db.message).toContain("timeout");
  });

  it("carries a correlation id on ready and degraded responses too", async () => {
    mockFastDb();
    mockFastRpc();

    const ready = await request(app).get("/health/ready").set("x-request-id", "corr-ready");

    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("ready");
    expect(ready.body.requestId).toBe("corr-ready");

    process.env.HEALTH_DB_DEGRADED_LATENCY_MS = "5";
    mockSlowDb(40);

    const degraded = await request(app)
      .get("/health/ready")
      .set("x-request-id", "corr-degraded");

    expect(degraded.status).toBe(200);
    expect(degraded.body.status).toBe("degraded");
    expect(degraded.body.requestId).toBe("corr-degraded");
  });

  it("redacts credentials from a connection URL that is not in the env list", async () => {
    mockDownDb("failed talking to redis://:sup3rSecretPW@cache.internal:6379");

    const res = await request(app).get("/health/ready");
    const serialized = JSON.stringify(res.body);

    // Defence in depth: this URL is not one of the literal env values, so only
    // the generic scheme://user:pass@host scrub can catch it.
    expect(serialized).not.toContain("sup3rSecretPW");
    expect(serialized).toContain("[REDACTED]");
  });
});
