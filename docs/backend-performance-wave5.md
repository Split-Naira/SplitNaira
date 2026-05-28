# Backend Performance — Wave 5

## Overview

Wave 5 performance work reduces RPC load, caps in-memory read-cache growth, tunes the Postgres pool, and fixes RPC retry behavior so transient Soroban failures recover correctly.

## Implementation plan

| Priority | Change | Files |
|----------|--------|-------|
| High | Bounded TTL read cache (max entries + expiry) | `backend/src/services/read-cache.ts`, `stellar.ts` |
| High | Fix `executeWithRetry` to await `Promise.race` (retries actually run) | `backend/src/services/stellar.ts` |
| Medium | Configurable cache and pool via env | `backend/src/config/env.ts`, `backend/.env.example` |
| Medium | Postgres connection pool `max` via TypeORM `extra` | `backend/src/services/database.ts` |
| Medium | Unit tests for cache behavior | `backend/src/services/read-cache.test.ts` |

## Operational impact

### Read cache

- **Before:** Unbounded `Map` for simulation reads; risk of memory growth on long-lived processes.
- **After:** Default max **500** entries, TTL **30s** (configurable). Oldest entry evicted when full.
- **Tuning:** `READ_CACHE_TTL_MS`, `READ_CACHE_MAX_ENTRIES` in environment.
- **Invalidation:** Unchanged — write routes still call `invalidateCache` / `invalidateCacheByPrefix`.

### Database pool

- **Default:** `DATABASE_POOL_MAX=10` connections per process.
- **Tuning:** Raise for high concurrency; lower for small containers.

### RPC retries

- Transient errors now retry with exponential backoff (structured `logger.warn`).

## Rollback

1. Revert the merge commit and redeploy the previous image.
2. No schema migrations in this wave.
3. Remove optional env vars to restore prior defaults (30s TTL, unbounded cache behavior replaced by bounded — revert code to restore old semantics).

### Monitoring after deploy

- Process RSS / heap (cache cap should stabilize growth)
- Soroban RPC request rate (should drop on read-heavy endpoints)
- API p95 latency on `GET` split/project routes
- Postgres active connections vs `DATABASE_POOL_MAX`

## Local CI (`.github/workflows/ci.yml` backend job)

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
npm run migration:run -w backend   # requires Postgres on :5432
npm run lint -w backend
npm run build -w backend
npm run test:compat -w backend
npm run test -w backend
```

## Pre-deployment checklist

- [ ] Full backend test suite green
- [ ] Set `READ_CACHE_*` / `DATABASE_POOL_MAX` in staging if defaults are insufficient
- [ ] Confirm no regression on write paths (cache invalidation still called)
