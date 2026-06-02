# Platform Hardening: Deployment Safety Checklist

**Purpose**: Ensure safe deployment of Platform Hardening changes to production  
**Owner**: Platform/DevOps team  
**Last Updated**: June 2, 2026  
**Status**: CHECKLIST (verify before each deployment)

---

## Pre-Deployment Verification (Development)

- [ ] **Code Review Complete**
  - All reviewers approved PR #401
  - No outstanding review comments
  - Security review completed

- [ ] **Tests Passing**
  ```bash
  cd backend && npm test
  # Verify output: "All tests passed"
  # Specifically check:
  # - error-scenarios.test.ts: PASS
  # - transaction-safety.test.ts: PASS
  # - routes.test.ts: PASS
  # - users.test.ts: PASS
  ```

- [ ] **Build Succeeds**
  ```bash
  cd backend
  npm run build
  # Should complete without errors
  npm run type-check
  # Should have 0 type errors
  ```

- [ ] **Lint Passes**
  ```bash
  npm run lint
  # Should have 0 errors (warnings OK)
  ```

- [ ] **Dependencies Verified**
  ```bash
  npm run deps:check
  # Should complete without errors
  ```

- [ ] **No Uncommitted Changes**
  ```bash
  git status
  # Working tree should be clean
  ```

---

## Pre-Deployment Verification (Staging)

- [ ] **Staging Environment Updated**
  - New backend image built and pushed
  - Backend version matches git commit
  - Database migrations applied to staging DB

- [ ] **Smoke Tests Passing**
  ```bash
  # Health endpoint responds
  curl -s https://staging-api.splitnaira.com/health | jq .
  # Should return: {"status": "ok"}

  # Error handling works
  curl -s -X POST https://staging-api.splitnaira.com/users/register \
    -d '{}' -H "Content-Type: application/json" | jq .
  # Should return 400 with structured error response
  ```

- [ ] **Database Health**
  ```bash
  # Check connection pool
  psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"
  # Should be reasonable number (< pool_max)

  # Check no orphaned transactions
  psql $DATABASE_URL -c "SELECT * FROM pg_stat_statements WHERE mean_time > 5000;"
  # Should see no slow transactions
  ```

- [ ] **No Regressions in Key Flows**
  - [ ] User registration works: POST /users/register
  - [ ] User login works: POST /users/login
  - [ ] Project listing works: GET /splits
  - [ ] Admin endpoints accessible with auth
  - [ ] Rate limiting activated (verify with load test)

- [ ] **Logging Configured**
  ```bash
  # Verify structured logging is enabled
  kubectl logs -l app=backend-staging --tail=20 | grep -E "requestId|type|message"
  # Should see structured JSON logs
  ```

- [ ] **Monitoring & Alerting**
  - [ ] Grafana dashboards accessible
  - [ ] Prometheus scraping backend metrics
  - [ ] Alert rules loaded (check AlertManager)
  - [ ] Slack/PagerDuty integration working

---

## Production Deployment Steps

### 1. Pre-Deployment Window (30 min before)

- [ ] **Announce in Slack** #deployments channel
  - Message: "Platform Hardening backend deployment starting in 30 min"
  - Include: git commit hash, expected change scope

- [ ] **Database Backup**
  ```bash
  # Create backup before any schema changes
  pg_dump $PROD_DATABASE_URL > prod_backup_$(date +%s).sql
  # (Not strictly needed for Platform Hardening, but good practice)
  ```

- [ ] **Review Deployment Checklist**
  - Confirm all pre-deploy checks are ✓
  - Confirm staging tests passed

### 2. Deploy Backend

- [ ] **Blue-Green Deployment (recommended)**
  ```bash
  # Deploy to new "green" infrastructure without cutting over
  kubectl set image deployment/backend-green backend=splitnaira/backend:NEW_TAG
  kubectl rollout status deployment/backend-green
  # Takes ~2-3 minutes

  # Test green deployment
  curl -s http://backend-green:3000/health
  # Should return 200
  ```

