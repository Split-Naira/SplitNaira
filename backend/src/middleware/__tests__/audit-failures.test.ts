import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import { requestIdMiddleware } from "../request-id.js";
import {
  requirePaymentsAdminAccess,
  enforcePaymentsAdminWriteEnabled,
} from "../payments-admin.js";
import { errorHandler, notFoundHandler } from "../error.js";
import { auditAdminMutationsMiddleware } from "../audit-log.js";
import { logger } from "../../services/logger.js";
import { clearEnvCache } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Issue #1031: Audit allow-token and disallow-token failures should be
// auditable without leaking sensitive headers.
// ---------------------------------------------------------------------------

// Mock the database to capture audit log entries
const mockSave = vi.fn().mockResolvedValue(undefined);
const mockCreate = vi.fn((entry: Record<string, unknown>) => entry);
const mockGetRepository = vi.fn(() => ({
  create: mockCreate,
  save: mockSave,
}));

vi.mock("../../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: mockGetRepository,
  }),
}));

// Mock logger to capture log output
const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
vi.spyOn(logger, "info").mockImplementation(() => logger);

// Mock stellar SDK
vi.mock("@stellar/stellar-sdk", async (importOriginal) => ({
  // Real StrKey: env and address validation depend on its checksum logic.
  StrKey: (await importOriginal<typeof import("@stellar/stellar-sdk")>()).StrKey,
  Address: {
    fromString: vi.fn((addr: string) => ({
      toScVal: () => ({ address: addr }),
    })),
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
    Server: vi.fn(function () {
      return {
        getAccount: vi.fn(),
        prepareTransaction: vi.fn(),
        simulateTransaction: vi.fn(),
      };
    }),
  },
  xdr: {
    ScVal: {
      scvMap: (items: unknown[]) => items,
      scvU32: (value: number) => value,
      scvVec: (items: unknown[]) => items,
    },
  },
}));

beforeAll(() => {
  process.env.HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon.test";
  process.env.SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban.test";
  process.env.SOROBAN_NETWORK_PASSPHRASE =
    process.env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network";
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  process.env.SIMULATOR_ACCOUNT = process.env.SIMULATOR_ACCOUNT ?? "GTESTSIMULATOR";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "https://example.com/postgres";
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockCreate.mockImplementation((entry: Record<string, unknown>) => entry);
});

