# Operational Dashboard Metrics Inventory

> Last updated: 2026-07-27
> Part of the production readiness observability stack. Linked from `docs/runbooks/observability.md`.

This document inventories every metric exposed by the SplitNaira backend, plus the key signals that teams should monitor but are not yet instrumented. Each row maps a metric to its owner, alert threshold, and the dashboard panel where it should appear.

---

## 1. API / HTTP Metrics

Source: `backend/src/routes/metrics.ts`, `backend/src/services/metrics.ts`, `backend/src/middleware/metrics.ts`

| Metric | Type | Labels | Owner | Alert Threshold | Dashboard Panel |
|--------|------|--------|-------|----------------|-----------------|
| `splitnaira_http_requests_total` | counter | `method`, `route`, `status` | Backend | P99 daily spike >5x baseline | Request Rate by Route |
| `splitnaira_http_request_duration_seconds_sum` | gauge | `method`, `route` | Backend | Route P99 > 5s | Request Latency by Route |
| `splitnaira_http_request_duration_seconds_count` | gauge | `method`, `route` | Backend | — | Request Latency (companion) |
| `splitnaira_http_requests_inflight` | gauge | — | Backend | Sustained >50 | In-Flight Requests |
| `splitnaira_validation_failures_total` | counter | — | Backend | Any >0 in 1h | Response Validation Failures |
| `splitnaira_info` | gauge | `version` | Platform | — | Service Version |

### Notes
- Latency metrics use `process.hrtime.bigint()` via the `metricsMiddleware` in `index.ts`.
- Validation failures are tracked in `middleware/validateResponse.ts`.
- Inflight tracking increments on request entry and decrements on response finish or close.

### Missing (TODO)
- Per-status breakdown alert (5xx spike auto-alert).
- Endpoint-level P50/P95/P99 without post-processing (currently only sum/count exposed).

---

## 2. Business Metrics

Source: `backend/src/services/metrics.ts`

| Metric | Type | Labels | Owner | Alert Threshold | Dashboard Panel |
|--------|------|--------|-------|----------------|-----------------|
| `projects_created_total` | counter | — | Product | Zero in 24h | Projects Created (rate) |
| `distributions_executed_total` | counter | — | Product | Zero in 24h | Distributions Executed |
| `deposits_received_total` | counter | — | Product | Zero in 24h | Deposits Received |
| `sse_connections_active` | gauge | — | Backend | >100 concurrent | Active SSE Connections |

### Notes
- Business counters are incremented in `routes/splits.ts` at the point of XDR generation (not on-chain confirmation).
- A future version should tie these to the event listener's confirmed events for accuracy.

### Missing (TODO)
- `payouts_total` by token type (USDC vs native XLM).
- `users_registered_total` from the auth flow.
- `collaborators_invited_total` from invite events.
- `projects_expired` or `ttl_renewals_total`.

---

## 3. Database Metrics

Source: No dedicated DB metrics are currently exported. The health endpoint (`routes/health.ts`) runs a `SELECT 1` query for readiness.

| Metric | Type | Labels | Owner | Alert Threshold | Status |
|--------|------|--------|-------|----------------|--------|
| `pg_pool_size_current` | gauge | — | Backend | >80% of `PG_POOL_MAX` | ❌ Missing |
| `pg_pool_size_idle` | gauge | — | Backend | <2 | ❌ Missing |
| `pg_query_duration_seconds` | histogram | `query` | Backend | P99 > 1s | ❌ Missing |
| `pg_connection_errors_total` | counter | — | Backend | Any >0 | ❌ Missing |
| `migration_version_current` | gauge | — | Platform | ≠ expected version | ❌ Missing |

### TODO (follow-up)
- Instrument `pg.Pool` event emitters (`connect`, `acquire`, `release`, `remove`) in `services/db.ts`.
- Wrap query execution with duration histogram.

---

## 4. Stellar RPC / Soroban Metrics

Source: Issue #836 wired `executeWithRetry` to record structured metrics.
Health endpoint runs `checkSorobanReachability()` and `checkContractHealth()`.

