import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Issue #1640: stable error-code coverage across public route families.
 *
 * Every failure a client can trigger on a public route family must answer
 * with the same machine-readable envelope:
 *
 *   { error: <snake_case>, code: <UPPER_SNAKE>, message, requestId, details: {} }
 *
 * For each family this drives the real Express app (external services
 * mocked) into representative failures and asserts the HTTP status, the exact
 * stable `code`, that `error` is the snake_case form of the code, that the
 * body's `requestId` matches the `x-request-id` response header (and echoes a
 * client-supplied id), that `details` is an object, and that nothing internal
 * (stack traces, raw parser text) leaks. Clients branch on `code`, so a change
 * to any of these codes must fail here first.
 */

const mockUserExists = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const { StrKey } = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    StrKey,
    Address: {
      fromString: vi.fn((address: string) => ({ toScVal: () => ({ address }), toString: () => address })),
    },
    BASE_FEE: "100",
    Contract: vi.fn().mockImplementation(function () {
      return { call: vi.fn().mockReturnValue({}) };
    }),
    TransactionBuilder: vi.fn().mockImplementation(function () {
      return {
        addOperation: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({ toXDR: () => "test_xdr" }),
      };
    }),
    nativeToScVal: vi.fn((val: unknown) => ({ val })),
    scValToNative: vi.fn((val: unknown) => val),
    rpc: {
      Server: vi.fn().mockImplementation(function () {
        return {
          getAccount: vi.fn().mockResolvedValue({ accountId: () => "G_TEST", sequenceNumber: () => "1" }),
          simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: null } }),
          prepareTransaction: vi.fn().mockResolvedValue({ toXDR: () => "test_xdr", sequence: "1", fee: "100" }),
        };
      }),
    },
    xdr: { ScVal: { scvU32: vi.fn(), scvVec: vi.fn() } },
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
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      simulatorAccount: "test_account",
    })),
    getStellarRpcServer: vi.fn(() => ({
      getAccount: vi.fn().mockResolvedValue({ accountId: () => "G_TEST", sequenceNumber: () => "1" }),
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: null } }),
      prepareTransaction: vi.fn().mockResolvedValue({ toXDR: () => "test_xdr", sequence: "1", fee: "100" }),
      getEvents: vi.fn().mockResolvedValue({ events: [] }),
    })),
    executeWithRetry: vi.fn(async (fn: () => unknown) => fn()),
    getCached: vi.fn(() => undefined),
    setCached: vi.fn(),
    invalidateCache: vi.fn(),
    invalidateCacheByPrefix: vi.fn(),
    getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, evictions: 0 })),
    READ_CACHE_TTL_MS: 30000,
    checkSorobanReachability: vi.fn().mockResolvedValue({ rpc: { ok: true }, contract: { ok: true } }),
  };
});

vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(() => ({
    isInitialized: true,
    query: vi.fn().mockResolvedValue([{ one: 1 }]),
    getRepository: vi.fn(() => ({
      exists: mockUserExists,
      findOne: vi.fn().mockResolvedValue(null),
      findOneBy: vi.fn().mockResolvedValue(null),
    })),
  })),
  withTransaction: vi.fn(),
  initDatabase: vi.fn().mockResolvedValue({}),
  closeDatabase: vi.fn().mockResolvedValue({}),
}));

const ADMIN_KEY = "route-family-admin-key";
process.env.PAYMENTS_ADMIN_API_KEY = ADMIN_KEY;

const { app } = await import("../index.js");
const { clearEnvCache } = await import("../config/env.js");
const { markStartupComplete } = await import("../routes/health.js");

/** A checksum-valid Stellar account (the all-zero ed25519 key). */
const VALID_WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

type Res = request.Response;

/** Asserts the shared envelope and returns the body for case-specific checks. */
function expectEnvelope(res: Res, status: number, code: string, opts: { snake?: boolean } = {}) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.headers["content-type"]).toMatch(/application\/json/);
  const body = res.body as Record<string, unknown>;

  expect(body.code).toBe(code);
  expect(body.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  expect(typeof body.error).toBe("string");
  if (opts.snake !== false) expect(body.error).toBe(code.toLowerCase());

  expect(typeof body.message).toBe("string");
  expect((body.message as string).length).toBeGreaterThan(0);

  expect(typeof body.requestId).toBe("string");
  expect((body.requestId as string).length).toBeGreaterThan(0);
  expect(res.headers["x-request-id"]).toBe(body.requestId);

  expect(body.details).toBeTypeOf("object");
  expect(body.details).not.toBeNull();
  expect(Array.isArray(body.details)).toBe(false);

  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/\n\s+at |node_modules|SyntaxError|QueryFailedError/);
  return body;
}

interface Case {
  family: string;
  name: string;
  send: (requestId: string) => Promise<Res>;
  status: number;
  code: string;
  snake?: boolean;
  check?: (body: Record<string, unknown>) => void;
}

