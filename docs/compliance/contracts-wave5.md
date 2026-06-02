# Contracts Compliance - Wave 5

## Objective
Deliver production-grade Soroban smart contract compliance improvements for SplitNaira, with a focus on Wallet & Payments.

## Implementation Plan

### 1. Wallet & Payments Contract Surface
- `deposit` validates token transfers, rejects invalid amounts, and publishes `deposit_received`
- `distribute` preserves exact payout accounting, handles integer rounding safely, and emits `payment_sent`
- `claim` supports pull-based collaborator self-service claims while updating claimed ledgers and total distributed amounts
- `pause_distributions` and `unpause_distributions` provide an emergency stop for payout flows
- `withdraw_unallocated` enables admin recovery of stray direct-token transfers without touching project-accounted balances

### 2. Allowlist & Recovery
- Allowlist remains optional until token approval is configured
- Once configured, `allow_token` / `disallow_token` enforce token eligibility for project creation
- `get_unallocated_balance` computes contract holdings minus account-level project balances
- `withdraw_unallocated` rejects contract-self transfers and prevents over-withdrawal

### 2.5 Analytics & Insights
- The contract exposes on-chain analytics signals through stable read-only query methods and event topics.
- Analytics workflows should consume contract events such as:
  - `project_created`
  - `deposit_received`
  - `payment_sent`
  - `distribution_complete`
  - `collaborator_claimed`
  - `project_locked`
- Read-only methods like `get_project_count`, `get_project_ids`, `list_projects`, `get_balance`, `get_claimable`, and `get_unallocated_balance` provide an analytics-friendly query surface.
- Event schema stability is enforced by contract tests, protecting Analytics & Insights consumers from breaking changes.

### 2.6 Platform Hardening
- `get_unallocated_balance` is hardened to use cached token-accounted project balances when available.
- `deposit` now increments a cached project-balance total for the token being deposited.
- `distribute` and `claim` now decrement the cached project-balance total when funds leave the project pool.
- The cache falls back to the existing project-scan behavior if the cached key is not present, preserving upgrade compatibility.
- This reduces read-side operational cost for monitoring and recovery workflows.

### 3. Access Control
- Admin-only paths require configured admin auth
- Project owner operations require explicit owner authorization
- Collaborator claim flows validate that the caller is registered on the project

### 4. Test Coverage
- `tests.rs` exercises wallet/payment workflows and edge cases
- Coverage includes: deposit, distribution, batch distribution, paused state, claim semantics, claimed ledger updates, unallocated recovery, allowlist rules, and owner/admin gating

## Rollback Notes
Contract releases require a new deployed contract ID when code changes. Existing stable contract IDs remain valid and can be restored in frontend/backend configuration.

## Operational Impact
- Improves Wallet & Payments safety for production rollout
- Adds explicit recovery controls for stray tokens
- Preserves payout accounting when self-service claims occur

## Release Safety
- No ABI-breaking changes are introduced by this wave
- Existing flows remain compatible with current frontend/backends until the new contract ID is switched
- Backend admin freeze (`PAYMENTS_ADMIN_WRITE_ENABLED=false`) supports rollback-safe operations during deployment and recovery
