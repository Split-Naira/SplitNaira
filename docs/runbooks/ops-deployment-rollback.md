# Ops Deployment & Rollback Runbook (#438)

## Purpose

Standardize how operators sync contract deployment metadata across backend, frontend, and release artifacts with checksums and rollback paths.

## Artifact sync

After building WASM:

```bash
npm run build:contracts
CONTRACT_ID=C... NETWORK=testnet ./scripts/sync-contracts.sh
```

`sync-contracts.sh`:

- Writes `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm.sha256`
- Writes `release-info.json` (contract ID, network, wasm hash, timestamp)
- Updates `backend/src/config/contract.json` and `frontend/src/config/contract.ts`

Non-interactive deploy (CI or scripts):

```bash
CONTRACT_ID=C... NETWORK=testnet ./scripts/sync-contracts.sh --non-interactive
```

## Pre-deploy checklist

- [ ] `npm run verify:data-integrity` passes
- [ ] `contracts/target/.../splitnaira_contract.wasm` exists
- [ ] `CONTRACT_ID` matches target network (testnet vs mainnet)
- [ ] Backend `CONTRACT_ID` and frontend `NEXT_PUBLIC_CONTRACT_ID` match
- [ ] Database migrations applied (`npm run migration:run -w backend`)
- [ ] `GET /ops/mainnet-readiness` returns `ready` and no missing production config issues

## Deploy order

1. Contract (testnet/staging/prod) — see [deployment.md](../deployment.md)
2. Backend API — [backend-deploy.md](../backend-deploy.md)
3. Frontend — container or static host per [frontend/DOCKER.md](../../frontend/DOCKER.md)

## Smoke tests

- `GET /health` returns 200
- `GET /api/splits/admin/status` reflects expected admin and pause state
- UI: connect wallet, list projects, optional deposit/distribute on testnet

## Operational impact

| Step | Downtime | Data risk |
|------|----------|-----------|
| Contract deploy (new ID) | None until cutover | Old contract remains on-chain |
| Backend env update | Brief restart | None if DB unchanged |
| Frontend env update | Rebuild/redeploy | None |
| Pause distributions | Distribute blocked | Deposits safe |

## Rollback

### Fast (minutes)

1. Restore previous `CONTRACT_ID` in backend + frontend env from `contracts/deployments.json` or last `release-info.json`.
2. Redeploy backend and frontend with previous values.
3. Verify `/health` and `/ops/mainnet-readiness` to confirm the rollback environment is stable.

### Contract emergency

1. Call `pause_distributions` on the current contract (admin wallet).
2. Communicate pause to users; investigate before `unpause_distributions`.

### Full revert

1. Revert git commit that changed contract ID configs.
2. Re-run deploy pipelines for backend/frontend only.
3. Do **not** delete old contract IDs on-chain — funds may remain there.

## Monitoring

- Backend logs: distribution build failures, RPC retries
- Horizon / Soroban RPC latency on configured endpoints
- Compare `release-info.json` `wasm_hash` with CI build artifacts after each release
