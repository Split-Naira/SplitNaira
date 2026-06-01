# Backend Release Operations — Wave 5

## Overview

Wave 5 release-operations work improves deploy readiness for the SplitNaira backend: atomic user registration, structured logging on critical paths, validation middleware repair, payments-admin route hardening, and operational runbook material for safe rollout and rollback.

## Implementation plan

| Priority | Item | Files |
|----------|------|-------|
| Critical | Fix `validateRequest` middleware responses | `backend/src/middleware/validate.ts` |
| Critical | Add `withTransaction()` and wrap user registration | `backend/src/services/database.ts`, `backend/src/routes/users.ts` |
| Critical | Protect wallet/payment admin routes with `PAYMENTS_ADMIN_API_KEY` | `backend/src/index.ts`, `backend/src/middleware/payments-admin.ts` |
| High | Add rollback-aware write freeze for `/splits/admin/*` | `backend/src/index.ts`, `backend/src/config/env.ts` |
| High | Route errors through Winston `logger` (error handler, RPC retries, payout backfill) | `middleware/error.ts`, `services/stellar.ts`, `services/PayoutHistoryService.ts`, etc. |
| High | Repair incomplete validation/RPC error responses blocking builds | `backend/src/routes/splits.ts` |
| Medium | Transaction + RPC retry tests | `services/database.test.ts`, `__tests__/users.test.ts`, `services/stellar.ts` |

## Deployment safety

### Pre-deployment checklist

- [ ] `npm run deps:check -w backend`
- [ ] `npm run migration:run -w backend` (staging/production when Postgres is available)
- [ ] `npm run lint -w backend`
- [ ] `npm run build -w backend`
- [ ] `npm run test:compat -w backend`
- [ ] `npm run test -w backend`
- [ ] Confirm `DATABASE_URL` and Stellar env vars match [`backend/.env.example`](../backend/.env.example)

### Zero-downtime deployment

1. **No schema changes** in this wave — migrations are optional if already applied.
2. **Backward compatible** API responses for existing clients.
3. **Logging** changes are internal only (Winston files / aggregation).

### Deployment steps

```bash
git checkout main && git pull
git checkout -b feat/backend-release-ops-wave5
# after merge:
npm ci
npm run build -w backend
npm run migration:run -w backend   # when DATABASE_URL points at target DB
# deploy via backend-deploy workflow / your platform
curl https://<api-host>/health
```

## Rollback procedure

### Quick rollback

```bash
git revert <merge-commit-sha>
npm run build -w backend
# redeploy previous artifact / restart service
```

### Why rollback is low risk

- No new migrations required to revert.
- `withTransaction` only tightens user registration; reverting restores prior non-transactional behavior.
- No destructive data migrations in this wave.

### Monitor after deploy or rollback

- `/health` success rate
- User registration 4xx/5xx rates
- `/splits/admin/*` 401/503 rates
- Winston log volume and error spikes
- Postgres connection pool metrics

## Operational impact

### Logging

Application and RPC errors on touched paths now use structured `logger` entries with `requestId`, improving correlation in `error.log` / `combined.log`.

### Database transactions

User registration is atomic: duplicate detection and insert share one transaction; failures roll back with no partial rows.

### Validation / RPC responses

Incomplete `res.status().json({ error: , ... })` placeholders in splits routes were replaced with consistent `validation_error` / `rpc_error` payloads so the API compiles and returns predictable 400/502 bodies.

### Payments admin safety

Production deployments now require `PAYMENTS_ADMIN_API_KEY` for `/splits/admin/*`, and payout-impacting admin writes can be frozen instantly with `PAYMENTS_ADMIN_WRITE_ENABLED=false` while leaving read-only diagnostics available during rollback.

## Local CI (matches `.github/workflows/ci.yml` backend job)

```bash
export CI=true NODE_ENV=test \
  DATABASE_URL=postgresql://splitnaira:splitnaira@localhost:5432/splitnaira_ci \
  HORIZON_URL=https://horizon-testnet.stellar.org \
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  SIMULATOR_ACCOUNT=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF \
  NEXT_PUBLIC_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

npm ci
npm run deps:check -w backend
npm run migration:run -w backend
npm run lint -w backend
npm run build -w backend
npm run test:compat -w backend -- --reporter=verbose
npm run test -w backend -- --reporter=verbose
```

Postgres 16 must be listening on `localhost:5432` (same as the CI service container).

## Known limitations

- Response validation middleware is not applied to every route yet.
- `env.ts` startup diagnostics still use `console.log` by design.
- Admin role enforcement remains follow-up work (see audit in `docs/BACKEND_RELEASE_OPS_AUDIT.md`).

## References

- [Backend deploy](../docs/backend-deploy.md)
- [Release readiness checklist](../docs/release-readiness-checklist.md)
- [TypeORM transactions](https://typeorm.io/transactions)
