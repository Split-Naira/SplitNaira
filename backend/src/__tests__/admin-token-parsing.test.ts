import express from "express";
import request from "supertest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failed token address parsing in admin flows.
 *
 * Every admin route that accepts a token address must reject a malformed one
 * with the standard 400 `validation_error` envelope, and must do so before any
 * Soroban RPC traffic (no getAccount / simulate / prepare) and before the
 * admin action is audit-logged. The service-layer builders are also exercised
 * directly, since they are reachable without the route-level Zod schema.
 *
 * Address parsing uses the real @stellar/stellar-sdk; only the RPC server is
 * mocked, so these tests pin the SDK's actual strkey rules.
 */

const getAccountMock = vi.fn();
const prepareTransactionMock = vi.fn();
const simulateTransactionMock = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function () {
        return {
          getAccount: getAccountMock,
          prepareTransaction: prepareTransactionMock,
          simulateTransaction: simulateTransactionMock,
        };
      }),
    },
  };
});

vi.mock("../services/database.js", () => ({
  getDataSource: vi.fn(() => ({ isInitialized: true, query: vi.fn() })),
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  withTransaction: vi.fn(),
}));

const loggerInfoMock = vi.hoisted(() => vi.fn());
vi.mock("../services/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/logger.js")>();
  return {
    ...actual,
    logger: { ...actual.logger, info: loggerInfoMock },
  };
});

import { splitsRouter } from "../routes/splits.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import {
  buildAllowTokenUnsignedXdr,
  buildDisallowTokenUnsignedXdr,
  buildWithdrawUnallocatedUnsignedXdr,
} from "../services/splits.service.js";
import { RequestValidationError } from "../services/stellar.js";

const ADMIN = Keypair.random().publicKey();
const DESTINATION = Keypair.random().publicKey();
const VALID_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 7));

const flipLastChar = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");

/** Token values that must never reach the contract. */
const MALFORMED_TOKENS: Array<[label: string, value: unknown]> = [
  ["empty string", ""],
  ["arbitrary text", "not-an-address"],
  ["bad checksum", flipLastChar(VALID_TOKEN)],
  ["truncated strkey", VALID_TOKEN.slice(0, -1)],
  ["lowercased strkey", VALID_TOKEN.toLowerCase()],
  ["whitespace-padded strkey", ` ${VALID_TOKEN} `],
  ["secret seed", Keypair.random().secret()],
  ["hex contract id", `0x${"ab".repeat(32)}`],
  ["number", 12345],
  ["null", null],
];

