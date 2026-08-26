import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const getAccountMock = vi.fn();
const prepareTransactionMock = vi.fn();
const simulateTransactionMock = vi.fn();
const getEventsMock = vi.fn();

const serverMock = {
  getAccount: getAccountMock,
  prepareTransaction: prepareTransactionMock,
  simulateTransaction: simulateTransactionMock,
  getEvents: getEventsMock,
};

vi.mock("@stellar/stellar-sdk", () => {
  class ScMapEntry {
    key: unknown;
    val: unknown;
    constructor({ key, val }: { key: unknown; val: unknown }) {
      this.key = key;
      this.val = val;
    }
  }

  return {
    Address: {
      fromString: vi.fn((address: string) => {
        if (!/^[GC][A-Z0-9_]+$/.test(address)) throw new Error("invalid address");
        return {
          toScVal: () => ({ address }),
        };
      }),
    },
    BASE_FEE: 100,
    Contract: vi.fn().mockImplementation(function () {
      return {
        call: (method: string, ...args: unknown[]) => ({ method, args }),
      };
    }),
    TransactionBuilder: vi.fn().mockImplementation(function () {
      return {
        addOperation: function (op: unknown) {
          this.op = op;
          return this;
        },
        setTimeout: function () {
          return this;
        },
        build: function () {
          return { preparedOperation: this.op };
        },
      };
    }),
    nativeToScVal: vi.fn((value: unknown) => ({
      toXDR: () => `MOCKED_XDR_${value}`,
    })),
    scValToNative: vi.fn((value: unknown) => value),
    rpc: {
      Server: vi.fn().mockImplementation(function () {
        return serverMock;
      }),
    },
    xdr: {
      ScVal: {
        scvMap: (items: unknown[]) => items,
        scvU32: (value: number) => value,
        scvVec: (items: unknown[]) => items,
      },
      ScMapEntry,
    },
  };
});

vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(() => ({
    isInitialized: true,
    query: vi.fn().mockResolvedValue([{ one: 1 }]),
    getRepository: vi.fn(() => ({
      create: vi.fn((x) => x),
      save: vi.fn().mockResolvedValue({}),
    })),
  })),
  initDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
  withTransaction: vi.fn((cb) => cb({ manager: { getRepository: vi.fn() } })),
}));

vi.mock("../services/EventListenerService.js", () => ({
  getServiceHealth: vi.fn(() => ({
    status: "healthy",
    lastSuccessfulPoll: "2026-08-26T18:00:00.000Z",
    consecutiveErrors: 0,
  })),
  getLedgerLag: vi.fn(() => 0),
  startEventListenerService: vi.fn().mockResolvedValue(undefined),
  stopEventListenerService: vi.fn(),
}));

vi.mock("../services/PayoutHistoryService.js", () => ({
  createPayoutHistoryService: vi.fn(() => ({
    backfill: vi.fn().mockResolvedValue({}),
  })),
}));

import { splitsRouter } from "../routes/splits.js";
import { opsRouter } from "../routes/ops.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import {
  getValidationFailureCount,
  resetValidationFailureCount,
} from "../middleware/validateResponse.js";
import {
  AdminStatusResponseSchema,
  AdminIsTokenAllowedResponseSchema,
  AdminTokenCountResponseSchema,
  AdminUnallocatedResponseSchema,
  AdminCacheStatsResponseSchema,
  AdminUnsignedXdrResponseSchema,
  OpsStatusResponseSchema,
  OpsBackfillResponseSchema,
  MainnetReadinessResponseSchema,
} from "../schemas/admin.schemas.js";

