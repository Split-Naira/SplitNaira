# Secrets and Rotation Guide

This document captures the secret inventory, ownership, and rotation procedures for SplitNaira.

> Never commit `.env`, `.env.local`, or any files containing live secrets to git. Use host secret stores, platform environment variables, or GitHub Actions secrets instead.

## Secret Management Principles

- Treat all private keys, database URLs, webhook URLs, and signing secrets as sensitive.
- Store secrets in the hosting platform or CI secret manager; do not store them in source control.
- Rotate secrets proactively and immediately after any suspected compromise.
- Keep secrets scoped to the minimum required environment.
- Document owner, purpose, and rotation steps for every secret.

## Approved Secret Stores

Use one of the following mechanisms rather than committing secrets to files:

- GitHub Actions secrets / repository secrets
- Render environment secrets / service config vars
- Vault / HashiCorp Vault / AWS Secrets Manager / Azure Key Vault
- Local OS keychain or encrypted credentials store for dev/test secrets

## Secret Inventory

### GitHub Actions / CI Secrets

| Secret | Owner | Purpose | Rotation notes |
|---|---|---|---|
| `RENDER_BACKEND_DEPLOY_HOOK_URL` | Platform / Deploy owner | Triggers backend deploys via Render webhook | Rotate by creating a new Render hook, update the GitHub secret, validate with a deploy, then retire the old hook |
| `MAINNET_CONTRACT_ID` | Contract release manager | Validates production deployment configuration | Rotate when the mainnet contract changes; update the secret in GitHub and any rendering host configs |

### Backend Runtime Secrets

| Secret | Owner | Purpose | Rotation notes |
|---|---|---|---|
| `DATABASE_URL` | DB owner / platform | Production PostgreSQL connection string | Rotate by issuing new credentials or endpoint, update secret store, and redeploy backend with health checks before decommissioning the old connection |
| `JWT_SECRET` | Security / backend owner | Signs API auth tokens | Rotate by updating the secret store and redeploying the backend; expect existing tokens to become invalid unless dual-secret support is implemented |
| `STELLAR_ISSUER_SECRET` | Payments / operations | Stellar issuer account secret | Rotate by provisioning a new keypair and updating the service secret; if compromised, follow incident response procedures immediately |
| `STELLAR_DISTRIBUTOR_SECRET` | Payments / operations | Stellar distributor account secret | Rotate like other Stellar keys: generate a new keypair, update the environment secret, and redeploy after validating the new account state |
| `SENTRY_DSN` | Observability | Error monitoring endpoint key | Rotate in Sentry and update the backend secret store; verify events arrive with the new DSN |

### Local or Test Secrets

| Secret | Owner | Purpose | Rotation notes |
|---|---|---|---|
| `STELLAR_SECRET_KEY` | Developer / test operator | Local/deploy Stellar account secret | Keep in a local vault or secret manager; never commit it. Rotate by replacing the secret and regenerating a funded key if necessary |
| `ADMIN_SECRET` | Contract admin operator | Soroban contract admin signing key | Treat as a private key. Store securely and rotate on suspicion of compromise |
| `OPERATOR_SECRET_KEY` | Operator account key for scripts | Script execution / maintenance tasks | Store only in secure tooling and rotate regularly |
| `SIMULATOR_ACCOUNT` | Developer / QA | Optional simulator account ID | Not a secret itself, but must be paired with a secure key if used |

## Rendering Deploy Hook Rotation Without Downtime

The Render deploy hook is a trigger URL used by GitHub Actions to start backend deployments. It is sensitive and must be rotated carefully.

1. In the Render dashboard, create a new deploy hook for the backend service. If Render supports multiple hooks, keep the old hook active until the new one is validated.
2. Update the GitHub Actions secret `RENDER_BACKEND_DEPLOY_HOOK_URL` with the new hook URL in **Settings → Secrets and variables → Actions**.
3. Run a controlled backend deploy using `.github/workflows/backend-deploy.yml` or `mainnet-deploy.yml`.
4. Confirm successful deployment and smoke checks.
5. Remove or revoke the old deploy hook from Render once the new hook is confirmed working.

> This rotation path is safe because Render keeps the existing service running until the new deployment completes successfully.

## Database URL Rotation Procedure

1. Provision new credentials or a new database endpoint in the database host.
2. Update `DATABASE_URL` in the target environment secret store.
3. Redeploy the backend and verify `GET /health` returns OK.
4. Confirm application traffic is healthy before retiring the old database credentials.

