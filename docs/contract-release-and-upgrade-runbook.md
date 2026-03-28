# Contract Release and Upgrade Runbook

This runbook describes the end-to-end release/upgrade path for the `contracts/` workspace in SplitNaira.

## 1. Prerequisites
- Rust toolchain 1.76+ (stable)
- `cargo` installed and on PATH
- Soroban CLI (v0.28+ recommended)
- Stellar CLI (for non‑WASM key management as needed)
- Local testnet account with Lumens for fees
- `frontend/` and `backend/` environment variables configured (optional for integration tests)

## 2. Validate contract code
1. `cd contracts`
2. `cargo test`
3. `cargo fmt -- --check`
4. `cargo clippy --all-targets -- -D warnings`

## 3. Build WASM bundle
1. `cargo build --release --target wasm32-unknown-unknown`
2. `wasm-bindgen` is not required for Soroban contracts.
3. Verify artifact path: `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`

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

## 9. Release sign-off checklist
- [ ] All tests pass locally + GitHub Actions
- [ ] Version and CLI docs aligned (`README.md`, `docs/SOROBAN_SETUP.md`)
- [ ] Contract event behavior is stable
- [ ] Runbook updated for any new contract entrypoints
- [ ] Release note summarized in PR

## 10. Operators guidance
- Prefer `stellar contract deploy` for initial release.
- Prefer managed configuration store for `CONTRACT_ID` in deployment.
- Document each release tag in changelog.
