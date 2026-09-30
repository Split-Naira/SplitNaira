# Production Secret Rotation Runbook

This runbook establishes standard operating procedures for rotating security-sensitive credentials and cryptographic keys in SplitNaira's production environment. Follow the documented sequences to guarantee zero downtime, prevent service disruption, and maintain audit compliance.

---

## 📋 Secret Inventory & Classification Matrix

| Category | Environment Variable(s) | Primary Secret Store | Rotation Strategy | Maximum Stale Grace Period | Impact if Misconfigured |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **JWT Signing Secrets** | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `EMAIL_TOKEN_SECRET` | Render / Vault / Secrets Manager | Dual-Key Overlap | 24 Hours (`JWT_EXPIRES_IN`) | Session invalidation, forced logout, auth downtime |
| **Payment Admin API Key** | `PAYMENTS_ADMIN_API_KEY` | Render / Vault / Secrets Manager | Coordinated Cutover / Freeze Gate | None (Instant Cutover) | Admin payout routes fail, unauthorized 401s |
| **Stellar / Soroban Operator** | `SOROBAN_OPERATOR_SECRET_KEY`, `OPERATOR_SECRET_KEY` | Render / Vault / Secrets Manager | Provision New Account & Cutover | None (Instant Cutover) | Settlement failures, transaction submission stalls |
| **Contract Admin Key** | `ADMIN_SECRET` | Secure HSM / Offline Hardware Signer | Smart Contract Authority Transfer | None (Instant Cutover) | Inability to pause or upgrade smart contracts |
| **Stellar Issuer & Distributor** | `STELLAR_ISSUER_SECRET`, `STELLAR_DISTRIBUTOR_SECRET` | Secure Vault / Multi-sig Signer | Account Reconfiguration / Multi-sig | None | Token issuance & disbursement interruption |
| **Database Credentials** | `DATABASE_URL`, `DATABASE_PASSWORD` | Cloud Provider / Secrets Manager | Dual-User Staging | Zero downtime | API 500 errors, connection pool exhaustion |
| **RPC & External Providers** | `SOROBAN_RPC_URL`, `HORIZON_URL`, `SENTRY_DSN` | Render / GitHub Actions Secrets | Staged Endpoint Switch | None | RPC simulation failure, dropped error telemetry |
| **CI/CD Deploy Hooks** | `RENDER_BACKEND_DEPLOY_HOOK_URL` | GitHub Actions Secrets | Dual-Hook Overlap | 24 Hours | Blocked automated deployments |

---

## 🛡️ 1. General Rotation Principles & Safety Rules

1. **Pre-Notification & Maintenance Window**:
   - For planned rotations involving payment routes (`PAYMENTS_ADMIN_API_KEY`) or database credentials, notify the on-call team in `#incidents-payments` and `#ops-deployments`.
2. **Dual-Key & Staged Deployments**:
   - Whenever an interface validates asymmetric or symmetric tokens (such as JWTs), stage the old key in a fallback variable (`JWT_SECRET_PREVIOUS`) before fully retiring it.
3. **Write Freeze Safeguard**:
   - If rotating payment admin keys during active payout settlement or under incident suspicion, use the emergency kill switch `PAYMENTS_ADMIN_WRITE_ENABLED=false` to reject mutations with `503 payments_admin_writes_disabled` while keys are updated.
4. **Vault History & Rollback Retention**:
   - Retain the immediate prior secret version (`version n-1`) in your secret store until post-rotation verification is complete.
5. **Never Commit Secrets**:
   - Never place plaintext credentials in source control, pull request bodies, tickets, or unencrypted communications.

---

## 🔑 2. JWT Secret Rotation Procedure

SplitNaira signs user authentication tokens and email verification links using symmetric keys configured via `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `EMAIL_TOKEN_SECRET`.

### A. Prerequisites & Parameters
- **Access Token TTL**: Configured via `JWT_EXPIRES_IN` (default: `24h`).
- **Email Token TTL**: Configured via `PASSWORD_RESET_TOKEN_TTL` (`30m`) and `INVITATION_TOKEN_TTL` (`7d`).
- **Overlap Window**: 24 hours to prevent mass session disconnects.

### B. Step-by-Step Execution

#### Step 1: Generate New Cryptographic Secrets
Generate high-entropy 512-bit secrets for production signing:
```bash
# Generate new JWT access token secret
NEW_JWT_SECRET=$(openssl rand -hex 64)

# Generate new JWT refresh token secret
NEW_JWT_REFRESH_SECRET=$(openssl rand -hex 64)

