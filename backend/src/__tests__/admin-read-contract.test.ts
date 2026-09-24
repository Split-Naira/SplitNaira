import express from "express";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

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
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { generateOpenApi } from "../openapi.js";
import {
  getValidationFailureCount,
  resetValidationFailureCount,
} from "../middleware/validateResponse.js";
import {
  AdminAllowlistResponseSchema,
  AdminStatusResponseSchema,
  AdminIsTokenAllowedResponseSchema,
  AdminTokenCountResponseSchema,
  AdminUnallocatedResponseSchema,
  AdminCacheStatsResponseSchema,
} from "../schemas/admin.schemas.js";

/**
 * Issue #1088: response-contract tests for the split admin READ endpoints.
 *
 * admin-response-validation.test.ts covers the happy path. This suite pins
 * the contract itself, for every admin read route:
 *   1. 200 bodies match the runtime Zod schema exactly (no undeclared fields).
 *   2. The runtime schema and the published OpenAPI 200 schema agree on
 *      field names and required fields, so docs and runtime cannot drift apart.
 *   3. Drifted payloads are blocked with 500 in strict mode (production
 *      default) and only counted in lenient mode.
 *   4. Failures use the standard error envelope and never count as
 *      response-schema violations.
 */

const ADMIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TOKEN = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

type ContractReturns = Record<string, unknown>;

interface AdminReadContract {
  path: string;
  url: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** On-chain values keyed by contract method (none for non-RPC routes). */
  contractReturns: ContractReturns;
  expectedBody?: Record<string, unknown>;
  /** Contract values that violate the schema, when the route can surface drift. */
  drift?: ContractReturns;
}

const ADMIN_READ_CONTRACTS: AdminReadContract[] = [
  {
    path: "/splits/admin/allowlist",
    url: "/splits/admin/allowlist?start=0&limit=10",
    schema: AdminAllowlistResponseSchema,
    contractReturns: { get_admin: ADMIN, get_allowed_token_count: 2, get_allowed_tokens: [TOKEN, TOKEN_B] },
    expectedBody: { admin: ADMIN, count: 2, tokens: [TOKEN, TOKEN_B] },
    drift: { get_admin: ADMIN, get_allowed_token_count: 2, get_allowed_tokens: "not-a-list" },
  },
  {
    path: "/splits/admin/status",
    url: "/splits/admin/status",
    schema: AdminStatusResponseSchema,
    contractReturns: { get_admin: ADMIN, is_distributions_paused: true },
    expectedBody: { admin: ADMIN, isPaused: true },
  },
  {
    path: "/splits/admin/is-token-allowed",
    url: `/splits/admin/is-token-allowed?token=${TOKEN}`,
    schema: AdminIsTokenAllowedResponseSchema,
    contractReturns: { is_token_allowed: true },
    expectedBody: { token: TOKEN, isAllowed: true },
  },
  {
    path: "/splits/admin/token-count",
    url: "/splits/admin/token-count",
    schema: AdminTokenCountResponseSchema,
    contractReturns: { get_allowed_token_count: 7 },
    expectedBody: { count: 7 },
    drift: { get_allowed_token_count: "seven" },
  },
  {
    path: "/splits/admin/unallocated",
    url: `/splits/admin/unallocated?token=${TOKEN}`,
    schema: AdminUnallocatedResponseSchema,
    contractReturns: { get_unallocated_balance: 1250000 },
    expectedBody: { token: TOKEN, unallocated: "1250000" },
  },
  {
    path: "/splits/admin/cache-stats",
    url: "/splits/admin/cache-stats",
    schema: AdminCacheStatsResponseSchema,
    contractReturns: {},
  },
];

const RPC_BACKED_CONTRACTS = ADMIN_READ_CONTRACTS.filter((c) => Object.keys(c.contractReturns).length > 0);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Answer each simulated contract call from `returns`, keyed by method name. */
function mockContract(returns: ContractReturns) {
  getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });
  simulateTransactionMock.mockImplementation(async (tx: { preparedOperation: { method: string } }) => {
    const method = tx.preparedOperation.method;
    if (!(method in returns)) throw new Error(`unexpected contract call: ${method}`);
    return { result: { retval: returns[method] } };
  });
}

function requiredKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
    .map(([key]) => key)
    .sort();
}

