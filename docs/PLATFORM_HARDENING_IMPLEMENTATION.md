# Platform Hardening Implementation Guide
## Wave 5 — Production-Grade Backend Reliability

**Issue**: #401  
**Track**: Platform Hardening  
**Priority**: High  
**Status**: Implementation  
**Date**: June 2, 2026

---

## Executive Summary

This document outlines the Platform Hardening initiative for SplitNaira's backend, focused on delivering production-grade reliability improvements that accelerate deployment readiness. The work encompasses:

- **Input validation hardening** — comprehensive schema validation across all routes
- **Database transaction safety** — atomic operations for critical financial paths
- **Error handling consistency** — structured error responses with remediation hints
- **Operational safety** — deployment checklists, monitoring, and rollback procedures
- **Test coverage expansion** — error scenarios and transaction rollback verification

**Target**: Deploy-safe backend that handles failures gracefully without data corruption.

---

## Implementation Checklist

### ✅ Phase 1: Validation Hardening

- [x] Validate request bodies with Zod schemas (`validateRequest` middleware)
- [x] Validate path parameters in all routes (e.g., `:projectId`, `:txHash`)
- [x] Validate query parameters consistently
- [x] Return structured 400 errors with detailed validation messages
- [x] Test validation failures comprehensively

**Status**: COMPLETE  
**Test Coverage**: `__tests__/error-scenarios.test.ts`

### ✅ Phase 2: Transaction Safety

- [x] Implement `withTransaction()` helper for atomic operations
- [x] Wrap user registration in transaction (post/users/register)
- [x] Document transaction rollback behavior
- [x] Add tests for rollback scenarios
- [x] Ensure all database writes use transaction wrapper

**Status**: COMPLETE  
**Test Coverage**: `__tests__/transaction-safety.test.ts`

### ✅ Phase 3: Error Handling

- [x] Centralized error handler (`middleware/error.ts`)
- [x] Consistent error response format (error, message, requestId, details)
- [x] Contract error mapping with remediation hints
- [x] RPC error handling with retry logic
- [x] Security headers in all responses

**Status**: COMPLETE  
**Test Coverage**: `__tests__/error-scenarios.test.ts`

### ✅ Phase 4: Rate Limiting

- [x] Global rate limiter (safety net)
- [x] Read limiter for GET requests
- [x] Write limiter for POST/PUT/DELETE requests
- [x] Admin limiter with configurable key
- [x] Auth limiter for /users/login

**Status**: COMPLETE  
**Configuration**: `middleware/rate-limit.ts`

### ✅ Phase 5: Response Validation

- [x] Middleware to validate outgoing JSON responses
- [x] Log failures to support schema discovery
- [x] Strict mode in production (reject malformed responses)
- [x] Tests for response validation edge cases

**Status**: COMPLETE  
**Middleware**: `middleware/validateResponse.ts`

### ✅ Phase 6: Security Headers

- [x] Content Security Policy (CSP) via Helmet
- [x] Strict-Transport-Security (HSTS)
- [x] X-Frame-Options (deny)
- [x] X-Content-Type-Options (nosniff)
- [x] Remove X-Powered-By header

**Status**: COMPLETE  
**Configuration**: `index.ts` (Helmet setup)

---

## Deployment Safety

### Pre-Deployment Checklist

Before deploying Platform Hardening changes:

- [ ] All tests pass: `npm test`
  ```bash
  cd backend && npm test -- error-scenarios.test.ts transaction-safety.test.ts
  ```

- [ ] Code coverage maintained: `npm run test:coverage` (if available)

- [ ] No breaking changes to existing API contracts:
  - Response format unchanged (still includes `error`, `message`, `requestId`)
  - Validation errors return 400 (same as before)
  - All existing endpoints function identically

- [ ] Database is up-to-date:
  ```bash
  npm run migration:run -w backend
  ```

- [ ] Environment variables are correct:
  ```bash
  npm run validate-env -w backend
  npm run deps:check -w backend
  ```

- [ ] Git is clean:
  ```bash
  git status  # No uncommitted changes
  git log --oneline -1  # Verify commit message
  ```

### Deployment Order

1. **Contract** (if updated) — see `docs/deployment.md`
2. **Database Migrations** — apply pending migrations
3. **Backend API** — deploy new backend image
4. **Frontend** (if needed) — update contract ID config if changed
5. **Smoke Tests** — verify health and functionality

### Smoke Tests Post-Deploy

```bash
# Check backend is healthy
curl https://api.splitnaira.com/health

# Verify error handling
curl -X POST https://api.splitnaira.com/users/register -d '{}' -H "Content-Type: application/json"
# Should return 400 with structured error

# Check rate limiting is working
for i in {1..300}; do curl https://api.splitnaira.com/health; done
# Should eventually see 429 (Too Many Requests)

# Verify transactions work (optional)
# Test user registration in staging environment
```

---

## Operational Impact

| Component | Impact | Downtime | Risk |
|-----------|--------|----------|------|
| Input Validation | Better error messages | None | None — backward compatible |
| Transaction Wrapping | Prevents data corruption | None | None — internal improvement |
| Error Handling | Consistent responses | None | None — no API change |
| Rate Limiting | Protects against abuse | None | Low — adjustable thresholds |
| Response Validation | Catches schema drift | None | Low — logs only in non-strict mode |
| Security Headers | Hardens against attacks | None | Low — standard HTTP headers |

