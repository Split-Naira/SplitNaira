import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AuditLog } from "../entities/AuditLog.js";
import { clearEnvCache } from "../config/env.js";
import { markStartupComplete } from "../routes/health.js";

process.env.DATABASE_URL = "https://example.com/postgres";
process.env.SIMULATOR_ACCOUNT = "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6";
process.env.CONTRACT_ID = "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const mockAuditSave = vi.fn().mockResolvedValue(undefined);
const mockAuditCreate = vi.fn((data: unknown) => data);

vi.mock("@stellar/stellar-sdk", () => ({
  Address: {
    fromString: vi.fn((address: string) => ({
      toScVal: () => ({ address }),
      toString: () => address
    }))
  },
  BASE_FEE: "100",
  Contract: vi.fn().mockImplementation(function (this: unknown) {
    return { call: vi.fn().mockReturnValue({}) };
  }),
  TransactionBuilder: vi.fn().mockImplementation(function (this: unknown) {
    return {
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ toXDR: () => "test_xdr" })
    };
  }),
  nativeToScVal: vi.fn((val: unknown) => ({ val })),
  scValToNative: vi.fn((val: unknown) => val),
  rpc: {
    Server: vi.fn().mockImplementation(function (this: unknown) {
      return {
        getAccount: vi.fn().mockResolvedValue({
          accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          sequenceNumber: () => "1"
        }),
        simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: null } }),
        prepareTransaction: vi.fn().mockResolvedValue({
          toXDR: () => "test_xdr",
          sequence: "1",
          fee: "100"
        })
      };
    })
  },
  xdr: {
    ScVal: {
      scvU32: vi.fn(),
      scvVec: vi.fn()
    }
  }
}));

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
    executeWithRetry: vi.fn(async (fn: () => unknown) => fn()),
    getCached: vi.fn(() => undefined),
    setCached: vi.fn(),
    invalidateCache: vi.fn(),
    invalidateCacheByPrefix: vi.fn(),
    getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, evictions: 0 })),
    READ_CACHE_TTL_MS: 30000,
    checkSorobanReachability: vi.fn().mockResolvedValue({
      rpc: { ok: true },
      contract: { ok: true }
    })
  };
});

vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(() => ({
    isInitialized: true,
    query: vi.fn().mockResolvedValue([{ one: 1 }]),
    getRepository: vi.fn((entity: unknown) => {
      if (entity === AuditLog) {
        return {
          create: mockAuditCreate,
          save: mockAuditSave
        };
      }
      return {
        findOne: vi.fn(),
        save: vi.fn(),
        exist: vi.fn().mockResolvedValue(false),
        create: vi.fn((data: unknown) => data)
      };
    })
  })),
  initDatabase: vi.fn().mockResolvedValue({}),
  closeDatabase: vi.fn().mockResolvedValue({})
}));

const { app } = await import("../index.js");

describe("Admin audit logging", () => {
  beforeEach(() => {
    mockAuditSave.mockClear();
    mockAuditCreate.mockClear();
    markStartupComplete();
    process.env.PAYMENTS_ADMIN_API_KEY = "ops-key";
    process.env.PAYMENTS_ADMIN_WRITE_ENABLED = "true";
    clearEnvCache();
  });

  afterEach(() => {
    delete process.env.PAYMENTS_ADMIN_API_KEY;
    delete process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
    clearEnvCache();
  });

  it("creates an audit log row after a successful pause-distributions call", async () => {
    const res = await request(app)
      .post("/splits/admin/pause-distributions")
      .set("x-admin-api-key", "ops-key")
      .set("x-request-id", "audit-test-request")
      .send({
        admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      });

    expect(res.status).toBe(200);
    expect(mockAuditCreate).toHaveBeenCalledOnce();
    expect(mockAuditSave).toHaveBeenCalledOnce();

    const auditEntry = mockAuditCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(auditEntry.action).toBe("pause_distributions");
    expect(auditEntry.requestId).toBe("audit-test-request");
    expect(auditEntry.ipHash).toBeTruthy();
    expect(auditEntry.payload).toEqual({
      admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    });
  });

  it("does not create an audit log row for failed admin mutations", async () => {
    const res = await request(app)
      .post("/splits/admin/pause-distributions")
      .set("x-admin-api-key", "ops-key")
      .send({});

    expect(res.status).toBe(400);
    expect(mockAuditSave).not.toHaveBeenCalled();
  });

  it("does not create an audit log row for blocked admin writes", async () => {
    process.env.PAYMENTS_ADMIN_WRITE_ENABLED = "false";
    clearEnvCache();

    const res = await request(app)
      .post("/splits/admin/pause-distributions")
      .set("x-admin-api-key", "ops-key")
      .send({
        admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      });

    expect(res.status).toBe(503);
    expect(mockAuditSave).not.toHaveBeenCalled();
  });
});
