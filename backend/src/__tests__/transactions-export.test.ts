import { describe, it, expect, vi } from "vitest";
import request from "supertest";

const OWN_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

const mockRecords = [
  {
    id: "tx-1",
    roundId: "round-1",
    recipient: OWN_ADDRESS,
    amount: "1000",
    token: "CAS3...",
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    txHash: "validhash123",
    status: "completed",
  },
];

const mockGetMany = vi.fn().mockResolvedValue(mockRecords);
const mockGetManyAndCount = vi.fn().mockResolvedValue([mockRecords, mockRecords.length]);
const mockGetCount = vi.fn().mockResolvedValue(mockRecords.length);

const mockQueryBuilder = {
  andWhere: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getCount: mockGetCount,
  getMany: mockGetMany,
  getManyAndCount: mockGetManyAndCount,
};

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      createQueryBuilder: () => mockQueryBuilder,
    }),
  }),
  initDatabase: async () => {},
  closeDatabase: async () => {},
}));

// Session revocation (#1446) is covered in session-revocation.test.ts; these
// tests only need tokens at the current (default) version.
vi.mock("../services/session-revocation.js", () => ({
  getSessionVersion: vi.fn(async () => 0),
  getMaxSessionVersionForEmail: vi.fn(async () => 0),
  revokeSessionsForEmail: vi.fn(async () => 1),
}));

import { app } from "../index.js";
import { signToken } from "../services/jwt.js";
import { encodeTransactionCursor } from "../lib/keyset-cursor.js";

describe("GET /transactions/export", () => {
  it("rejects a request with no bearer token", async () => {
    const response = await request(app).get("/transactions/export");
    expect(response.status).toBe(401);
  });

  it("ignores a client-supplied walletAddress and scopes to the token's own wallet", async () => {
    const token = signToken(OWN_ADDRESS);
    // transactionExportQuerySchema has no walletAddress field at all, so
    // this is also validated at the schema layer, not just the service call.
    const response = await request(app)
      .get(`/transactions/export?format=json&walletAddress=${OTHER_ADDRESS}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      "transaction.recipient = :recipient",
      { recipient: OWN_ADDRESS },
    );
  });

  it("returns a paginated JSON page with pagination metadata for format=json", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=json&limit=10&offset=0")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("transactions");
    expect(response.body).toHaveProperty("total", mockRecords.length);
    expect(response.body).toHaveProperty("limit", 10);
    expect(response.body).toHaveProperty("offset", 0);
    expect(response.body).toHaveProperty("hasMore", false);
    expect(response.body).toHaveProperty("nextCursor", null);
    // Verify financial precision is preserved
    expect(typeof response.body.transactions[0].amount).toBe("string");
    expect(response.body.transactions[0].amount).toBe("1000");
  });

  it("accepts a valid cursor for format=json pagination", async () => {
    const token = signToken(OWN_ADDRESS);
    const cursor = encodeTransactionCursor({
      timestamp: mockRecords[0].timestamp,
      id: "11111111-1111-4111-8111-111111111111",
    });
    const response = await request(app)
      .get(`/transactions/export?format=json&cursor=${encodeURIComponent(cursor)}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("transactions");
    expect(response.body).toHaveProperty("total");
    expect(response.body).toHaveProperty("hasMore");
  });

  it("rejects an invalid cursor with 400 VALIDATION_ERROR", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=json&cursor=invalid-cursor-token!")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.details).toEqual({ cursor: "invalid" });
  });

  it("rejects limit above 100 with 400", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=json&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("streams a CSV by default with a header row and a downloadable filename", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain(".csv");

    const lines = response.text.trim().split("\r\n");
    expect(lines[0]).toBe("id,roundId,recipient,amount,token,timestamp,txHash,status");
    expect(lines[1]).toContain("tx-1");
    expect(lines[1]).toContain(OWN_ADDRESS);
  });

  it("rejects an invalid format value", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=xml")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});
