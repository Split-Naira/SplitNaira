import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { checkSorobanReachability } from "../services/stellar.js";
import { clearEnvCache } from "../config/env.js";

vi.mock("@stellar/stellar-sdk", () => {
  return {
    Address: {
      fromString: vi.fn((address) => ({
        toScVal: () => ({ address }),
        toString: () => address
      }))
    },
    BASE_FEE: "100",
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({})
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        toXDR: () => "test_xdr"
      })
    })),
    nativeToScVal: vi.fn((val) => ({ val })),
    scValToNative: vi.fn((val) => val),
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({
          accountId: () => "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6",
          sequenceNumber: () => "1",
          sequence: "1"
        }),
        simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: [] } }),
        prepareTransaction: vi.fn().mockResolvedValue({
          toXDR: () => "test_xdr",
          sequence: "1",
          fee: "100"
        })
      }))
    },
    xdr: {
      ScVal: {
        scvU32: vi.fn(),
        scvVec: vi.fn()
      }
    }
  };
});

vi.mock("../services/stellar.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/stellar.js")>();
  return {
    ...actual,
    loadStellarConfig: vi.fn(() => ({
      horizonUrl: "http://horizon",
      sorobanRpcUrl: "http://rpc",
      networkPassphrase: "test",
      contractId: "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR",
      simulatorAccount: "test_account"
    })),
    getStellarRpcServer: vi.fn(() => ({
      getAccount: vi.fn().mockResolvedValue({
        accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        sequenceNumber: () => "1",
        incrementSequenceNumber: vi.fn()
      }),
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: null } }),
      prepareTransaction: vi.fn().mockResolvedValue({
        toXDR: () => "test_xdr",
        sequence: "1",
        fee: "100"
      }),
      getEvents: vi.fn().mockResolvedValue({ events: [] })
    })),
    executeWithRetry: vi.fn(async (fn) => fn()),
    getCached: vi.fn(() => undefined),
    setCached: vi.fn(),
    invalidateCache: vi.fn(),
    invalidateCacheByPrefix: vi.fn(),
    getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, evictions: 0 })),
    READ_CACHE_TTL_MS: 30000,
    checkSorobanReachability: vi.fn().mockResolvedValue({
      rpc: { ok: true },
      contract: { ok: true }
    }),
  };
});

// Mock database service for health checks
vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(() => ({
    isInitialized: true,
    query: vi.fn().mockResolvedValue([{ one: 1 }])
  })),
  initDatabase: vi.fn().mockResolvedValue({}),
  closeDatabase: vi.fn().mockResolvedValue({})
}));

