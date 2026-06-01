# Backend Deployment (CD)

This project deploys the backend via GitHub Actions using Render deploy hooks.

## Workflow

- Files:
  - `.github/workflows/backend-deploy.yml`
  - `.github/workflows/mainnet-deploy.yml`
- Triggered on:
  - Push to `main` (for merge-based CD via backend-deploy)
  - Manual run via `workflow_dispatch` (backend-deploy or mainnet-deploy)
- Pipeline stages:
  - `verify-backend`: install, verify data integrity, lint, build, and test backend
  - `validate-deploy-config`: verify `deploy_environment` and production secrets before deployment
  - `deploy-backend`: trigger deployment target
  - `verify-mainnet`: manual production path validates data integrity, lint, build, and tests
  - `deploy-mainnet`: explicit mainnet release path for production

## Deployment Target

- Default target: `render`
- Target selection order:
  1. Manual dispatch input: `deploy_target`
  2. Repository variable: `BACKEND_DEPLOY_TARGET`
  3. Fallback default: `render`

Currently supported values:
- `render`

## Required Secrets

Set these in GitHub repository settings under **Settings -> Secrets and variables -> Actions**:

- `RENDER_BACKEND_DEPLOY_HOOK_URL`
  - Value: Render backend service deploy hook URL
- `MAINNET_CONTRACT_ID`
  - Value: Mainnet Soroban contract ID to validate production deploy readiness

See [docs/secrets.md](./secrets.md) for full secret ownership, rotation procedures, and safe host-secret storage guidance.

## Optional Variables

Set these in **Settings -> Secrets and variables -> Actions -> Variables**:

- `BACKEND_DEPLOY_TARGET`
  - Default recommended value: `render`
- `BACKEND_SMOKE_URL`
  - Value: Base URL for post-deploy readiness smoke tests, such as `https://api-staging.example.com`
- `BACKEND_METRICS_URL`
  - Value: Optional metrics endpoint URL for CI/CD analytics validation, such as `https://api-staging.example.com/metrics`

When `BACKEND_METRICS_URL` is configured, the post-deploy smoke check validates both `/health/ready` and the metrics exposition endpoint before the workflow succeeds.

## Notes

- Deploy job only runs after backend lint/build succeeds.
- If `BACKEND_DEPLOY_TARGET` is set to an unsupported value, the job fails fast with a clear error.

## Database Migrations

Production runs with TypeORM `synchronize: false`; schema changes are shipped as versioned migrations.

Run migrations before routing traffic to a new backend release:

```bash
cd backend
npm run migration:run
```

The command reads `DATABASE_URL` plus the same Stellar environment variables used by the backend. CI validates that migrations apply on a clean PostgreSQL database before deployment.

## Wallet & Payments Admin Controls

`/splits/admin/*` now supports an environment-backed operator control plane for wallet and payout operations.

| Variable | Required | Purpose |
|---|---|---|
| `PAYMENTS_ADMIN_API_KEY` | Production: **Yes** | Shared secret required in the `x-admin-api-key` header for all `/splits/admin/*` requests |
| `PAYMENTS_ADMIN_WRITE_ENABLED` | No (`true` by default) | Emergency switch for admin write routes such as pause/unpause, allowlist changes, and unallocated-withdrawal XDR generation |

Recommended production configuration:

```bash
PAYMENTS_ADMIN_API_KEY=<long-random-secret-from-secret-manager>
PAYMENTS_ADMIN_WRITE_ENABLED=true
```

### Emergency freeze / rollback-aware mode

When a payout incident, contract anomaly, or rollback is in progress:

```bash
PAYMENTS_ADMIN_WRITE_ENABLED=false
```

With that flag set, backend admin reads remain available for diagnostics, while mutating `/splits/admin/*` routes return `503 payments_admin_writes_disabled`. This gives ops a fast way to stop new recovery/pause/allowlist actions without changing code.

## Readiness Checks

`GET /health/ready` returns component status for `db`, `rpc`, and `contract`.

`GET /ops/mainnet-readiness` extends that coverage with deployment validation and ops auditing, including:

- environment configuration diagnostics
- database connectivity and query health
- cache runtime metrics
- production secret audits (`MAINNET_CONTRACT_ID`, `RENDER_BACKEND_DEPLOY_HOOK_URL`)
- contract ID consistency with the current backend configuration

The endpoint returns `503` when any component is unavailable so Render/load balancers do not route traffic to an instance with missing config, an unreachable database, an unreachable Soroban RPC, or an invalid/unreachable contract.

---

## CORS Configuration

`CORS_ORIGIN` controls which browser origins may call the API.

| Environment | Required | Rules |
|---|---|---|
| Development | No | Defaults to `http://localhost:3000` |
| Production | **Yes** | Must be set; wildcard `*` is rejected at startup |

```bash
# Single origin (Vercel preview URL)
CORS_ORIGIN=https://splitnaira.vercel.app

# Multiple origins — comma-separated (Vercel + custom domain)
CORS_ORIGIN=https://splitnaira.vercel.app,https://app.splitnaira.com,https://splitnaira.com
```

If `CORS_ORIGIN` is missing or contains `*` in production the process will refuse to start with a descriptive error.

---

## Structured Logging

Two log formats are supported, selected by `LOG_FORMAT`:

| Value | Use case | Output |
|---|---|---|
| `pretty` (default) | Local development | Coloured human-readable lines |
| `json` | Production / Render | Newline-delimited JSON for log drains |

Set `LOG_FORMAT=json` in the Render environment dashboard.

### JSON log fields

Every JSON log entry includes:

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO-8601 string | UTC log time |
| `level` | string | `error` / `warn` / `info` / `http` / `debug` |
| `message` | string | Human-readable summary |
| `requestId` | string? | Correlation ID from `x-request-id` (present on request-scoped logs) |

Additional fields depend on the call site (e.g. `method`, `path`, `errors` for response-validation failures).

### Secrets scrub list

The following field names are automatically redacted to `[REDACTED]` in every log entry regardless of nesting depth:

`password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `private_key`, `mnemonic`, `seed`, `database_url`, `sentry_dsn`

---

## Error Monitoring (Sentry)

Set `SENTRY_DSN` to activate backend error capture. The SDK is loaded lazily — omitting the variable has zero runtime cost.

```bash
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production          # defaults to NODE_ENV
# SENTRY_SCRUB_WALLET_ADDRESSES=true   # redacts Stellar addresses (default: true)
```

Captured events:
- Unhandled promise rejections
- Uncaught exceptions
- Generic 5xx errors that reach the global error handler

Stellar public keys (`G…`) and contract IDs (`C…`) are scrubbed from event payloads by default. Set `SENTRY_SCRUB_WALLET_ADDRESSES=false` to disable scrubbing if keys are needed for debugging.

### Frontend Sentry

Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel or your hosting platform:

```bash
NEXT_PUBLIC_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

The `AppErrorBoundary` component forwards uncaught React render errors to Sentry when the DSN is present.

---

## Response Schema Validation

`withResponseValidation` wraps route handlers and validates the outgoing JSON body against a Zod schema before it reaches the client.

### Behaviour on mismatch

| Mode | When active | Behaviour |
|---|---|---|
| Strict | `NODE_ENV=production` **or** `STRICT_RESPONSE_VALIDATION=true` | Returns HTTP 500; logs full diff |
| Lenient | `NODE_ENV` ≠ production (unless flag overrides) | Forwards original body; logs diff |

Override the default with:

```bash
# Force strict even in development (recommended for CI)
STRICT_RESPONSE_VALIDATION=true

# Disable strict in production (not recommended)
STRICT_RESPONSE_VALIDATION=false
```

### Tradeoffs

Strict mode prevents clients from receiving corrupt/partial data when the API contract drifts from what the server produces, catching issues at the API layer rather than in the frontend. The cost is that any schema mismatch becomes a 500 visible to callers — deploy with confidence by running the full test suite first.

In lenient mode, mismatches are only visible in logs, making it safe to iterate on endpoints before full schema coverage is achieved.
