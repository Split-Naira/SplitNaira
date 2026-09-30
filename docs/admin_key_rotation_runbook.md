# Soroban Contract Admin Key Rotation Runbook

This runbook outlines the operational procedure for rotating the administrative signing key (`ADMIN_SECRET`) for SplitNaira's Soroban smart contracts on Stellar.

---

## 🎯 Scope & Impact

The contract administrator holds high-privilege capabilities on deployed Soroban contracts, including:
- Executing contract logic upgrades (`upgrade(new_wasm_hash)`)
- Emergency protocol pausing or state locking (`lock()` / `pause()`)
- Administrative configuration updates

Rotating this key must be performed on-chain via an authorized state transition signed by the active admin key.

---

## 🔐 Rotation Procedure

### Phase 1: Keypair Generation & Security Staging
1. Generate a new cryptographic keypair on an isolated, air-gapped machine or hardware security module:
   ```bash
   stellar keys generate --global splitnaira-contract-admin-v2 --network mainnet
   ```
2. Export the public address:
   ```bash
   NEW_ADMIN_ADDRESS=$(stellar keys address splitnaira-contract-admin-v2)
   echo "New Admin Address: $NEW_ADMIN_ADDRESS"
   ```
3. Secure the secret key in cold storage or enterprise key custody (e.g. AWS CloudHSM / HashiCorp Vault Transit).

### Phase 2: On-Chain Admin Role Transfer
1. Retrieve the deployed contract ID:
   ```bash
   CONTRACT_ID=$(jq -r '.mainnet.contract_id' contracts/deployments.json)
   ```
2. Invoke the contract's `set_admin` function signed by the current administrator:
   ```bash
   stellar contract invoke \
     --id "$CONTRACT_ID" \
     --source splitnaira-contract-admin-current \
     --network mainnet \
     -- \
     set_admin --new_admin "$NEW_ADMIN_ADDRESS"
   ```
3. Confirm transaction status and ledger inclusion using Stellar Horizon or Soroban RPC:
   ```bash
   curl -s "https://horizon.stellar.org/transactions/<TRANSACTION_HASH>" | jq .successful
   ```

### Phase 3: Post-Rotation Verification
1. **Query On-Chain Admin State**:
   Verify that the smart contract reports the new address as admin:
   ```bash
   stellar contract read \
     --id "$CONTRACT_ID" \
     --network mainnet \
     --key admin
   ```
   *Expected output: `$NEW_ADMIN_ADDRESS`.*
2. **Interface & Contract Validation**:
   Run the contract deployment validator script:
   ```bash
   node contracts/scripts/validate-deployment.mjs
   ```

### Phase 4: Rollback Strategy
If an issue occurs before the on-chain transfer transaction is broadcast:
- Discard the staged keypair and generate a new one.
If an unauthorized or incorrect address is set as admin:
- Immediately invoke incident response protocols (see [Incident Management](./runbooks/incident-management.md)).
- If multi-sig or timelock safeguards are enabled, execute the cancellation transaction during the timelock window.

---

## 🔗 Related Documentation
- [Production Secret Rotation Runbook](../runbooks/production-secret-rotation.md) — Comprehensive secret rotation procedures
- [Production Secret Rotation Procedure](./runbooks/secret-rotation-procedure.md) — General credentials and key rotation
- [Contract Release & Upgrade Runbook](./contract-release-and-upgrade-runbook.md) — Contract deployment and upgrade process
- [Secrets & Rotation Guide](./secrets.md) — Secret inventory and security policy