# Generate new email token secret (if rotating in tandem)
NEW_EMAIL_TOKEN_SECRET=$(openssl rand -hex 64)
```

#### Step 2: Phase 1 — Deploy Dual-Secret Staging
1. Retrieve the currently deployed secret as `<OLD_JWT_SECRET>`.
2. Update the environment variables in the hosting platform (e.g. Render / Vault):
   ```ini
   JWT_SECRET=<NEW_JWT_SECRET>
   JWT_SECRET_PREVIOUS=<OLD_JWT_SECRET>
   JWT_REFRESH_SECRET=<NEW_JWT_REFRESH_SECRET>
   EMAIL_TOKEN_SECRET=<NEW_EMAIL_TOKEN_SECRET>
   ```
3. Trigger a rolling zero-downtime deployment:
   ```bash
   # If running on Kubernetes
   kubectl rollout restart deployment/splitnaira-backend -n production
   kubectl rollout status deployment/splitnaira-backend -n production
   ```
   *Note: In Phase 1, newly issued tokens are signed using `NEW_JWT_SECRET`. Active tokens issued prior to rotation are validated against `JWT_SECRET_PREVIOUS`.*

#### Step 3: Phase 1 Verification
1. **Issue new token**: Authenticate via auth login endpoint:
   ```bash
   curl -s -X POST https://api.splitnaira.com/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"smoke-test@splitnaira.com","password":"<TEST_PASSWORD>"}'
   ```
   *Verify response contains a valid token signed with the new key.*
2. **Verify authenticated call with new token**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer <NEW_TOKEN>" \
     -H "Content-Type: application/json" \
     https://api.splitnaira.com/v1/users/me
   ```
   *Expected code: `200`.*
3. **Verify backward-compatibility**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer <PREVIOUS_TOKEN>" \
     -H "Content-Type: application/json" \
     https://api.splitnaira.com/v1/users/me
   ```
   *Expected code: `200`.*

#### Step 4: Phase 2 — Deprecate Previous Secret (After 24 Hours)
Once the 24-hour expiration window elapsed:
1. Remove `JWT_SECRET_PREVIOUS` from the secret store.
2. Trigger a final rolling deployment:
   ```bash
   kubectl rollout restart deployment/splitnaira-backend -n production
   ```
3. Confirm obsolete tokens are rejected:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer <PREVIOUS_TOKEN>" \
     https://api.splitnaira.com/v1/users/me
   ```
   *Expected code: `401`.*

### C. JWT Rollback Procedure
If verification fails or authentication rejection rates spike (`> 0.1%`):
1. Immediately restore `JWT_SECRET=<OLD_JWT_SECRET>` in the secret store.
2. Trigger an immediate rollout undo:
   ```bash
   kubectl rollout undo deployment/splitnaira-backend -n production
   ```
3. Confirm login and token verification succeed with the rolled-back key.

---

## 💳 3. Payment Admin Key Rotation Procedure

The `PAYMENTS_ADMIN_API_KEY` protects high-privilege endpoints under `/splits/admin/*` (such as allowlist mutations and payout status queries) guarded by `PaymentsAdminGuard`.

### A. Governance & Coordination
- **Sign-off Requirement**: Rotation requires authorization from the Payments Engineering Lead.
- **Affected Clients**: Admin CLI scripts (`scripts/bootstrap-allowlist.sh`), backend payout workers, and internal operations dashboards.

### B. Step-by-step Execution

#### Step 1: Generate New Admin Key
Generate a secure 256-bit hexadecimal string:
```bash
NEW_PAYMENTS_ADMIN_KEY=$(openssl rand -hex 32)
```

#### Step 2: Optional Write Freeze (Incident / High-Risk Rotation)
If rotating due to suspected key leakage or during active settlement:
1. In the target environment, set:
   ```ini
   PAYMENTS_ADMIN_WRITE_ENABLED=false
   ```
2. Confirm admin write routes return `503`:
   ```bash
   curl -s -i -X POST https://api.splitnaira.com/splits/admin/freeze \
     -H "x-admin-api-key: <CURRENT_KEY>"
   ```
   *Expect `503 payments_admin_writes_disabled`.*

#### Step 3: Update Secret Store & Deploy
1. Update `PAYMENTS_ADMIN_API_KEY` with `<NEW_PAYMENTS_ADMIN_KEY>` in Render / Vault.
2. Update internal clients and administrative scripts with the new key.
3. Perform a zero-downtime rolling restart of backend services:
   ```bash
   kubectl rollout restart deployment/splitnaira-backend -n production
   kubectl rollout status deployment/splitnaira-backend -n production
   ```

#### Step 4: Verification
1. **Positive check with new key**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "x-admin-api-key: <NEW_PAYMENTS_ADMIN_KEY>" \
     https://api.splitnaira.com/splits/admin/status
   ```
   *Expected code: `200`.*
2. **Negative check with old key (Revocation check)**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "x-admin-api-key: <OLD_PAYMENTS_ADMIN_KEY>" \
     https://api.splitnaira.com/splits/admin/status
   ```
   *Expected code: `401`.*
