# Database Indexes for Frequent Queries (Issue #1334)

This document outlines the indexes added to improve the performance of frequent queries within the project and compares their expected query plans.

## 1. User Email Lookup
**Entity:** `User`
**Column:** `email`
**Index Name:** `IDX_users_email`

### Query Pattern
When authenticating via email, the system frequently queries the user by email:
```typescript
userRepository.findOne({ where: { email } })
```

### Query Plan Comparison
*   **Before:** `Seq Scan` on `users`. The database must scan every row in the `users` table to find the matching email, resulting in O(N) time complexity.
*   **After:** `Index Scan` on `IDX_users_email`. The database uses the B-Tree index to look up the email directly, improving performance to O(log N).

## 2. Transaction Recipient and Timestamp Sorting
**Entity:** `TransactionRecord`
**Columns:** `recipient`, `timestamp`
**Index Name:** `IDX_transactions_recipient_timestamp`

### Query Pattern
The payout history service frequently fetches transactions for a specific recipient, ordered by timestamp in descending order:
```typescript
query.andWhere("transaction.recipient = :recipient")
     .orderBy("transaction.timestamp", "DESC")
```

### Query Plan Comparison
*   **Before:** `Index Scan` on `IDX_transactions_recipient` followed by a `Sort` operation on `timestamp`. While filtering by recipient was fast, sorting the resulting rows required an in-memory sort or disk spill.
*   **After:** `Index Scan` on `IDX_transactions_recipient_timestamp`. The composite index stores rows already sorted by `timestamp` for each `recipient`. The query can traverse the index backwards and read the ordered results directly, avoiding the expensive sort step entirely.

## 3. Ledger Block Project Id Lookup
**Entity:** `LedgerBlock`
**Column:** `projectId`
**Index Name:** `IDX_ledger_blocks_project_id`

### Query Pattern
During history processing and event log scanning, ledger blocks associated with a specific project are queried.

### Query Plan Comparison
*   **Before:** `Seq Scan` on `ledger_blocks`. To find blocks for a project, the database must scan the entire ledger history.
*   **After:** `Index Scan` on `IDX_ledger_blocks_project_id`. The database can quickly pinpoint the exact blocks relevant to a project.
