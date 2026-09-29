# Immutable financial event records

Issue #1339. The `transactions` table stores confirmed on-chain payment events
and is append-only.

| Column | Rule |
| --- | --- |
| `id`, `txHash` | Immutable (identity and on-chain reference) |
| `roundId`, `recipient`, `amount`, `token` | Immutable (what was paid, to whom) |
| `timestamp` | Immutable (original ledger close time) |
| `status` | Mutable: `pending` -> `completed` / `failed` |
| whole row | Cannot be deleted |

## Enforcement

Migration `1760000000008-AddImmutableTransactionRecords` adds the trigger
`trg_transactions_immutable`. It runs before every UPDATE or DELETE and raises
`integrity_constraint_violation` when a protected column changes or a row is
deleted. Updates that leave protected columns unchanged (such as the event
listener's `upsert` of an identical row) are allowed.

## Limits

- The table owner or a superuser can disable the trigger. Production
  applications should connect with a role that does not own the table.
- `TRUNCATE` does not fire row-level triggers.

## Tests

`backend/src/__tests__/transactions-immutability.test.ts` runs against a
migrated Postgres (`DATABASE_URL`).