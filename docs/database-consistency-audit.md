# Database Consistency Audit Command (#1338)

> **Issue:** #1338
> **Area:** Backend database integrity
> **Script:** `backend/src/scripts/audit-database-consistency.ts`

## Purpose

A single command that checks the relational invariants this backend relies
on, prints a readable summary, can also emit a machine-readable JSON report,
and exits non-zero when it finds a critical discrepancy — suitable for a
cron job or a CI step.

As with the existing orphaned-transaction check (#937, see
`docs/orphaned-transaction-remediation.md`), this schema has **no real
foreign keys** — grepping `backend/src/entities/` still turns up no
`@ManyToOne`/`@JoinColumn` anywhere. So "relational invariant" here covers:

1. **Cross-table reconciliation** — reused, not reimplemented, from the
   existing `checkOrphanedTransactions()` (#937): completed `transactions`
   vs. `ledger_blocks` settlement rows.
2. **Uniqueness invariants** the app already depends on elsewhere, re-checked
   independently of whatever database constraint currently backs them (a
   constraint can be missing on a partially migrated database, or bypassed
   by a manual/raw write):
   - `users.walletAddress`
   - `transactions.txHash`
   - `notifications.eventKey` (breaks the delivery-idempotency guarantee
     documented in `entities/Notification.ts` if duplicated)
   - `notification_preferences` (`wallet`, `category`) pairs
   - `split_cancellations.projectId` ("a split can only be cancelled once")
3. **A schema-specific business rule**: `entities/NotificationPreference.ts`
   states that `security` and `payment` preferences "must never be silenced".
   The audit flags any row that violates that directly.

## Why reuse `checkOrphanedTransactions()` instead of writing a new check

That function is already implemented, tested (#937), and documents at length
why `transactions` vs `ledger_blocks` is the only real cross-table
reconciliation possible in this schema. Reimplementing it here would drift
out of sync with the original the next time either changes. This command
imports it, translates its report into the shared `ConsistencyFinding` shape,
and adds the checks #937 did not cover.

## Report shape

```ts
interface ConsistencyFinding {
  checkId: string; // e.g. "duplicate-wallet-address"
  severity: "critical" | "warning";
  message: string;
  count?: number;
  sampleIds?: string[]; // max 5, wallet-derived samples are masked
}

interface ConsistencyAuditReport {
  generatedAt: string; // ISO timestamp
  checksRun: string[];
  findings: ConsistencyFinding[];
  ok: boolean; // false iff any finding has severity "critical"
}
```

`severity` distinguishes things that indicate broken data (`critical`) from
things that are expected/informational under normal operation (`warning`,
e.g. a payout recipient who isn't a registered user — recipients are never
required to be registered, per #937). Only `critical` findings affect the
exit code and `ok`.

## Running the audit

```bash
cd backend
DATABASE_URL=postgresql://user:password@localhost:5432/splitnaira \
  HORIZON_URL=https://horizon-testnet.stellar.org \
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  CONTRACT_ID=<your-contract-id> \
  SIMULATOR_ACCOUNT=<your-simulator-account> \
  npx tsx src/scripts/audit-database-consistency.ts
```

Add `--json` to get a single JSON document on stdout instead of the
human-readable log lines (for piping into another tool or attaching to an
alert):

```bash
npx tsx src/scripts/audit-database-consistency.ts --json
```

Exit code is `1` if any finding has severity `critical`, `0` otherwise
(warnings alone do not fail the run). A database connection failure also
exits `1`, with the error message passed through the same connection-string
scrubbing as #937 (`sanitizeErrorMessage`), so `DATABASE_URL` credentials
never reach the logs.

## Wallet address masking

Any wallet-derived value in a finding's `sampleIds` is masked with the same
first-6/last-4 convention as #937 (`maskWalletAddress`, e.g.
`GA1111...AAAA`). Structural identifiers that aren't secrets — `txHash`,
`eventKey`, `projectId` — are shown in full.

## Automated test coverage

`backend/src/scripts/audit-database-consistency.test.ts` exercises
`runDatabaseConsistencyAudit()` against a **mocked** `DataSource` (the same
per-entity mocked-`find()` style as `check-orphaned-transactions.test.ts`),
so it runs in normal `npm run test` / CI without needing a live database. It
covers: a fully consistent fixture (no findings), each duplicate check
firing independently, the mandatory-preference rule (and that it does *not*
fire for an optional category), a propagated critical finding from the
reused orphaned-transaction check, and that a warning-only finding (an
unregistered recipient) does not flip `ok` to `false`.

## On database constraints

No new database constraint or migration is added here, deliberately: every
uniqueness case above is already backed by a unique index (see the relevant
`@Index(..., { unique: true })` in each entity). This command is a
**defensive, independent re-check** of those invariants — useful precisely
because it doesn't rely on the same constraint it's verifying still being in
place (e.g. after a partial migration run, or a write that bypassed the ORM).

## Related

- [Orphaned Transaction Record Remediation](./orphaned-transaction-remediation.md)
  (#937) — the reconciliation logic this command reuses.