---

## Rollback Procedure

### Fast Rollback (< 5 minutes)

If issues are detected post-deploy:

1. **Identify** the problematic endpoint or feature
   ```bash
   kubectl logs -l app=backend --tail=100
   # Look for error patterns or increased error rates
   ```

2. **Restore** previous backend image
   ```bash
   # Revert to previous image in your deployment
   kubectl set image deployment/backend backend=splitnaira/backend:PREVIOUS_TAG
   kubectl rollout status deployment/backend
   ```

3. **Verify** rollback succeeded
   ```bash
   curl https://api.splitnaira.com/health
   # Should see 200 OK within 30 seconds
   ```

4. **Investigate** the root cause
   - Check recent code changes for schema mismatches
   - Review database state for corruption
   - Check rate limiting configuration

### Full Rollback (git-based)

If a deeper rollback is needed:

```bash
# On main branch
git revert <commit-hash> # Revert the commit
git push origin main

# Redeploy
./scripts/deploy.sh backend main
```

### Database Rollback

If database migrations need to be rolled back:

```bash
# Use TypeORM migration CLI (if available)
npm run migration:revert -w backend

# Or manually via database tool
psql $DATABASE_URL -f down.sql
```

**Note**: Platform Hardening changes don't modify database schema, so this is typically not needed.

---

## Monitoring & Alerting

### Key Metrics to Monitor

1. **Error Rate** — track 4xx and 5xx responses
   ```
   Alert if 5xx error rate > 5% for 5 minutes
   Alert if validation error rate increases > 20% from baseline
   ```

2. **Response Time** — transaction wrapping may add latency
   ```
   Alert if p99 latency increases > 500ms
   ```

3. **Database Connection Pool** — transaction safety uses QueryRunner
   ```
   Alert if active connections > 80% of pool max
   Alert if waiting connections > 5
   ```

4. **Rate Limit Hits** — indicates traffic patterns or abuse
   ```
   Track 429 responses per endpoint
   Alert if unusual spike in a single endpoint
   ```

### Example Prometheus Metrics

```yaml
# Error rates by endpoint
rate(http_requests_total{status=~"4|5"}[5m])

# Validation error rate
rate(http_requests_total{status="400"}[5m])

# Database transaction duration
histogram_quantile(0.99, http_request_duration_seconds)

# Active DB connections
database_connections_active
```

### Log Patterns to Monitor

Look for these patterns in logs that indicate issues:

```
ERROR: VALIDATION_ERROR - indicates bad input
ERROR: RPC_CONNECTIVITY - Stellar RPC unreachable
ERROR: APPLICATION error - catch-all for business logic issues
WARN: RPC retry - indicates transient RPC issues
```

---

## Known Limitations & Future Work

### Current Limitations

1. **Isolation Level** — Uses PostgreSQL default (READ COMMITTED)
   - Sufficient for current volume
   - May need SERIALIZABLE for higher concurrency
   - **Future**: Add isolation level configuration if race conditions detected

2. **Connection Pool** — Fixed pool size (default 10)
   - Adequate for current load
   - Tune via `DATABASE_POOL_MAX` if needed
   - **Future**: Implement adaptive pool sizing

3. **Error Detail Levels** — Production hides internal details
   - Good for security, reduces debugging
   - **Future**: Add structured logging for operators

### Future Enhancements

- [ ] Circuit breaker for Stellar RPC
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Gradual rollout with feature flags
- [ ] Request replay capability for failed transactions
- [ ] Dead letter queue for unprocessable messages

---

## Testing Checklist

All tests should pass before merge:

```bash
cd backend

# Run all tests
npm test

# Run specific test suites
npm test -- error-scenarios.test.ts
npm test -- transaction-safety.test.ts

# Check coverage
npm run test:coverage

# Lint and type check
npm run lint
npm run type-check
```

---

## Documentation Updates

The following docs were updated as part of Platform Hardening:

- [x] `backend/README.md` — database transaction safety section
- [x] `docs/ops-deployment-rollback.md` — enhanced with Platform Hardening details
- [x] `docs/release-readiness-checklist.md` — added validation verification
- [x] This guide — `PLATFORM_HARDENING_IMPLEMENTATION.md`

---

## Support & Questions

If issues arise:

1. **Validation not working?** — Check that schema is applied to route handler
2. **Transactions failing?** — Verify database connection pool isn't exhausted
3. **Rate limiting too aggressive?** — Adjust limits in `middleware/rate-limit.ts`
4. **Tests failing?** — Run with `--reporter=verbose` to see details

Contact: Backend team via GitHub issues or PR comments.

---

## References

- [Backend README](../backend/README.md) — Development guide
- [Error Handling](../backend/src/lib/errors.ts) — Error code mappings
- [Database Service](../backend/src/services/database.ts) — Transaction API
- [Deployment Guide](../docs/backend-deploy.md) — CI/CD configuration
- [Ops Runbook](../docs/runbooks/ops-deployment-rollback.md) — Deployment procedures
