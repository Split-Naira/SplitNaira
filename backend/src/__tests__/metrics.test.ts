import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { metricsRouter } from "../routes/metrics.js";
import { metricsMiddleware, payloadSizeMetricsMiddleware, resolveRouteGroup } from "../middleware/metrics.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler } from "../middleware/error.js";
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

describe("request payload size telemetry by route group (Issue #1090)", () => {
  const app = express();
  // Same order as index.ts: payload telemetry runs before the body parser so
  // oversized (413) requests are still counted. A 1kb limit keeps tests fast.
  app.use(payloadSizeMetricsMiddleware);
  app.use(express.json({ limit: "1kb" }));
  app.use(requestIdMiddleware);
  app.post("/splits", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/splits/admin/allow-token", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/wp-login.php", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/splits", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/metrics", metricsRouter);
  app.use(errorHandler);

  beforeEach(() => {
    resetRequestMetrics();
  });

  function metricLine(text: string, prefix: string): string | undefined {
    return text.split("\n").find((line) => line.startsWith(prefix));
  }

  it("maps paths to a bounded set of route groups", () => {
    expect(resolveRouteGroup("/")).toBe("root");
    expect(resolveRouteGroup("/splits")).toBe("splits");
    expect(resolveRouteGroup("/splits/proj_1/lock")).toBe("splits");
    expect(resolveRouteGroup("/splits/admin/allow-token")).toBe("splits_admin");
    expect(resolveRouteGroup("/splitsadmin")).toBe("other");
    expect(resolveRouteGroup("/api/ledger/123")).toBe("ledger");
    expect(resolveRouteGroup("/api/openapi.json")).toBe("docs");
    expect(resolveRouteGroup("/users/login")).toBe("users");
    expect(resolveRouteGroup("/.env")).toBe("other");
  });

  it("records a cumulative size histogram per route group", async () => {
    const small = { note: "x".repeat(100) }; // ~113 bytes
    const medium = { note: "x".repeat(500) }; // ~513 bytes
    await request(app).post("/splits").send(small).expect(200);
    await request(app).post("/splits").send(medium).expect(200);
    await request(app).post("/splits/admin/allow-token").send(small).expect(200);

    const res = await request(app).get("/metrics");
    const smallBytes = Buffer.byteLength(JSON.stringify(small));
    const mediumBytes = Buffer.byteLength(JSON.stringify(medium));

    expect(res.text).toContain("# TYPE splitnaira_http_request_payload_bytes histogram");
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_bucket{route_group="splits",le="256"} 1');
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_bucket{route_group="splits",le="1024"} 2');
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_bucket{route_group="splits",le="+Inf"} 2');
    expect(res.text).toContain(
      `splitnaira_http_request_payload_bytes_sum{route_group="splits"} ${smallBytes + mediumBytes}`,
    );
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_count{route_group="splits"} 2');
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_count{route_group="splits_admin"} 1');
  });

  it("counts oversized bodies rejected by express.json as 413 by route group", async () => {
    await request(app)
      .post("/splits")
      .send({ note: "x".repeat(2048) })
      .expect(413);

    const res = await request(app).get("/metrics");
    expect(res.text).toContain("# TYPE splitnaira_http_request_payload_rejected_total counter");
    expect(res.text).toContain('splitnaira_http_request_payload_rejected_total{route_group="splits"} 1');
    // The rejected request's declared size still lands in the top bucket.
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_bucket{route_group="splits",le="1024"} 0');
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_count{route_group="splits"} 1');
  });

  it("collapses unknown paths into the `other` group and skips bodiless requests", async () => {
    await request(app).post("/wp-login.php").send({ user: "admin" }).expect(200);
    await request(app).get("/splits").expect(200);

    const res = await request(app).get("/metrics");
    expect(res.text).toContain('splitnaira_http_request_payload_bytes_count{route_group="other"} 1');
    expect(res.text).not.toContain('route_group="/wp-login.php"');
    // The GET without a body (and the /metrics scrape itself) record nothing.
    expect(metricLine(res.text, 'splitnaira_http_request_payload_bytes_count{route_group="splits"}')).toBeUndefined();
    expect(metricLine(res.text, 'splitnaira_http_request_payload_bytes_count{route_group="metrics"}')).toBeUndefined();
  });
});
