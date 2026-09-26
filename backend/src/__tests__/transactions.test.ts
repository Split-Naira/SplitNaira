import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

const mockTransactionRecords = [
  {
    id: "tx-1",
    roundId: "round-1",
    recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount: "1000",
    token: "CAS3...",
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    txHash: "validhash123",
    status: "completed"
  }
];

const mockGetMany = vi.fn().mockResolvedValue(mockTransactionRecords);
const mockFindOneBy = vi.fn().mockResolvedValue(null);
const mockFindBy = vi.fn().mockResolvedValue(mockTransactionRecords);
const mockFind = vi.fn().mockImplementation((options) => {
  const optionsStr = JSON.stringify(options || {});
  if (optionsStr.includes("nonexistent")) {
    return [];
  }
  return mockTransactionRecords;
});

const mockQueryBuilder = {
  andWhere: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getMany: mockGetMany
};

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      createQueryBuilder: () => mockQueryBuilder,
      findOneBy: mockFindOneBy,
      findBy: mockFindBy,
      find: mockFind
    })
  }),
  initDatabase: async () => {},
  closeDatabase: async () => {}
}));

import { app } from "../index.js";


describe("Transaction History API", () => {
  beforeAll(async () => {
    // Note: This test assumes PayoutHistoryService is properly initialized
    // In a real scenario, you'd want to seed test data
  });

  describe("GET /transactions/history", () => {
    it("should return transaction history with default pagination", async () => {
      const response = await request(app)
        .get("/transactions/history");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("transactions");
      expect(response.body).toHaveProperty("total");
      expect(response.body).toHaveProperty("limit");
      expect(response.body).toHaveProperty("offset");
      expect(Array.isArray(response.body.transactions)).toBe(true);
    });

    it("should filter by wallet address", async () => {
      const walletAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const response = await request(app)
        .get(`/transactions/history?walletAddress=${walletAddress}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions).toBeDefined();
    });

    it("should filter by status", async () => {
      const response = await request(app)
        .get("/transactions/history?status=completed");

      expect(response.status).toBe(200);
      expect(response.body.transactions).toBeDefined();
    });

    it("should apply pagination", async () => {
      const response = await request(app)
        .get("/transactions/history?limit=5&offset=0");

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(5);
      expect(response.body.offset).toBe(0);
    });

    it("should filter by date range", async () => {
      const startDate = Math.floor(Date.now() / 1000) - 86400; // 24 hours ago
      const endDate = Math.floor(Date.now() / 1000);
      
      const response = await request(app)
        .get(`/transactions/history?startDate=${startDate}&endDate=${endDate}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions).toBeDefined();
    });

    it("should reject invalid status value", async () => {
      const response = await request(app)
        .get("/transactions/history?status=invalid");

      expect(response.status).toBe(400);
    });

    it("should reject invalid limit value", async () => {
      const response = await request(app)
        .get("/transactions/history?limit=1000");

      expect(response.status).toBe(400);
    });

    it("should reject invalid wallet address format", async () => {
      const response = await request(app)
        .get("/transactions/history?walletAddress=INVALID");

      expect(response.status).toBe(400);
    });
  });

  describe("GET /transactions/:txHash", () => {
    it("should return 404 for non-existent transaction", async () => {
      const response = await request(app)
        .get("/transactions/nonexistenthash123");

      expect(response.status).toBe(404);
    });

    it("should reject empty transaction hash", async () => {
      const response = await request(app)
        .get("/transactions/");

      // Should hit the not found handler or return 404
      expect([404, 400]).toContain(response.status);
    });
  });

  describe("GET /transactions/receipt/:txHash", () => {
    const hash = "a".repeat(64);

    it("builds receipt fields from the saved payout and configured network", async () => {
      mockFindOneBy.mockResolvedValueOnce({
        ...mockTransactionRecords[0],
        txHash: hash,
        timestamp: 1_700_000_000,
      });

      const response = await request(app).get(`/transactions/receipt/${hash}`);

      expect(response.status).toBe(200);
      expect(mockFindOneBy).toHaveBeenCalledWith({ txHash: hash });
      expect(response.body).toEqual({
        reference: hash,
        amount: "1000",
        token: "CAS3...",
        date: "2023-11-14T22:13:20.000Z",
        network: process.env.SOROBAN_NETWORK_PASSPHRASE,
        status: "completed",
        recipient: mockTransactionRecords[0].recipient,
        projectId: "round-1",
      });
    });

    it("rejects malformed hashes without querying the database", async () => {
      const before = mockFindOneBy.mock.calls.length;
      const response = await request(app).get("/transactions/receipt/not-a-hash");
      expect(response.status).toBe(400);
      expect(mockFindOneBy.mock.calls.length).toBe(before);
    });

    it("returns 404 for an unknown payout", async () => {
      const response = await request(app).get(`/transactions/receipt/${hash}`);
      expect(response.status).toBe(404);
    });

    it("does not issue a receipt when the transaction store is unavailable", async () => {
      mockFindOneBy.mockRejectedValueOnce(new Error("database unavailable"));
      const response = await request(app).get(`/transactions/receipt/${hash}`);
      expect(response.status).toBe(500);
    });
  });

  describe("GET /transactions/recipient/:walletAddress", () => {
    it("should return transactions for valid wallet address", async () => {
      const walletAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const response = await request(app)
        .get(`/transactions/recipient/${walletAddress}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("transactions");
      expect(response.body).toHaveProperty("total");
      expect(response.body.walletAddress).toBe(walletAddress);
      expect(Array.isArray(response.body.transactions)).toBe(true);
    });

    it("should reject invalid wallet address format", async () => {
      const response = await request(app)
        .get("/transactions/recipient/INVALID");

      expect(response.status).toBe(400);
    });
  });
});
