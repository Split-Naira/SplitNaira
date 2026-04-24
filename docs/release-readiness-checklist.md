# Release Readiness Checklist (Contracts)

This checklist is the authoritative guide for contract release flow in SplitNaira.

- [x] `docs/contract-release-and-upgrade-runbook.md` exists and is up-to-date.
- [x] `contracts/` unit tests pass (`cargo test`).
- [x] `contracts/` formatter and linter checks pass.
- [x] Release build file exists: `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`.
- [x] Contract API is current:
  - `create_project`
  - `refresh_project_storage`
  - `deposit`
  - `distribute`
  - `get_balance`
  - `get_unallocated_balance`
  - `withdraw_unallocated`
- [x] Storage lifetime policy is documented and verifiable:
  - Project-scoped TTL-managed records are defined (`Project`, `ProjectBalance`, `Claimed`)
  - Operator cadence for TTL refresh is documented
  - Restore/incident steps are documented for missing project state
- [x] Event APIs are documented and validated:
  - `project_created` (topic)
  - `deposit_received` (topic, from, amount, post-balance)
  - `payment_sent`
  - `distribution_complete`
- [x] Backend/contract compatibility coverage exists for:
  - ScVal encoding for create/update/admin routes
  - history event topic and payload decoding
  - Stellar address validation and conversion edge cases
- [x] In docs, CLI/tooling versions mention:
  - Rust stable
  - Soroban CLI v0.28+
  - Stellar CLI current stable
- [x] README links to runbook and SOROBAN setup.
- [x] Operators can follow documented release/upgrade path without guesswork.
