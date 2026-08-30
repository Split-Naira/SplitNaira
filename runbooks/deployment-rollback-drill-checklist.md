# Deployment Rollback Drill Checklist

Issue #1167. Rollback procedures exist ([Rollback Guide](./rollback-guide.md),
[Ops Deployment & Rollback](../docs/runbooks/ops-deployment-rollback.md)),
but like backups, a rollback procedure that's never been exercised is a
guess, not a plan. This checklist defines a scheduled drill to confirm the
documented rollback steps actually work, on a staging environment, before
they're ever needed for real.

## Cadence

- Run a rollback drill **quarterly**, and after any change to the deploy
  pipeline, contract upgrade mechanism, or the rollback runbooks themselves.
- Align scheduling with the existing
  [database backup restore drill](../runbooks/backup-restore-drill-schedule.md)
  where practical, since both exercise the same staging environment.

## Owner

- On-call backend engineer for the quarter schedules and runs the drill,
  with a second engineer reviewing the evidence — same ownership model as
  the backup restore drill.

## Scope

This drill exercises the **fast/backend rollback path** end-to-end on
staging. It does not require an actual contract redeploy or mainnet
change — see [Out of Scope](#out-of-scope) below for what's covered by
other drills or reviewed separately.

## Procedure

1. **Pick a target release.** Use the current staging deployment as the
   "bad" release to roll back from.
2. **Identify the stable commit.** Confirm the previous known-good commit
   hash per [Rollback Guide §1](./rollback-guide.md#1-backend-service-rollback).
3. **Freeze admin writes.** Set `PAYMENTS_ADMIN_WRITE_ENABLED=false` on
   staging and confirm `/splits/admin/*` writes are rejected with
   `503 payments_admin_writes_disabled`.
4. **Perform the rollback.** Follow the deploy-order steps in
   [Ops Deployment & Rollback §Rollback](../docs/runbooks/ops-deployment-rollback.md#rollback)
   against staging (previous `CONTRACT_ID`/env values, redeploy backend and
   frontend).
5. **Run smoke tests.** `GET /health` returns 200; `GET /ops/mainnet-readiness`
   reflects the rolled-back environment; UI can connect a wallet and list
   projects.
6. **Re-enable admin writes** once the rollback is confirmed healthy, and
   verify a write succeeds again.
7. **Time the drill.** Record how long steps 2–6 took — this is the number
   that matters most if a real incident happens.

## Out of Scope

- Actual contract `upgrade`/`pause_distributions` calls — these mutate
  on-chain state and aren't exercised in a routine drill. Reviewed
  separately alongside contract upgrade governance
  ([ADR template](../docs/adr/0001-contract-upgrade-decision-record.md)).
- Point-in-time database recovery — covered by the
  [backup restore drill](../runbooks/backup-restore-drill-schedule.md), not
  duplicated here.

## Success Criteria

- [ ] Stable commit identified without needing to search past 5 minutes.
- [ ] Admin writes correctly frozen and later correctly re-enabled.
- [ ] Rollback completes and `/health` + `/ops/mainnet-readiness` both pass.
- [ ] Smoke tests (wallet connect, list projects) pass on the rolled-back
      environment.
- [ ] Total drill time recorded and within an acceptable window (target:
      under 15 minutes for the fast path).

## Evidence Capture

- [ ] Record drill date, duration, engineer, and pass/fail, using the same
      tracking location as the backup restore drill
      (`docs/audit-log-retention.md`'s linked tracking sheet, or attach
      output logs to the drill ticket).
- [ ] If any step took longer than expected or failed, open a follow-up
      issue referencing this checklist and the specific step.

## Related

- [Rollback Guide](./rollback-guide.md)
- [Ops Deployment & Rollback Runbook](../docs/runbooks/ops-deployment-rollback.md)
- [Database Backup Restore Drill Schedule](./backup-restore-drill-schedule.md)
- [Stuck Payouts Incident Response](../docs/runbooks/stuck-payouts.md)