## JWT Secret Rotation Procedure

1. Generate a new secret with strong entropy.
2. Update `JWT_SECRET` in the host secret store.
3. Redeploy the backend.
4. If you need old sessions to remain valid, implement a short transition window or dual-secret support before rotating.

## Stellar Secret Rotation Procedure

1. Generate a new Stellar keypair for the affected account.
2. Configure the new account on the network (fund it if needed, establish required trustlines, etc.).
3. Update the corresponding secret (`STELLAR_ISSUER_SECRET`, `STELLAR_DISTRIBUTOR_SECRET`, `ADMIN_SECRET`, or `STELLAR_SECRET_KEY`) in the secret store.
4. Redeploy the backend or rerun the relevant script.
5. If the old key was compromised, treat this as an incident and take corrective action immediately.

## Do Not Commit `.env`

- Use `.env.example`, `backend/.env.example`, and `frontend/.env.example` only as templates.
- Do not commit actual `.env`, `.env.local`, or `.env.production` files.
- Configure secrets directly in the hosting platform, Render dashboard, or GitHub Actions secrets.

## Secret Scanning Policy

SplitNaira enforces secret scanning at multiple layers to prevent credential leakage into source control, CI logs, and deployment artifacts.

### Required Scanning Layers

| Layer | Tool | Scope | Enforcement |
|---|---|---|---|
| Pre-commit | gitleaks (local) | Staged files | Recommended for all contributors |
| CI pipeline | GitHub secret scanning | All pushes and PRs | Enabled via GitHub repository settings |
| CI pipeline | gitleaks (workflow) | Full git history | Runs on PR and push to `main` |
| Deployment | Manual review | `.env` files, config vars | Required before production deploys |

### What Gets Scanned

The following patterns are flagged by secret scanning:

- **Private keys**: Stellar secret keys (`S...`), Ed25519 seed bytes, PEM-encoded private keys
- **Database credentials**: Connection strings with embedded passwords (`postgresql://user:pass@...`)
- **API keys and tokens**: JWT secrets, webhook URLs with tokens, Sentry DSNs
- **Environment files**: `.env`, `.env.local`, `.env.production`, `.env.*.local`
- **High-entropy strings**: Random strings exceeding 30 characters in config contexts

### Pre-commit Hook Setup

Install gitleaks as a pre-commit hook to catch secrets before they reach the repository:

```bash
# Install gitleaks (one-time)
# macOS: brew install gitleaks
# Windows: scoop install gitleaks
# Linux: see https://github.com/gitleaks/gitleaks#installation

# Run manually against staged files
gitleaks protect --staged --verbose

# Scan full repository history
gitleaks detect --source . --verbose
```

### CI Workflow Integration

Add a `secret-scanning` job to CI workflows:

```yaml
secret-scanning:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Run Gitleaks
      uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Response to Detected Secrets

If secret scanning detects a potential secret:

1. **Stop the pipeline** — Do not proceed with deploy or merge
2. **Verify the finding** — Confirm whether the detected string is a live secret or a false positive (e.g., `.env.example` placeholder)
3. **If confirmed live secret**:
   - Rotate the credential immediately (see rotation procedures above)
   - Remove the secret from git history using `git filter-repo` or BFG Repo-Cleaner
   - Force-push the cleaned history (coordinate with team)
   - Re-scan to confirm removal
4. **If false positive**:
   - Add a `.gitleaksallow` file with the allowed fingerprint
   - Document the exception in the PR description
   - Require reviewer approval for the exception

### `.gitleaksallow` Exceptions

Place a `.gitleaksallow` file at the repository root to document approved false positives:

```
# .gitleaksallow — approved false positives
# Format: fingerprint (first 10 chars of SHA256) followed by comment
# Example: abc123def4  # .env.example placeholder value
```

### Deployment Gate

No deployment to staging or production proceeds if:

- Secret scanning CI job fails with unacknowledged findings
- `.env` files are detected in the build context
- Unrotated secrets from previous findings remain in git history

### Operational Impact

- Secret scanning adds ~10–30 seconds to CI pipeline runtime
- False positives from test fixtures should be added to `.gitleaksallow`
- Contributors must install gitleaks locally for pre-commit scanning (recommended but not enforced)
- GitHub secret scanning alerts appear in the repository Security tab

## Related Documentation

- `docs/deployment.md`
- `docs/backend-deploy.md`
- `docs/runbooks/cicd-security.md`
