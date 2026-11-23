# Ledger Transaction Finality Policy

Issue #1478. Code: [`backend/src/services/ledger-finality.ts`](../backend/src/services/ledger-finality.ts).
Tests: [`backend/src/__tests__/ledger-finality.test.ts`](../backend/src/__tests__/ledger-finality.test.ts).

## Confirmation assumptions

Stellar closes ledgers with the Stellar Consensus Protocol (SCP). Once the ledger
that contains a transaction closes, the transaction's result is **final**: SCP
does not reorganize closed ledgers, so there is no probabilistic "wait N blocks"
like on proof-of-work chains. Ledgers close roughly every 5–6 seconds.

The backend still applies a per-network policy, for operational reasons:

| Network    | Passphrase                                       | `confirmationDepth` | `submissionTimeoutLedgers` | Resets possible           |
| ---------- | ------------------------------------------------ | ------------------- | -------------------------- | ------------------------- |
| mainnet    | `Public Global Stellar Network ; September 2015` | 1                   | 120 (~10 min)              | No                        |
| testnet    | `Test SDF Network ; September 2015`              | 0                   | 120                        | Yes (periodic SDF resets) |
| futurenet  | `Test SDF Future Network ; October 2022`         | 0                   | 120                        | Yes (frequent)            |
| standalone | `Standalone Network ; February 2017`             | 0                   | 60                         | Yes (local container)     |

- **`confirmationDepth`** is the number of ledgers that must close _after_ the
  inclusion ledger before the backend books the transaction as `completed`. On
  mainnet we require 1. That isn't for consensus safety. It makes sure the
  load-balanced RPC we read from, and the event listener that writes
  `transactions` and `ledger_blocks`, have both moved past the inclusion ledger
  before money is reported as settled.
- **`submissionTimeoutLedgers`** is how long a transaction with no known ledger
  or time bound may stay unseen before it is treated as `expired`. Submitters
  should set a ledger bound or time bound no longer than this window. When
  `validUntilLedger` is known, it takes precedence over the default window,
  because after that ledger closes the transaction can never be applied.
- **Resets.** On testnet, futurenet and standalone, "final" only holds until the
  next network reset. Never treat testnet settlement as evidence for mainnet
  accounting.

Policies resolve from `SOROBAN_NETWORK_PASSPHRASE` by **exact** match.
`getFinalityPolicy` fails closed with `unknown_network` for any other value, so
a typo cannot quietly inherit testnet's lax settings. Policies are frozen at
runtime.

## State machine

```
submitted ──► included ──► final        (terminal, → completed)
    │
    ├──► final                          (depth already reached)
    ├──► failed                         (terminal, on-ledger failure → failed)
    └──► expired                        (terminal, never landed → failed)
```

Only `final` maps to `TransactionStatus = "completed"`. `included` and
`submitted` stay `pending`.

### Transition rules

- **Monotonic.** A lagging RPC node can return `NOT_FOUND` for a transaction we
  already saw included, or report a lower `latestLedger`. These reads never move
  a record backwards. `evaluateFinality` keeps the previous state and sets
  `regressionIgnored: true`.
- **Depth is never negative.** If the node's `latestLedger` is behind the
  inclusion ledger, depth is clamped to 0, so an inconsistent node cannot
  fast-track finality.
- **Conflicts escalate.** An observation that contradicts a terminal state
  throws `finality_conflict`, and the record is left unchanged. Examples: a
  `final` transaction later reported `FAILED`, or an `expired` transaction
  that later lands. Treat this as an incident: see
  [orphaned-transaction-remediation.md](./orphaned-transaction-remediation.md)
  and [runbooks/stuck-payouts.md](./runbooks/stuck-payouts.md).
- Malformed observations (missing, zero, fractional or negative ledger numbers)
  throw `invalid_observation`.

## Operator notes

- Distribution submissions are also kept in `transaction_attempts`, separately
  from confirmed payout history. The client registers the hash, project, source
  wallet and configured network as soon as Soroban accepts the submission.
  `GET /transactions/recovery/attempts/:txHash` reconciles that record against
  Soroban RPC and stores the last check, terminal failure code and failure
  ledger. RPC errors and `NOT_FOUND` results inside the transaction validity
  window remain pending; after the 300-second transaction window plus a
  60-second margin, a still-missing transaction is marked expired/failed.
- A confirmed attempt remains completed even if a later read reports a
  conflicting failure. A failed or expired attempt can be retried only by
  building and signing a fresh transaction; the failed signed envelope is never
  reused. Check the recovery endpoint before retrying an unconfirmed payout.
- Every payout attempt status change is written to `audit_log` with
  `action = payout_attempt_transition` (#1643), in the same database
  transaction as the status update. If the audit row can't be written, the
  status change is rolled back, so the trail can't miss a transition. Each row
  stores:
  - `request_id`: the request's correlation id (`x-request-id` /
    `x-correlation-id`). Outside a request, a generated UUID is used.
  - `actor` (`system:payout-recovery` unless a principal is supplied) and
    `ip_hash` (`system` outside a request).
  - `payload`: `attemptId`, `txHash`, `projectId`, `previousStatus`,
    `nextStatus`, `previousFailureCode`, `failureCode`, `failureLedger`, the
    RPC `observation` (`status`, `ledger`) and `occurredAt` (epoch ms).

  Registration writes the first row (`previousStatus: null`, `nextStatus:
pending`). Re-registering a hash and still-pending checks write no row.
  Allowed transitions are `pending -> failed | completed` and
  `failed -> completed`. `completed` is terminal. Updates are guarded on the
  status that was read, so `previousStatus` is always the state actually
  overwritten, and a concurrent writer's change is never reverted.
  `verifyPayoutAuditTrail(rows, currentStatus)` in
  `backend/src/services/transaction-recovery.ts` checks that a hash's rows,
  oldest first, form an unbroken chain from registration to the current
  status. To pull one attempt's trail:

  ```sql
  SELECT request_id, performed_at, payload
  FROM audit_log
  WHERE action = 'payout_attempt_transition'
    AND payload->>'txHash' = '<hash>'
  ORDER BY performed_at;
  ```

- To change a policy value, edit `FINALITY_POLICIES` and update the table above
  in the same PR. The tests assert that mainnet stays at least as strict as
  every resettable network.
- After a testnet or futurenet reset, records that were `final` on the old
  network still read `completed`, and new lookups for them return `NOT_FOUND`
  (ignored as a lagging read). Clear testnet data after a reset, not mainnet.
- Validation: `npm test -- ledger-finality` (no network access required).
