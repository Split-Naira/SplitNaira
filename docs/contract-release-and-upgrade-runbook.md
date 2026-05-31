# Contract Release and Upgrade Runbook

This runbook describes the end-to-end release/upgrade path for the `contracts/` workspace in SplitNaira.

## 1. Prerequisites
- Rust toolchain 1.76+ (stable)
- `cargo` installed and on PATH
- Node.js 18+ for regenerating `contracts/interface/splitnaira.contract-interface.json`
- Soroban CLI (v0.28+ recommended)
- Stellar CLI (for non‑WASM key management as needed)
- Local testnet account with Lumens for fees
- `frontend/` and `backend/` environment variables configured (optional for integration tests)

## 2. Validate contract code
1. `cd contracts`
2. `cargo test`
3. `cargo fmt -- --check`
4. `cargo clippy --all-targets -- -D warnings`
5. `cd .. && npm run generate:contract-interface`
6. `npm run generate:contract-types`
7. Confirm `contracts/interface/splitnaira.contract-interface.json` and generated types are committed with any contract surface change.

## 3. Build WASM bundle
1. `cargo build --release --target wasm32-unknown-unknown`
2. `wasm-bindgen` is not required for Soroban contracts.
3. Verify artifact path: `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`
4. Refresh the machine-consumable interface artifact if method, event, type, or error definitions changed:
   - `npm run generate:contract-interface`
   - `npm run generate:contract-types`
   - Review the JSON and generated TypeScript diffs before release sign-off.
1. `rustup target add wasm32v1-none` (one-time)
2. `cargo build --release --target wasm32v1-none`
3. `wasm-bindgen` is not required for Soroban contracts.
4. Verify artifact path: `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`

## 4. Run contract-level testing
- Unit test suite in `contracts/tests.rs` includes behavior, edge cases, event emission.
- Add a test case for release-change guard mechanics if introduced.

## 5. Deploy to testnet
1. Ensure network config:
   - `stellar network add testnet --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"`
2. Generate/fund key (if needed):
   - `stellar keys generate deployer`
   - `stellar keys fund deployer --network testnet`
3. Deploy contract:
   - `stellar contract deploy --wasm target/wasm32v1-none/release/splitnaira_contract.wasm --source deployer --network testnet`
4. Record contract ID and update frontend/backend env `.env` variables.

## 6. Smoke test on testnet

### Automated smoke script (issue #361)

Use `scripts/smoke-testnet.mjs` to exercise the full create → deposit → distribute
lifecycle against the live testnet contract:

```bash
# Required env vars — never commit secrets
export STELLAR_SECRET_KEY="S..."      # funded testnet keypair
export CONTRACT_ID="C..."             # deployed contract ID

node scripts/smoke-testnet.mjs
# Exits 0 on success, 1 on any failure
```

The script:
1. Registers a 2-collaborator split project (70% / 30%).
2. Approves and deposits 1 XLM (configurable via `SMOKE_DEPOSIT_AMOUNT`).
3. Calls `distribute` and verifies claimed balances match expected basis-point split.

#### Manual-dispatch CI job

Alternatively, trigger the smoke test via GitHub Actions without checking out locally:

1. Go to **Actions → Contract Smoke Test (Testnet) → Run workflow**.
2. Enter the deployed `CONTRACT_ID`.
3. Optionally adjust `deposit_amount` (default 10 000 000 stroops = 1 XLM).
4. Monitor the workflow log — it exits 0 only if all steps pass.

> **Prerequisite:** The `testnet` GitHub Environment must have `STELLAR_TESTNET_SECRET_KEY`
> set to a funded testnet keypair (Settings → Environments → testnet → Secrets).

### Manual verification (fallback)
- Execute `create_project`, `deposit`, `distribute` via integration or UI.
- Verify event stream includes:
  - `project_created`
  - `deposit_received`
  - `payment_sent`
  - `distribution_complete`

## 7. Upgrade process
1. New release path:
   - Build new WASM as above.
   - Deploy replacement contract to Soroban.
   - Update system configuration (backend/frontend) to new contract ID.
   - Perform verification tests.
2. Blue/green (canary) strategy:
   - Deploy new contract ID in staging config.
   - Run 2-3 full flows.
   - Switch production traffic once verified.
3. Rollback
   - Keep last stable contract ID in config.
   - If emergency, revert `CONTRACT_ID` and redeploy services.

## 8. Recovery
- Use `contracts` `get_unallocated_balance()` and `withdraw_unallocated()` to manage stray funds during upgrade.

## 9. Storage lifetime maintenance (TTL)

### 9.1 Record durability policy
- Must stay alive for long-lived projects:
   - `Project(project_id)`
   - `ProjectBalance(project_id)`
   - `Claimed(project_id, collaborator_address)` for current collaborators
- Managed as global metadata (not per-project hot records):
   - `ProjectIds`, `ProjectCount`
   - `Admin`, `AllowedToken*`, `DistributionsPaused`

### 9.2 How TTL is maintained
- Automatic maintenance (contract hot paths):
   - `create_project`, `update_collaborators`, `update_project_metadata`, `lock_project`, `deposit`, `distribute`, `get_project`, `get_claimed`
- Explicit maintenance endpoint for long inactivity windows:
   - `refresh_project_storage(project_id)` (permissionless)
   - Returns `NotFound` if the project no longer exists.

### 9.3 Operator cadence for long-lived projects
1. Weekly/bi-weekly, list active and high-value project IDs.
2. Call `refresh_project_storage(project_id)` for projects expected to remain live but quiet.
3. Verify state is present with `get_project(project_id)` and (if applicable) `get_claimed(project_id, collaborator)`.

### 9.4 Restore and incident response
- If a project lookup returns `NotFound`, treat it as potential eviction/corruption and start incident handling.
- Use backend/indexed snapshots (or historical records) to reconstruct collaborator config and metadata.
- Recreate project state and resume operations only after sign-off that balances/claims are reconciled.

### 9.5 Contributor verification
- Contract tests must include coverage for:
   - `refresh_project_storage` success on existing projects
   - `refresh_project_storage` failure on missing projects
   - unchanged payout accounting after refresh calls
- Backend tests must include ScVal/address compatibility checks for create/update/history/admin flows.

## 10. Release sign-off checklist
- [ ] All tests pass locally + GitHub Actions
- [ ] Version and CLI docs aligned (`README.md`, `docs/SOROBAN_SETUP.md`)
- [ ] Contract event behavior is stable
- [ ] `contracts/interface/splitnaira.contract-interface.json` refreshed and reviewed
- [ ] Runbook updated for any new contract entrypoints
- [ ] Release note summarized in PR

## 11. Operators guidance
- Prefer `stellar contract deploy` for initial release.
- Prefer managed configuration store for `CONTRACT_ID` in deployment.
- Document each release tag in changelog.
