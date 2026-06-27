import { Router } from "express";
import { getValidationFailureCount } from "../middleware/validateResponse.js";
import {
  getInflightRequestCount,
  getRequestCountSnapshots,
  getRequestDurationSnapshots,
  getProjectsCreatedTotal,
  getDistributionsExecutedTotal,
  getDepositsReceivedTotal,
  getSseConnectionsActive,
} from "../services/metrics.js";

export const metricsRouter = Router();

const SERVICE_VERSION = process.env.npm_package_version ?? "unknown";

function quoteLabelValue(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatPrometheusMetrics(): string {
  const mem = process.memoryUsage();
  const validationFailures = getValidationFailureCount();
  const requestCounts = getRequestCountSnapshots();
  const requestDurations = getRequestDurationSnapshots();

  const lines = [
    "# HELP splitnaira_validation_failures_total Total response schema validation failures.",
    "# TYPE splitnaira_validation_failures_total counter",
    `splitnaira_validation_failures_total ${validationFailures}`,
    "# HELP splitnaira_process_uptime_seconds Process uptime in seconds.",
    "# TYPE splitnaira_process_uptime_seconds gauge",
    `splitnaira_process_uptime_seconds ${process.uptime().toFixed(3)}`,
    "# HELP splitnaira_process_heap_bytes Resident heap size in bytes.",
    "# TYPE splitnaira_process_heap_bytes gauge",
    `splitnaira_process_heap_bytes ${mem.heapUsed}`,
    "# HELP splitnaira_info Service version info.",
    "# TYPE splitnaira_info gauge",
    `splitnaira_info{version=${quoteLabelValue(SERVICE_VERSION)}} 1`,
    "# HELP splitnaira_http_requests_total Total HTTP requests received.",
    "# TYPE splitnaira_http_requests_total counter",
  ];

  for (const { method, route, status, count } of requestCounts) {
    lines.push(
      `splitnaira_http_requests_total{method=${quoteLabelValue(method)},route=${quoteLabelValue(route)},status="${status}"} ${count}`,
    );
  }

  lines.push("# HELP splitnaira_http_request_duration_seconds_sum Total time spent handling HTTP requests.");
  lines.push("# TYPE splitnaira_http_request_duration_seconds_sum gauge");
  lines.push("# HELP splitnaira_http_request_duration_seconds_count HTTP request duration sample count.");
  lines.push("# TYPE splitnaira_http_request_duration_seconds_count gauge");

  for (const { method, route, sumSeconds, count } of requestDurations) {
    lines.push(
      `splitnaira_http_request_duration_seconds_sum{method=${quoteLabelValue(method)},route=${quoteLabelValue(route)}} ${sumSeconds.toFixed(6)}`,
    );
    lines.push(
      `splitnaira_http_request_duration_seconds_count{method=${quoteLabelValue(method)},route=${quoteLabelValue(route)}} ${count}`,
    );
  }

  lines.push("# HELP splitnaira_http_requests_inflight Number of in-flight HTTP requests.");
  lines.push("# TYPE splitnaira_http_requests_inflight gauge");
  lines.push(`splitnaira_http_requests_inflight ${getInflightRequestCount()}`);
  lines.push("# HELP projects_created_total Total projects created.");
lines.push("# TYPE projects_created_total counter");
lines.push(`projects_created_total ${getProjectsCreatedTotal()}`);

lines.push("# HELP distributions_executed_total Total distributions executed.");
lines.push("# TYPE distributions_executed_total counter");
lines.push(`distributions_executed_total ${getDistributionsExecutedTotal()}`);

lines.push("# HELP deposits_received_total Total deposits received.");
lines.push("# TYPE deposits_received_total counter");
lines.push(`deposits_received_total ${getDepositsReceivedTotal()}`);

lines.push("# HELP sse_connections_active Active SSE connections.");
lines.push("# TYPE sse_connections_active gauge");
lines.push(`sse_connections_active ${getSseConnectionsActive()}`);

  return lines.join("\n");
}

/**
 * Prometheus-compatible metrics endpoint.
 * Disabled unless METRICS_ENABLED=true (or unset in production with explicit opt-in).
 */
metricsRouter.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(`${formatPrometheusMetrics()}\n`);
});

export function isMetricsEnabled(): boolean {
  const flag = process.env.METRICS_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}
