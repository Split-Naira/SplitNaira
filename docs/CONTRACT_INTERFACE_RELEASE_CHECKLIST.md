# Contract Interface Release Checklist

Use this checklist for any change that can affect the contract interface artifact, generated types, API contracts, or deployment metadata.

## 1) Classify the change
- [ ] Mark as non-breaking if existing methods, args, return types, error codes, and event fields remain backward compatible.
- [ ] Mark as breaking if any method/event/error surface is removed, renamed, reordered, or type-changed.
- [ ] If breaking: include migration notes for backend/frontend consumers and update release notes with operator action items.

## 2) Contract and interface source updates
- [ ] Update Rust contract sources in `contracts/` (`lib.rs`, `events.rs`, `errors.rs`, supporting modules).
- [ ] Verify storage layout compatibility and migration expectations against [Contract Storage Layout and Migrations](./contract-storage-layout-and-migrations.md).
- [ ] Run contract quality gates:
  - [ ] `cd contracts && cargo test`
  - [ ] `cd contracts && cargo fmt -- --check`
  - [ ] `cd contracts && cargo clippy --all-targets -- -D warnings`

## 3) Regenerate interface and TypeScript outputs
- [ ] Regenerate the machine interface JSON:
  - [ ] `npm run generate:contract-interface`
- [ ] Regenerate contract-derived TypeScript types:
  - [ ] `npm run generate:contract-types`
- [ ] Verify updated files are reviewed and committed:
  - [ ] `contracts/interface/splitnaira.contract-interface.json`
  - [ ] `backend/src/generated/contract-types.ts`
  - [ ] `frontend/src/generated/contract-types.ts`

## 4) Backend, API, and OpenAPI alignment
- [ ] Update backend handlers/services/schema validation impacted by interface changes.
- [ ] Update OpenAPI docs/spec where request/response or event semantics changed:
  - [ ] `backend/openapi.json`
  - [ ] Backend route/schema docs in `backend/src/`
- [ ] Run backend tests and lint for impacted areas.

## 5) Frontend alignment
- [ ] Update frontend callers/components/hooks that use changed methods/events/types.
- [ ] Confirm transaction lifecycle UI still reflects contract outcomes.
- [ ] Run frontend tests for impacted areas.

## 6) Deployment metadata and runtime config
- [ ] Build release WASM:
  - [ ] `cd contracts && cargo build --release --target wasm32v1-none`
- [ ] Confirm artifact path:
  - [ ] `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`
- [ ] Record/verify deployment metadata updates:
  - [ ] Contract ID
  - [ ] Network/passphrase
  - [ ] Release tag/commit
  - [ ] Environment config references (`CONTRACT_ID` consumers)

## 7) Documentation and changelog
- [ ] Update docs impacted by interface changes (runbooks, integration notes, API usage docs).
- [ ] Add changelog entry with explicit breaking/non-breaking label.
- [ ] Include rollout/rollback notes if consumer updates are required.

## 8) CI and release validation gates
- [ ] Required CI commands executed (locally and/or CI):
  - [ ] `cd contracts && cargo test`
  - [ ] `cd contracts && cargo fmt -- --check`
  - [ ] `cd contracts && cargo clippy --all-targets -- -D warnings`
  - [ ] `npm run generate:contract-interface`
  - [ ] `npm run generate:contract-types`
- [ ] Run repository test suites required by the release branch policy.
- [ ] If testnet deploy is part of release: run smoke flow (`scripts/smoke-testnet.mjs`) and capture evidence.

## 9) PR review checklist
- [ ] PR description states whether the change is breaking or non-breaking.
- [ ] PR description includes generated file diffs and why they changed.
- [ ] PR description includes commands used for validation.
- [ ] At least one reviewer validated backend/frontend compatibility for changed contract surface.
