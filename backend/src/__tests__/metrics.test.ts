import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { metricsRouter } from "../routes/metrics.js";
import { metricsMiddleware } from "../middleware/metrics.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { resetValidationFailureCount } from "../middleware/validateResponse.js";
import { resetRequestMetrics } from "../services/metrics.js";

describe("GET /metrics", () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(metricsMiddleware);
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/metrics", metricsRouter);

  beforeEach(() => {
    resetValidationFailureCount();
    resetRequestMetrics();
  });

  it("returns Prometheus text exposition with analytics metrics", async () => {
    await request(app).get("/ping");
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("splitnaira_validation_failures_total 0");
    expect(res.text).toContain("splitnaira_process_uptime_seconds");
    expect(res.text).toContain("splitnaira_http_requests_inflight");
    expect(res.text).toContain('splitnaira_http_requests_total{method="GET",route="/ping",status="200"} 1');
    expect(res.text).toContain('splitnaira_http_request_duration_seconds_count{method="GET",route="/ping"} 1');
    expect(res.text).toContain("# TYPE splitnaira_event_listener_ledger_lag gauge");
    expect(res.text).toContain("# TYPE splitnaira_event_listener_last_processed_ledger gauge");

    // Issue #1165: idempotency conflict/replay counters
    expect(res.text).toContain("splitnaira_idempotency_conflicts_total 0");
    expect(res.text).toContain("splitnaira_idempotency_replays_total 0");
  });
});
