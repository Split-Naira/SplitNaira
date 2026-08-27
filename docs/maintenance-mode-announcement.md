# Maintenance Mode Announcement Workflow

**Purpose**: Standardise how SplitNaira announces, manages, and resolves planned and unplanned maintenance windows. This workflow provides a single GitHub Actions entry point that updates a status file, notifies stakeholders, and produces an audit trail.

**Owner**: Operations / Platform Engineering  
**Last Updated**: August 27, 2026  
**Workflow**: `.github/workflows/maintenance-mode.yml`

---

## Overview

The maintenance-mode workflow automates three operations:

| Action | What It Does | When to Use |
|--------|-------------|-------------|
| **start** | Creates `docs/MAINTENANCE_STATUS.md` with live maintenance banner, notifies Slack | Beginning of a maintenance window |
| **schedule** | Same as `start` but accepts a future start time for pre-announced maintenance | Planning ahead — the workflow still runs immediately to create the status file and notify |
| **end** | Updates `docs/MAINTENANCE_STATUS.md` to "Operational", notifies Slack | Concluding a maintenance window |

---

## Prerequisites

### Required Secrets

| Secret | Purpose | Required? |
|--------|---------|-----------|
| `SLACK_STATUS_WEBHOOK_URL` | Slack incoming webhook for `#status` channel | Optional — workflow skips notification if absent |

### Required Permissions

The workflow uses `contents: write` to commit the maintenance status file. This works with the default `GITHUB_TOKEN` on repositories where the workflow has write access to `docs/`.

---

## Usage

### Triggering from the GitHub UI

1. Go to **Actions → Maintenance Mode → Run workflow**
2. Select the action: `start`, `end`, or `schedule`
3. Fill in the optional fields:
   - **Announcement message**: User-facing description of what's happening
   - **Estimated duration**: How long maintenance is expected to last
   - **Schedule start** (schedule only): ISO 8601 timestamp for future maintenance
   - **Notify Slack**: Toggle Slack notification
4. Click **Run workflow**

### Triggering from the CLI

```bash
# Start maintenance
gh workflow run maintenance-mode.yml \
  -f action=start \
  -f announcement_message="Database migration in progress" \
  -f estimated_duration="45 minutes"

# End maintenance
gh workflow run maintenance-mode.yml \
  -f action=end

# Schedule future maintenance
gh workflow run maintenance-mode.yml \
  -f action=schedule \
  -f schedule_start="2026-09-01T02:00:00Z" \
  -f estimated_duration="2 hours"
```

---

## Operational Procedure

### Starting Maintenance

1. **Trigger the workflow** with action `start`
2. **Freeze backend payout writes**:
   ```bash
   # On the backend service, set:
   PAYMENTS_ADMIN_WRITE_ENABLED=false
   ```
   Restart or redeploy the backend with this environment variable.
3. **Optionally pause on-chain distributions** (for maintenance affecting the Soroban contract):
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network <NETWORK> \
     -- pause_distributions \
     --admin <ADMIN_ADDRESS>
   ```
4. **Verify** that payout endpoints return `503 payments_admin_writes_disabled`
5. **Monitor** the `#incidents-payments` channel for user reports

### Ending Maintenance

1. **Restore backend payout writes**:
   ```bash
   PAYMENTS_ADMIN_WRITE_ENABLED=true
   ```
   Restart or redeploy the backend.
2. **Unpause on-chain distributions** (if paused):
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network <NETWORK> \
     -- unpause_distributions \
     --admin <ADMIN_ADDRESS>
   ```
3. **Verify** readiness:
   ```bash
   curl -s https://api.splitnaira.com/health/ready | jq .
   # Should return 200 with status "ok"
   ```
4. **Trigger the workflow** with action `end`
5. **Monitor** payout metrics for 30 minutes post-maintenance

---

## What Gets Created

### `docs/MAINTENANCE_STATUS.md`

This file is committed and pushed to the repository during maintenance. It serves as:

- A **single source of truth** for current maintenance status
- A **readable banner** for anyone browsing the repository
- An **audit trail** of when maintenance started and ended

### Slack Notification

If `SLACK_STATUS_WEBHOOK_URL` is configured, a rich Slack message is posted to the `#status` channel with:

- Status header (🟡 Maintenance / ✅ Complete)
- Duration, message, and who triggered it
- Link to the workflow run for audit

### Workflow Summary

The GitHub Actions run page includes a formatted summary table with all inputs and next-step guidance.

---

## Environment Variable Reference

| Variable | Value During Maintenance | Purpose |
|----------|------------------------|---------|
| `PAYMENTS_ADMIN_WRITE_ENABLED` | `false` → `true` | Freeze/restore backend admin payout routes |
| Contract pause state | `paused` → `unpaused` | Freeze/restore on-chain distributions |

---

## Incident vs. Maintenance

| Aspect | Maintenance Mode | Incident (Payout Failure) |
|--------|-----------------|--------------------------|
| **Trigger** | Planned or announced | Unexpected detection |
| **Workflow** | `maintenance-mode.yml` | `payout-failure-severity-matrix.md` |
| **Communication** | Pre-announced, expected | Reactive, urgent |
| **Duration** | Known window | Unknown until resolved |
| **Status file** | `docs/MAINTENANCE_STATUS.md` | Incident channel + status page |

For unplanned payout failures, use the severity matrix in `runbooks/payout-failure-severity-matrix.md` and the triage protocol in `docs/runbooks/stuck-payouts.md`.

---

## Troubleshooting

### Workflow fails to commit

Ensure the workflow has `contents: write` permission. If using a custom PAT, verify it has repo write access.

### Slack notification not sent

Check that `SLACK_STATUS_WEBHOOK_URL` is set as a repository secret. The webhook URL can be obtained from the Slack app settings for the `#status` channel.

### Maintenance status file not updated

The workflow commits directly to the current branch. If branch protection is enabled, the push may be blocked. Consider using a service account PAT or adjusting protection rules for bot commits.

---

## Related Documents

- `runbooks/payout-failure-severity-matrix.md` — Severity classification for payout incidents
- `docs/runbooks/stuck-payouts.md` — Triage protocol for stuck/delayed payouts
- `runbooks/rollback-guide.md` — Backend and contract rollback procedures
- `runbooks/production-readiness.md` — Pre-deployment verification checklist
- `docs/PLATFORM_HARDENING_DEPLOYMENT_CHECKLIST.md` — Deployment safety checklist

---

*This document is part of the Wave 6 ops hardening track.*
