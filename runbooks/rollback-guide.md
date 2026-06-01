# Rollback Guide

This runbook outlines the steps to perform a safe rollback of infrastructure, backend services, or smart contracts in the event of a critical failure.

## 1. Backend Service Rollback
If a backend deployment introduces critical failures (e.g., 5xx error spikes, memory leaks):

1. **Identify Stable Commit**: Use GitHub or your CI/CD platform to identify the last known stable commit hash.
2. **Freeze Wallet/Payments Admin Writes First**: Before swapping artifacts, set `PAYMENTS_ADMIN_WRITE_ENABLED=false` and restart or redeploy the backend so new `/splits/admin/*` write operations are rejected with `503 payments_admin_writes_disabled`.
3. **Revert Deployment**:
   - If using containerized deployments (Docker/K8s), rollback to the previous stable image tag:
     ```bash
     kubectl rollout undo deployment/splitnaira-backend
     ```
   - If deploying via bare-metal/PM2, pull the stable commit and restart:
     ```bash
     git checkout <STABLE_COMMIT_HASH>
     npm ci
     npm run build
     pm2 restart splitnaira-backend
     ```
4. **Re-enable Writes After Verification**: Once the stable release is healthy and payout state is confirmed, restore `PAYMENTS_ADMIN_WRITE_ENABLED=true`.

## 2. Database Rollback
If a migration corrupts data or causes schema mismatches:

1. **Migration Revert**: If the migration has a safe `down` script, revert it using TypeORM:
   ```bash
   npm run typeorm migration:revert
   ```
2. **Point-in-Time Recovery (PITR)**: If data is corrupted, use the cloud provider's PITR feature (AWS RDS, GCP Cloud SQL) to restore the database to the exact minute before the migration ran.

## 3. Smart Contract Rollback (Soroban)
Soroban contracts cannot be easily "deleted" after deployment, but they can be upgraded or deprecated.

1. **Immediate Halt**: If the contract is compromised, the `admin` account should invoke the `lock` or pause function to freeze state mutations.
2. **Contract Upgrade**: Deploy a patched WASM binary and use the `upgrade` function (if implemented and authorized) to point the existing contract instance to the new logic.
3. **Frontend Mitigation**: If the contract cannot be halted, immediately push a frontend patch disabling interactions with the compromised contract ID to protect end-users.
