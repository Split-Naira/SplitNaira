# Database Backup Restore Drill Schedule

Issue #1075. Backups exist, but restores must be drilled regularly to
confirm they actually work.

## Cadence
- Run a restore drill **quarterly**, and after any change to the backup
  configuration or database version.

## Owner
- On-call backend engineer for the quarter schedules and runs the drill,
  with a second engineer reviewing the evidence.

## Procedure
1. Provision a scratch Postgres instance (not production).
2. Restore the most recent automated backup into it.
3. Run `npm run verify:data-integrity` against the restored instance.
4. Spot-check row counts on `splits`, `payouts`, and `users` against
   production.

## Success criteria
- [ ] Restore completes without error.
- [ ] Data integrity check passes.
- [ ] Row counts match production within expected drift (pending writes
      since the backup was taken).

## Evidence capture
- [ ] Record drill date, duration, engineer, and pass/fail in
      `docs/audit-log-retention.md`'s linked tracking sheet (or attach
      output logs to the drill ticket).