| Metric | Type | Labels | Owner | Alert Threshold | Status |
|--------|------|--------|-------|----------------|--------|
| `splitnaira_rpc_retry_attempts_total` | counter | — | Backend | Sustained > 2x baseline | ✅ Live (Issue #836) |
| `splitnaira_rpc_retry_max_attempts_reached_total` | counter | — | Backend | Any >0 in 5m | ✅ Live (Issue #836) |
| `splitnaira_rpc_retry_duration_ms_total` | counter | — | Backend | Increase > 60s/15m | ✅ Live (Issue #836) |
| `splitnaira_rpc_retry_outcomes_total` | counter | `operation`, `outcome`, `endpoint` | Backend | Timeouts / exhausted >0 | ✅ Live (Issue #836) |
| `rpc_request_duration_seconds` | histogram | `endpoint` | Backend | P99 > 5s | ❌ Missing |
| `rpc_request_errors_total` | counter | `endpoint`, `code` | Backend | Any >0 | ✅ Partial (Issue #836 covers retry outcomes) |
| `rpc_simulation_latency_seconds` | histogram | — | Backend | P99 > 3s | ❌ Missing |
| `contract_call_duration_seconds` | histogram | `method` | Backend | P99 > 5s | ❌ Missing |

### Existing Health Checks
- `/health/ready` checks Soroban RPC reachability and contract simulation.
- Failures set component status to `not_ready` and return 503.

### Issue #836: How retry metrics are recorded
- Per-attempt: `recordRpcRetryAttempt(operation, endpoint, attempt, delayMs)`
  increments `splitnaira_rpc_retry_attempts_total` and, when `delayMs > 0`,
  `splitnaira_rpc_retry_duration_ms_total`.
- Per-final-outcome: `recordRpcRetryOutcome(operation, outcome, endpoint)`
  increments `splitnaira_rpc_retry_outcomes_total{operation, outcome, endpoint}`
  and bumps `splitnaira_rpc_retry_max_attempts_reached_total` when outcome is
  `exhausted`.
- Outcomes: `success`, `validation_error`, `timeout`, `exhausted`,
  `transient_failure` (reserved for future behaviour changes).

### TODO (follow-up)
- Export RPC call timings from `lib/soroban-transaction.ts` and `services/contract.ts`.
- Track `minResourceFee` from simulation responses as a gauge (fee estimation).

---

## 5. Wallet & Auth Metrics

Source: `frontend/src/hooks/useWallet.ts` captures Sentry errors. No Prometheus metrics.

| Metric | Type | Labels | Owner | Alert Threshold | Status |
|--------|------|--------|-------|----------------|--------|
| `wallet_connect_attempts_total` | counter | `method` | Frontend | — | ❌ Missing |
| `wallet_connect_errors_total` | counter | `method`, `code` | Frontend | Increase >2x baseline | ❌ Missing |
| `wallet_account_switches_total` | counter | — | Frontend | — | ❌ Missing |
| `auth_login_success_total` | counter | — | Backend | Zero in 24h | ❌ Missing |
| `auth_login_failures_total` | counter | — | Backend | Spike >5x baseline | ❌ Missing |

### Existing Sentry Coverage
- Wallet connect/refresh errors captured in `useWallet.ts` with tags `section: "wallet-hook"`.
- API auth errors captured in `api-client.ts` with tags `section: "api-client"`.

### TODO (follow-up)
- Export wallet metrics from the frontend to the backend `/metrics` endpoint via a reporting API.
- Track auth login attempts in `routes/users.ts`.

---

## 6. Payout / Transaction Metrics

Source: `services/PayoutHistoryService.ts`, `services/EventListenerService.ts`.

| Metric | Type | Labels | Owner | Alert Threshold | Status |
|--------|------|--------|-------|----------------|--------|
| `payouts_initiated_total` | counter | `token` | Backend | — | ❌ Missing |
| `payouts_confirmed_total` | counter | `token` | Backend | < `initiated` in 30m | ❌ Missing |
| `payouts_failed_total` | counter | `token`, `reason` | Backend | Any >0 | ❌ Missing |
| `tx_submit_duration_seconds` | histogram | — | Backend | P99 > 30s | ❌ Missing |
| `tx_poll_cycles_total` | counter | `status` | Backend | — | ❌ Missing |
| `splitnaira_event_listener_ledger_lag` | gauge | — | Backend / Platform | >20 for 5m warning; >100 for 10m critical | ✅ Live |
| `splitnaira_event_listener_last_processed_ledger` | gauge | — | Backend | — | ✅ Live |
| `splitnaira_event_listener_latest_observed_ledger` | gauge | — | Backend | — | ✅ Live |

### Existing Coverage
- Soroban transaction submit and poll errors captured in Sentry (`soroban-transaction.ts`).
- Payout history service logs errors via Winston logger.
- Listener ledger position is persisted alongside its cursor and exposed through
  `/metrics`; see the [observability runbook](./runbooks/observability.md#background-listener-ledger-lag).

### TODO (follow-up)
- Instrument `submitSorobanTransactionAndPoll()` with duration histogram and status counters.
- Track confirmed vs. failed payout ratio.

---

## 7. SSE / Event Stream Metrics

Source: `routes/events.ts`, `services/EventListenerService.ts`

| Metric | Type | Labels | Owner | Alert Threshold | Dashboard Panel |
|--------|------|--------|-------|----------------|-----------------|
| `sse_connections_active` | gauge | — | Backend | >100 | Active SSE Connections |
| `sse_connections_total` | counter | — | Backend | — | SSE Connection Rate |
| `sse_errors_total` | counter | — | Backend | Any >0 in 5m | SSE Errors |

### Existing
- Active connections tracked in-memory via `metricsService.incrementSseConnections()`.
- Connection count exposed as `sse_connections_active`.

### Missing (TODO)
- Connection duration histogram.
- Error type breakdown (timeout vs. invalid txHash vs. listener limit).

---

## 8. Infrastructure / Process Metrics

Source: `routes/metrics.ts`

| Metric | Type | Labels | Owner | Alert Threshold | Dashboard Panel |
|--------|------|--------|-------|----------------|-----------------|
| `splitnaira_process_uptime_seconds` | gauge | — | Platform | <60 after deploy | Process Uptime |
| `splitnaira_process_heap_bytes` | gauge | — | Platform | >80% of limit | Heap Usage |
| `splitnaira_info` | gauge | `version` | Platform | — | Deployed Version |

### Missing (TODO)
- Event loop lag histogram.
- RSS memory in addition to heap.
- CPU usage gauge (may require external exporter).

---

## 9. Missing Metrics Summary

The following metric families were identified as gaps during the inventory. Each should be created as a follow-up GitHub issue:

| # | Metric | Reason | Effort |
|---|--------|--------|--------|
| 1 | `pg_pool_*` series | No DB pool metrics anywhere | 2d |
| 2 | `rpc_*` series | RPC calls drive all contract interactions | 2d |
| 3 | `wallet_*` series | Wallet UX issues are top user complaints | 3d |
| 4 | `auth_*` series | Auth failures can indicate attacks | 1d |
| 5 | `payout_*` confirmed/failed | Core business metric, no coverage | 2d |
| 6 | `tx_submit_duration_seconds` | Slow submits indicate RPC issues | 1d |

---

## 10. How to Add a New Metric

1. Add the counter/gauge/histogram in `backend/src/services/metrics.ts`.
2. Register the metric line in `backend/src/routes/metrics.ts` under the Prometheus `register.metric()` section.
3. Wire the recording call at the source (e.g., middleware, service function, route handler).
4. Add a test in `backend/src/__tests__/metrics.test.ts`.
5. Add the metric row to this inventory table.
6. Update `docs/runbooks/observability.md` if the metric should appear on a dashboard.

---

## 11. Owners

| Owner | Team | Areas |
|-------|------|-------|
| **Backend** | Backend Engineering | API, DB, RPC, SSE, business metrics |
| **Frontend** | Frontend Engineering | Wallet, auth UX metrics |
| **Platform** | DevOps / Platform | Infrastructure, uptime, deployment metrics |
| **Product** | Product Management | Business counters (projects, distributions, deposits) |

---

*Generated during Wave 5 operational hardening. See `docs/runbooks/observability.md` for the linked observability runbook.*
