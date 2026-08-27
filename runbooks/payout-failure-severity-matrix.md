# Production Incident Severity Matrix — Payout Failures

**Purpose**: Define a standardised severity classification for all payout-related production incidents so operators can triage quickly, escalate correctly, and communicate consistently with affected users.

**Owner**: Operations / Backend Engineering  
**Last Updated**: August 27, 2026  
**Status**: ACTIVE — use this matrix for every payout incident  
**Supersedes**: The ad-hoc escalation rules previously embedded in `docs/runbooks/stuck-payouts.md`. That runbook's triage protocol and recovery steps remain authoritative; this document provides the classification layer on top.

---

## 1. Severity Levels

| Level | Name | User Impact | Financial Risk | Response SLA | Resolution SLA | Escalation Path |
|-------|------|-------------|----------------|--------------|----------------|-----------------|
| **P0** | Catastrophic | All users blocked from all payout operations across every project | Potential fund loss, double-spend, or contract state corruption | **5 minutes** | **1 hour** | Incident Commander → Lead Blockchain Eng → Security Officer → CTO |
| **P1** | Critical | Multiple projects affected; payouts stuck or failing for > 15 min | Funds locked on-chain but not disbursed; accounting discrepancy | **15 minutes** | **4 hours** | Incident Commander → Lead Blockchain/Soroban Eng → Operations Lead |
| **P2** | Major | Single project payout failing; RPC degradation with elevated retry rate | Funds delayed but on-chain flow intact | **30 minutes** | **8 hours** | On-call Backend Eng → DevOps / Infrastructure Lead |
| **P3** | Minor | Transient status sync delay; single user reporting pending transaction | None — funds safe in contract or already disbursed | **2 hours** | **24 hours** | Tier 2 Support → Backend Engineer (business hours) |

---

## 2. Trigger Conditions

### P0 — Catastrophic

| # | Trigger | Detection Source |
|---|---------|-----------------|
| 1 | Systemic payout failure across **> 5 projects simultaneously** | Alert: `splitnaira_payouts_failed_total` spike; user reports |
| 2 | Smart contract state corruption — on-chain balance ≠ sum of `get_claimable` for all collaborators | Manual audit; contract state check |
| 3 | Confirmed double-spend or funds sent to wrong addresses | On-chain investigation; Horizon query |
| 4 | Admin private key or `PAYMENTS_ADMIN_API_KEY` compromise | Security alert; audit log `ADMIN_ACCESS_DENIED` spike |
| 5 | Total Soroban RPC outage lasting > 15 minutes | `splitnaira_rpc_retry_outcomes_total{outcome="exhausted"}` > 0 sustained |
| 6 | Contract accounting discrepancy detected (e.g., `total_distributed` out of sync) | Backfill script anomaly; manual check |

### P1 — Critical

| # | Trigger | Detection Source |
|---|---------|-----------------|
| 1 | Single project payout failure **unresolvable by retry** after 3 attempts | Payout retry logs; manual check |
| 2 | RPC degradation causing p99 latency > 10 s or retry rate > 20 % for > 10 min | `splitnaira_rpc_retry_duration_ms_total` spike |
| 3 | Event listener stream disconnected > 30 minutes | `splitnaira_event_listener_ledger_lag` > 100 |
| 4 | Partial distribution failure requiring manual backfill (multi-beneficiary `distribute` reverted after partial transfers) | On-chain event analysis |
| 5 | Database writes for payout records failing (`PayoutHistoryService` errors) | Winston error logs |
| 6 | `pause_distributions` triggered on contract but admin unaware | Contract state query |

### P2 — Major

| # | Trigger | Detection Source |
|---|---------|-----------------|
| 1 | Single project payout delayed > 3 min but < 15 min (possible transient RPC issue) | User report; tx status check |
| 2 | RPC 429 (rate-limit) responses on payout submission | `splitnaira_rpc_retry_outcomes_total{outcome="transient_failure"}` |
| 3 | Backend payout status showing "pending" while Horizon shows `txSUCCESS` (data sync lag < 30 min) | Event listener lag metric |
| 4 | Payout history backfill script needed for isolated historical ledger | Ops request |
| 5 | Elevated `splitnaira_payouts_failed_total` for a single token type | Business metrics dashboard |

### P3 — Minor

| # | Trigger | Detection Source |
|---|---------|-----------------|
| 1 | Transient UI payout status sync delay (< 15 min) | User report |
| 2 | Single user query regarding pending transaction (resolved by Horizon lookup) | Support ticket |
| 3 | Backfill script needed for isolated historical ledger (non-urgent) | Ops request |
| 4 | Minor discrepancy in payout history display (cosmetic, no financial impact) | User report |

---

## 3. Decision Tree

```
Payout failure reported or detected
│
├─ Affecting > 5 projects OR contract corruption OR key compromise?
│  └─ YES → P0 Catastrophic
│
├─ Affecting a single project, unresolvable by retry?
│  └─ YES → P1 Critical
│
├─ RPC degraded / event listener lag / data sync gap?
│  ├─ Duration > 30 min OR retry rate > 20%? → P1 Critical
│  └─ Duration < 30 min? → P2 Major
│
├─ Single delayed payout (< 15 min), likely transient?
│  └─ YES → P2 Major
│
└─ Cosmetic status delay, single user query?
   └─ YES → P3 Minor
```

---

## 4. Response Playbooks by Severity

### P0 Catastrophic — Immediate Actions