- [ ] **Cutover Traffic (if confident)**
  ```bash
  # Update service selector to point to green
  kubectl patch service backend -p '{"spec": {"selector": {"version": "green"}}}'
  # Wait 30 seconds for connection draining
  ```

- [ ] **Monitor Post-Deploy**
  ```bash
  # Watch logs for errors
  kubectl logs -l app=backend --tail=100 -f

  # Check error rates
  watch -n 5 'curl -s https://api.splitnaira.com/health | jq .'
  ```

### 3. Post-Deployment Verification (Production)

- [ ] **Health Check**
  ```bash
  curl -s https://api.splitnaira.com/health | jq .
  # Should return: {"status": "ok"}
  # Response time should be < 200ms
  ```

- [ ] **Error Handling**
  ```bash
  # Verify validation errors work
  curl -X POST https://api.splitnaira.com/users/register \
    -d '{"walletAddress":"invalid"}' \
    -H "Content-Type: application/json" | jq .
  # Should return 400 with:
  # - error: "validation_error" (or similar)
  # - requestId: (non-empty)
  # - details: (error details)
  ```

- [ ] **No Error Surge**
  ```bash
  # Monitor error rates for 5 minutes
  # Alert threshold: if error rate > 5% for 5 consecutive minutes, ROLLBACK

  # Query Prometheus
  curl -s 'http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status=~"5.."}[5m])'
  # Should show error rate near baseline (< 1%)
  ```

- [ ] **Database Connection Pool**
  ```bash
  psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"
  # Should be reasonable (< 20 for single instance)
  ```

- [ ] **Rate Limiting Functional**
  ```bash
  # Rapid requests should eventually return 429
  for i in {1..200}; do curl -s https://api.splitnaira.com/health -o /dev/null -w "%{http_code}\n"; done | sort | uniq -c
  # Output should include some 429 responses
  ```

### 4. User-Facing Tests (Production)

- [ ] **Frontend Loads** (if deployed together)
  - [ ] https://app.splitnaira.com loads without errors
  - [ ] No console errors in browser dev tools
  - [ ] Wallet connection works

- [ ] **Core Flows Work**
  - [ ] Can register new user (staging wallet)
  - [ ] Can list projects
  - [ ] Can view project details
  - [ ] Can see transaction history

---

## Rollback Decision Tree

### Decision 1: Error Rate Elevated?

**Metric**: 5xx errors > 5% for > 5 minutes  
**Action**: ROLLBACK

```bash
# Immediate rollback
kubectl set image deployment/backend backend=splitnaira/backend:PREVIOUS_TAG
kubectl rollout status deployment/backend

# Wait for all pods to be ready
kubectl wait --for=condition=ready pod -l app=backend --timeout=300s

# Verify
curl -s https://api.splitnaira.com/health
```

### Decision 2: Validation Errors Increased?

**Metric**: 400 errors > 150% of baseline for > 10 minutes  
**Action**: INVESTIGATE (likely schema mismatch)

```bash
# Check logs for validation patterns
kubectl logs -l app=backend | grep "VALIDATION_ERROR" | head -20

# If logs show consistent pattern (e.g., always failing on same field):
# Likely a schema mismatch — ROLLBACK
```

### Decision 3: Database Slow Queries?

**Metric**: p99 latency > 1000ms for > 5 minutes  
**Action**: INVESTIGATE then decide

```bash
# Check slow queries
psql $DATABASE_URL -c "SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# If new transaction wrapping causing slowness:
# - Might be pool exhaustion → increase DATABASE_POOL_MAX
# - Might be lock contention → ROLLBACK and investigate
```

### Decision 4: Monitoring/Alerting Failed?

**Metric**: Can't access Prometheus/Grafana  
**Action**: INVESTIGATE (separate from Platform Hardening issue)

```bash
# If you can't monitor, you can't verify safety — ROLLBACK as precaution
```

---

## Rollback Procedure

### Option 1: Fast Rollback (Recommended)