const rid = (id: string) => ({ "x-request-id": id });

const CASES: Case[] = [
  // ── Cross-cutting ────────────────────────────────────────────────────────
  {
    family: "unknown route",
    name: "unmatched path returns the static 404 contract",
    send: (id) => request(app).get("/definitely/not/a/route").set(rid(id)),
    status: 404,
    code: "NOT_FOUND",
  },
  {
    family: "unknown route",
    name: "unsupported verb on a known resource returns the same 404",
    send: (id) => request(app).delete("/transactions/history").set(rid(id)),
    status: 404,
    code: "NOT_FOUND",
  },
  {
    family: "body parsing",
    name: "malformed JSON is rejected before any route runs",
    send: (id) =>
      request(app).post("/users/register").set(rid(id)).set("Content-Type", "application/json").send("{ bad json"),
    status: 400,
    code: "INVALID_JSON",
  },

  // ── /splits ──────────────────────────────────────────────────────────────
  {
    family: "splits",
    name: "invalid project id",
    send: (id) => request(app).get("/splits/not-a-valid-id!!!").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    family: "splits",
    name: "invalid create payload",
    send: (id) => request(app).post("/splits").set(rid(id)).send({ owner: "nope" }),
    status: 400,
    code: "VALIDATION_ERROR",
  },

  // ── /splits/admin ────────────────────────────────────────────────────────
  {
    family: "splits admin",
    name: "missing admin API key",
    send: (id) => request(app).get("/splits/admin/status").set(rid(id)),
    status: 401,
    code: "ADMIN_AUTH_REQUIRED",
  },
  {
    family: "splits admin",
    name: "wrong admin API key",
    send: (id) => request(app).get("/splits/admin/status").set(rid(id)).set("x-admin-api-key", "wrong"),
    status: 401,
    code: "ADMIN_AUTH_REQUIRED",
  },

  // ── /users ───────────────────────────────────────────────────────────────
  {
    family: "users",
    name: "profile without a bearer token",
    send: (id) => request(app).get("/users/me").set(rid(id)),
    status: 401,
    code: "UNAUTHORIZED",
  },
  {
    family: "users",
    name: "invalid registration payload",
    send: (id) => request(app).post("/users/register").set(rid(id)).send({ walletAddress: "not-a-wallet" }),
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    family: "users",
    name: "registering an existing wallet",
    send: (id) => {
      mockUserExists.mockResolvedValueOnce(true);
      return request(app).post("/users/register").set(rid(id)).send({ walletAddress: VALID_WALLET });
    },
    status: 409,
    code: "CONFLICT",
  },

  // ── /auth ────────────────────────────────────────────────────────────────
  {
    family: "auth",
    name: "password reset with an invalid token",
    send: (id) =>
      request(app)
        .post("/auth/password-reset/confirm")
        .set(rid(id))
        .send({ token: "garbage", newPassword: "long-enough-password" }),
    status: 400,
    code: "INVALID_OR_EXPIRED_TOKEN",
  },
  {
    family: "auth",
    name: "email verification with an invalid token",
    send: (id) => request(app).post("/auth/email-verification/confirm").set(rid(id)).send({ token: "garbage" }),
    status: 400,
    code: "INVALID_OR_EXPIRED_TOKEN",
  },
  {
    family: "auth",
    name: "invitation accept with an invalid token",
    send: (id) => request(app).post("/auth/invitations/accept").set(rid(id)).send({ token: "garbage" }),
    status: 400,
    code: "INVALID_OR_EXPIRED_TOKEN",
  },
  {
    family: "auth",
    name: "email change confirm with an invalid token",
    send: (id) => request(app).post("/auth/email-change/confirm").set(rid(id)).send({ token: "garbage" }),
    status: 400,
    code: "INVALID_OR_EXPIRED_TOKEN",
  },
  {
    family: "auth",
    name: "password reset request without an email",
    send: (id) => request(app).post("/auth/password-reset/request").set(rid(id)).send({}),
    status: 400,
    code: "VALIDATION_ERROR",
  },

  // ── /collaboration ───────────────────────────────────────────────────────
  {
    family: "collaboration",
    name: "cancel invitation without a Stellar address header",
    send: (id) => request(app).post("/collaboration/invitations/inv-1/cancel").set(rid(id)),
    status: 401,
    code: "UNAUTHORIZED",
  },
  {
    family: "collaboration",
    name: "cancel an unknown invitation",
    send: (id) =>
      request(app)
        .post("/collaboration/invitations/does-not-exist/cancel")
        .set(rid(id))
        .set("x-stellar-address", VALID_WALLET),
    status: 404,
    code: "INVITATION_NOT_FOUND",
  },
  {
    family: "collaboration",
    name: "delete a project nobody can authorize",
    send: (id) =>
      request(app)
        .post("/collaboration/projects/project_1/delete")
        .set(rid(id))
        .set("x-stellar-address", VALID_WALLET)
        .send({ confirmed: true }),
    status: 403,
    code: "PERMISSION_DENIED",
    check: (body) => {
      // Pre-#1640 top-level fields stay for existing clients.
      expect(body.permission).toBe("project:delete");
      expect(body.details).toMatchObject({ permission: "project:delete" });
    },
  },

  // ── /transactions ────────────────────────────────────────────────────────
  {
    family: "transactions",
    name: "receipt for a malformed hash",
    send: (id) => request(app).get("/transactions/receipt/not-a-hash").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    family: "transactions",
    name: "history page size above the cap",
    send: (id) => request(app).get("/transactions/history?limit=1000").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    family: "transactions",
    name: "export without a bearer token",
    send: (id) => request(app).get("/transactions/export").set(rid(id)),
    status: 401,
    code: "UNAUTHORIZED",
  },
  {
    family: "transactions",
    name: "invalid payout attempt metadata",
    send: (id) => request(app).post("/transactions/recovery/attempts").set(rid(id)).send({ txHash: "x" }),
    status: 400,
    code: "VALIDATION_ERROR",
  },

  // ── /notifications ───────────────────────────────────────────────────────
  {
    family: "notifications",
    name: "list without a bearer token",
    send: (id) => request(app).get("/notifications").set(rid(id)),
    status: 401,
    code: "UNAUTHORIZED",
  },

  // ── /api/ledger ──────────────────────────────────────────────────────────
  {
    family: "ledger",
    name: "non-numeric limit",
    send: (id) => request(app).get("/api/ledger/blocks?limit=abc").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    family: "ledger",
    name: "cursor that is not a uuid",
    send: (id) => request(app).get("/api/ledger/blocks?cursor=nope").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },

  // ── /events ──────────────────────────────────────────────────────────────
  {
    family: "events",
    name: "SSE subscription without txHash",
    send: (id) => request(app).get("/events").set(rid(id)),
    status: 400,
    code: "VALIDATION_ERROR",
  },
];

