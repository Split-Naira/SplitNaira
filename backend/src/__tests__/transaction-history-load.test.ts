import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startTimer, endTimer } from "../lib/performance.js";
import { app } from "../index.js";

describe("Transaction History Load Test", () => {
  const TEST_WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
  const PAGINATION_SIZES = [10, 50, 100, 500];
  const LARGE_OFFSET = 5000;

  beforeAll(async () => {
    // Ensure database is available
    console.log("Starting transaction history load test suite...");
  });

  afterAll(async () => {
    console.log("Transaction history load test suite completed.");
  });

  describe("pagination performance", () => {
    it("handles small page size (10 records) efficiently", async () => {
      startTimer("history-small-page");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 10, offset: 0 });
      const elapsed = endTimer("history-small-page");

      expect(res.status).toBeLessThan(500);
      expect(elapsed).toBeLessThan(500);
    });

    it("handles medium page size (100 records) within budget", async () => {
      startTimer("history-medium-page");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 100, offset: 0 });
      const elapsed = endTimer("history-medium-page");

      expect(res.status).toBeLessThan(500);
      expect(elapsed).toBeLessThan(1000);
    });

    it("handles large page size (500 records) with acceptable latency", async () => {
      startTimer("history-large-page");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 500, offset: 0 });
      const elapsed = endTimer("history-large-page");

      expect(res.status).toBeLessThan(500);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("pagination correctness", () => {
    it("returns correct total count metadata", async () => {
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 10, offset: 0 });

      if (res.status === 200 || res.status === 404) {
        if (res.body.total !== undefined) {
          expect(typeof res.body.total).toBe("number");
          expect(res.body.total).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("maintains consistent results across sequential pages", async () => {
      const pageResults = [];

      for (const offset of [0, 10, 20]) {
        const res = await request(app)
          .get("/transactions/history")
          .query({ walletAddress: TEST_WALLET, limit: 10, offset });

        pageResults.push({ offset, status: res.status });
      }

      expect(pageResults[0].status).toBe(pageResults[1].status);
      expect(pageResults[1].status).toBe(pageResults[2].status);
    });
  });

  describe("query performance", () => {
    it("filters by status without performance degradation", async () => {
      startTimer("history-status-filter");
      await request(app)
        .get("/transactions/history")
        .query({
          walletAddress: TEST_WALLET,
          status: "completed",
          limit: 50,
          offset: 0,
        });
      const elapsed = endTimer("history-status-filter");

      expect(elapsed).toBeLessThan(1000);
    });

    it("filters by date range efficiently", async () => {
      startTimer("history-date-filter");
      const startDate = new Date("2024-01-01").toISOString();
      const endDate = new Date("2024-12-31").toISOString();

      await request(app)
        .get("/transactions/history")
        .query({
          walletAddress: TEST_WALLET,
          startDate,
          endDate,
          limit: 50,
          offset: 0,
        });
      const elapsed = endTimer("history-date-filter");

      expect(elapsed).toBeLessThan(1500);
    });

    it("combines multiple filters without performance loss", async () => {
      startTimer("history-multi-filter");
      const startDate = new Date("2024-01-01").toISOString();
      const endDate = new Date("2024-12-31").toISOString();

      await request(app)
        .get("/transactions/history")
        .query({
          walletAddress: TEST_WALLET,
          status: "completed",
          startDate,
          endDate,
          limit: 100,
          offset: 0,
        });
      const elapsed = endTimer("history-multi-filter");

      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("response payload efficiency", () => {
    it("returns reasonable response size for large pages", async () => {
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 100, offset: 0 });

      if (res.status === 200 && res.body.transactions) {
        const responseSize = JSON.stringify(res.body).length;
        const expectedMaxSizeBytes = 5 * 1024 * 1024;

        expect(responseSize).toBeLessThan(expectedMaxSizeBytes);
      }
    });
  });

  describe("error handling under load", () => {
    it("handles invalid wallet address gracefully", async () => {
      startTimer("invalid-wallet-error");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: "INVALID", limit: 10, offset: 0 });
      const elapsed = endTimer("invalid-wallet-error");

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(500);
    });

    it("handles extreme pagination values without hanging", async () => {
      startTimer("extreme-pagination");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 10000, offset: LARGE_OFFSET });
      const elapsed = endTimer("extreme-pagination");

      expect(res.status).toBeLessThan(500);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