const VALID_ADMIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_TOKEN = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VALID_TO = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use("/ops", opsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("Admin Route Response Validation Coverage", () => {
  const originalStrict = process.env.STRICT_RESPONSE_VALIDATION;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.HORIZON_URL = "https://horizon.test";
    process.env.SOROBAN_RPC_URL = "https://soroban.test";
    process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    process.env.SIMULATOR_ACCOUNT = "GTESTSIMULATOR";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRICT_RESPONSE_VALIDATION = "true";
    resetValidationFailureCount();
  });

  afterEach(() => {
    if (originalStrict !== undefined) {
      process.env.STRICT_RESPONSE_VALIDATION = originalStrict;
    } else {
      delete process.env.STRICT_RESPONSE_VALIDATION;
    }
    process.env.NODE_ENV = originalNodeEnv ?? "test";
  });

  describe("1. Stats and Diagnostic Admin Responses", () => {
    it("GET /splits/admin/status validates against AdminStatusResponseSchema", async () => {
      simulateTransactionMock
        .mockResolvedValueOnce({ result: { retval: VALID_ADMIN } })
        .mockResolvedValueOnce({ result: { retval: false } });

      const app = createTestApp();
      const res = await request(app).get("/splits/admin/status");

      expect(res.status).toBe(200);
      const parsed = AdminStatusResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toEqual({ admin: VALID_ADMIN, isPaused: false });
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /splits/admin/token-count validates against AdminTokenCountResponseSchema", async () => {
      simulateTransactionMock.mockResolvedValueOnce({
        result: { retval: 5 },
      });

      const app = createTestApp();
      const res = await request(app).get("/splits/admin/token-count");

      expect(res.status).toBe(200);
      const parsed = AdminTokenCountResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toEqual({ count: 5 });
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /splits/admin/is-token-allowed validates against AdminIsTokenAllowedResponseSchema", async () => {
      simulateTransactionMock.mockResolvedValueOnce({
        result: { retval: true },
      });

      const app = createTestApp();
      const res = await request(app).get(`/splits/admin/is-token-allowed?token=${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      const parsed = AdminIsTokenAllowedResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toEqual({ token: VALID_TOKEN, isAllowed: true });
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /splits/admin/cache-stats validates against AdminCacheStatsResponseSchema", async () => {
      const app = createTestApp();
      const res = await request(app).get("/splits/admin/cache-stats");

      expect(res.status).toBe(200);
      const parsed = AdminCacheStatsResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toHaveProperty("size");
      expect(res.body).toHaveProperty("keys");
      expect(res.body).toHaveProperty("ttlMs");
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /ops/status validates against OpsStatusResponseSchema", async () => {
      const app = createTestApp();
      const res = await request(app).get("/ops/status");

      expect(res.status).toBe(200);
      const parsed = OpsStatusResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.eventListener.status).toBe("healthy");
      expect(res.body.database.connected).toBe(true);
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /ops/mainnet-readiness validates against MainnetReadinessResponseSchema", async () => {
      const app = createTestApp();
      const res = await request(app).get("/ops/mainnet-readiness");

      // In non-production or test environment, readiness evaluates components
      expect([200, 503]).toContain(res.status);
      const parsed = MainnetReadinessResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toHaveProperty("components");
    });
  });

  describe("2. Payment Admin Action Responses", () => {
    it("POST /splits/admin/allow-token validates against AdminUnsignedXdrResponseSchema", async () => {
      getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
      prepareTransactionMock.mockResolvedValue({
        toXDR: () => "MOCKED_ALLOW_TOKEN_XDR",
        sequence: "100",
        fee: "100",
      });

      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/allow-token")
        .send({ admin: VALID_ADMIN, token: VALID_TOKEN });

      expect(res.status).toBe(200);
      const parsed = AdminUnsignedXdrResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.xdr).toBe("MOCKED_ALLOW_TOKEN_XDR");
      expect(res.body.metadata.operation).toBe("allow_token");
      expect(getValidationFailureCount()).toBe(0);
    });

    it("POST /splits/admin/disallow-token validates against AdminUnsignedXdrResponseSchema", async () => {
      getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
      prepareTransactionMock.mockResolvedValue({
        toXDR: () => "MOCKED_DISALLOW_TOKEN_XDR",
        sequence: "101",
        fee: "100",
      });

      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/disallow-token")
        .send({ admin: VALID_ADMIN, token: VALID_TOKEN });

      expect(res.status).toBe(200);
      const parsed = AdminUnsignedXdrResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.xdr).toBe("MOCKED_DISALLOW_TOKEN_XDR");
      expect(res.body.metadata.operation).toBe("disallow_token");
      expect(getValidationFailureCount()).toBe(0);
    });

    it("POST /splits/admin/pause-distributions validates against AdminUnsignedXdrResponseSchema", async () => {
      getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
      prepareTransactionMock.mockResolvedValue({
        toXDR: () => "MOCKED_PAUSE_XDR",
        sequence: "102",
        fee: "100",
      });

      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/pause-distributions")
        .send({ admin: VALID_ADMIN });

      expect(res.status).toBe(200);
      const parsed = AdminUnsignedXdrResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.xdr).toBe("MOCKED_PAUSE_XDR");
      expect(res.body.metadata.operation).toBe("pause_distributions");
      expect(getValidationFailureCount()).toBe(0);
    });

    it("POST /splits/admin/unpause-distributions validates against AdminUnsignedXdrResponseSchema", async () => {
      getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
      prepareTransactionMock.mockResolvedValue({
        toXDR: () => "MOCKED_UNPAUSE_XDR",
        sequence: "103",
        fee: "100",
      });

      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/unpause-distributions")
        .send({ admin: VALID_ADMIN });

      expect(res.status).toBe(200);
      const parsed = AdminUnsignedXdrResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.xdr).toBe("MOCKED_UNPAUSE_XDR");
      expect(res.body.metadata.operation).toBe("unpause_distributions");
      expect(getValidationFailureCount()).toBe(0);
    });

    it("GET /splits/admin/unallocated validates against AdminUnallocatedResponseSchema", async () => {
      simulateTransactionMock.mockResolvedValueOnce({
        result: { retval: 1250000 },
      });

      const app = createTestApp();
      const res = await request(app).get(`/splits/admin/unallocated?token=${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      const parsed = AdminUnallocatedResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toEqual({ token: VALID_TOKEN, unallocated: "1250000" });
      expect(getValidationFailureCount()).toBe(0);
    });

    it("POST /ops/backfill validates against OpsBackfillResponseSchema", async () => {
      const app = createTestApp();
      const res = await request(app).post("/ops/backfill").send({ fromLedger: 1000 });

      expect(res.status).toBe(200);
      const parsed = OpsBackfillResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.success).toBe(true);
      expect(getValidationFailureCount()).toBe(0);
    });
  });

  describe("3. Audit Context & Recovery Admin Responses", () => {
    it("POST /splits/admin/withdraw-unallocated validates metadata including auditContext", async () => {
      getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
      prepareTransactionMock.mockResolvedValue({
        toXDR: () => "MOCKED_WITHDRAW_UNALLOCATED_XDR",
        sequence: "104",
        fee: "100",
      });

      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/withdraw-unallocated")
        .send({
          admin: VALID_ADMIN,
          token: VALID_TOKEN,
          to: VALID_TO,
          amount: 500000,
        });

      expect(res.status).toBe(200);
      const parsed = AdminUnsignedXdrResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.metadata.operation).toBe("withdraw_unallocated");
      expect(res.body.metadata.auditContext).toMatchObject({
        token: VALID_TOKEN,
        destination: VALID_TO,
        amount: 500000,
      });
      expect(res.body.metadata.auditContext.initiatedAt).toBeDefined();
      expect(getValidationFailureCount()).toBe(0);
    });
  });

  describe("4. Error Responses Bypass Success Schema Validation", () => {
    it("400 validation error does not trigger 500 response schema mismatch", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/splits/admin/withdraw-unallocated")
        .send({ admin: VALID_ADMIN }); // missing token, to, amount

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
      // Failure counter for response schema validation should NOT increment on client 400s
      expect(getValidationFailureCount()).toBe(0);
    });
  });
});
