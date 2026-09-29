# Foreign-key integrity audit

Issue #1336. Audited against the migrations in `backend/src/migrations` and the
entities in `backend/src/entities`.

## Result

No database foreign key exists today, and none can be added safely. Every
reference-like column points at on-chain state or at a wallet address, neither
of which has a local parent table.

## Relationships

| Column | Refers to | Decision |
| --- | --- | --- |
| `transactions.roundId`, `split_cancellations.projectId` | On-chain project (Soroban contract). No local projects table. | Not a foreign key: no parent table. |
| `transactions.recipient` | Wallet address. Recipients are not required to be registered users. | Not a foreign key (see below). |
| `notifications.recipient`, `notification_preferences.wallet` | Wallet address, created from ledger events for wallets that may never register. | Not a foreign key (see below). |
| `split_cancellations.cancelledBy` | Wallet of the on-chain project owner. | Not a foreign key. |
| `notifications.resourceId` (with `resourceType`) | A resource whose type varies per row. | Not a foreign key: polymorphic. |
| `transactions.txHash` and `ledger_blocks.txHash` | Same on-chain transaction, recorded in two places. | Not a foreign key: `ledger_blocks` has no migration, and `check-orphaned-transactions.ts` reports drift. |

### Why wallet columns must not reference `users`

The event listener saves a whole batch of transactions and the polling cursor in
a single database transaction. A foreign key to `users` would reject payouts to
unregistered wallets, roll back the batch and the cursor, and stall indexing on
the same events indefinitely. `backend/src/scripts/check-orphaned-transactions.ts`
already treats unregistered recipients as expected.

## What the database enforces instead

| Table | Constraint |
| --- | --- |
| `transactions` | unique `txHash` |
| `split_cancellations` | unique `projectId` (one cancellation per split) |
| `notifications` | unique `(recipient, eventKey)` |
| `notification_preferences` | unique `(wallet, category)` |
| `users` | unique `walletAddress` |
| every table | primary key |

## Known gap

`ledger_blocks` has an entity but no migration, so the table does not exist on a
migrated database. See `docs/orphaned-transaction-remediation.md`. Out of scope
for this audit.

## Migration handling for a future foreign key

1. Count orphans first:
```sql
   SELECT count(*) FROM child c
   WHERE c."parentId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM parent p WHERE p.id = c."parentId");
```
2. If the count is not zero, do not ship the constraint. Remediate the data first.
3. Add the constraint in two steps to avoid a long lock: `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE CONSTRAINT` in a separate migration.
4. Historical financial records are never cascaded away. Use `ON DELETE RESTRICT`.
5. Give the migration a `down()` that drops the constraint.
6. Record the constraint in `DOCUMENTED_FOREIGN_KEYS` in
   `backend/src/__tests__/foreign-key-integrity.test.ts` and in this document.

## Re-running the audit

```sql
-- Existing foreign keys
SELECT conrelid::regclass AS "table", conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace;

-- Reference-like columns
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name <> 'migrations'
  AND column_name ~* '(id|hash|wallet|recipient|address|by)$';
```

## Tests

`backend/src/__tests__/foreign-key-integrity.test.ts` runs against a migrated
Postgres. It fails if an undocumented foreign key appears, checks every table has
a primary key, confirms wallet and on-chain references stay unconstrained, and
checks the unique constraints above.