function buildApp(opts: { adminKey?: string; writesEnabled?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);

  if (opts.adminKey) {
    process.env.PAYMENTS_ADMIN_API_KEY = opts.adminKey;
  } else {
    delete process.env.PAYMENTS_ADMIN_API_KEY;
  }
  process.env.PAYMENTS_ADMIN_WRITE_ENABLED = opts.writesEnabled !== false ? "true" : "false";

  clearEnvCache();

  app.use(
    "/splits/admin",
    auditAdminMutationsMiddleware,
    requirePaymentsAdminAccess,
    enforcePaymentsAdminWriteEnabled
  );

  // Stub admin routes that return different status codes
  app.post("/splits/admin/allow-token", (_req, res) => {
    res.status(200).json({ xdr: "MOCK_XDR", metadata: { operation: "allow_token" } });
  });
  app.post("/splits/admin/disallow-token", (_req, res) => {
    res.status(200).json({ xdr: "MOCK_XDR", metadata: { operation: "disallow_token" } });
  });

  // Route that simulates validation failure
  app.post("/splits/admin/validation-fail", (_req, res) => {
    res.status(400).json({ error: "validation_error", message: "Invalid payload", details: {} });
  });

  // Route that simulates RPC failure
  app.post("/splits/admin/rpc-fail", (_req, res) => {
    res.status(502).json({ error: "rpc_error", message: "RPC operation failed", details: {} });
  });

  // Route that simulates auth failure
  app.post("/splits/admin/auth-fail", (_req, res) => {
    res.status(401).json({ error: "unauthorized", message: "Admin authentication failed", details: {} });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

describe("Issue #1031: Admin audit log captures mutations (success path)", () => {
  it("logs successful allow-token mutation with payload", async () => {
    const app = buildApp();
    const customId = "audit-success-1";
    await request(app)
      .post("/splits/admin/allow-token")
      .set("x-request-id", customId)
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(200);

    // Wait for the async 'finish' listener to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("allow_token");
    expect(savedEntry.payload).toMatchObject({ admin: "GADMIN", token: "[REDACTED]" });
  });

  it("logs successful disallow-token mutation with payload", async () => {
    const app = buildApp();
    const customId = "audit-success-2";
    await request(app)
      .post("/splits/admin/disallow-token")
      .set("x-request-id", customId)
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("disallow_token");
  });
});

describe("Issue #1031: Admin audit log captures failures", () => {
  it("logs validation failure with sanitized metadata", async () => {
    const app = buildApp();
    const customId = "audit-fail-val-1";
    await request(app)
      .post("/splits/admin/validation-fail")
      .set("x-request-id", customId)
      .send({ bad: "payload" })
      .expect(400);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("validation_fail");
    expect(savedEntry.payload).toMatchObject({
      action: "validation_fail",
      requestId: customId,
      route: "/splits/admin/validation-fail",
      statusCode: 400,
    });
  });

  it("logs RPC failure with sanitized metadata", async () => {
    const app = buildApp();
    const customId = "audit-fail-rpc-1";
    await request(app)
      .post("/splits/admin/rpc-fail")
      .set("x-request-id", customId)
      .send({ admin: "GADMIN" })
      .expect(502);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("rpc_fail");
    expect(savedEntry.payload).toMatchObject({
      action: "rpc_fail",
      statusCode: 502,
      route: "/splits/admin/rpc-fail",
    });
  });

  it("logs auth failure with sanitized metadata", async () => {
    const app = buildApp({ adminKey: "secret-key-123" });
    const customId = "audit-fail-auth-1";
    await request(app)
      .post("/splits/admin/auth-fail")
      .set("x-request-id", customId)
      .send({})
      .expect(401);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("auth_fail");
    expect(savedEntry.payload).toMatchObject({
      statusCode: 401,
    });
  });

  it("logs disabled-write failure when writes are disabled", async () => {
    const app = buildApp({ writesEnabled: false });
    const customId = "audit-fail-write-disabled-1";
    await request(app)
      .post("/splits/admin/allow-token")
      .set("x-request-id", customId)
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(503);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    expect(savedEntry.requestId).toBe(customId);
    expect(savedEntry.action).toBe("allow_token");
    expect(savedEntry.payload).toMatchObject({
      statusCode: 503,
      route: "/splits/admin/allow-token",
    });
  });
});

describe("Issue #1031: Audit log does not leak sensitive headers", () => {
  it("audit entry for write-disabled failure never contains raw API key", async () => {
    const app = buildApp({ adminKey: "super-secret-api-key-abc", writesEnabled: false });
    const customId = "audit-no-leak-1";
    await request(app)
      .post("/splits/admin/allow-token")
      .set("x-request-id", customId)
      .set("x-admin-api-key", "super-secret-api-key-abc")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(503);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedEntry = mockCreate.mock.calls[0][0];
    const serialized = JSON.stringify(savedEntry);
    expect(serialized).not.toContain("super-secret-api-key-abc");
    // Ensure the logged payload is failure metadata, not request body with headers
    if (savedEntry.payload && typeof savedEntry.payload === "object") {
      expect(Object.keys(savedEntry.payload)).not.toContain("headers");
      expect(Object.keys(savedEntry.payload)).not.toContain("authorization");
    }
  });

  it("warn log for blocked request does not contain API key", async () => {
    const app = buildApp({ adminKey: "my-secret-key-xyz", writesEnabled: false });
    await request(app)
      .post("/splits/admin/allow-token")
      .set("x-admin-api-key", "my-secret-key-xyz")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(503);

    // Check the warn log calls
    const blockedCalls = warnSpy.mock.calls.filter(
      ([msg]) => msg === "Blocked payments admin request"
    );
    expect(blockedCalls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(blockedCalls);
    expect(serialized).not.toContain("my-secret-key-xyz");
  });
});