```bash
# 1. Immediately revert image
kubectl set image deployment/backend \
  backend=splitnaira/backend:PREVIOUS_VERSION_TAG

# 2. Wait for rollout
kubectl rollout status deployment/backend --timeout=5m

# 3. Verify health
curl -s https://api.splitnaira.com/health

# 4. Notify team
# Message in Slack: "Rolled back to VERSION_TAG due to [REASON]"

# 5. Schedule postmortem
# Document what went wrong for postmortem
```

### Option 2: Git-Based Rollback

```bash
# If fast rollback didn't work, use git
cd /path/to/deployment-repo

git revert <commit-hash-of-hardening>
git push origin main

# Redeploy via CI/CD
./scripts/deploy.sh backend main

# Wait and verify as above
```

### Option 3: Manual Database Rollback

```bash
# If database state is corrupted (shouldn't happen, but precaution)

# 1. Stop application
kubectl scale deployment/backend --replicas=0

# 2. Restore backup (if created)
psql $PROD_DATABASE_URL < prod_backup_TIMESTAMP.sql

# 3. Restart with previous image
kubectl scale deployment/backend --replicas=3
kubectl set image deployment/backend backend=splitnaira/backend:PREVIOUS_TAG
kubectl rollout status deployment/backend
```

---

## Post-Rollback Steps

1. **Notify Team**
   - Post in Slack with summary
   - Document in incident tracking system

2. **Collect Data**
   - Export logs from failed deployment
   - Export metrics (Prometheus)
   - Export database transaction log (if applicable)

3. **Root Cause Analysis**
   - Was it a code issue? Schema mismatch?
   - Was it infrastructure? (DB pool, RPC latency?)
   - Was it integration? (Stellar RPC failure?)

4. **Fix & Retry**
   - Address root cause in code
   - Re-test in staging
   - Re-run deployment checklist
   - Deploy again when confident

---

## Success Criteria

Platform Hardening deployment is **SUCCESSFUL** when:

- ✅ All health checks passing
- ✅ Error rate unchanged (< 1% 5xx, < 5% 4xx)
- ✅ Response times unchanged (p99 < 500ms)
- ✅ Database pool healthy (< 80% utilization)
- ✅ No increase in validation errors
- ✅ No user complaints in support channels
- ✅ 1 hour post-deploy with no issues

---

## Escalation Contacts

| Role | Contact | Responsibilities |
|------|---------|------------------|
| On-Call Engineer | #oncall | Monitor deployment, decide rollback |
| Backend Lead | @backend-lead | Code review, troubleshooting |
| DevOps Lead | @devops-lead | Infrastructure, rollback execution |
| Platform Lead | @platform-lead | Overall coordination |

---

## Appendix: Common Issues & Fixes

### Issue: "validation error" responses everywhere

**Symptom**: 400 errors on valid requests  
**Likely Cause**: Schema mismatch between frontend/backend  
**Fix**:
1. Check that frontend sent valid JSON
2. Verify Zod schema in backend matches expected format
3. Check if schema was changed in PR

### Issue: Rate limiting too aggressive

**Symptom**: 429 responses on normal traffic  
**Likely Cause**: Rate limiter thresholds too low  
**Fix**:
1. Check `middleware/rate-limit.ts` configuration
2. Verify tokens are not exhausted too quickly
3. May need to increase limits based on load test results

### Issue: Database connection pool exhaustion

**Symptom**: "Error: too many connections" in logs  
**Likely Cause**: Transaction wrapping holding connections longer  
**Fix**:
1. Increase `DATABASE_POOL_MAX` environment variable
2. Check for hanging transactions: `SELECT * FROM pg_stat_activity WHERE state='idle in transaction'`
3. Verify transaction callbacks are completing promptly

### Issue: Slow response times

**Symptom**: p99 latency increased to 1000ms+  
**Likely Cause**: Lock contention or slow queries  
**Fix**:
1. Check PostgreSQL slow query log
2. Verify indexes are present on frequently queried columns
3. May need to add `INDEX` on walletAddress or projectId

---

## Approved By

- [ ] Backend Team
- [ ] DevOps Team
- [ ] Platform Lead
- [ ] CTO/Technical Director

**Date Approved**: ___________