describe("Route Integration Tests", () => {
  const originalAdminApiKey = process.env.PAYMENTS_ADMIN_API_KEY;
  const originalAdminWriteEnabled = process.env.PAYMENTS_ADMIN_WRITE_ENABLED;

  beforeAll(() => {
    process.env.DATABASE_URL = "https://example.com/postgres";
    process.env.SIMULATOR_ACCOUNT = "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6";
    process.env.CONTRACT_ID = "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR";
    process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    process.env.SOROBAN_NETWORK_PASSPHRASE = "test";
  });

  beforeEach(() => {
    clearEnvCache();
    delete process.env.PAYMENTS_ADMIN_API_KEY;
    delete process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
  });

  afterEach(() => {
    clearEnvCache();
    if (originalAdminApiKey === undefined) {
      delete process.env.PAYMENTS_ADMIN_API_KEY;
    } else {
      process.env.PAYMENTS_ADMIN_API_KEY = originalAdminApiKey;
    }

    if (originalAdminWriteEnabled === undefined) {
      delete process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
    } else {
      process.env.PAYMENTS_ADMIN_WRITE_ENABLED = originalAdminWriteEnabled;
    }
  });

  describe("GET /", () => {
    it("should return API info", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("SplitNaira API");
    });
  });

  describe("GET /health", () => {
    it("should return 200 and ok status", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body).toHaveProperty("uptime");
      expect(res.body).toHaveProperty("timestamp");
    });
  });

  describe("GET /health/live", () => {
    it("should return 200 and ok status for liveness", async () => {
      const res = await request(app).get("/health/live");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("GET /health/ready", () => {
    it("should return 200 and ready status when dependencies are ok", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
    });

    it("should return 503 when environment variables are missing", async () => {
      // Temporarily remove required env vars
      const originalSimulatorAccount = process.env.SIMULATOR_ACCOUNT;
      const originalContractId = process.env.CONTRACT_ID;
      delete process.env.SIMULATOR_ACCOUNT;
      delete process.env.CONTRACT_ID;

      try {
        const res = await request(app).get("/health/ready");
        expect(res.status).toBe(503);
        expect(res.body.status).toBe("not_ready");
        expect(res.body.error).toBe("missing_config");
        expect(res.body).toHaveProperty("requestId");
      } finally {
        // Restore env vars
        process.env.SIMULATOR_ACCOUNT = originalSimulatorAccount;
        process.env.CONTRACT_ID = originalContractId;
      }
    });

    it("should return 503 when Soroban RPC is unavailable", async () => {
      vi.mocked(checkSorobanReachability).mockResolvedValueOnce({
        rpc: { ok: false, message: "RPC timeout" },
        contract: { ok: false, message: "Skipped because Soroban RPC is unreachable" }
      });

      const res = await request(app).get("/health/ready");

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("rpc_unavailable");
      expect(res.body.components.rpc.ok).toBe(false);
    });

    it("should return 503 when contract simulation fails", async () => {
      vi.mocked(checkSorobanReachability).mockResolvedValueOnce({
        rpc: { ok: true },
        contract: { ok: false, message: "contract not found" }
      });

      const res = await request(app).get("/health/ready");

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("contract_unreachable");
      expect(res.body.components.contract.ok).toBe(false);
    });
  });

  describe("GET /health/startup", () => {
    it("should return 503 while startup is incomplete", async () => {
      const res = await request(app).get("/health/startup");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("starting");
    });
  });

  describe("GET /ops/mainnet-readiness", () => {
    it("should return 200 and ready status when dependencies are ok", async () => {
      const res = await request(app).get("/ops/mainnet-readiness");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.components.env.ok).toBe(true);
      expect(res.body.components.db.ok).toBe(true);
      expect(res.body.components.deploy.ok).toBe(true);
    });

    it("should return 503 when production secrets are missing in production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalCorsOrigin = process.env.CORS_ORIGIN;
      const originalMainnetContractId = process.env.MAINNET_CONTRACT_ID;
      const originalRenderHook = process.env.RENDER_BACKEND_DEPLOY_HOOK_URL;

      process.env.NODE_ENV = "production";
      process.env.CORS_ORIGIN = "https://app.splitnaira.com";
      delete process.env.MAINNET_CONTRACT_ID;
      delete process.env.RENDER_BACKEND_DEPLOY_HOOK_URL;

      try {
        const res = await request(app).get("/ops/mainnet-readiness");
        expect(res.status).toBe(503);
        expect(res.body.status).toBe("not_ready");
        expect(res.body.components.deploy.productionSecrets.mainnetContractId).toBe(false);
        expect(res.body.components.deploy.productionSecrets.renderBackendDeployHookUrl).toBe(false);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.CORS_ORIGIN = originalCorsOrigin;
        process.env.MAINNET_CONTRACT_ID = originalMainnetContractId;
        process.env.RENDER_BACKEND_DEPLOY_HOOK_URL = originalRenderHook;
      }
    });
  });

  describe("Error Handling & Request ID", () => {
    it("should propagate x-correlation-id in validation error responses", async () => {
      const res = await request(app)
        .get("/splits/invalid-project-id!!!")
        .set("x-correlation-id", "corr-test-id");

      expect(res.status).toBe(400);
      expect(res.body.requestId).toBe("corr-test-id");
      expect(res.headers["x-correlation-id"]).toBe("corr-test-id");
    });
    it("should propagate request-id in validation error responses", async () => {
      const res = await request(app)
        .get("/splits/invalid-project-id!!!")
        .set("x-request-id", "test-request-id");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
      expect(res.body.requestId).toBe("test-request-id");
    });

    it("should return 404 for unknown routes", async () => {
      const res = await request(app).get("/unknown-route");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    });
  });

  describe("Payments admin controls", () => {
    it("requires x-admin-api-key when PAYMENTS_ADMIN_API_KEY is configured", async () => {
      process.env.PAYMENTS_ADMIN_API_KEY = "ops-key";
      clearEnvCache();

      const res = await request(app).get("/splits/admin/status");

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("admin_auth_required");
    });

    it("allows admin reads with a valid x-admin-api-key", async () => {
      process.env.PAYMENTS_ADMIN_API_KEY = "ops-key";
      clearEnvCache();

      const res = await request(app)
        .get("/splits/admin/status")
        .set("x-admin-api-key", "ops-key");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("admin");
      expect(res.body).toHaveProperty("isPaused");
    });

    it("blocks admin writes when PAYMENTS_ADMIN_WRITE_ENABLED is false", async () => {
      process.env.PAYMENTS_ADMIN_API_KEY = "ops-key";
      process.env.PAYMENTS_ADMIN_WRITE_ENABLED = "false";
      clearEnvCache();

      const res = await request(app)
        .post("/splits/admin/pause-distributions")
        .set("x-admin-api-key", "ops-key")
        .send({
          admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("payments_admin_writes_disabled");
      expect(res.body.details.rollbackAware).toBe(true);
    });
  });
});
