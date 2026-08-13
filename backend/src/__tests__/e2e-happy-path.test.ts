/**
 * Issue #173: End-to-end happy-path test
 *
 * Exercises the full core product loop in one flow:
 *   create project → deposit → distribute → history
 *
 * All Stellar RPC calls are mocked so the suite is reproducible in CI
 * without requiring a live testnet. Each step asserts the contract
 * integration point that would break if any layer changed its contract.
 *
 * If a step fails the error message identifies which layer broke
 * (validation, RPC build, or response shape) so contributors can
 * triage quickly.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { app } from "../index.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before vi.mock factories are invoked
// ---------------------------------------------------------------------------
const { getAccountMock, prepareTransactionMock, simulateTransactionMock, getEventsMock } =
  vi.hoisted(() => ({
    getAccountMock: vi.fn(),
    prepareTransactionMock: vi.fn(),
    simulateTransactionMock: vi.fn(),
    getEventsMock: vi.fn()
  }));

const serverMock = {
  getAccount: getAccountMock,
  prepareTransaction: prepareTransactionMock,
  simulateTransaction: simulateTransactionMock,
  getEvents: getEventsMock
};

// ---------------------------------------------------------------------------
// Mock the Stellar SDK so zod address schemas accept our test fixtures,
// and so rpc.Server calls are intercepted by serverMock.
// This mirrors the approach used in splits.test.ts.
// ---------------------------------------------------------------------------
vi.mock("@stellar/stellar-sdk", () => {
  class ScMapEntry {
    key: unknown;
    val: unknown;
    constructor({ key, val }: { key: unknown; val: unknown }) {
      this.key = key;
      this.val = val;
    }
  }

  // Import the real nativeToScVal / scValToNative so that the history decode
  // helpers and event-value construction in tests work correctly.
  const { nativeToScVal: realNativeToScVal, scValToNative: realScValToNative } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  return {
    Address: {
      fromString: vi.fn((address: string) => ({
        toScVal: () => ({ address })
      }))
    },
    BASE_FEE: 100,
    Contract: vi.fn().mockImplementation(function () { return {
      call: (method: string, ...args: unknown[]) => ({ method, args })
    }; }),
    TransactionBuilder: vi.fn().mockImplementation(function () { return {
      addOperation: function (op: unknown) {
        this.op = op;
        return this;
      },
      setTimeout: function () {
        return this;
      },
      build: function () {
        return { preparedOperation: this.op };
      }
    }; }),
    nativeToScVal: realNativeToScVal,
    scValToNative: realScValToNative,
    rpc: {
      Server: vi.fn().mockImplementation(function () { return serverMock; })
    },
    xdr: {
      ScVal: {
        scvMap: (items: unknown[]) => items,
        scvU32: (value: number) => value,
        scvVec: (items: unknown[]) => items
      },
      ScMapEntry
    }
  };
});

// ---------------------------------------------------------------------------
// Mock the Stellar service layer
// ---------------------------------------------------------------------------
vi.mock("../services/stellar.js", () => {
  class RequestValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RequestValidationError";
    }
  }

  return {
    loadStellarConfig: () => ({
      horizonUrl: "http://horizon.test",
      sorobanRpcUrl: "http://rpc.test",
      networkPassphrase: "Test SDF Network",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      simulatorAccount: "GSIMULATOR"
    }),
    getStellarRpcServer: () => serverMock,
    executeWithRetry: async <T>(fn: () => Promise<T>) => fn(),
    RequestValidationError,
    // Cache stubs — seed project reads used by deposit token verification.
    getCached: (key: string) => key === "project:e2e_happy_001" ? {
      projectId: "e2e_happy_001",
      title: "E2E Happy Path Project",
      projectType: "music",
      owner: "GOWNER000000000000000000000000000000000000000000000000001",
      token: "CTOKEN00000000000000000000000000000000000000000000000001",
      collaborators: [],
      balance: "0"
    } : undefined,
    setCached: () => undefined,
    invalidateCache: () => undefined,
    invalidateCacheByPrefix: () => undefined,
    getCacheStats: () => ({ size: 0, keys: [] }),
    READ_CACHE_TTL_MS: 30_000
  };
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const OWNER = "GOWNER000000000000000000000000000000000000000000000000001";
const TOKEN = "CTOKEN00000000000000000000000000000000000000000000000001";
const COLLAB_A = "GCOLLAB0000000000000000000000000000000000000000000000001";
const COLLAB_B = "GCOLLAB0000000000000000000000000000000000000000000000002";
const PROJECT_ID = "e2e_happy_001";
const DEPOSIT_AMOUNT = 10_000_000; // 1 XLM in stroops

const createPayload = {
  owner: OWNER,
  projectId: PROJECT_ID,
  title: "E2E Happy Path Project",
  projectType: "music",
  token: TOKEN,
  collaborators: [
    { address: COLLAB_A, alias: "Artist A", basisPoints: 6000 },
    { address: COLLAB_B, alias: "Artist B", basisPoints: 4000 }
  ]
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeXdrMock(operation: string, xdrString: string) {
  return {
    toXDR: () => xdrString,
    sequence: "1",
    fee: "100"
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("E2E happy path: create → deposit → distribute → history", () => {
  beforeAll(() => {
    process.env.HORIZON_URL = "https://horizon.test";
    process.env.SOROBAN_RPC_URL = "https://soroban.test";
    process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network";
    process.env.CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    process.env.SIMULATOR_ACCOUNT = "GSIMULATOR";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Step 1: Create ──────────────────────────────────────────────────────

  it("Step 1 — builds a create_project transaction for a valid split", async () => {
    getAccountMock.mockResolvedValue({ accountId: OWNER });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("create_project", "XDR_CREATE_E2E"));

    const res = await request(app).post("/splits").send(createPayload);

    expect(res.status, `[create] unexpected status: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.xdr).toBe("XDR_CREATE_E2E");
    expect(res.body.metadata).toMatchObject({
      operation: "create_project",
      sourceAccount: OWNER
    });

    // Verify the RPC was called with the owner account (auth source)
    expect(getAccountMock).toHaveBeenCalledWith(OWNER);
  });

  it("Step 1 — rejects creation with mismatched basis points (not 10000)", async () => {
    const badPayload = {
      ...createPayload,
      collaborators: [
        { address: COLLAB_A, alias: "A", basisPoints: 5000 },
        { address: COLLAB_B, alias: "B", basisPoints: 3000 } // total 8000
      ]
    };

    const res = await request(app).post("/splits").send(badPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  // ── Step 2: Deposit ─────────────────────────────────────────────────────

  it("Step 2 — builds a deposit transaction after project creation", async () => {
    getAccountMock.mockResolvedValue({ accountId: COLLAB_A });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("deposit", "XDR_DEPOSIT_E2E"));

    const res = await request(app)
      .post(`/splits/${PROJECT_ID}/deposit`)
      .send({ from: COLLAB_A, amount: DEPOSIT_AMOUNT, token: TOKEN });

    expect(res.status, `[deposit] unexpected status: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.xdr).toBe("XDR_DEPOSIT_E2E");
    expect(res.body.metadata).toMatchObject({
      operation: "deposit",
      sourceAccount: COLLAB_A
    });

    expect(getAccountMock).toHaveBeenCalledWith(COLLAB_A);
  });

  it("Step 2 — rejects a deposit with amount ≤ 0", async () => {
    const res = await request(app)
      .post(`/splits/${PROJECT_ID}/deposit`)
      .send({ from: COLLAB_A, amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  // ── Step 3: Distribute ──────────────────────────────────────────────────

  it("Step 3 — builds a distribute transaction after deposit is confirmed", async () => {
    getAccountMock.mockResolvedValue({ accountId: COLLAB_A });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("distribute", "XDR_DISTRIBUTE_E2E"));

    const res = await request(app)
      .post(`/splits/${PROJECT_ID}/distribute`)
      .send({ sourceAddress: COLLAB_A });

    expect(res.status, `[distribute] unexpected status: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.xdr).toBe("XDR_DISTRIBUTE_E2E");
    expect(res.body.metadata).toMatchObject({
      operation: "distribute",
      sourceAccount: COLLAB_A
    });
  });

  it("Step 3 — distribute falls back to simulator account when no sourceAddress given", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GSIMULATOR" });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("distribute", "XDR_DISTRIBUTE_FALLBACK"));

    const res = await request(app)
      .post(`/splits/${PROJECT_ID}/distribute`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.metadata.sourceAccount).toBe("GSIMULATOR");
  });

  // ── Step 4: History ─────────────────────────────────────────────────────

  it("Step 4 — returns distribution and payment events for the project", async () => {
    const topicProjectId = nativeToScVal(PROJECT_ID, { type: "symbol" }).toXDR("base64");
    const roundTopic = nativeToScVal("distribution_complete", { type: "symbol" }).toXDR("base64");
    const paymentTopic = nativeToScVal("payment_sent", { type: "symbol" }).toXDR("base64");

    getEventsMock
      .mockResolvedValueOnce({
        // distribution_complete event
        events: [
          {
            value: nativeToScVal([1, BigInt(DEPOSIT_AMOUNT)]),
            txHash: "TXHASH_ROUND_1",
            ledgerClosedAt: "2026-04-01T10:00:00Z",
            id: "round-event-1"
          }
        ]
      })
      .mockResolvedValueOnce({
        // payment_sent events (two collaborators)
        events: [
          {
            value: nativeToScVal([COLLAB_A, BigInt(6_000_000)]),
            txHash: "TXHASH_PAYMENT_A",
            ledgerClosedAt: "2026-04-01T10:00:01Z",
            id: "payment-event-a"
          },
          {
            value: nativeToScVal([COLLAB_B, BigInt(4_000_000)]),
            txHash: "TXHASH_PAYMENT_B",
            ledgerClosedAt: "2026-04-01T10:00:01Z",
            id: "payment-event-b"
          }
        ]
      });

    const res = await request(app).get(`/splits/${PROJECT_ID}/history`);

    expect(res.status, `[history] unexpected status: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.items).toHaveLength(3);

    const roundEvent = res.body.items.find((e: { type: string }) => e.type === "round");
    expect(roundEvent, "[history] distribution_complete event missing").toBeDefined();
    expect(roundEvent.round).toBe(1);
    expect(roundEvent.txHash).toBe("TXHASH_ROUND_1");

    const paymentEvents = res.body.items.filter((e: { type: string }) => e.type === "payment");
    expect(paymentEvents, "[history] payment_sent events missing").toHaveLength(2);

    const collabAPayment = paymentEvents.find((e: { recipient: string }) => e.recipient === COLLAB_A);
    expect(collabAPayment, "[history] COLLAB_A payment event missing").toBeDefined();
    expect(collabAPayment.amount).toBe("6000000");

    // Both event-fetch calls must use the correct topic filters for the project
    expect(getEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ type: "contract", contractIds: expect.any(Array), topics: [[roundTopic], [topicProjectId]] }]
      })
    );
    expect(getEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ type: "contract", contractIds: expect.any(Array), topics: [[paymentTopic], [topicProjectId]] }]
      })
    );
  });

  it("Step 4 — returns an empty history before any distribution events exist", async () => {
    getEventsMock.mockResolvedValue({ events: [] });

    const res = await request(app).get(`/splits/${PROJECT_ID}/history`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.nextCursor).toBeNull();
  });

  // ── Full flow assertion ──────────────────────────────────────────────────

  it("Full flow — all four steps succeed in sequence without errors", async () => {
    // Step 1: create
    getAccountMock.mockResolvedValue({ accountId: OWNER });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("create_project", "XDR_FULL_CREATE"));
    const createRes = await request(app).post("/splits").send(createPayload);
    expect(createRes.status, `[full-flow create] ${JSON.stringify(createRes.body)}`).toBe(200);

    // Step 2: deposit
    getAccountMock.mockResolvedValue({ accountId: COLLAB_A });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("deposit", "XDR_FULL_DEPOSIT"));
    const depositRes = await request(app)
      .post(`/splits/${PROJECT_ID}/deposit`)
      .send({ from: COLLAB_A, amount: DEPOSIT_AMOUNT, token: TOKEN });
    expect(depositRes.status, `[full-flow deposit] ${JSON.stringify(depositRes.body)}`).toBe(200);

    // Step 3: distribute
    getAccountMock.mockResolvedValue({ accountId: "GSIMULATOR" });
    prepareTransactionMock.mockResolvedValue(makeXdrMock("distribute", "XDR_FULL_DISTRIBUTE"));
    const distributeRes = await request(app)
      .post(`/splits/${PROJECT_ID}/distribute`)
      .send({});
    expect(distributeRes.status, `[full-flow distribute] ${JSON.stringify(distributeRes.body)}`).toBe(200);

    // Step 4: history
    getEventsMock
      .mockResolvedValueOnce({
        events: [
          {
            value: nativeToScVal([1, BigInt(DEPOSIT_AMOUNT)]),
            txHash: "TXHASH_FULL_ROUND",
            ledgerClosedAt: "2026-04-01T12:00:00Z",
            id: "full-round-1"
          }
        ]
      })
      .mockResolvedValueOnce({
        events: [
          {
            value: nativeToScVal([COLLAB_A, BigInt(6_000_000)]),
            txHash: "TXHASH_FULL_PAY_A",
            ledgerClosedAt: "2026-04-01T12:00:01Z",
            id: "full-payment-a"
          }
        ]
      });

    const historyRes = await request(app).get(`/splits/${PROJECT_ID}/history`);
    expect(historyRes.status, `[full-flow history] ${JSON.stringify(historyRes.body)}`).toBe(200);
    expect(historyRes.body.items.length).toBeGreaterThan(0);
  });
});