describe("stable error codes across public route families (#1640)", () => {
  beforeAll(() => {
    markStartupComplete();
  });

  beforeEach(() => {
    process.env.PAYMENTS_ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
    clearEnvCache();
    mockUserExists.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
    clearEnvCache();
  });

  it("covers every public route family", () => {
    expect(new Set(CASES.map((c) => c.family))).toEqual(
      new Set([
        "unknown route",
        "body parsing",
        "splits",
        "splits admin",
        "users",
        "auth",
        "collaboration",
        "transactions",
        "notifications",
        "ledger",
        "events",
      ]),
    );
  });

  for (const c of CASES) {
    it(`${c.family}: ${c.name} -> ${c.status} ${c.code}`, async () => {
      const requestId = `rf-${c.family.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await c.send(requestId);
      const body = expectEnvelope(res, c.status, c.code, { snake: c.snake });
      // A client-supplied correlation id is echoed back unchanged.
      expect(body.requestId).toBe(requestId);
      c.check?.(body);
    });
  }

  it("generates a requestId when the client sends none", async () => {
    const res = await request(app).get("/transactions/receipt/not-a-hash");
    const body = expectEnvelope(res, 400, "VALIDATION_ERROR");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never reflects an unsafe client correlation id, even on early parse errors", async () => {
    const unsafe = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    const res = await request(app)
      .post("/users/register")
      .set("x-request-id", unsafe)
      .set("Content-Type", "application/json")
      .send("{ bad json");
    const body = expectEnvelope(res, 400, "INVALID_JSON");
    expect(body.requestId).not.toBe(unsafe);
    expect(JSON.stringify(res.headers)).not.toContain(unsafe);
  });

  it("splits admin: writes disabled -> 503 PAYMENTS_ADMIN_WRITES_DISABLED with rollback details", async () => {
    process.env.PAYMENTS_ADMIN_WRITE_ENABLED = "false";
    clearEnvCache();
    const res = await request(app)
      .post("/splits/admin/pause-distributions")
      .set(rid("rf-admin-writes-disabled"))
      .set("x-admin-api-key", ADMIN_KEY)
      .send({});
    const body = expectEnvelope(res, 503, "PAYMENTS_ADMIN_WRITES_DISABLED");
    expect(body.details).toEqual({ rollbackAware: true });
  });

  it("the same failure class gets the same code in every family", async () => {
    const unauthorized = await Promise.all([
      request(app).get("/users/me"),
      request(app).get("/transactions/export"),
      request(app).get("/notifications"),
      request(app).post("/collaboration/invitations/x/cancel"),
    ]);
    for (const res of unauthorized) expectEnvelope(res, 401, "UNAUTHORIZED");

    const validation = await Promise.all([
      request(app).get("/splits/bad-id!!!"),
      request(app).get("/transactions/receipt/zz"),
      request(app).get("/api/ledger/blocks?limit=0"),
      request(app).get("/events"),
    ]);
    for (const res of validation) expectEnvelope(res, 400, "VALIDATION_ERROR");
  });
});