3. **Audit Log Verification**:
   Inspect backend application logs:
   ```bash
   # Filter for PaymentsAdminGuard log entries
   kubectl logs -l app=splitnaira-backend -n production --tail=100 | grep -E "ADMIN_ACCESS_GRANTED|ADMIN_ACCESS_DENIED"
   ```
   *Verify `ADMIN_ACCESS_GRANTED` for the new key and absence of unexpected denials.*
4. **Re-enable Writes (if frozen in Step 2)**:
   Set `PAYMENTS_ADMIN_WRITE_ENABLED=true` and confirm write access is restored.

### C. Payment Admin Key Rollback Procedure
If external clients or automated services cannot authenticate:
1. Immediately restore `PAYMENTS_ADMIN_API_KEY=<OLD_PAYMENTS_ADMIN_KEY>`.
2. Ensure `PAYMENTS_ADMIN_WRITE_ENABLED=true`.
3. Restart or redeploy backend pods.
4. Verify with:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "x-admin-api-key: <OLD_PAYMENTS_ADMIN_KEY>" \
     https://api.splitnaira.com/splits/admin/status
   ```
   *Expected code: `200`.*

---

## 🌐 4. Wallet & Provider Credentials Rotation Procedure

### A. Stellar / Soroban Operator Account (`SOROBAN_OPERATOR_SECRET_KEY`)
The operator account submits automated transactions (such as project creation relays and claim distributions) on Stellar.

#### Rotation Steps:
1. **Generate a New Keypair**:
   ```bash
   stellar keys generate --global soroban-operator-prod-new --network mainnet
   NEW_OPERATOR_PUB=$(stellar keys address soroban-operator-prod-new)
   NEW_OPERATOR_SEC=$(stellar keys show soroban-operator-prod-new)
   ```
2. **Fund the Account**:
   - Fund the new account with at least 50 XLM (base reserve + gas fees buffer) on Stellar Mainnet.
   - Establish required token trustlines if handling non-native assets:
     ```bash
     stellar tx change-trust --source soroban-operator-prod-new --line "TOKEN:GASSET_ISSUER"
     ```
3. **Deploy the New Secret**:
   - Update `SOROBAN_OPERATOR_SECRET_KEY` in Render / Vault.
   - Roll out the new configuration:
     ```bash
     kubectl rollout restart deployment/splitnaira-backend -n production
     ```
4. **Verification**:
   - Execute a canary contract read or low-value test transaction:
     ```bash
     node scripts/healthcheck.mjs
     ```
   - Verify ledger close time and status via Horizon:
     ```bash
     curl -s https://horizon.stellar.org/accounts/${NEW_OPERATOR_PUB}
     ```
5. **Decommission Old Account**:
   - Merge or sweep remaining XLM balance from old operator account to the treasury:
     ```bash
     stellar tx account-merge --source soroban-operator-prod-old --destination <TREASURY_ACCOUNT>
     ```

### B. Soroban Smart Contract Admin Key (`ADMIN_SECRET`)
The smart contract admin key holds administrative authorization over deployed Soroban contracts (pause, unpause, upgrade WASM).

#### Rotation Steps:
1. **Generate New Admin Keypair**:
   ```bash
   stellar keys generate --global splitnaira-contract-admin-new --network mainnet
   NEW_ADMIN_PUB=$(stellar keys address splitnaira-contract-admin-new)
   ```
2. **Transfer Admin Role on Smart Contract**:
   Execute the contract administration transfer function using the current admin key:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source splitnaira-contract-admin-old \
     --network mainnet \
     -- \
     set_admin --new_admin $NEW_ADMIN_PUB
   ```
3. **Verify State on Contract**:
   Query the contract storage or run the contract interface checker:
   ```bash
   node contracts/scripts/validate-deployment.mjs
   ```
   *Verify the returned admin address matches `$NEW_ADMIN_PUB`.*
4. **Store Secret Securely**:
   Store the secret key for `splitnaira-contract-admin-new` in an offline hardware wallet or enterprise KMS. Wipe ephemeral instances.

### C. Stellar Issuer & Distributor Secrets (`STELLAR_ISSUER_SECRET`, `STELLAR_DISTRIBUTOR_SECRET`)
1. **Provision New Accounts**: Generate new keypairs and establish required multi-signature signing thresholds.
2. **Update Signer Weights**: Add new public key as signer with threshold weights on-chain.
3. **Update Application Secrets**: Set new secret keys in environment configuration.
4. **Revoke Old Signers**: Set old public key signing weight to `0`.

### D. PostgreSQL Database Credentials (`DATABASE_URL`, `DATABASE_PASSWORD`)
Zero-downtime database credential rotation requires dual-user role staging in PostgreSQL:

