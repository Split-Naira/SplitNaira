import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { splitsRouter } from "./splits.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";

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
      fromString: vi.fn((address: string) => ({
        toScVal: () => ({ address }),
      })),
    },
    BASE_FEE: 100,
    Contract: vi.fn().mockImplementation(() => ({
      call: (method: string, ...args: unknown[]) => ({ method, args }),
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
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
    })),
    nativeToScVal: vi.fn((value: unknown) => ({
      toXDR: () => `MOCKED_XDR_${value}`,
    })),
    scValToNative: vi.fn((value: unknown) => value),
    rpc: {
      Server: vi.fn(() => serverMock),
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

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

beforeAll(() => {
  process.env.HORIZON_URL = "https://horizon.test";
  process.env.SOROBAN_RPC_URL = "https://soroban.test";
  process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network";
  process.env.CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  process.env.SIMULATOR_ACCOUNT = "GTESTSIMULATOR";
  process.env.DATABASE_URL = "https://example.com/postgres";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("splits routes integration", () => {
  it("creates a split project", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GOWNER" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_CREATE",
      sequence: "123",
      fee: "100",
    });

    const app = createApp();

    const createPayload = {
      owner: "GOWNER",
      projectId: "project_1",
      title: "Project 1",
      projectType: "token",
      token: "GTOKENADDRESS",
      collaborators: [
        { address: "GCOLLAB1", alias: "A", basisPoints: 5000 },
        { address: "GCOLLAB2", alias: "B", basisPoints: 5000 },
      ],
    };

    const response = await request(app)
      .post("/splits")
      .send(createPayload)
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_CREATE",
      metadata: {
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        networkPassphrase: "Test SDF Network",
        sourceAccount: "GOWNER",
        operation: "create_project",
      },
    });

    expect(getAccountMock).toHaveBeenCalledWith("GOWNER");
  });

  it("locks a split project", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GOWNER" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_LOCK",
      sequence: "456",
      fee: "100",
    });

    const app = createApp();

    const response = await request(app)
      .post("/splits/project_1/lock")
      .send({ owner: "GOWNER" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_LOCK",
      metadata: {
        operation: "lock_project",
        sourceAccount: "GOWNER",
      },
    });

    expect(getAccountMock).toHaveBeenCalledWith("GOWNER");
  });

  it("builds distribute transaction", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GDISP" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_DISTRIBUTE",
      sequence: "789",
      fee: "100",
    });

    const app = createApp();

    const response = await request(app)
      .post("/splits/project_1/distribute")
      .send({ sourceAddress: "GDISP" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_DISTRIBUTE",
      metadata: {
        operation: "distribute",
        sourceAccount: "GDISP",
      },
    });

    expect(getAccountMock).toHaveBeenCalledWith("GDISP");
  });

  it("lists split projects", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GSIM" });
    simulateTransactionMock.mockResolvedValue({
      result: {
        retval: [{ projectId: "project_1" }, { projectId: "project_2" }],
      },
    });

    const app = createApp();

    const response = await request(app)
      .get("/splits?start=0&limit=10")
      .expect(200);

    expect(response.body).toEqual([
      { projectId: "project_1" },
      { projectId: "project_2" },
    ]);

    expect(getAccountMock).toHaveBeenCalledWith("GTESTSIMULATOR");
  });

  it("fetches a project by id", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GSIM" });
    simulateTransactionMock.mockResolvedValue({
      result: {
        retval: { projectId: "project_1", title: "Project 1" },
      },
    });

    const app = createApp();

    const response = await request(app).get("/splits/project_1").expect(200);

    expect(response.body).toEqual({
      projectId: "project_1",
      title: "Project 1",
    });
    expect(getAccountMock).toHaveBeenCalledWith("GTESTSIMULATOR");
  });

  it("reads admin allowlist state", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GSIM" });
    simulateTransactionMock
      .mockResolvedValueOnce({
        result: {
          retval: "GADMIN",
        },
      })
      .mockResolvedValueOnce({
        result: {
          retval: 2,
        },
      })
      .mockResolvedValueOnce({
        result: {
          retval: ["GTOKEN_1", "GTOKEN_2"],
        },
      });

    const app = createApp();

    const response = await request(app)
      .get("/splits/admin/allowlist?start=0&limit=25")
      .expect(200);

    expect(response.body).toEqual({
      admin: "GADMIN",
      count: 2,
      tokens: ["GTOKEN_1", "GTOKEN_2"],
    });

    expect(getAccountMock).toHaveBeenCalledWith("GTESTSIMULATOR");
    expect(simulateTransactionMock).toHaveBeenCalledTimes(3);
  });

  it("builds allow_token transaction", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GADMIN" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_ALLOW_TOKEN",
      sequence: "100",
      fee: "100",
    });

    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/allow-token")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_ALLOW_TOKEN",
      metadata: {
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        networkPassphrase: "Test SDF Network",
        sourceAccount: "GADMIN",
        operation: "allow_token",
      },
    });

    expect(getAccountMock).toHaveBeenCalledWith("GADMIN");
  });

  it("builds disallow_token transaction", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GADMIN" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_DISALLOW_TOKEN",
      sequence: "101",
      fee: "100",
    });

    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/disallow-token")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_DISALLOW_TOKEN",
      metadata: {
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        networkPassphrase: "Test SDF Network",
        sourceAccount: "GADMIN",
        operation: "disallow_token",
      },
    });

    expect(getAccountMock).toHaveBeenCalledWith("GADMIN");
  });

  it("returns 400 for allow_token with missing fields", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/allow-token")
      .send({ admin: "GADMIN" }) // missing token
      .expect(400);

    expect(response.body.error).toBe("validation_error");
  });

  it("returns 400 for disallow_token with missing fields", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/disallow-token")
      .send({ token: "GTOKEN" }) // missing admin
      .expect(400);

    expect(response.body.error).toBe("validation_error");
  });

  it("returns 400 for allow_token when admin account not found", async () => {
    getAccountMock.mockRejectedValue(new Error("not found"));

    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/allow-token")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(response.body.message).toMatch(/admin account not found/);
  }, 15000);

  it("returns 400 for disallow_token when admin account not found", async () => {
    getAccountMock.mockRejectedValue(new Error("not found"));

    const app = createApp();

    const response = await request(app)
      .post("/splits/admin/disallow-token")
      .send({ admin: "GADMIN", token: "GTOKEN" })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(response.body.message).toMatch(/admin account not found/);
  }, 15000);

  it("builds pause_distributions transaction", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GADMIN" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_PAUSE_DISTRIBUTIONS",
      sequence: "102",
      fee: "100",
    });

    const app = createApp();
    const response = await request(app)
      .post("/splits/admin/pause-distributions")
      .send({ admin: "GADMIN" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_PAUSE_DISTRIBUTIONS",
      metadata: {
        sourceAccount: "GADMIN",
        operation: "pause_distributions",
      },
    });
  });

  it("builds unpause_distributions transaction", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GADMIN" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_UNPAUSE_DISTRIBUTIONS",
      sequence: "103",
      fee: "100",
    });

    const app = createApp();
    const response = await request(app)
      .post("/splits/admin/unpause-distributions")
      .send({ admin: "GADMIN" })
      .expect(200);

    expect(response.body).toMatchObject({
      xdr: "XDR_UNPAUSE_DISTRIBUTIONS",
      metadata: {
        sourceAccount: "GADMIN",
        operation: "unpause_distributions",
      },
    });
  });

  it("retrieves history filtered and sorted", async () => {
    getAccountMock.mockResolvedValue({ accountId: "GSIM" });

    getEventsMock
      .mockResolvedValueOnce({
        events: [
          {
            value: [2, 100],
            txHash: "TX2",
            ledgerClosedAt: "2025-01-02T00:00:00Z",
            id: "round-2",
          },
        ],
      })
      .mockResolvedValueOnce({
        events: [
          {
            value: ["GUSER", 50],
            txHash: "TX1",
            ledgerClosedAt: "2025-01-01T00:00:00Z",
            id: "payment-1",
          },
        ],
      });

    const app = createApp();

    const response = await request(app)
      .get("/splits/project_1/history")
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          type: "round",
          round: 2,
          amount: "100",
          txHash: "TX2",
          ledgerCloseTime: "2025-01-02T00:00:00Z",
          id: "round-2",
        },
        {
          type: "payment",
          recipient: "GUSER",
          amount: "50",
          txHash: "TX1",
          ledgerCloseTime: "2025-01-01T00:00:00Z",
          id: "payment-1",
        },
      ],
      nextCursor: null,
    });

    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
