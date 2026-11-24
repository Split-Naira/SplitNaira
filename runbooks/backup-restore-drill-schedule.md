
# Database Backup and Restore Drill Schedule

**Issue:** #1075

Backups must be regularly tested through restore drills to verify
recoverability and ensure that database backups remain usable when
needed.

## 1. Drill Cadence

- Conduct a restore drill **quarterly**.
- Perform an additional drill after any change to the backup
  configuration or database version.

## 2. Ownership and Responsibilities

- The on-call backend engineer for the quarter is responsible for
  scheduling and executing the restore drill.
- A second engineer must review the drill results and supporting
  evidence.

## 3. Restore Drill Procedure

1. Provision a scratch PostgreSQL instance isolated from production.
2. Restore the most recent automated backup into the scratch instance.
3. Run `npm run verify:data-integrity` against the restored database.
4. Compare row counts for the `splits`, `payouts`, and `users` tables
   against production, accounting for expected data changes since
   the backup was taken.

## 4. Success Criteria

The restore drill is considered successful when all the following
conditions are met:

- [ ] The backup restores successfully without errors.
- [ ] The data integrity verification completes successfully.
- [ ] Row counts for `splits`, `payouts`, and `users` match production,
      allowing for expected drift caused by writes occurring after
      the backup was created.

## 5. Evidence and Audit Trail

For every restore drill, record the following information:

- [ ] Drill date.
- [ ] Restore duration.
- [ ] Executing engineer.
- [ ] Pass/fail result.
- [ ] Supporting verification output and restore logs.

Store the drill record in the tracking sheet linked from
`docs/audit-log-retention.md`, or attach the supporting output logs
to the corresponding drill ticket.
