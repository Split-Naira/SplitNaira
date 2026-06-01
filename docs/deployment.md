# SplitNaira — End-to-End Deployment Runbook

This is the single authoritative guide for deploying SplitNaira from source to a running environment. It covers testnet, staging, and production in order. A new operator should be able to complete a full release without asking maintainers.

**Related docs:**
- [Contract Release & Upgrade Runbook](./contract-release-and-upgrade-runbook.md)
- [Backend CD](./backend-deploy.md)
- [Soroban / CLI Setup](./SOROBAN_SETUP.md)
- [Release Readiness Checklist](./release-readiness-checklist.md)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variables Reference](#2-environment-variables-reference)
3. [Phase 1 — Testnet Deploy](#3-phase-1--testnet-deploy)
4. [Phase 2 — Staging Deploy](#4-phase-2--staging-deploy)
5. [Phase 3 — Production Deploy](#5-phase-3--production-deploy)
6. [Smoke Tests](#6-smoke-tests)
7. [Rollback Procedures](#7-rollback-procedures)
8. [Operational Notes](#8-operational-notes)

---

## 1. Prerequisites

### Toolchain

| Tool | Minimum version | Install reference |
|---|---|---|
| Node.js | 18 | [nodejs.org](https://nodejs.org) |
| Rust (stable) | 1.76 | `rustup default stable` |
| Soroban CLI | 0.28 | `cargo install soroban-cli --locked` |
| Stellar CLI | latest stable | `cargo install stellar-cli` |
| PostgreSQL | 14 | Managed DB or self-hosted |
| Docker | any recent | Required for frontend container deploys |

See [docs/SOROBAN_SETUP.md](./SOROBAN_SETUP.md) for Windows-specific Rust/MSVC setup.

### Access

- GitHub repository write access (to trigger CD workflows)
- Render account with backend service configured (or equivalent PaaS)
- PostgreSQL connection string for each environment
- Stellar deployer key funded with Lumens on the target network
- Freighter wallet (for manual smoke tests via the UI)

### One-time WASM target setup

```bash
rustup target add wasm32v1-none
```

---

## 2. Environment Variables Reference

Copy `.env.example` to `.env` (or set these as secrets/config vars in your hosting platform) before deploying each service.
See [docs/environments.md](./environments.md) for the full matrix and per-environment examples.
See [docs/secrets.md](./secrets.md) for authoritative secret handling, rotation procedures, and the rule to never commit `.env` files.

### Backend (`backend/.env.example`)

| Variable | Description | Example |
|---|---|---|
| `PORT` | HTTP port the API listens on | `3001` |
| `CORS_ORIGIN` | Comma-separated allowed origins | `https://app.splitnaira.com` |
| `LOG_LEVEL` | Winston log level | `info` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/splitnaira` |
| `HORIZON_URL` | Stellar Horizon endpoint | `https://horizon-testnet.stellar.org` |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `SOROBAN_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `CONTRACT_ID` | Deployed Soroban contract ID | `C...` (56-char Stellar contract address) |
| `SIMULATOR_ACCOUNT` | Optional simulator account address | `G...` |

### Frontend (`frontend/.env.example`)

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | Network name | `testnet` or `mainnet` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Soroban contract ID | `C...` |
| `NEXT_PUBLIC_HORIZON_URL` | Stellar Horizon endpoint | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_API_BASE_URL` | Backend API base URL | `https://api.splitnaira.com` |

### Network passphrases

| Network | Passphrase |
|---|---|
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

---

## 3. Phase 1 — Testnet Deploy

Use testnet to validate the full stack before touching staging or production. All steps are safe to repeat.

### Step 1 — Validate and build the contract

```bash
cd contracts
cargo test --locked
cargo fmt -- --check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32v1-none --locked
```

Verify the artifact exists:

```
contracts/target/wasm32v1-none/release/splitnaira_contract.wasm
```

### Step 2 — Regenerate contract interface (if ABI changed)

Run from the repo root:

```bash
npm run generate:contract-interface
npm run generate:contract-types
```

Review diffs in `contracts/interface/splitnaira.contract-interface.json` and `backend/src/generated/contract-types.ts` / `frontend/src/generated/contract-types.ts`. Commit any changes before deploying.

### Step 3 — Deploy contract to testnet

```bash
# Add testnet network config (one-time)
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Generate and fund a deployer key (one-time per environment)
stellar keys generate deployer
stellar keys fund deployer --network testnet

# Deploy
cd contracts
stellar contract deploy \
  --wasm target/wasm32v1-none/release/splitnaira_contract.wasm \
  --source deployer \
  --network testnet
```

Record the contract ID printed by the deploy command. You will need it in the next steps.

> See [contract-release-and-upgrade-runbook.md](./contract-release-and-upgrade-runbook.md) §5 for full contract deploy details and §7 for the upgrade path.

### Step 3a — Bootstrap admin and allowlist standard testnet tokens

After deploying the contract, set the contract admin and allowlist the documented standard testnet assets in one step.

Standard testnet assets:
- USD Coin (USDC): `CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR`
- Soroban Waved USD (wUSD): `CDLZJQG2OZZXZAU3YICESOJE73SOXREH74DRBEDAFTMPAQWX3JD3YQ`

Run:

```bash
CONTRACT_ID=<contract id> ADMIN_SECRET=<admin secret> ./scripts/bootstrap-allowlist.sh
```

If `ADMIN_PUBLIC` cannot be derived automatically from `ADMIN_SECRET`, provide it explicitly:

```bash
ADMIN_PUBLIC=<admin public key> CONTRACT_ID=<contract id> ADMIN_SECRET=<admin secret> ./scripts/bootstrap-allowlist.sh
```

The script builds and signs `set_admin` and `allow_token` operations for the testnet tokens, and prints the transaction output for each operation.

Verify the bootstrap result:

```bash
soroban contract invoke \
  --id <contract id> \
  --network testnet \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url https://soroban-testnet.stellar.org \
  --fn is_token_allowed \
  --args address <token contract id>
```

Expected output for each allowlisted token is `true`.

### Step 4 — Configure backend environment

```bash
cd backend
cp .env.example .env
```

Set at minimum:

```
DATABASE_URL=postgresql://...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=<contract ID from Step 3>
CORS_ORIGIN=http://localhost:3000
```

### Step 5 — Provision and migrate the database

The backend uses TypeORM. In non-production environments `synchronize: true` is set, so the schema is applied automatically on first start. For production, see [Phase 3 §DB migrations](#db-migrations).

```bash
cd backend
npm ci
npm run build
npm run start
```

Confirm the server logs `Database connection established` and `Server started on port 3001`.

### Step 6 — Configure and run the frontend

```bash
cd frontend
cp .env.example .env.local
```

Set:

```
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_ID=<contract ID from Step 3>
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

```bash
npm ci
npm run build
npm run start
```

### Step 7 — Run smoke tests

See [§6 Smoke Tests](#6-smoke-tests).

---

## 4. Phase 2 — Staging Deploy

Staging mirrors production configuration but uses testnet (or a dedicated staging network). The goal is to validate the CD pipeline and infrastructure before touching production.

### Checklist

- [ ] All testnet smoke tests pass (Phase 1 complete)
- [ ] Contract interface artifacts are committed and up to date
- [ ] Backend and frontend tests pass in CI (`npm run test` in each directory)
- [ ] `DATABASE_URL` points to the staging database
- [ ] `CONTRACT_ID` is set to the testnet contract deployed in Phase 1
- [ ] `CORS_ORIGIN` is set to the staging frontend URL
- [ ] `NEXT_PUBLIC_API_BASE_URL` points to the staging backend URL

### Step 1 — Trigger backend deploy

Push to `main` or trigger the workflow manually:

1. Go to **Actions → Backend Deploy** in GitHub.
2. Click **Run workflow** and select the `main` branch.
3. Set `deploy_environment` to `staging` or `production`.
4. The pipeline runs `verify-backend` (lint + build), validates deployment configuration, then calls the Render deploy hook.

Required GitHub secrets:
- `RENDER_BACKEND_DEPLOY_HOOK_URL`
- `MAINNET_CONTRACT_ID` (production only)

### Mainnet release

For explicit production releases, use the dedicated manual workflow:

- **Actions → Mainnet Deploy**
- `deploy_environment` defaults to `production`
- This workflow validates mainnet deploy configuration before invoking Render
- It is intended for safe, human-reviewed mainnet rollouts

See [docs/backend-deploy.md](./backend-deploy.md) for full CI/CD details.

### Step 2 — Deploy frontend

**Docker (recommended for staging/production):**

```bash
cd frontend
docker build -t splitnaira-frontend .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_STELLAR_NETWORK=testnet \
  -e NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  -e NEXT_PUBLIC_CONTRACT_ID=<contract ID> \
  -e NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org \
  -e NEXT_PUBLIC_API_BASE_URL=https://api-staging.splitnaira.com \
  splitnaira-frontend
```

See [frontend/DOCKER.md](../frontend/DOCKER.md) for full Docker options.

**Node (alternative):**

```bash
cd frontend
npm ci
npm run build
npm run start
```

### Step 3 — Run smoke tests against staging

Repeat the smoke test suite (§6) against the staging URLs. All checks must pass before proceeding to production.

---

## 5. Phase 3 — Production Deploy

> **Stop.** Confirm staging smoke tests passed before continuing.

Production uses Stellar mainnet. The contract ID, network passphrase, and RPC URLs are different from testnet.

### Step 1 — Deploy contract to mainnet

```bash
# Add mainnet network config (one-time)
stellar network add mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"

# Fund deployer key on mainnet with real XLM before deploying
stellar keys fund deployer --network mainnet  # only works on testnet; fund manually on mainnet

cd contracts
stellar contract deploy \
  --wasm target/wasm32v1-none/release/splitnaira_contract.wasm \
  --source deployer \
  --network mainnet
```

Record the mainnet contract ID. Store it in your secrets manager or CI environment variables — do not commit it to the repository.

### Step 2 — Set production environment variables

**Backend (set in Render or your hosting platform's config vars):**

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://...  (production DB)
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
HORIZON_URL=https://horizon.stellar.org
CONTRACT_ID=<mainnet contract ID>
CORS_ORIGIN=https://app.splitnaira.com
LOG_LEVEL=info
```

**Frontend (set as build-time env vars or Docker env):**

```
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
NEXT_PUBLIC_CONTRACT_ID=<mainnet contract ID>
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_API_BASE_URL=https://api.splitnaira.com
```

### Step 3 — DB migrations

In production `synchronize` is disabled. Apply schema changes explicitly before starting the backend:

```bash
cd backend
npm run build
# Run TypeORM migrations (add this script if not present):
node dist/node_modules/.bin/typeorm migration:run -d dist/src/services/database.js
```

> If no migration files exist yet, the initial schema is applied by the first `synchronize: true` run in a non-production environment. For production, generate and commit migration files from that schema before go-live.

### Step 4 — Deploy backend to production

Push to `main` or trigger the GitHub Actions workflow:

1. **Actions → Backend Deploy → Run workflow** (select `main`).
2. Monitor the `verify-backend` and `deploy-backend` job logs.
3. Confirm the Render service shows a successful deploy and the health endpoint responds.

### Step 5 — Deploy frontend to production

```bash
cd frontend
docker build -t splitnaira-frontend:prod .
# Push to your container registry and deploy via your hosting platform
docker tag splitnaira-frontend:prod <registry>/splitnaira-frontend:prod
docker push <registry>/splitnaira-frontend:prod
```

Or trigger your frontend CD pipeline if configured.

### Step 6 — Run production smoke tests

Repeat the smoke test suite (§6) against production URLs. If any check fails, execute the rollback procedure (§7) immediately.

---

## 6. Smoke Tests

Run these checks after every deploy, against the target environment's URLs.

### API health

```bash
curl -s https://<backend-url>/health | jq .
# Expected: { "status": "ok" }

curl -s https://<backend-url>/ | jq .
# Expected: { "name": "SplitNaira API", "status": "ok", "version": "0.1.0" }
```

### Database connectivity

A successful `/health` response confirms the backend connected to the database. If the health check fails, check `DATABASE_URL` and network access from the backend host.

### Contract connectivity

```bash
curl -s https://<backend-url>/splits | jq .
# Expected: 200 with a projects array (may be empty on first deploy)
```

### Contract event flow (manual or integration test)

Using the UI or Stellar CLI, execute one full flow:

1. Create a project (`create_project`)
2. Deposit funds (`deposit`)
3. Distribute to collaborators (`distribute`)

Verify the Horizon event stream includes:
- `project_created`
- `deposit_received`
- `payment_sent`
- `distribution_complete`

### Frontend reachability

Open `https://<frontend-url>` in a browser. Confirm:
- Page loads without console errors
- Freighter wallet connects on testnet/mainnet as appropriate
- The splits dashboard renders (may be empty)

### API documentation

```bash
curl -s https://<backend-url>/api/openapi.json | jq .info
# Expected: OpenAPI info block with title and version
```

---

## 7. Rollback Procedures

### Contract rollback

Soroban contracts are immutable once deployed. Rollback means pointing services back to the previous contract ID.

1. Retrieve the last known-good `CONTRACT_ID` from your secrets manager or deployment history.
2. Update `CONTRACT_ID` in backend config vars and redeploy the backend (§5 Step 4).
3. Update `NEXT_PUBLIC_CONTRACT_ID` in frontend config and redeploy the frontend (§5 Step 5).
4. Run smoke tests to confirm the previous contract is responding correctly.

> Keep the last stable contract ID documented in your deployment log or secrets manager at all times.

See [contract-release-and-upgrade-runbook.md](./contract-release-and-upgrade-runbook.md) §7 for the full upgrade/rollback strategy including blue/green canary approach.

### Backend rollback

Render retains previous deploys. To roll back:

1. Open the Render dashboard → your backend service → **Deploys**.
2. Select the last successful deploy and click **Redeploy**.
3. Confirm the health endpoint responds after the rollback deploy completes.

If using another platform, redeploy the previous Docker image tag or Git SHA.

### Frontend rollback

Redeploy the previous Docker image tag:

```bash
docker pull <registry>/splitnaira-frontend:<previous-tag>
# Restart your container or update your hosting platform to use the previous tag
```

Or revert the frontend CD pipeline to the previous commit SHA.

### Database rollback

If a migration caused data issues:

1. Stop the backend to prevent further writes.
2. Restore from the most recent pre-migration backup.
3. Redeploy the previous backend version.
4. Verify data integrity before resuming traffic.

> Always take a database snapshot before running migrations in production.

---

## 8. Operational Notes

### Storage TTL maintenance

Soroban contract storage has a TTL. For long-lived or quiet projects, call `refresh_project_storage(project_id)` on a weekly or bi-weekly cadence to prevent state eviction. See [contract-release-and-upgrade-runbook.md](./contract-release-and-upgrade-runbook.md) §9 for the full TTL policy and incident response steps.

### Rate limits

The backend applies per-route rate limits. Auth endpoints (`/users/register`, `/users/login`) have stricter limits to block credential stuffing. If you see 429 responses during smoke tests, wait for the window to reset or adjust limits in `backend/src/middleware/rate-limit.ts` before deploying.

### CORS

`CORS_ORIGIN` accepts a comma-separated list of origins. In production, set it to the exact frontend URL(s) — no trailing slash, no wildcards.

### Logs

The backend uses Winston. Set `LOG_LEVEL=debug` temporarily to diagnose startup issues, then revert to `info` for production.

### Graceful shutdown

The backend handles `SIGTERM` and `SIGINT` for graceful shutdown. The default force-exit timeout is 10 seconds (`SHUTDOWN_FORCE_TIMEOUT_MS`). Increase this if your hosting platform sends SIGTERM well before killing the process.

### i18n

The frontend supports English (`en`) and French (`fr`) via `next-intl`. Locale-prefixed routes (`/en`, `/fr`) are enabled by default. To add a language, update `frontend/src/i18n/routing.ts` and add `frontend/messages/<locale>.json`.