function expectErrorEnvelope(body: Record<string, unknown>) {
  expect(typeof body.error).toBe("string");
  expect(typeof body.message).toBe("string");
  expect(typeof body.requestId).toBe("string");
}

describe("Issue #1088: split admin read endpoint response contracts", () => {
  const originalStrict = process.env.STRICT_RESPONSE_VALIDATION;

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
  });

  describe("200 bodies match the runtime schema exactly", () => {
    for (const contract of ADMIN_READ_CONTRACTS) {
      it(`GET ${contract.path}`, async () => {
        mockContract(contract.contractReturns);

        const res = await request(createTestApp()).get(contract.url);

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/json/);
        // strict(): an undeclared field in the body is a contract break too.
        const parsed = contract.schema.strict().safeParse(res.body);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        for (const key of requiredKeys(contract.schema)) {
          expect(res.body).toHaveProperty(key);
        }
        if (contract.expectedBody) {
          expect(res.body).toEqual(contract.expectedBody);
        }
        expect(getValidationFailureCount()).toBe(0);
      });
    }
  });

  describe("runtime schemas agree with the published OpenAPI spec", () => {
    const spec = generateOpenApi() as {
      paths: Record<string, { get?: { responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> } }>;
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };

    function openApi200Schema(path: string) {
      let schema = spec.paths[path]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
      const ref = schema?.$ref as string | undefined;
      if (ref) schema = spec.components?.schemas?.[ref.split("/").pop()!];
      return schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    }

    for (const contract of ADMIN_READ_CONTRACTS) {
      it(`GET ${contract.path}`, () => {
        const published = openApi200Schema(contract.path);
        expect(published, `no 200 schema documented for ${contract.path}`).toBeDefined();
        expect(Object.keys(published!.properties ?? {}).sort()).toEqual(Object.keys(contract.schema.shape).sort());
        expect([...(published!.required ?? [])].sort()).toEqual(requiredKeys(contract.schema));
      });
    }
  });

  describe("schema drift is blocked in strict mode and counted in lenient mode", () => {
    for (const contract of ADMIN_READ_CONTRACTS.filter((c) => c.drift)) {
      it(`GET ${contract.path} returns 500 on drift when strict`, async () => {
        mockContract(contract.drift!);

        const res = await request(createTestApp()).get(contract.url);

        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({
          error: "internal_error",
          message: "Response schema validation failed.",
        });
        expectErrorEnvelope(res.body);
        expect(getValidationFailureCount()).toBe(1);
      });

      it(`GET ${contract.path} forwards drift but counts it when lenient`, async () => {
        process.env.STRICT_RESPONSE_VALIDATION = "false";
        mockContract(contract.drift!);

        const res = await request(createTestApp()).get(contract.url);

        expect(res.status).toBe(200);
        expect(contract.schema.safeParse(res.body).success).toBe(false);
        expect(getValidationFailureCount()).toBe(1);
      });
    }
  });

  describe("failures use the error envelope and are not counted as drift", () => {
    for (const contract of RPC_BACKED_CONTRACTS) {
      it(`GET ${contract.path} when the simulator account is missing`, async () => {
        getAccountMock.mockRejectedValue(new Error("account not found"));

        const res = await request(createTestApp()).get(contract.url);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("validation_error");
        expectErrorEnvelope(res.body);
        expect(getValidationFailureCount()).toBe(0);
      });

      it(`GET ${contract.path} when the RPC simulation fails`, async () => {
        getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });
        simulateTransactionMock.mockRejectedValue(new Error("rpc unavailable"));

        const res = await request(createTestApp()).get(contract.url);

        expect(res.status).toBeGreaterThanOrEqual(500);
        expectErrorEnvelope(res.body);
        expect(getValidationFailureCount()).toBe(0);
      });
    }

    for (const path of ["/splits/admin/is-token-allowed", "/splits/admin/unallocated"]) {
      it(`GET ${path} without the token query returns a 400 envelope`, async () => {
        const res = await request(createTestApp()).get(path);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("validation_error");
        expectErrorEnvelope(res.body);
        expect(simulateTransactionMock).not.toHaveBeenCalled();
        expect(getValidationFailureCount()).toBe(0);
      });
    }
  });
});
