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

const mockQueryBuilder = {
  andWhere: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
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

import { app } from "../index.js";
import { signToken } from "../services/jwt.js";

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

  it("returns a paginated JSON page for format=json", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=json&limit=10&offset=0")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("transactions");
    expect(response.body).toHaveProperty("total", mockRecords.length);
    expect(response.body).toHaveProperty("limit", 10);
    expect(response.body).toHaveProperty("offset", 0);
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