type AdminTokenRoute = {
  name: string;
  send: (token: unknown) => request.Test;
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = createTestApp();

const ROUTES: AdminTokenRoute[] = [
  {
    name: "POST /splits/admin/allow-token",
    send: (token) => request(app).post("/splits/admin/allow-token").send({ admin: ADMIN, token }),
  },
  {
    name: "POST /splits/admin/disallow-token",
    send: (token) => request(app).post("/splits/admin/disallow-token").send({ admin: ADMIN, token }),
  },
  {
    name: "POST /splits/admin/withdraw-unallocated",
    send: (token) =>
      request(app)
        .post("/splits/admin/withdraw-unallocated")
        .send({ admin: ADMIN, token, to: DESTINATION, amount: 100 }),
  },
  {
    name: "GET /splits/admin/is-token-allowed",
    send: (token) => request(app).get("/splits/admin/is-token-allowed").query({ token: String(token) }),
  },
  {
    name: "GET /splits/admin/unallocated",
    send: (token) => request(app).get("/splits/admin/unallocated").query({ token: String(token) }),
  },
];

function expectNoRpcTraffic() {
  expect(getAccountMock).not.toHaveBeenCalled();
  expect(simulateTransactionMock).not.toHaveBeenCalled();
  expect(prepareTransactionMock).not.toHaveBeenCalled();
}

function expectNoAdminAuditLog() {
  expect(loggerInfoMock).not.toHaveBeenCalledWith("Payments admin action prepared", expect.anything());
}

describe("admin flows: failed token address parsing", () => {
  beforeAll(() => {
    process.env.HORIZON_URL = "https://horizon.test";
    process.env.SOROBAN_RPC_URL = "https://soroban.test";
    process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.CONTRACT_ID = VALID_TOKEN;
    process.env.SIMULATOR_ACCOUNT = ADMIN;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(ROUTES)("$name", (route) => {
    // Query-string routes can only carry strings, so skip non-string payloads there.
    const cases = route.name.startsWith("GET")
      ? MALFORMED_TOKENS.filter(([, v]) => typeof v === "string")
      : MALFORMED_TOKENS;

    it.each(cases)("rejects %s with a 400 token field error and no RPC calls", async (_label, token) => {
      const res = await route.send(token);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "validation_error",
        message: "Invalid request payload.",
      });
      expect(typeof res.body.requestId).toBe("string");
      expect(res.body.details.fieldErrors.token).toEqual(expect.arrayContaining([expect.any(String)]));
      expectNoRpcTraffic();
      expectNoAdminAuditLog();
    });
  });

  it.each([
    ["POST /splits/admin/allow-token", () => request(app).post("/splits/admin/allow-token").send({ admin: ADMIN })],
    ["POST /splits/admin/disallow-token", () => request(app).post("/splits/admin/disallow-token").send({ admin: ADMIN })],
    [
      "POST /splits/admin/withdraw-unallocated",
      () => request(app).post("/splits/admin/withdraw-unallocated").send({ admin: ADMIN, to: DESTINATION, amount: 1 }),
    ],
    ["GET /splits/admin/is-token-allowed", () => request(app).get("/splits/admin/is-token-allowed")],
    ["GET /splits/admin/unallocated", () => request(app).get("/splits/admin/unallocated")],
  ])("%s rejects a missing token", async (_name, send) => {
    const res = await send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details.fieldErrors.token).toBeDefined();
    expectNoRpcTraffic();
  });

  it("reports only the token field when the admin address is valid", async () => {
    const res = await request(app)
      .post("/splits/admin/allow-token")
      .send({ admin: ADMIN, token: "not-an-address" });

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details.fieldErrors)).toEqual(["token"]);
    expect(res.body.details.fieldErrors.token[0]).toMatch(/valid Stellar address/);
  });

  it("does not echo the rejected token value back in the error message", async () => {
    const marker = "<script>alert(1)</script>";
    const res = await request(app).post("/splits/admin/allow-token").send({ admin: ADMIN, token: marker });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(marker);
  });

  describe("service-layer builders (defense in depth)", () => {
    const BAD_TOKEN = flipLastChar(VALID_TOKEN);

    it.each([
      ["buildAllowTokenUnsignedXdr", () => buildAllowTokenUnsignedXdr({ admin: ADMIN, token: BAD_TOKEN })],
      ["buildDisallowTokenUnsignedXdr", () => buildDisallowTokenUnsignedXdr({ admin: ADMIN, token: BAD_TOKEN })],
      [
        "buildWithdrawUnallocatedUnsignedXdr",
        () => buildWithdrawUnallocatedUnsignedXdr({ admin: ADMIN, token: BAD_TOKEN, to: DESTINATION, amount: 1 }),
      ],
    ])("%s throws RequestValidationError before any RPC call", async (_name, build) => {
      const promise = build();

      await expect(promise).rejects.toBeInstanceOf(RequestValidationError);
      await expect(promise).rejects.toThrow("token address must be a valid Stellar address");
      expectNoRpcTraffic();
    });

    it("buildWithdrawUnallocatedUnsignedXdr rejects a malformed destination before any RPC call", async () => {
      await expect(
        buildWithdrawUnallocatedUnsignedXdr({ admin: ADMIN, token: VALID_TOKEN, to: "bogus", amount: 1 })
      ).rejects.toThrow("destination address must be a valid Stellar address");
      expectNoRpcTraffic();
    });
  });
});
