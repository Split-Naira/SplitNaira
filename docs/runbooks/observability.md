# Observability Runbook

Operational guidance for metrics, health probes, correlation IDs, and deploy verification.

## Health Endpoints

| Endpoint | Purpose | Expected |
|----------|---------|----------|
| `GET /health` | Readiness alias | `200` (`ready`/`degraded`), `503` (`not_ready`) — see below |
| `GET /health/live` | Liveness (process up) | `200`, `{ status: "ok" }` |
| `GET /health/startup` | Initialisation complete | `200` after DB/listeners start; `503` during boot |
| `GET /health/ready` | Ready for traffic | `200` (`ready`/`degraded`), `503` (`not_ready`) — see below |

Configure Render/orchestrator probes:

- **Liveness:** `/health/live`
- **Readiness:** `/health/ready`
- **Startup (optional):** `/health/startup`

### Degraded-mode readiness contract (Issue #935)

`/health` and `/health/ready` report a three-way `status` instead of a binary
ready/not-ready, so orchestrators and the frontend can distinguish "fully
healthy", "impaired but serving traffic", and "actually down":

| `status` | HTTP code | Meaning | On-call action |
|----------|-----------|---------|-----------------|
| `ready` | `200` | Every dependency (`db`, `rpc`, `contract`, `eventListener`) is `up`/`healthy`. | None. |
| `degraded` | `200` | The service is still usable — nothing is fully down — but at least one dependency is slow (past its latency threshold) or in a non-fatal failure state (e.g. the event listener backing off after RPC errors). | Investigate at normal priority; **do not page as an outage**. Traffic keeps flowing. |
| `not_ready` | `503` | `env` config is invalid, or `db`/`rpc`/`contract` is fully unreachable/erroring. Unchanged from the legacy binary contract. | Page / treat as an outage, same as before. |

Each of `components.db`, `components.rpc`, and `components.contract` in the
response body now has the shape:

```json
{ "status": "up" | "degraded" | "down", "latencyMs": 123, "message": "query_ok" }
```

- **`up`**: responded successfully within its latency threshold.
- **`degraded`**: responded successfully, but slower than its threshold.
- **`down`**: errored or timed out outright (this is what drives `not_ready`/`503` — a dependency degrading to `"degraded"` never does).

`components.env` stays a simple `{ ok: boolean }` — there's no natural
"degraded" config state. `components.eventListener` keeps its existing
`stopped`/`healthy`/`degraded` shape from `EventListenerService.getServiceHealth()`;
an `eventListener.status === "degraded"` now also pulls the *overall*
`status` down to `"degraded"` (previously it was reported informationally
without affecting the top-level status).

**Latency thresholds** (configurable, see `backend/.env.example`):

| Env var | Default | Applies to |
|---------|---------|------------|
| `HEALTH_DB_DEGRADED_LATENCY_MS` | `500` | The `SELECT 1` readiness query |
| `HEALTH_RPC_DEGRADED_LATENCY_MS` | `1500` | Both the Soroban RPC `getAccount` reachability call and the contract-simulation call |

Defaults were picked to be well above typical same-region latency (a local
Postgres `SELECT 1` is normally single-digit ms; a Soroban RPC round-trip is
normally 100-500ms) while still catching genuine slowdowns before they turn
into timeouts/retries and user-visible errors.

**Secrets hygiene**: dependency `message` fields are redacted before being
serialized — literal `DATABASE_URL`/`SOROBAN_RPC_URL`/`HORIZON_URL`/
`PAYMENTS_ADMIN_API_KEY` values and any `scheme://user:pass@host`-shaped
credential segment are stripped to `[REDACTED]` if a driver or RPC error
happens to echo them back. See `redactSecrets()` in `backend/src/routes/health.ts`
and the redaction test in `backend/src/routes/health.test.ts`.

## Metrics

`GET /metrics` — Prometheus text exposition (enabled when `METRICS_ENABLED=true`, default on in production).

For the complete inventory of every metric, owner, alert threshold, and missing metrics, see [Metrics Inventory](../metrics-inventory.md).

Exposed series:

- `splitnaira_validation_failures_total` — response schema validation failures
- `splitnaira_http_requests_total{method,route,status}` — total HTTP requests by route and status
- `splitnaira_http_request_duration_seconds_sum{method,route}` — cumulative request latency in seconds
- `splitnaira_http_request_duration_seconds_count{method,route}` — number of latency samples per route
- `splitnaira_http_requests_inflight` — current in-flight HTTP requests
- `splitnaira_process_uptime_seconds`
- `splitnaira_process_heap_bytes`
- `splitnaira_info{version="..."}`
- `projects_created_total` — total projects created
- `distributions_executed_total` — total distributions executed
- `deposits_received_total` — total deposits received
- `sse_connections_active` — active SSE connections (#1166 — now actually wired to connect/disconnect events; previously defined but never incremented)
- `sse_disconnects_total` — cumulative SSE client disconnects (#1166); a rate spike indicates client churn even when the active gauge looks flat
- `splitnaira_rpc_retry_attempts_total` — total RPC retry attempts (Issue #836)
- `splitnaira_rpc_retry_max_attempts_reached_total` — times the retry budget was fully consumed without success (Issue #836)
- `splitnaira_rpc_retry_duration_ms_total` — cumulative sleeper delay between RPC retry attempts in milliseconds (Issue #836)
- `splitnaira_rpc_retry_outcomes_total{operation,outcome,endpoint}` — final outcome of RPC retry sequences labelled by operation and endpoint (Issue #836)
- `splitnaira_event_listener_ledger_lag` — ledgers between the newest ledger observed by the event listener and its last processed ledger
- `splitnaira_event_listener_last_processed_ledger` — last ledger the listener processed
- `splitnaira_event_listener_latest_observed_ledger` — latest ledger reported by the listener's Soroban RPC poll

### Background listener ledger lag

**Owner:** Backend on-call owns the listener and metric; Platform on-call owns
the Prometheus scrape and alert route. The listener persists both its opaque
Soroban event cursor and its last processed ledger in `service_state`, so the
lag signal survives a process restart.

`splitnaira_event_listener_ledger_lag` is emitted only after the listener has
observed a latest ledger and processed an event ledger. Its absence during an
idle cursor-only startup is expected; use `/ops/status` to inspect the
`eventListener.ledgerLag` fields while it warms up. A value of zero is healthy.

Recommended alerts:

| Severity | Expression | First response |
|----------|------------|----------------|
| Warning | `splitnaira_event_listener_ledger_lag > 20 for 5m` | Check `/ops/status`, RPC retry metrics, and listener logs. |
| Critical | `splitnaira_event_listener_ledger_lag > 100 for 10m` | Page Backend on-call; check DB health and consider the stuck-payouts runbook. |

The listener's 10,000-ledger catch-up cap remains a safety guard, not an SLO:
if it is hit, investigate the outage window because older events may need a
targeted backfill.

Contract-level telemetry is also available through on-chain event topics emitted by the SplitNaira contract. Analytics consumers should combine backend metrics with contract event streams for richer Insights.

Scrape from internal network only; do not expose publicly without auth.

### Response validation failure-rate alert (Issue #1163)

**Owner:** Backend Engineering owns the response-validation middleware and
triage. Platform Engineering owns the Prometheus scrape, alert rule, and
notification route.

`splitnaira_validation_failures_total` counts response schema mismatches from
`withResponseValidation`, not client 4xx request-validation rejections. In
strict mode, these mismatches become 500 responses; in non-strict mode they
are logged and the original response is sent. A rise usually indicates API
schema drift or a faulty handler deployment.

Configure the following alerts against the backend's internal `/metrics`
scrape. The minimum count prevents a tiny amount of low-volume traffic from
creating a misleading percentage alert.

```yaml
groups:
  - name: splitnaira-response-validation
    rules:
      - alert: SplitNairaElevatedResponseValidationFailureRate
        expr: |
          (
            sum(increase(splitnaira_validation_failures_total[5m]))
            /
            clamp_min(sum(increase(splitnaira_http_requests_total[5m])), 1)
          ) >= 0.01
          and sum(increase(splitnaira_validation_failures_total[5m])) >= 5
        for: 5m
        labels:
          severity: warning
          owner: backend
        annotations:
          summary: Response validation failures exceed 1% of requests.
      - alert: SplitNairaCriticalResponseValidationFailureRate
        expr: |
          (
            sum(increase(splitnaira_validation_failures_total[5m]))
            /
            clamp_min(sum(increase(splitnaira_http_requests_total[5m])), 1)
          ) >= 0.05
          and sum(increase(splitnaira_validation_failures_total[5m])) >= 10
        for: 5m
        labels:
          severity: critical
          owner: backend
        annotations:
          summary: Response validation failures exceed 5% of requests.
```

For a warning, inspect the deployment diff, structured logs (using the
request ID), and the affected route before rolling back. For a critical alert,
page Backend on-call, consider pausing the rollout, and roll back the backend
if the mismatch was introduced by the current deployment. Platform should
confirm that the `/metrics` scrape itself remains healthy before treating an
absence of this signal as recovery.

## Correlation IDs

Every request receives `x-request-id` and `x-correlation-id` (same value). Clients may send either header; the value is echoed in responses and included in error payloads as `requestId`.

Structured logs (Winston JSON when `LOG_FORMAT=json`) include `requestId` on error paths.

### Request ID log-query cookbook

Use the request ID from the `x-request-id` response header or error body as the
primary investigation key. It is safe to share with support; do not put bearer
tokens, API keys, or raw request bodies into queries or tickets.

| Log system | Query | Use |
|------------|-------|-----|
| Render log search | `requestId:"<REQUEST_ID>"` | Find structured application and request logs for one request. |
| Grafana Loki | `{service="splitnaira-backend"} | json | requestId="<REQUEST_ID>"` | Restrict to the backend stream, then parse JSON fields. |
| Elastic / Kibana KQL | `service.name : "splitnaira-backend" and requestId : "<REQUEST_ID>"` | Correlate API, retry, and error records. |
| CloudWatch Logs Insights | `fields @timestamp, level, message, requestId | filter requestId = "<REQUEST_ID>" | sort @timestamp asc` | Produce a chronological incident timeline. |

If the first query finds only an HTTP access line, expand the time range by two
minutes and search both `requestId` and the returned `x-correlation-id` (they
are aliases). For a failed write, next search its `txHash` or `projectId` from
the structured record; never search or paste its authorization header.

## Post-Deploy Smoke Check

After Render deploy, CI runs `scripts/deploy-smoke-check.mjs` when repo variable `BACKEND_SMOKE_URL` is set:

```bash
BACKEND_URL=https://your-api.example.com node scripts/deploy-smoke-check.mjs
```

Polls `/health/ready` every 10s for up to 5 minutes.

When `BACKEND_METRICS_URL` is also configured, the smoke check validates the analytics/metrics exposition endpoint after readiness succeeds. This ensures the deployment is not only live, but also emitting the telemetry needed for Analytics & Insights.

## Incident Investigation

1. Obtain `x-correlation-id` / `requestId` from the client or error response.
2. Search Render logs or Sentry (when `SENTRY_DSN` is configured).
3. Check `/health/ready` component breakdown for dependency failures — note
   whether the overall `status` is `degraded` (investigate, don't page) or
   `not_ready` (treat as an outage); see "Degraded-mode readiness contract"
   above.
4. Review metrics around the failure window (`splitnaira_validation_failures_total` spikes indicate schema drift).
5. For missing payout updates, compare `splitnaira_event_listener_ledger_lag`
   with `/ops/status` before initiating a manual backfill.

## Rollback

| Change | Rollback |
|--------|----------|
| Metrics endpoint | Set `METRICS_ENABLED=false` and redeploy |
| Smoke check failures | Roll back Render deploy; smoke check does not auto-rollback |
| Correlation header change | Revert middleware commit; clients using either header remain compatible |

## RPC Retry Observability (Issue #836)

Every call into `executeWithRetry` carries two labels: `operation` (e.g.
`simulateTransaction`, `getEvents`) and `endpoint` (e.g. `rpc`). The helper
emits the following structured logs (`LOG_FORMAT=json` recommended for
ingestion):

| Log | Level | When |
|-----|-------|------|
| `RPC retry scheduled` | warn | Each retryable failure before the next attempt |
| `RPC operation rejected before retrying` | warn | `RequestValidationError` short-circuits the helper |
| `RPC retries exhausted` | error | Final attempt failed after the full retry budget |

Log fields (stable schema):

| Field | Type | Meaning |
|-------|------|---------|
| `operation` | string | Short label identifying the RPC call (`simulateTransaction`, `getEvents`, ...) |
| `endpoint` | string | Host label, defaults to `rpc` |
| `attempt` | number | 1-based attempt number for this log line |
| `nextAttempt` | number | The attempt number that will run after the scheduled backoff (omitted for terminal lines) |
| `maxRetries` | number | The configured retry budget for the call |
| `delayMs` | number | The backoff that will be slept before the next attempt |
| `errorKind` | string | The `name` of the captured error class |
| `errorMessage` | string | Sanitized first-line of the error message (no XDR, no `secret_key=...`, no stack) |

### Alert signals

Recommended Prometheus alerts:

| Signal | Expression | Rationale |
|--------|-----------|-----------|
| Retry budget exhausted for any operation | `rate(splitnaira_rpc_retry_max_attempts_reached_total[5m]) > 0` | Burning the full budget means callers will start seeing 502/504 responses |
| **Repeated exhaustion for the same operation (#1164)** | `sum by (operation) (increase(splitnaira_rpc_retry_outcomes_total{outcome="exhausted"}[15m])) >= 3` | A single exhaustion can be a transient blip; **3 or more within 15 minutes for the same operation** means the RPC endpoint is sustained-degraded for that call path, not just having a bad moment. This is the signal that should page, not just log — treat it as distinct from (and higher severity than) the "any >0" rule above, which is informational. |
| Sustained `simulateTransaction` timeouts | `sum by (endpoint) (rate(splitnaira_rpc_retry_outcomes_total{outcome="timeout"}[5m])) > 0.1` | Simulation latency past `timeoutMs` means RPC is degraded for write paths |
| Cumulative retry sleep growing without success | `increase(splitnaira_rpc_retry_duration_ms_total[15m]) > 60000` | Backoffs are stacking, suggesting the RPC is flapping |
| Validation rejections from RPC | `sum by (operation) (rate(splitnaira_rpc_retry_outcomes_total{outcome="validation_error"}[5m])) > 0` | Indicates a client is sending payloads the RPC refuses — usually a contract arg drift |

### Why "repeated" needs its own threshold (#1164)

The existing `rate(splitnaira_rpc_retry_max_attempts_reached_total[5m]) > 0`
rule fires the same way whether the RPC endpoint had a single fluky failure
or has been failing every call for the last hour — it can't tell the
difference, because it only asks "did this happen at all". That's fine as a
low-severity signal to watch, but it's not enough to page on, and pages
based on it either get ignored (too noisy) or over-escalate a genuine
one-off blip.

The fix isn't a new metric — `splitnaira_rpc_retry_outcomes_total{operation,
outcome, endpoint}` already carries everything needed, since every
`exhausted` outcome is recorded per-operation. `sum by (operation)
(increase(...[15m])) >= 3` asks "how many times has *this specific
operation* exhausted its retry budget in the last 15 minutes", which is a
materially different and stronger signal: 3+ within 15 minutes for one
operation means that call path is currently, persistently broken, not just
unlucky once. This is the threshold that should page on-call; the plain
"any >0" rule stays as a lower-priority warning.

### Secret-hygiene guarantees

`executeWithRetry` does not log full `Error` objects; it logs only
`errorKind` and the first line of `errorMessage`. The helper additionally
scrubs `secret_key` and `xdr=` substrings from the message before logging.
Reviewers should reject any PR that introduces `console.log(error)` or
`logger.warn({ error })` in retry paths, because those bypass the sanitizer.

## Related

- [CI/CD reliability](../cicd-reliability.md)
- [Backend deploy](../backend-deploy.md)
- [Ops deployment & rollback](./ops-deployment-rollback.md)
- [Metrics inventory](../metrics-inventory.md)