//  ISSUE #174 — Lock & Update Owner-Gating Integration Tests
// ============================================================

describe("Issue #174: lock & update permissions and owner gating", () => {
  const VALID_OWNER = "GOWNER";
  const VALID_TOKEN = "GTOKEN";
  const VALID_COLLAB_A = "GCOLLABA";
  const VALID_COLLAB_B = "GCOLLABB";
  const VALID_COLLAB_C = "GCOLLABC";

  it("lock route passes owner through as sourceAccount in built XDR", async () => {
    getAccountMock.mockResolvedValue({ accountId: VALID_OWNER });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_LOCK",
      sequence: "1",
      fee: "100",
    });

    const app = createApp();
    const response = await request(app)
      .post("/splits/proj_a/lock")
      .send({ owner: VALID_OWNER })
      .expect(200);

    expect(response.body.metadata.sourceAccount).toBe(VALID_OWNER);
    expect(response.body.metadata.operation).toBe("lock_project");
    expect(getAccountMock).toHaveBeenCalledWith(VALID_OWNER);
  });

  it("lock route rejects missing owner with 400 validation_error", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/splits/proj_a/lock")
      .send({})
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("lock route rejects invalid projectId (non-alphanumeric) with 400", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/splits/bad-id!/lock")
      .send({ owner: VALID_OWNER })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("lock route surfaces 'owner account not found' as 400 when RPC lookup fails", async () => {
    getAccountMock.mockRejectedValue(new Error("not_found"));

    const app = createApp();
    const response = await request(app)
      .post("/splits/proj_a/lock")
      .send({ owner: VALID_OWNER })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(response.body.message).toMatch(/owner account not found/);
  }, 15000);

  it("update-collaborators route passes owner through as sourceAccount", async () => {
    getAccountMock.mockResolvedValue({ accountId: VALID_OWNER });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_UPDATE",
      sequence: "2",
      fee: "100",
    });

    const app = createApp();
    const response = await request(app)
      .put("/splits/proj_a/collaborators")
      .send({
        owner: VALID_OWNER,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 6000 },
          { address: VALID_COLLAB_B, alias: "B", basisPoints: 4000 },
        ],
      })
      .expect(200);

    expect(response.body.metadata.sourceAccount).toBe(VALID_OWNER);
    expect(response.body.metadata.operation).toBe("update_collaborators");
    expect(getAccountMock).toHaveBeenCalledWith(VALID_OWNER);
  });

  it("update-collaborators rejects missing owner with 400", async () => {
    const app = createApp();
    const response = await request(app)
      .put("/splits/proj_a/collaborators")
      .send({
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 5000 },
          { address: VALID_COLLAB_B, alias: "B", basisPoints: 5000 },
        ],
      })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("update-collaborators rejects basisPoints that don't sum to 10000", async () => {
    const app = createApp();
    const response = await request(app)
      .put("/splits/proj_a/collaborators")
      .send({
        owner: VALID_OWNER,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 6000 },
          { address: VALID_COLLAB_B, alias: "B", basisPoints: 3000 },
        ],
      })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("update-collaborators rejects duplicate collaborator addresses", async () => {
    const app = createApp();
    const response = await request(app)
      .put("/splits/proj_a/collaborators")
      .send({
        owner: VALID_OWNER,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 5000 },
          { address: VALID_COLLAB_A, alias: "A2", basisPoints: 5000 },
        ],
      })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("update-collaborators rejects fewer than 2 collaborators", async () => {
    const app = createApp();
    const response = await request(app)
      .put("/splits/proj_a/collaborators")
      .send({
        owner: VALID_OWNER,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 10000 },
        ],
      })
      .expect(400);

    expect(response.body.error).toBe("validation_error");
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("full lifecycle: same owner can create → update collaborators → lock", async () => {
    getAccountMock.mockResolvedValue({ accountId: VALID_OWNER });
    prepareTransactionMock
      .mockResolvedValueOnce({
        toXDR: () => "XDR_CREATE",
        sequence: "1",
        fee: "100",
      })
      .mockResolvedValueOnce({
        toXDR: () => "XDR_UPDATE",
        sequence: "2",
        fee: "100",
      })
      .mockResolvedValueOnce({
        toXDR: () => "XDR_LOCK",
        sequence: "3",
        fee: "100",
      });

    const app = createApp();

    // 1. Create
    const createRes = await request(app)
      .post("/splits")
      .send({
        owner: VALID_OWNER,
        projectId: "lifecycle_1",
        title: "Lifecycle Project",
        projectType: "music",
        token: VALID_TOKEN,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 5000 },
          { address: VALID_COLLAB_B, alias: "B", basisPoints: 5000 },
        ],
      })
      .expect(200);
    expect(createRes.body.metadata.operation).toBe("create_project");
    expect(createRes.body.metadata.sourceAccount).toBe(VALID_OWNER);

    // 2. Update collaborators (still pre-lock)
    const updateRes = await request(app)
      .put("/splits/lifecycle_1/collaborators")
      .send({
        owner: VALID_OWNER,
        collaborators: [
          { address: VALID_COLLAB_A, alias: "A", basisPoints: 3000 },
          { address: VALID_COLLAB_B, alias: "B", basisPoints: 3000 },
          { address: VALID_COLLAB_C, alias: "C", basisPoints: 4000 },
        ],
      })
      .expect(200);
    expect(updateRes.body.metadata.operation).toBe("update_collaborators");
    expect(updateRes.body.metadata.sourceAccount).toBe(VALID_OWNER);

    // 3. Lock
    const lockRes = await request(app)
      .post("/splits/lifecycle_1/lock")
      .send({ owner: VALID_OWNER })
      .expect(200);
    expect(lockRes.body.metadata.operation).toBe("lock_project");
    expect(lockRes.body.metadata.sourceAccount).toBe(VALID_OWNER);

    // All 3 ops called getAccount with the same owner address
    const ownerCalls = getAccountMock.mock.calls.filter(
      (call) => call[0] === VALID_OWNER,
    );
    expect(ownerCalls.length).toBe(3);
  });
});

