import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { startTimer, endTimer } from "../lib/performance.js";
import { app } from "../index.js";

interface BenchmarkResult {
  endpoint: string;
  method: string;
  latencyMs: number;
  threshold: number;
  passed: boolean;
}

describe("API Response-Time Benchmarks", () => {
  const TEST_WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
  const results: BenchmarkResult[] = [];

  beforeAll(() => {
    console.log("Starting API response-time benchmark suite...");
  });

  const recordBenchmark = (
    endpoint: string,
    method: string,
    latencyMs: number,
    threshold: number,
  ) => {
    const passed = latencyMs <= threshold;
    results.push({
      endpoint,
      method,
      latencyMs,
      threshold,
      passed,
    });
  };

  describe("health and status endpoints", () => {
    it("GET /health returns within 100ms", async () => {
      startTimer("health");
      const res = await request(app).get("/health");
      const latency = endTimer("health");

      recordBenchmark("GET /health", "GET", latency, 100);
      expect(res.status).toBeLessThan(500);
      expect(latency).toBeLessThan(100);
    });
  });

  describe("read-heavy endpoints", () => {
    it("GET /projects lists projects within 1000ms", async () => {
      startTimer("list-projects");
      const res = await request(app)
        .get("/projects")
        .query({ limit: 50, offset: 0 });
      const latency = endTimer("list-projects");

      recordBenchmark("GET /projects", "GET", latency, 1000);
      expect(res.status).toBeLessThan(500);
      expect(latency).toBeLessThan(1000);
    });

    it("GET /transactions/history returns within 800ms", async () => {
      startTimer("transaction-history");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: TEST_WALLET, limit: 50, offset: 0 });
      const latency = endTimer("transaction-history");

      recordBenchmark("GET /transactions/history", "GET", latency, 800);
      expect(res.status).toBeLessThan(500);
      expect(latency).toBeLessThan(800);
    });

    it("GET /projects/:id retrieves single project within 500ms", async () => {
      startTimer("get-project");
      const res = await request(app).get("/projects/test-project");
      const latency = endTimer("get-project");

      recordBenchmark("GET /projects/:id", "GET", latency, 500);
      expect(res.status).toBeLessThan(500);
      expect(latency).toBeLessThan(500);
    });
  });

  describe("write operations", () => {
    it("POST /splits creates split within 5000ms", async () => {
      startTimer("create-split");
      const res = await request(app)
        .post("/splits")
        .set("X-Stellar-Address", TEST_WALLET)
        .send({
          title: "Benchmark Split",
          projectType: "App",
          collaborators: [
            {
              address: TEST_WALLET,
              alias: "Owner",
              basisPoints: 10000,
            },
          ],
        });
      const latency = endTimer("create-split");

      recordBenchmark("POST /splits", "POST", latency, 5000);
      expect(res.status).toBeLessThan(500);
      expect(latency).toBeLessThan(5000);
    });
  });

  describe("aggregation and analytical endpoints", () => {
    it("GET /admin/allowlist-status returns within 800ms", async () => {
      startTimer("allowlist-status");
      const res = await request(app)
        .get("/admin/allowlist-status")
        .set("X-Admin-Token", "test");
      const latency = endTimer("allowlist-status");

      recordBenchmark("GET /admin/allowlist-status", "GET", latency, 800);
      expect(latency).toBeLessThan(800);
    });

    it("GET /admin/cache-stats returns within 300ms", async () => {
      startTimer("cache-stats");
      const res = await request(app)
        .get("/admin/cache-stats")
        .set("X-Admin-Token", "test");
      const latency = endTimer("cache-stats");

      recordBenchmark("GET /admin/cache-stats", "GET", latency, 300);
      expect(latency).toBeLessThan(300);
    });
  });

  describe("error paths performance", () => {
    it("returns 404 for non-existent project within 300ms", async () => {
      startTimer("notfound-project");
      const res = await request(app).get("/projects/non-existent-project-id");
      const latency = endTimer("notfound-project");

      recordBenchmark("GET /projects/:id (404)", "GET", latency, 300);
      expect(res.status).toBe(404);
      expect(latency).toBeLessThan(300);
    });

    it("returns 400 for invalid query within 200ms", async () => {
      startTimer("invalid-query");
      const res = await request(app)
        .get("/transactions/history")
        .query({ walletAddress: "INVALID", limit: "abc" });
      const latency = endTimer("invalid-query");

      recordBenchmark("GET /transactions/history (400)", "GET", latency, 200);
      expect(res.status).toBe(400);
      expect(latency).toBeLessThan(200);
    });

    it("returns 401 for missing auth within 100ms", async () => {
      startTimer("missing-auth");
      const res = await request(app)
        .post("/admin/allow-token")
        .send({ token: "TEST" });
      const latency = endTimer("missing-auth");

      recordBenchmark("POST /admin/allow-token (401)", "POST", latency, 100);
      expect([401, 403]).toContain(res.status);
      expect(latency).toBeLessThan(100);
    });
  });

  describe("pagination performance", () => {
    it("handles limit parameter within 100ms overhead", async () => {
      startTimer("pagination-small");
      const res = await request(app)
        .get("/projects")
        .query({ limit: 10, offset: 0 });
      const latency = endTimer("pagination-small");

      recordBenchmark("GET /projects (limit=10)", "GET", latency, 1000);
      expect(latency).toBeLessThan(1000);
    });

    it("handles large offset within reasonable time", async () => {
      startTimer("pagination-large-offset");
      const res = await request(app)
        .get("/projects")
        .query({ limit: 10, offset: 5000 });
      const latency = endTimer("pagination-large-offset");

      recordBenchmark("GET /projects (offset=5000)", "GET", latency, 1500);
      expect(latency).toBeLessThan(1500);
    });
  });

  afterAll(() => {
    console.log("\n" + "=".repeat(80));
    console.log("API Response-Time Benchmark Report");
    console.log("=".repeat(80) + "\n");

    const headers = ["Endpoint", "Method", "Latency", "Threshold", "Status"];
    const columnWidths = [40, 6, 12, 12, 8];

    console.log(
      headers.map((h, i) => h.padEnd(columnWidths[i])).join(""),
    );
    console.log("-".repeat(80));

    for (const result of results) {
      const status = result.passed ? "✓ PASS" : "✗ FAIL";
      const row = [
        result.endpoint.padEnd(columnWidths[0]),
        result.method.padEnd(columnWidths[1]),
        `${result.latencyMs.toFixed(1)}ms`.padEnd(columnWidths[2]),
        `${result.threshold}ms`.padEnd(columnWidths[3]),
        status.padEnd(columnWidths[4]),
      ].join("");
      console.log(row);
    }

    console.log("\n" + "=".repeat(80));
    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    const passedPercent = ((passedCount / totalCount) * 100).toFixed(1);
    console.log(`Summary: ${passedCount}/${totalCount} benchmarks passed (${passedPercent}%)\n`);

    expect(passedCount).toBe(totalCount);
  });
});
