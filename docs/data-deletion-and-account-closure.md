# Data Deletion and Account Closure Process (#907)

> **Issue:** #907
> **Track:** Stellar Wave
> **Status:** Complete

## Purpose

This document defines how SplitNaira handles a user's request to close their
account or delete their data. It covers request intake, identity
verification, exactly what can be deleted versus what must be retained or
anonymized, and how that interacts with financial/audit records and on-chain
data.

There is currently no self-service deletion endpoint in the product. This
document describes the manual support process a platform admin follows today,
and is written so it can be turned directly into an automated flow later
without changing the underlying data-handling decisions.

## Scope: What Data SplitNaira Actually Holds

Before deciding what to delete, it's worth being precise about what user data
exists in this system, since it's deliberately minimal:

| Table                                                           | Data                                                                                        | PII?                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `users` (`User` entity)                                         | `walletAddress`, optional `email`, optional `alias`, `role`, `isActive`                     | Yes — email and alias are direct identifiers; walletAddress is a pseudonymous but potentially linkable identifier  |
| `audit_log` (`AuditLog` entity)                                 | `action`, `performed_at`, `ip_hash` (SHA-256, truncated), `request_id`, `payload` (JSONB)   | Limited — IP is already hashed, but `payload` may contain a wallet address or email depending on the action logged |
| `transactions` (`TransactionRecord` entity)                     | `roundId`, `recipient` (wallet address), `amount`, `token`, `timestamp`, `txHash`, `status` | Limited — wallet address only, no name/email                                                                       |
| Stellar/Soroban on-chain state (`SplitProject`, `Collaborator`) | Owner address, collaborator addresses + aliases + basis points                              | Limited — wallet addresses and aliases, no email                                                                   |

Notably: **`transactions` has no foreign key to `users`** — it's keyed
entirely on `recipient` (a wallet address string), not a user ID. This means
transaction history is not directly "owned" by a user row in the relational
sense, which matters a lot for what "delete this user" can and cannot mean
(see [What Can Be Deleted, Anonymized, or Retained](#what-can-be-deleted-anonymized-or-retained) below).

There is no separate KYC data store in this codebase today.

## Request Intake and Identity Verification

### Intake

1. The user submits a deletion/closure request. Until a self-service
   endpoint exists, this arrives via a support channel (email or in-app
   contact) rather than an API call.
2. Support opens a ticket and records: the wallet address the request claims
   to belong to, the requested action (full deletion vs. anonymization vs.
   deactivation — see below), and the date received.

### Identity Verification

SplitNaira has no password-based login — accounts are identified by Stellar
wallet address, and the existing JWT auth flow already treats a valid wallet
signature as the sole proof of user intent (see
[wallet-signing-threat-model.md](./wallet-signing-threat-model.md)).
Deletion requests should be verified the same way, not via email confirmation
alone (email is optional and unverified at registration — see
`userRegistrationSchema` in
[`backend/src/routes/users.ts`](../backend/src/routes/users.ts)):

1. Ask the requester to sign a short, purpose-specific message (e.g.
   `"I am requesting deletion of my SplitNaira account as of <date>"`) with
   the private key for the wallet address on the request.
2. Verify the signature server-side against that wallet's public key before
   proceeding. Support must not action a request based on an email address
   alone, since email is optional and never verified at registration time.
3. If the requester can't produce a valid signature (lost wallet access),
   escalate to manual review — do not delete data on an unverified request.

## What Can Be Deleted, Anonymized, or Retained

| Data                                                            | Action                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.email`                                                   | **Delete**                                                                                     | Optional field, not required for the account to function once removed.                                                                                                                                                                                                                                                                                                                                                                              |
| `users.alias`                                                   | **Delete**                                                                                     | Display-only convenience field.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `users.walletAddress`                                           | **Anonymize** (replace with a tombstone value, e.g. `deleted-user-<id>`), not deleted outright | The column is `unique`; the row itself may need to remain if it's referenced elsewhere (currently it isn't via FK — see note below), and the account's existence needs to remain auditable.                                                                                                                                                                                                                                                         |
| `users.isActive`                                                | **Set to `false`**                                                                             | Marks the account closed without removing the row, preserving `createdAt`/`updatedAt` for audit purposes.                                                                                                                                                                                                                                                                                                                                           |
| `audit_log.payload` entries mentioning the user                 | **Retain, do not delete**                                                                      | Audit logs are compliance records — see [audit-log-retention.md](./audit-log-retention.md), 2-year retention already defined. If a payload contains the user's raw wallet address or email, this is retained as part of that policy; it is not carved out early.                                                                                                                                                                                    |
| `transactions` rows where `recipient` matches the user's wallet | **Retain, do not delete**                                                                      | These are financial records of completed or pending on-chain payouts. Deleting them would corrupt the accounting/reconciliation trail and the `txHash` is independently verifiable on-chain regardless of what the database says — deleting the local row doesn't remove the underlying record.                                                                                                                                                     |
| Stellar/Soroban on-chain project and collaborator data          | **Cannot be deleted or modified**                                                              | This is immutable ledger state controlled by the smart contract, not the backend. An account closure request has no effect on it. If the user is a collaborator on an active split, their wallet address remains as a collaborator on-chain until the project owner removes/replaces them via the contract's own collaborator-management functions (subject to the project's lock state) — this is outside the backend's deletion process entirely. |

### Summary

- **Directly identifying, optional fields** (email, alias) are deleted outright.
- **The account row itself** is anonymized and deactivated, not hard-deleted, because deletion must not silently corrupt the meaning of retained audit/financial records that still reference the same wallet address.
- **Financial and audit records** are retained per existing retention policy, regardless of the deletion request.
- **On-chain data** is out of scope entirely — the backend cannot delete or alter it.

## Database Tables and Audit Log Considerations

- **`users`**: anonymize `email`/`alias` to `NULL`, set `walletAddress` to a
  tombstone value, set `isActive = false`. Do not `DELETE` the row — a hard
  delete would free the `walletAddress` unique constraint for reuse, which
  could let a different person register under a previously-closed account's
  identity, and would break the ability to explain historical `audit_log` or
  `transactions` rows that reference that same wallet address.
- **`audit_log`**: no special handling — the deletion request itself should
  be logged as a new `audit_log` row (`action: "account_closure_requested"`),
  and existing entries follow the standard 2-year retention regardless of
  the account's status.
- **`transactions`**: no changes. Since there's no FK to `users`, closing an
  account has no cascading effect here by construction — this is intentional,
  not an oversight, and should stay that way.

## Support Runbook

1. Receive and log the request (wallet address, requested action, date).
2. Verify identity via wallet-signature challenge (see above). Do not
   proceed without a valid signature.
3. Run the anonymization update against the `users` table for that wallet
   address (email → `NULL`, alias → `NULL`, walletAddress → tombstone,
   isActive → `false`).
4. Log an `audit_log` entry recording the closure action, `performed_at`,
   and the request's `request_id` for traceability.
5. Reply to the requester confirming: which fields were removed, which
   records were retained and why (link this document), and that on-chain
   collaborator/project data is outside the backend's control.
6. Close the support ticket, referencing the `audit_log` row id.

## Related

- [Backend audit log retention policy](./audit-log-retention.md)
- [Wallet signing threat model](./wallet-signing-threat-model.md)
- [Backend compliance improvements](./backend-compliance-improvements.md)
- [Backend release ops audit](./BACKEND_RELEASE_OPS_AUDIT.md)
