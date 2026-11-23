# Backend Audit Log Retention Policy (#896)

> **Issue:** #896
> **Track:** Stellar Wave
> **Status:** Complete

## Purpose

This document defines the retention policy, access controls, and archival process for backend audit logs in the SplitNaira platform. It ensures compliance with operational requirements and supports incident response by making audit data predictable and manageable.

## Audit Event Categories

| Category                | Source                         | Retention Period    | Storage             |
| ----------------------- | ------------------------------ | ------------------- | ------------------- |
| Admin mutations         | `audit_log` table (middleware) | 2 years             | PostgreSQL          |
| Application errors      | Winston rotated logs           | 90 days             | Filesystem / Render |
| Sentry error events     | Sentry dashboard               | 90 days (free tier) | Sentry cloud        |
| Health check failures   | Winston rotated logs           | 90 days             | Filesystem / Render |
| Authentication attempts | Winston rotated logs           | 90 days             | Filesystem / Render |

### Admin Mutations (audit_log table)

The `audit_log` table records every successful admin mutation under `/splits/admin`. Each row contains:

- `action` — derived from the last URL path segment (e.g., `pause_distributions`)
- `performed_at` — timestamp of the request completion
- `ip_hash` — SHA-256 of the request IP, truncated to 16 hex chars
- `request_id` — correlation ID for request tracing
- `payload` — the request body (JSONB)

The same table also holds payout attempt status transitions
(`action = payout_attempt_transition`, #1643). They record the prior and next
status with correlation metadata. See
[ledger-transaction-finality.md](./ledger-transaction-finality.md#operator-notes).

**Retention:** 2 years from `performed_at`. Rows older than 2 years are candidates for archival or deletion.

### Application Logs (Winston)

Winston logs are rotated daily and retained for 90 days. Log files follow the pattern `logs/app-YYYY-MM-DD.log`.

**Retention:** 90 days. Older logs are automatically deleted by the log rotation mechanism.

### Sentry Events

Sentry captures error events with full stack traces and context. The free tier retains events for 90 days.

**Retention:** 90 days (managed by Sentry). No local action required.

## Access Controls

| Role           | Audit Log Access | Application Log Access      | Sentry Access |
| -------------- | ---------------- | --------------------------- | ------------- |
| Platform admin | Read (via SQL)   | Read (via Render dashboard) | Read          |
| Developer      | Read (via SQL)   | Read (via Render dashboard) | Read          |
| Support        | None             | None                        | None          |
| External       | None             | None                        | None          |

### Audit Log Query Access

Audit logs are stored in the `audit_log` PostgreSQL table. Access is limited to users with database credentials, which are restricted to platform administrators.

```sql
-- Example: query recent admin actions
SELECT action, performed_at, request_id
FROM audit_log
WHERE performed_at > NOW() - INTERVAL '7 days'
ORDER BY performed_at DESC;
```

### Application Log Access

Application logs are accessible through the Render dashboard by authorized team members with deploy access.

### Sentry Access

Sentry access is managed through the Sentry organization settings. Only team members with the `Member` role or higher can view error events.

## Export Expectations

Audit logs may need to be exported for:

1. **Incident response** — during active incidents, relevant logs are exported to incident tickets
2. **Compliance audits** — annual export of admin mutation logs for the retention period
3. **Legal holds** — specific date ranges may be preserved indefinitely when required

### Export Procedure

1. Query the `audit_log` table for the required date range
2. Export as CSV or JSON using `psql` or a database GUI tool
3. Store the export in a secure location (e.g., encrypted cloud storage)
4. Document the export in the incident or compliance ticket

```sql
-- Example: export admin mutations for a specific month
COPY (
  SELECT action, performed_at, ip_hash, request_id, payload
  FROM audit_log
  WHERE performed_at >= '2026-01-01' AND performed_at < '2026-02-01'
  ORDER BY performed_at
) TO '/tmp/audit-export-2026-01.csv' WITH CSV HEADER;
```

## Deletion and Archival

### Automated Retention

- **Audit log table:** No automated deletion is currently configured. Retention is enforced by periodic manual review (quarterly).
- **Winston logs:** Automatically rotated and deleted after 90 days by the log rotation configuration.
- **Sentry events:** Automatically expired after 90 days by the Sentry free tier.

### Manual Archival Process

Quarterly, a platform administrator should:

1. Query for audit log rows older than 2 years:

   ```sql
   SELECT COUNT(*) FROM audit_log
   WHERE performed_at < NOW() - INTERVAL '2 years';
   ```

2. If rows exist, export them to cold storage before deletion:

   ```sql
   -- Export to CSV before deletion
   COPY (SELECT * FROM audit_log WHERE performed_at < NOW() - INTERVAL '2 years')
   TO '/tmp/audit-archive.csv' WITH CSV HEADER;
   ```

3. Delete the archived rows:

   ```sql
   DELETE FROM audit_log
   WHERE performed_at < NOW() - INTERVAL '2 years';
   ```

4. Document the archival in the operations log with date, row count, and storage location.

### Incident-Driven Deletion

In the event of a security incident, audit logs may be preserved beyond the standard retention period until the incident review is complete. Do not delete audit logs during an active incident investigation.

## Recommended Pool Settings

The database connection pool should be configured to handle audit log writes without exhausting connections:

| Setting              | Recommended Value | Env Variable                    | Rationale                                                   |
| -------------------- | ----------------- | ------------------------------- | ----------------------------------------------------------- |
| Pool max connections | 10-20             | `DATABASE_POOL_MAX`             | Sufficient for concurrent admin mutations + regular traffic |
| Idle timeout         | 30000ms           | `DATABASE_POOL_IDLE_MS`         | Default; releases idle connections promptly                 |
| Connection timeout   | 2000ms            | `DATABASE_POOL_CONN_TIMEOUT_MS` | Fails fast when pool is exhausted                           |

When the pool is saturated, the health readiness check (`/health/ready`) will return 503 with `database_unavailable`, preventing further traffic from reaching the database.

## Operational Impact

- Audit log writes are non-blocking: if the audit log write fails, the original request is not affected (the middleware catches and logs errors silently).
- Audit log queries should use indexed columns (`action`, `performed_at`) to avoid full table scans.
- Large exports should be performed during low-traffic periods to avoid impacting database performance.

## Related

- [CI/CD incident management](./runbooks/incident-management.md)
- [Stuck payouts incident response](./runbooks/stuck-payouts.md)
- [Observability](./runbooks/observability.md)
- [Backend compliance improvements](./backend-compliance-improvements.md)
- [Backend release ops audit](./BACKEND_RELEASE_OPS_AUDIT.md)
