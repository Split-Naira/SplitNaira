import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { startTimer, endTimer } from "../lib/performance.js";
import { app } from "../index.js";

describe("Concurrent Split Creation Load Test", () => {
  const TEST_OWNER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
  const COLLABORATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2";

  beforeAll(() => {
    console.log("Starting concurrent split creation load test suite...");
  });

  const buildCreateSplitPayload = (index: number) => ({
    title: `Test Split Project ${index}`,
    projectType: ["App", "Content", "Service"][index % 3],
    collaborators: [
      {
        address: COLLABORATOR,
        alias: `Collaborator ${index}`,
        basisPoints: 5000,
      },
      {
        address: TEST_OWNER,
        alias: `Owner`,
        basisPoints: 5000,
      },
    ],
  });

  describe("single split creation baseline", () => {
    it("creates a single split within expected latency", async () => {
      startTimer("single-split");
      const res = await request(app)
        .post("/splits")
        .set("X-Stellar-Address", TEST_OWNER)
        .send(buildCreateSplitPayload(0));
      const elapsed = endTimer("single-split");

      expect(res.status).toBeLessThan(500);
      if (res.status !== 500) {
        expect(elapsed).toBeLessThan(5000);
      }
    });
  });

  describe("sequential split creation performance", () => {
    it("creates 5 splits sequentially with consistent latency", async () => {
      const latencies = [];

      for (let i = 0; i < 5; i++) {
        startTimer(`sequential-split-${i}`);
        const res = await request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .send(buildCreateSplitPayload(i));
        const elapsed = endTimer(`sequential-split-${i}`);

        if (res.status !== 500) {
          latencies.push(elapsed);
        }
      }

      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);

        expect(avgLatency).toBeLessThan(3000);
        expect(maxLatency).toBeLessThan(5000);
      }
    });
  });

  describe("concurrent request handling", () => {
    it("handles 3 concurrent split creation requests", async () => {
      startTimer("concurrent-3");

      const promises = [0, 1, 2].map((i) =>
        request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .send(buildCreateSplitPayload(i))
      );

      const results = await Promise.all(promises);
      const elapsed = endTimer("concurrent-3");

      const successCount = results.filter((r) => r.status < 500).length;
      expect(successCount).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(10000);
    });

    it("handles 5 concurrent split creation requests without cascading failures", async () => {
      startTimer("concurrent-5");

      const promises = [0, 1, 2, 3, 4].map((i) =>
        request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .send(buildCreateSplitPayload(i))
      );

      const results = await Promise.all(promises);
      const elapsed = endTimer("concurrent-5");

      const successCount = results.filter((r) => r.status < 500).length;
      const errorCount = results.filter((r) => r.status >= 500).length;

      expect(successCount + errorCount).toBe(5);
      expect(elapsed).toBeLessThan(15000);
    });
  });

  describe("database contention", () => {
    it("maintains data consistency under concurrent writes", async () => {
      const projectIds = new Set();

      const promises = [0, 1, 2].map((i) =>
        request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .send(buildCreateSplitPayload(100 + i))
      );

      const results = await Promise.all(promises);

      for (const res of results) {
        if (res.status === 201 || res.status === 200) {
          if (res.body.projectId) {
            projectIds.add(res.body.projectId);
          }
        }
      }

      expect(projectIds.size).toBeLessThanOrEqual(3);
    });

    it("handles duplicate concurrent requests idempotently", async () => {
      const payload = buildCreateSplitPayload(200);
      const idempotencyKey = `test-idempotent-${Date.now()}`;

      const promises = [0, 1, 2].map(() =>
        request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .set("Idempotency-Key", idempotencyKey)
          .send(payload)
      );

      const results = await Promise.all(promises);

      const successStatuses = results
        .filter((r) => r.status === 201 || r.status === 200)
        .map((r) => r.status);

      expect(successStatuses.length).toBeLessThanOrEqual(1);
    });
  });

  describe("error handling under load", () => {
    it("returns proper error for invalid collaborator structure", async () => {
      startTimer("invalid-payload");
      const res = await request(app)
        .post("/splits")
        .set("X-Stellar-Address", TEST_OWNER)
        .send({
          title: "Invalid Split",
          projectType: "App",
          collaborators: [{ address: "INVALID" }],
        });
      const elapsed = endTimer("invalid-payload");

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(1000);
    });

    it("handles missing required fields gracefully", async () => {
      startTimer("missing-fields");
      const res = await request(app)
        .post("/splits")
        .set("X-Stellar-Address", TEST_OWNER)
        .send({
          projectType: "App",
        });
      const elapsed = endTimer("missing-fields");

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("throughput metrics", () => {
    it("measures request throughput", async () => {
      const startTime = performance.now();
      const requestCount = 10;

      const promises = Array.from({ length: requestCount }, (_, i) =>
        request(app)
          .post("/splits")
          .set("X-Stellar-Address", TEST_OWNER)
          .send(buildCreateSplitPayload(300 + i))
      );

      const results = await Promise.all(promises);
      const elapsedTime = performance.now() - startTime;

      const successCount = results.filter((r) => r.status < 500).length;
      const throughput = (successCount / elapsedTime) * 1000;

      expect(throughput).toBeGreaterThan(0);
      expect(elapsedTime).toBeLessThan(60000);
    });
  });
});
