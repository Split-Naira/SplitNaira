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
  getSseDisconnectsTotal,
  getRpcRetryAttemptsTotal,
  getRpcRetryDurationMsTotal,
  getRpcRetryMaxAttemptsReachedTotal,
  getRpcRetrySnapshots,
  getRpcRetryBudgetSnapshots,
  getIdempotencyConflictsTotal,
  getIdempotencyReplaysTotal,
  getRequestPayloadRejectedSnapshots,
  getRequestPayloadSizeSnapshots,
  PAYLOAD_SIZE_BUCKETS_BYTES,
} from "../services/metrics.js";
import { getLedgerLag } from "../services/EventListenerService.js";
import { RPC_RETRY_BUDGET_MAX_RETRIES } from "../services/rpc-retry-budget.js";

/**
 * Streaming / Raw Output Routes Note (Issue #524/Admin API response validation):
 *
 * The `/metrics` endpoint exports lines formatted according to the Prometheus text-based
 * exposition format (`text/plain; version=0.0.4`) rather than JSON. This endpoint is
 * intentionally exempt from `withResponseValidation` JSON middleware.
 */
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

  // Issue #1090: request payload size telemetry by route group.
  lines.push("# HELP splitnaira_http_request_payload_bytes Declared request body size (Content-Length) in bytes, by route group.");
  lines.push("# TYPE splitnaira_http_request_payload_bytes histogram");
  for (const { routeGroup, buckets, sumBytes, count } of getRequestPayloadSizeSnapshots()) {
    const group = quoteLabelValue(routeGroup);
    PAYLOAD_SIZE_BUCKETS_BYTES.forEach((upperBound, index) => {
      lines.push(`splitnaira_http_request_payload_bytes_bucket{route_group=${group},le="${upperBound}"} ${buckets[index]}`);
    });
    lines.push(`splitnaira_http_request_payload_bytes_bucket{route_group=${group},le="+Inf"} ${count}`);
    lines.push(`splitnaira_http_request_payload_bytes_sum{route_group=${group}} ${sumBytes}`);
    lines.push(`splitnaira_http_request_payload_bytes_count{route_group=${group}} ${count}`);
  }

  lines.push("# HELP splitnaira_http_request_payload_rejected_total Requests rejected with 413 because the body exceeded the size limit, by route group.");
  lines.push("# TYPE splitnaira_http_request_payload_rejected_total counter");
  for (const { routeGroup, count } of getRequestPayloadRejectedSnapshots()) {
    lines.push(`splitnaira_http_request_payload_rejected_total{route_group=${quoteLabelValue(routeGroup)}} ${count}`);
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

lines.push("# HELP sse_disconnects_total Cumulative SSE client disconnects (#1166).");
lines.push("# TYPE sse_disconnects_total counter");
lines.push(`sse_disconnects_total ${getSseDisconnectsTotal()}`);

  // Issue #836: RPC retry observability series.
  lines.push("# HELP splitnaira_rpc_retry_attempts_total Total RPC retry attempts, including first try, labelled by operation and endpoint.");
  lines.push("# TYPE splitnaira_rpc_retry_attempts_total counter");
  lines.push(`splitnaira_rpc_retry_attempts_total ${getRpcRetryAttemptsTotal()}`);

  lines.push("# HELP splitnaira_rpc_retry_max_attempts_reached_total Total times the RPC retry budget was fully consumed without success.");
  lines.push("# TYPE splitnaira_rpc_retry_max_attempts_reached_total counter");
  lines.push(`splitnaira_rpc_retry_max_attempts_reached_total ${getRpcRetryMaxAttemptsReachedTotal()}`);

  lines.push("# HELP splitnaira_rpc_retry_duration_ms_total Cumulative delay, in milliseconds, spent sleeping between RPC retry attempts.");
  lines.push("# TYPE splitnaira_rpc_retry_duration_ms_total counter");
  lines.push(`splitnaira_rpc_retry_duration_ms_total ${getRpcRetryDurationMsTotal()}`);

  lines.push("# HELP splitnaira_rpc_retry_outcomes_total Final outcome of RPC retry sequences by operation, endpoint, and outcome label.");
  lines.push("# TYPE splitnaira_rpc_retry_outcomes_total counter");
  for (const { operation, outcome, endpoint, count } of getRpcRetrySnapshots()) {
    if (outcome === "attempt") continue; // exposed via the aggregate counter above
    lines.push(
      `splitnaira_rpc_retry_outcomes_total{operation=${quoteLabelValue(operation)},outcome=${quoteLabelValue(outcome)},endpoint=${quoteLabelValue(endpoint)}} ${count}`,
    );
  }

  // Issue #1089: bounded retry budget series.
  lines.push("# HELP splitnaira_rpc_retry_budget_max_retries Hard ceiling on retries per RPC call; larger caller requests are clamped to this.");
  lines.push("# TYPE splitnaira_rpc_retry_budget_max_retries gauge");
  lines.push(`splitnaira_rpc_retry_budget_max_retries ${RPC_RETRY_BUDGET_MAX_RETRIES}`);

  const budgetSnapshots = getRpcRetryBudgetSnapshots();
  const budgetSeries: Array<[name: string, help: string, pick: (s: (typeof budgetSnapshots)[number]) => number]> = [
    ["splitnaira_rpc_retry_budget_sequences_total", "RPC retry sequences (executeWithRetry calls) completed, by operation and endpoint.", (s) => s.sequences],
    ["splitnaira_rpc_retry_budget_allowed_total", "Sum of retry budgets granted to completed RPC retry sequences.", (s) => s.retriesAllowed],
    ["splitnaira_rpc_retry_budget_used_total", "Sum of retries actually consumed by completed RPC retry sequences.", (s) => s.retriesUsed],
    ["splitnaira_rpc_retry_budget_exhausted_total", "RPC retry sequences that spent their whole budget without success (error or timeout).", (s) => s.exhausted],
  ];
  for (const [name, help, pick] of budgetSeries) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const snapshot of budgetSnapshots) {
      lines.push(
        `${name}{operation=${quoteLabelValue(snapshot.operation)},endpoint=${quoteLabelValue(snapshot.endpoint)}} ${pick(snapshot)}`,
      );
    }
  }

  // Issue #1165: idempotency conflict/replay counters.
  lines.push("# HELP splitnaira_idempotency_conflicts_total Total idempotency 409 conflicts (payload mismatch or in-progress).");
  lines.push("# TYPE splitnaira_idempotency_conflicts_total counter");
  lines.push(`splitnaira_idempotency_conflicts_total ${getIdempotencyConflictsTotal()}`);

  lines.push("# HELP splitnaira_idempotency_replays_total Total idempotency replays (cached response returned).");
  lines.push("# TYPE splitnaira_idempotency_replays_total counter");
  lines.push(`splitnaira_idempotency_replays_total ${getIdempotencyReplaysTotal()}`);

  const eventListenerLag = getLedgerLag();
  lines.push(
    "# HELP splitnaira_event_listener_ledger_lag Number of ledgers between the latest observed ledger and the last ledger processed by the background event listener.",
  );
  lines.push("# TYPE splitnaira_event_listener_ledger_lag gauge");
  if (eventListenerLag.lag !== null) {
    lines.push(`splitnaira_event_listener_ledger_lag ${eventListenerLag.lag}`);
  }
  lines.push(
    "# HELP splitnaira_event_listener_last_processed_ledger Last Soroban ledger processed by the background event listener.",
  );
  lines.push("# TYPE splitnaira_event_listener_last_processed_ledger gauge");
  if (eventListenerLag.lastProcessedLedger !== null) {
    lines.push(`splitnaira_event_listener_last_processed_ledger ${eventListenerLag.lastProcessedLedger}`);
  }
  lines.push(
    "# HELP splitnaira_event_listener_latest_observed_ledger Latest Soroban ledger observed by the background event listener.",
  );
  lines.push("# TYPE splitnaira_event_listener_latest_observed_ledger gauge");
  if (eventListenerLag.latestLedger !== null) {
    lines.push(`splitnaira_event_listener_latest_observed_ledger ${eventListenerLag.latestLedger}`);
  }

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