// ============================================================
// Issue #152: Admin contract-state read routes
// ============================================================

describe("admin contract-state read routes", () => {
  it("GET /splits/admin/status returns admin address and pause status", async () => {
    simulateTransactionMock.mockResolvedValue({
      result: { retval: "GADMIN" },
    });
    getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });

    const app = createApp();
    const res = await request(app).get("/splits/admin/status").expect(200);

    expect(res.body).toHaveProperty("admin");
    expect(res.body).toHaveProperty("isPaused");
  });

  it("GET /splits/admin/is-token-allowed returns allowlist status for a valid token", async () => {
    simulateTransactionMock.mockResolvedValue({
      result: { retval: true },
    });
    getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });

    const app = createApp();
    const token = "CTOKEN00000000000000000000000000000000000000000000000001";
    const res = await request(app)
      .get(`/splits/admin/is-token-allowed?token=${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ token });
    expect(res.body).toHaveProperty("isAllowed");
  });

  it("GET /splits/admin/is-token-allowed returns 400 for a missing token param", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/splits/admin/is-token-allowed")
      .expect(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("GET /splits/admin/token-count returns allowed token count", async () => {
    simulateTransactionMock.mockResolvedValue({
      result: { retval: 3 },
    });
    getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });

    const app = createApp();
    const res = await request(app).get("/splits/admin/token-count").expect(200);

    expect(res.body).toHaveProperty("count");
  });
});

// ============================================================
// Issue #166: Unallocated token recovery routes
// ============================================================

describe("unallocated token recovery routes", () => {
  const VALID_ADMIN =
    "GADMIN00000000000000000000000000000000000000000000000001";
  const VALID_TOKEN =
    "CTOKEN00000000000000000000000000000000000000000000000001";
  const VALID_TO = "GRECOVER0000000000000000000000000000000000000000000000001";

  it("GET /splits/admin/unallocated returns recoverable balance for a valid token", async () => {
    simulateTransactionMock.mockResolvedValue({
      result: { retval: 500_000 },
    });
    getAccountMock.mockResolvedValue({ accountId: "GTESTSIMULATOR" });

    const app = createApp();
    const res = await request(app)
      .get(`/splits/admin/unallocated?token=${VALID_TOKEN}`)
      .expect(200);

    expect(res.body).toMatchObject({ token: VALID_TOKEN });
    expect(res.body).toHaveProperty("unallocated");
  });

  it("GET /splits/admin/unallocated returns 400 when token is missing", async () => {
    const app = createApp();
    const res = await request(app).get("/splits/admin/unallocated").expect(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("POST /splits/admin/withdraw-unallocated builds unsigned XDR with audit context", async () => {
    getAccountMock.mockResolvedValue({ accountId: VALID_ADMIN });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "XDR_WITHDRAW_UNALLOCATED",
      sequence: "999",
      fee: "100",
    });

    const app = createApp();
    const res = await request(app)
      .post("/splits/admin/withdraw-unallocated")
      .send({
        admin: VALID_ADMIN,
        token: VALID_TOKEN,
        to: VALID_TO,
        amount: 250_000,
      })
      .expect(200);

    expect(res.body.xdr).toBe("XDR_WITHDRAW_UNALLOCATED");
    expect(res.body.metadata.operation).toBe("withdraw_unallocated");
    expect(res.body.metadata.auditContext).toMatchObject({
      token: VALID_TOKEN,
      destination: VALID_TO,
      amount: 250_000,
    });
    expect(res.body.metadata.auditContext.initiatedAt).toBeDefined();
    expect(getAccountMock).toHaveBeenCalledWith(VALID_ADMIN);
  });

  it("POST /splits/admin/withdraw-unallocated returns 400 when amount is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/admin/withdraw-unallocated")
      .send({ admin: VALID_ADMIN, token: VALID_TOKEN, to: VALID_TO })
      .expect(400);

    expect(res.body.error).toBe("validation_error");
  });

  it("POST /splits/admin/withdraw-unallocated returns 400 when amount is zero or negative", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/admin/withdraw-unallocated")
      .send({
        admin: VALID_ADMIN,
        token: VALID_TOKEN,
        to: VALID_TO,
        amount: -1,
      })
      .expect(400);

    expect(res.body.error).toBe("validation_error");
  });
});

// ============================================================
// Issue #161: Read-result caching — cache-stats endpoint
// ============================================================

describe("cache stats endpoint", () => {
  it("GET /splits/admin/cache-stats returns cache size and ttl", async () => {
    const app = createApp();
    const res = await request(app).get("/splits/admin/cache-stats").expect(200);

    expect(res.body).toHaveProperty("size");
    expect(res.body).toHaveProperty("ttlMs");
    expect(res.body).toHaveProperty("keys");
    expect(Array.isArray(res.body.keys)).toBe(true);
  });
});

// ============================================================
// Wave 5: self-service claim endpoint
// ============================================================

describe("POST /splits/:projectId/claim", () => {
  const VALID_CLAIMER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeEach(() => {
    getAccountMock.mockResolvedValue({ id: VALID_CLAIMER, sequence: "100" });
    prepareTransactionMock.mockResolvedValue({
      toXDR: () => "MOCKED_CLAIM_XDR",
      sequence: "101",
      fee: "100",
    });
  });

  it("returns 200 with xdr when projectId and claimer are valid", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/test_project/claim")
      .send({ claimer: VALID_CLAIMER })
      .expect(200);

    expect(res.body).toHaveProperty("xdr");
  });

  it("returns 400 when claimer is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/test_project/claim")
      .send({})
      .expect(400);

    expect(res.body.error).toBe("validation_error");
  });

  it("returns 400 when claimer is not a valid Stellar address", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/test_project/claim")
      .send({ claimer: "not-a-stellar-address" })
      .expect(400);

    expect(res.body.error).toBe("validation_error");
  });

  it("returns 400 when projectId is invalid", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/splits/!!bad!!/claim")
      .send({ claimer: VALID_CLAIMER })
      .expect(400);

    expect(res.body.error).toBe("validation_error");
  });
});