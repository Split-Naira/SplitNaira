# Production Readiness Checklist

This document serves as the operational runbook to ensure `SplitNaira` is ready for mainnet deployment and stable production load.

## 1. Security Hardening
- [x] **Helmet**: Ensure `helmet` is configured with strict Content Security Policy (CSP), HSTS (1-year preload), Frameguard, and XSS Filters.
- [x] **Rate Limiting**: Verify global API limiters and strict authentication limiters are functioning correctly.
- [x] **CORS**: Ensure `CORS_ORIGIN` environment variable is explicitly set for production to avoid wildcard origins.
- [ ] **Payments Admin Auth**: Set `PAYMENTS_ADMIN_API_KEY` in the production secret store and verify `/splits/admin/status` returns `401` without `x-admin-api-key` and `200` with it.

## 2. Infrastructure & Monitoring
- [ ] **Health Checks**: Confirm `/health` endpoints are continually scraped by uptime monitors (e.g., Datadog, Pingdom, BetterUptime).
- [ ] **Database Backups**: Verify automated Point-in-Time Recovery (PITR) is enabled on the primary Postgres database with at least a 7-day retention period.
- [ ] **Sentry**: Ensure `SENTRY_DSN` is correctly configured in production for error tracking. Verify wallet scrubbing rules are actively redacting PII/sensitive wallet addresses.
- [ ] **Payments Freeze Switch**: Confirm ops can restart or redeploy with `PAYMENTS_ADMIN_WRITE_ENABLED=false` and observe `503 payments_admin_writes_disabled` on admin write endpoints.

## 3. Deployment Safety
- [ ] **Rollback Capability**: Document and test the rollback process (refer to `rollback-guide.md`).
- [ ] **CI/CD Checks**: Confirm all GitHub actions (`backend-deploy.yml`, `mainnet-deploy.yml`) require all tests to pass prior to merging to `main`.