1. **Freeze all payout operations immediately**:
   - Set `PAYMENTS_ADMIN_WRITE_ENABLED=false` and restart backend.
   - Invoke `pause_distributions` on the smart contract.
2. **Incident Commander** opens a war room (`#incidents-payments`).
3. **Security Officer** rotates `PAYMENTS_ADMIN_API_KEY` and audits access logs.
4. **Lead Blockchain Eng** inspects contract state for corruption.
5. **External comms**: Status page updated immediately; affected users notified.
6. **Resolution**: Only resume payouts after contract state is verified clean and keys are rotated.

### P1 Critical — Urgent Actions

1. **Disable admin writes** if double-spend risk exists.
2. **Check contract pause status** — if paused by accident, invoke `unpause_distributions`.
3. **Run event backfill** to catch up missed ledger events:
   ```bash
   POST /ops/backfill
   { "fromLedger": <LAST_KNOWN_GOOD_LEDGER> }
   ```
4. **Retry payout** after confirming RPC health and contract state.
5. **Communicate**: Status page updated if delay > 15 min; affected project users notified.

### P2 Major — Investigate & Retry

1. **Check RPC health** (`GET /health/ready` and `splitnaira_rpc_retry_outcomes_total`).
2. **Retry the payout** once RPC is confirmed healthy.
3. **If data sync lag**: Wait for event listener to catch up; do not force-retry on-chain.
4. **Communicate**: Respond to affected user with status update.

### P3 Minor — Business Hours

1. **Acknowledge** the report in the support channel.
2. **Look up transaction** via Horizon or backend endpoint.
3. **Respond** to the user with the transaction status.
4. **Log** for metrics tracking.

---

## 5. Communication Templates

### Internal — Incident Channel (`#incidents-payments`)

```
🔴 [SEVERITY] Payout Incident — [PROJECT_NAME or "System-wide"]
Impact: [DESCRIPTION]
Status: Investigating / Identified / Monitoring / Resolved
TxHash: [IF_APPLICABLE]
CorrelationId: [IF_APPLICABLE]
Next update: [TIME]
```

### External — Status Page (P0/P1)

```
We are investigating a payout processing issue affecting [SCOPE].
Your funds remain safe in the smart contract.
We will provide an update within [TIMEFRAME].
Do not re-submit distribution attempts during this time.
```

### External — Resolution (P0/P1)

```
The payout issue has been resolved. [ROOT_CAUSE_SUMMARY].
All pending payouts will be processed shortly.
If your payout is not reflected within [TIME], please contact support.
```

---

## 6. Escalation Contacts

| Role | Responsibility | When to Escalate |
|------|---------------|------------------|
| Incident Commander | Overall coordination, war room lead | Any P0; P1 not resolved within SLA |
| Lead Blockchain/Soroban Engineer | Contract state investigation, on-chain recovery | P0, P1 involving contract or RPC |
| Security Officer | Key rotation, access audit, forensic analysis | P0 involving key compromise or suspected attack |
| Operations Lead | Infrastructure, deployment, rollback execution | Any P0/P1; P2 not resolved within SLA |
| On-call Backend Engineer | API triage, backend log analysis, retry execution | P1, P2 |
| DevOps / Infrastructure Lead | RPC node health, database, event listener | P1, P2 |
| Tier 2 Support | User-facing triage, status page updates | P2, P3 |

---

## 7. Post-Incident Requirements

| Severity | Postmortem Required? | Timeline | Reviewers |
|----------|---------------------|----------|-----------|
| P0 | Yes — full blameless postmortem | 48 hours | Engineering, Ops, Security |
| P1 | Yes — written incident report | 1 week | Engineering, Ops |
| P2 | Optional — async retro if pattern detected | Next sprint | Engineering |
| P3 | No — logged for metrics | — | — |

---

## 8. Relationship to Other Runbooks

| Document | Relationship |
|----------|-------------|
| `docs/runbooks/stuck-payouts.md` | Triage protocol and recovery steps (operational procedures) |
| `runbooks/rollback-guide.md` | Backend / database / contract rollback procedures |
| `runbooks/failed-payout-incident-checklist.md` | Quick checklist for distribution round failures |
| `runbooks/production-readiness.md` | Pre-deployment verification and operational readiness |
| `docs/metrics-inventory.md` | Metric definitions and alert thresholds |
| `docs/runbooks/observability.md` | Health probes, Prometheus metrics, log correlation |
| `docs/runbooks/incident-management.md` | CI/CD and runtime incident triage procedures |

---

## 9. Monitoring & Alerting Reference

Metrics that feed directly into severity classification:

| Metric | P0 Trigger | P1 Trigger | P2 Trigger |
|--------|-----------|-----------|-----------|
| `splitnaira_payouts_failed_total` | > 0 across > 5 projects in 5 min | > 0 for single project (unresolvable) | Elevated for single token type |
| `splitnaira_rpc_retry_outcomes_total{outcome="exhausted"}` | > 0 sustained 15 min | > 0 for 10 min | — |
| `splitnaira_rpc_retry_duration_ms_total` | Spike > 2x baseline | Increase > 60 s / 15 min | Moderate increase |
| `splitnaira_event_listener_ledger_lag` | — | > 100 for 10 min | > 20 for 5 min |
| `splitnaira_payouts_confirmed_total` | < `initiated` in 15 min (systemic) | < `initiated` in 30 min (single) | — |

---

*This document is part of the Wave 6 ops hardening track. See `docs/runbooks/README.md` for the full runbook index.*