1. **Create New Database User in Postgres**:
   ```sql
   CREATE USER splitnaira_backend_v2 WITH PASSWORD 'STRONGLY_GENERATED_PASSWORD';
   GRANT splitnaira_app_role TO splitnaira_backend_v2;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO splitnaira_backend_v2;
   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO splitnaira_backend_v2;
   ```
2. **Update Application Secret**:
   - Update `DATABASE_URL` in the hosting environment to use `splitnaira_backend_v2`.
3. **Rolling Deploy & Connection Drain**:
   - Restart backend instances rolling one by one.
   - Monitor connection pool migration in PostgreSQL:
     ```sql
     SELECT usename, count(*) FROM pg_stat_activity WHERE datname = 'splitnaira' GROUP BY usename;
     ```
4. **Drop Old User**:
   Once all connections from `splitnaira_backend_v1` drop to 0:
   ```sql
   REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM splitnaira_backend_v1;
   DROP USER splitnaira_backend_v1;
   ```

### E. RPC Providers & Infrastructure (`SOROBAN_RPC_URL`, `HORIZON_URL`, `SENTRY_DSN`, `RENDER_BACKEND_DEPLOY_HOOK_URL`)
- **RPC Providers**: Provision a new API key in the provider portal (QuickNode, NowNodes, etc.), update `SOROBAN_RPC_URL` or `HORIZON_URL`, restart backend, and verify `GET /health` returns `healthy` with `rpc.status: "up"`. Decommission old provider token after 24 hours.
- **Sentry DSN**: Issue new client keys in the Sentry dashboard, update `SENTRY_DSN`, trigger a synthetic non-fatal exception, and disable the old client key.
- **Render Deploy Hook**: Create a secondary deploy hook in the Render service settings, update `RENDER_BACKEND_DEPLOY_HOOK_URL` in GitHub Actions secrets (**Settings → Secrets and variables → Actions**), run a test CI workflow, and delete the legacy hook.

---

## 🚨 5. Emergency Rollback Playbook & Recovery Matrix

### A. Rollback Trigger Criteria
Initiate an emergency rollback immediately if any of the following occur post-rotation:
- **HTTP 5xx Spikes**: Backend 5xx error rate exceeds `1.0%` over a 5-minute rolling window.
- **Health Check Degradation**: `/health` endpoint reports `down` or `degraded` on `database` or `rpc`.
- **Authentication Failure Spike**: Sudden increase in `401 Unauthorized` or `403 Forbidden` responses.
- **Transaction Submission Failures**: Soroban contract invocations fail with signature or authorization errors.

### B. Quick Recovery Actions

| Issue Encountered | Immediate Rollback Step | Verification Check |
| :--- | :--- | :--- |
| **JWT Login / Session Failures** | Revert `JWT_SECRET` to previous value in vault and redeploy. | `curl -I https://api.splitnaira.com/v1/users/me` with previous token |
| **Admin Route 401s** | Restore previous `PAYMENTS_ADMIN_API_KEY` in vault and redeploy. | `curl -H "x-admin-api-key: <OLD_KEY>" https://api.splitnaira.com/splits/admin/status` |
| **Admin Payout Outages** | Toggle `PAYMENTS_ADMIN_WRITE_ENABLED=false` to halt mutations safely. | Admin routes return `503 payments_admin_writes_disabled` |
| **DB Connection Errors** | Point `DATABASE_URL` back to previous database credentials. | `SELECT count(*) FROM pg_stat_activity` & `/health` |
| **Operator Tx Failures** | Point `SOROBAN_OPERATOR_SECRET_KEY` back to funded previous key. | Submit low-gas canary call |

### C. Fast Deployment Rollback Command Reference
```bash
# Rollback Kubernetes Deployment
kubectl rollout undo deployment/splitnaira-backend -n production

# If deploying via PM2 / Bare-Metal
git checkout <PREVIOUS_STABLE_TAG>
npm ci
npm run build
pm2 restart splitnaira-backend

# Verify health status
curl -s https://api.splitnaira.com/health | jq .
```

---

## 🔗 Related Runbooks & Documentation

- [Rollback Guide](./rollback-guide.md) — Infrastructure and smart contract rollback runbook
- [Production Readiness Checklist](./production-readiness.md) — Pre-launch checklist including payment admin auth
- [Failed Payout Incident Checklist](./failed-payout-incident-checklist.md) — Triage steps for payment anomalies
- [Payout Failure Severity Matrix](./payout-failure-severity-matrix.md) — Severity classification and escalation channels
- [Secrets & Rotation Guide](../docs/secrets.md) — Full secret store inventory and scanning policies
- [Backend Environment Variables](../docs/backend-env-vars.md) — Complete environment variable specification
- [Soroban Contract Admin Key Rotation](../docs/admin_key_rotation_runbook.md) — Dedicated smart contract admin key guide
