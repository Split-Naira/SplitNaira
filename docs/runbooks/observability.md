# Observability Runbook

Operational guidance for metrics, health probes, correlation IDs, and deploy verification.

## Health Endpoints

| Endpoint | Purpose | Expected |
|----------|---------|----------|
| `GET /health` | Basic status + uptime | `200`, `{ status: "ok" }` |
| `GET /health/live` | Liveness (process up) | `200`, `{ status: "ok" }` |
| `GET /health/startup` | Initialisation complete | `200` after DB/listeners start; `503` during boot |
| `GET /health/ready` | Ready for traffic | `200` when DB + Soroban RPC + contract sim OK |

Configure Render/orchestrator probes:

- **Liveness:** `/health/live`
- **Readiness:** `/health/ready`
- **Startup (optional):** `/health/startup`

## Metrics

`GET /metrics` — Prometheus text exposition (enabled when `METRICS_ENABLED=true`, default on in production).

Exposed series:

- `splitnaira_validation_failures_total` — response schema validation failures
- `splitnaira_process_uptime_seconds`
- `splitnaira_process_heap_bytes`
- `splitnaira_info{version="..."}`

Scrape from internal network only; do not expose publicly without auth.

## Correlation IDs

Every request receives `x-request-id` and `x-correlation-id` (same value). Clients may send either header; the value is echoed in responses and included in error payloads as `requestId`.

Structured logs (Winston JSON when `LOG_FORMAT=json`) include `requestId` on error paths.

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
3. Check `/health/ready` component breakdown for dependency failures.
4. Review metrics around the failure window (`splitnaira_validation_failures_total` spikes indicate schema drift).

## Rollback

| Change | Rollback |
|--------|----------|
| Metrics endpoint | Set `METRICS_ENABLED=false` and redeploy |
| Smoke check failures | Roll back Render deploy; smoke check does not auto-rollback |
| Correlation header change | Revert middleware commit; clients using either header remain compatible |

## Related

- [CI/CD reliability](../cicd-reliability.md)
- [Backend deploy](../backend-deploy.md)
- [Ops deployment & rollback](./ops-deployment-rollback.md)
