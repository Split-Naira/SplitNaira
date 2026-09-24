/**
 * Cache invalidation coverage for token allowlist mutations (Issue #1095).
 *
 * Current contract (see the note above the allowlist routes in
 * routes/splits.ts): allowlist reads (`GET /splits/admin/allowlist`,
 * `/admin/is-token-allowed`, `/admin/token-count`) bypass the shared read
 * cache and simulate against the contract on every request. The mutation
 * routes (`POST /splits/admin/allow-token`, `/admin/disallow-token`) only build
 * an unsigned XDR, which the admin's wallet signs and submits, so the backend
 * never sees the moment the allowlist actually changes. Because nothing is
 * cached, nothing can go stale.
 *
 * These tests pin that contract. If allowlist reads start using the read
 * cache, the "reflects the next contract state" tests fail until explicit
 * invalidation is added as well.
 */
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { splitsRouter } from "../routes/splits.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { loadStellarConfig } from "../services/stellar.js";
import { getReadCache } from "../services/read-cache.js";

const getAccountMock = vi.fn();
const prepareTransactionMock = vi.fn();
const simulateTransactionMock = vi.fn();

vi.mock("@stellar/stellar-sdk", () => ({
  Address: {
    fromString: vi.fn((address: string) => {
      if (!/^[GC][A-Z0-9_]+$/.test(address)) throw new Error("invalid address");
      return { toScVal: () => ({ address }) };
    }),
  },
  BASE_FEE: 100,
  Contract: vi.fn().mockImplementation(function () {
    return { call: (method: string, ...args: unknown[]) => ({ method, args }) };
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
  nativeToScVal: vi.fn((value: unknown) => ({ toXDR: () => `MOCKED_XDR_${value}` })),
  scValToNative: vi.fn((value: unknown) => value),
  rpc: {
    Server: vi.fn().mockImplementation(function () {
      return {
        getAccount: getAccountMock,
        prepareTransaction: prepareTransactionMock,
        simulateTransaction: simulateTransactionMock,
      };
    }),
  },
  xdr: {
    ScVal: {
      scvMap: (items: unknown[]) => items,
      scvU32: (value: number) => value,
      scvVec: (items: unknown[]) => items,
    },
    ScMapEntry: class {
      constructor(public readonly entry: unknown) {}
    },
  },
}));

const ADMIN = "GADMIN";
const TOKEN_A = "CTOKENA";
const TOKEN_B = "CTOKENB";

/** Stand-in for on-chain allowlist state, read by the simulateTransaction mock. */
let onChainAllowlist: string[];

function applyOnChain(operation: "allow_token" | "disallow_token", token: string) {
  if (operation === "allow_token" && !onChainAllowlist.includes(token)) {
    onChainAllowlist = [...onChainAllowlist, token];
  }
  if (operation === "disallow_token") {
    onChainAllowlist = onChainAllowlist.filter((t) => t !== token);
  }
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Builds the unsigned XDR through the API, then simulates the wallet submitting it. */
async function mutateAllowlist(
  app: express.Express,
  operation: "allow_token" | "disallow_token",
  token: string
) {
  const path = operation === "allow_token" ? "allow-token" : "disallow-token";
  const res = await request(app)
    .post(`/splits/admin/${path}`)
    .send({ admin: ADMIN, token })
    .expect(200);
  expect(res.body.metadata.operation).toBe(operation);
  applyOnChain(operation, token);
}

beforeAll(() => {
  // Configures the shared read cache once so later getReadCache() calls
  // inspect the same instance the routes use.
  loadStellarConfig();
});

beforeEach(() => {
  vi.clearAllMocks();
  getReadCache().clear();
  onChainAllowlist = [TOKEN_A];

  getAccountMock.mockImplementation(async (accountId: string) => ({ accountId }));
  prepareTransactionMock.mockResolvedValue({ toXDR: () => "XDR_ADMIN", sequence: "1", fee: "100" });
  simulateTransactionMock.mockImplementation(
    async (tx: { preparedOperation: { method: string; args: unknown[] } }) => {
      const { method, args } = tx.preparedOperation;
      switch (method) {
        case "get_admin":
          return { result: { retval: ADMIN } };
        case "get_allowed_token_count":
          return { result: { retval: onChainAllowlist.length } };
        case "get_allowed_tokens":
          return { result: { retval: [...onChainAllowlist] } };
        case "is_token_allowed":
          return {
            result: { retval: onChainAllowlist.includes((args[0] as { address: string }).address) },
          };
        default:
          throw new Error(`unexpected simulate call: ${method}`);
      }
    }
  );
});

describe("token allowlist cache invalidation (Issue #1095)", () => {
  it("GET /admin/allowlist reflects the next contract state after allow-token", async () => {
    const app = createApp();

    const before = await request(app).get("/splits/admin/allowlist").expect(200);
    expect(before.body).toEqual({ admin: ADMIN, count: 1, tokens: [TOKEN_A] });

    await mutateAllowlist(app, "allow_token", TOKEN_B);

    const after = await request(app).get("/splits/admin/allowlist").expect(200);
    expect(after.body).toEqual({ admin: ADMIN, count: 2, tokens: [TOKEN_A, TOKEN_B] });
  });

  it("GET /admin/allowlist reflects the next contract state after disallow-token", async () => {
    const app = createApp();

    await request(app).get("/splits/admin/allowlist").expect(200);
    await mutateAllowlist(app, "disallow_token", TOKEN_A);

    const after = await request(app).get("/splits/admin/allowlist").expect(200);
    expect(after.body).toEqual({ admin: ADMIN, count: 0, tokens: [] });
  });

  it("GET /admin/is-token-allowed flips across an allow → disallow cycle", async () => {
    const app = createApp();
    const check = async () =>
      (await request(app).get(`/splits/admin/is-token-allowed?token=${TOKEN_B}`).expect(200)).body
        .isAllowed;

    expect(await check()).toBe(false);
    await mutateAllowlist(app, "allow_token", TOKEN_B);
    expect(await check()).toBe(true);
    await mutateAllowlist(app, "disallow_token", TOKEN_B);
    expect(await check()).toBe(false);
  });

  it("GET /admin/token-count tracks each mutation", async () => {
    const app = createApp();
    const count = async () =>
      (await request(app).get("/splits/admin/token-count").expect(200)).body.count;

    expect(await count()).toBe(1);
    await mutateAllowlist(app, "allow_token", TOKEN_B);
    expect(await count()).toBe(2);
    await mutateAllowlist(app, "disallow_token", TOKEN_A);
    await mutateAllowlist(app, "disallow_token", TOKEN_B);
    expect(await count()).toBe(0);
  });

  it("reflects allowlist changes submitted outside this API (e.g. directly from the admin wallet)", async () => {
    const app = createApp();

    await request(app).get("/splits/admin/allowlist").expect(200);
    applyOnChain("allow_token", TOKEN_B);

    const after = await request(app).get("/splits/admin/allowlist").expect(200);
    expect(after.body.tokens).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("simulates against the contract on every allowlist read instead of serving a cached result", async () => {
    const app = createApp();

    await request(app).get("/splits/admin/allowlist").expect(200);
    await request(app).get("/splits/admin/allowlist").expect(200);
    await request(app).get(`/splits/admin/is-token-allowed?token=${TOKEN_A}`).expect(200);
    await request(app).get(`/splits/admin/is-token-allowed?token=${TOKEN_A}`).expect(200);

    // 3 simulations per allowlist page read, 1 per is-token-allowed read.
    expect(simulateTransactionMock).toHaveBeenCalledTimes(3 * 2 + 1 * 2);
    expect(getReadCache().stats().size).toBe(0);
  });

  it.each(["allow_token", "disallow_token"] as const)(
    "%s leaves unrelated project read-cache entries untouched",
    async (operation) => {
      const app = createApp();
      const cache = getReadCache();
      cache.set("project:p1", { id: "p1" });
      cache.set("list_projects:0:10", [{ id: "p1" }]);

      await mutateAllowlist(app, operation, TOKEN_B);

      expect(cache.get("project:p1")).toEqual({ id: "p1" });
      expect(cache.get("list_projects:0:10")).toEqual([{ id: "p1" }]);
      expect(cache.stats().keys.sort()).toEqual(["list_projects:0:10", "project:p1"]);
    }
  );

  it("a rejected mutation does not touch the read cache", async () => {
    const app = createApp();
    const cache = getReadCache();
    cache.set("project:p1", { id: "p1" });

    await request(app)
      .post("/splits/admin/allow-token")
      .send({ admin: ADMIN }) // missing token
      .expect(400);

    expect(cache.stats().keys).toEqual(["project:p1"]);
    expect(prepareTransactionMock).not.toHaveBeenCalled();
  });
});
