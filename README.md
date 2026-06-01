# SplitNaira

Royalty splitting for Nigeria's creative economy, powered by Stellar and Soroban.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-7B61FF)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Smart%20Contracts-Soroban-blueviolet)](https://soroban.stellar.org)
[![Wave Program](https://img.shields.io/badge/Stellar-Wave%20Program-blue)](https://drips.network/wave/stellar)

## Status

SplitNaira is in active development. This repo currently contains:

- `contracts/` Soroban smart contract and tests
- `frontend/` Next.js + Tailwind scaffold
- `backend/` Express API scaffold
- `demo/` Static HTML flow prototype

## Tech Stack

- Frontend: Next.js (App Router), TailwindCSS, TypeScript
- Backend: Node.js, Express, TypeScript
- Smart contracts: Soroban (Rust)
- Blockchain: Stellar (testnet + mainnet)

## Quick Start

### Option 1: Docker Compose (Recommended for demos & pre-deploy)

```bash
# Copy the environment template
cp .env.compose.example .env.local

# Start the entire stack (Postgres + Backend + Frontend)
docker compose up

# Access the services:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - API Docs: http://localhost:3001/api/docs
```

### Option 2: Local Development

```bash
# Install all dependencies
npm run setup

# Development (all services)
npm run dev

# Build all projects
npm run build

# Run tests
npm run test
```

## Getting Started

Prerequisites:

- Node.js >= 18
- Rust (latest stable)
- Docker (optional, but recommended for compose setup)

### Root Commands

Use npm scripts from the root to run commands across all projects:

| Command | Description |
|---------|------------|
| `npm run setup` | Install all dependencies for frontend, backend, and contracts |
| `npm run dev` | Start frontend and backend development servers |
| `npm run dev:frontend` | Start only frontend dev server |
| `npm run dev:backend` | Start only backend dev server |
| `npm run build` | Build all projects (frontend, backend, contracts) |
| `npm run build:frontend` | Build frontend |
| `npm run build:backend` | Build backend |
| `npm run build:contracts` | Build smart contracts |
| `npm run test` | Run all tests |
| `npm run test:frontend` | Run frontend tests |
| `npm run test:backend` | Run backend tests |
| `npm run test:contracts` | Run contract tests |
| `npm run lint` | Lint all projects |
| `npm run clean` | Clean build artifacts |

### Docker Compose

The `docker-compose.yml` provides a complete local stack for development and smoke testing:

**Services:**
- **Postgres** (`postgres:16-alpine`): Database with automatic initialization
- **Backend** (Express + TypeScript): API server with health checks
- **Frontend** (Next.js): Web application

**Features:**
- Postgres volume persistence
- Service health checks with ordered startup
- Environment variable templating via `.env.compose.example`
- Bridge networking for inter-service communication
- Production-ready multi-stage Docker builds

**Quick Commands:**

```bash
# Start the stack
docker compose up

# Start in background
docker compose up -d

# View logs
docker compose logs -f backend    # Backend logs
docker compose logs -f frontend   # Frontend logs
docker compose logs -f postgres   # Database logs

# Stop services
docker compose down

# Reset database (remove volumes)
docker compose down -v

# Rebuild images
docker compose up --build
```

**Environment Configuration:**

Copy `.env.compose.example` to customize the stack:

```bash
cp .env.compose.example .env.local
# Edit .env.local as needed
docker compose --env-file .env.local up
```

**Accessing Services:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API Documentation: http://localhost:3001/api/docs
- Database: localhost:5432 (user: `splitnaira`, password: `splitnaira`)

For production wallet and payment operations, configure `PAYMENTS_ADMIN_API_KEY` on the backend before exposing `/splits/admin/*`. If payout-impacting admin actions need to be frozen during an incident or rollback, set `PAYMENTS_ADMIN_WRITE_ENABLED=false` and redeploy or restart the backend with the updated environment.

### Individual Project Commands

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

#### Backend

```bash
cd backend
npm install
npm run dev
```

#### Smart Contracts

```bash
cd contracts
cargo test --locked
rustup target add wasm32v1-none
cargo build --release --target wasm32v1-none --locked
```

## Project Structure

```
splitNaira/
├── backend/         # Express API
├── contracts/      # Soroban smart contracts
├── frontend/       # Next.js application
└── demo/          # Static prototype
```

## Operational Health Checks

| Endpoint | Purpose |
|-----------|----------|
| /health/live | Liveness Probe |
| /health/ready | Readiness Probe |
| /health/startup | Startup Probe |

Used for Kubernetes, Docker Swarm and cloud deployment monitoring.

## Observability

### Metrics

GET /metrics

### Request Tracing

All requests include:

X-Correlation-Id

### Logging

Structured JSON logs are emitted for production monitoring.

## Mainnet Readiness

Endpoint:

GET /ops/mainnet-readiness

Purpose:

- Deployment validation
- Launch verification
- Configuration auditing
- Mainnet configuration and readiness audit before traffic cutover

This endpoint performs a lightweight operational check that includes:

- environment configuration validation
- database connectivity verification
- cache and runtime capacity metrics
- production secret audit and contract ID consistency check

Use it as a pre-deploy gate during release and rollback planning.

## Developer Setup

npm install
npm run verify:env
npm run dev

## Code Quality

npm run lint
npm run test

## Bundle Analysis

npm run analyze

## Documentation

- [Deployment Runbook](./docs/deployment.md)
- [Operational Runbooks](./docs/runbooks/README.md) (contracts, CI/CD, ops, frontend)
- [Contributing Guide](./CONTRIBUTING.md)
- [Contract Setup](./docs/SOROBAN_SETUP.md)
- [Contract Release & Upgrade](./docs/contract-release-and-upgrade-runbook.md)
- [Backend CD](./docs/backend-deploy.md)
- [API Docs](./docs/openapi.json)
- [Mainnet Launch Runbook](./docs/runbooks/mainnet-launch.md)
- [User Onboarding Runbook](./docs/runbooks/user-onboarding.md)
- [API Evolution Runbook](./docs/runbooks/api-evolution.md)
- [Changelog](./CHANGELOG.md)

## Release Versioning

SplitNaira uses `v0.x.y` git tags for release traceability. A tag identifies the exact source state for backend, frontend, and smart contract code.

- Draft GitHub Releases are created automatically when a `v0.x.y` tag is pushed, using the release notes from `CHANGELOG.md`.
- The contract WASM built from the tagged commit is the versioned smart contract artifact. The canonical build output is:
  - `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`
  - `contracts/target/wasm32v1-none/release/release-info.json`
- `CONTRACT_ID` is the deployed contract address for the target network; it is recorded separately from the repo release tag.
- Keep `CHANGELOG.md` up to date before tagging a release so GitHub Releases reflect the correct notes.

## Notes

The release tag maps source, artifact, and deployment metadata together. When deploying a tagged release, ensure the contract WASM and the runtime environment are built from the same tag.

### Data integrity & release ops

```bash
npm run verify:data-integrity   # contract interface + generated types in sync
```

## CI/CD Pipelines

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to `main` | Full suite: data-integrity, frontend, backend, contracts, security audit |
| `backend-deploy.yml` | CI success on `main` / manual | Deploy backend to staging or production via Render |
| `mainnet-deploy.yml` | Manual only | Production mainnet deploy with pre-flight validation gate |
| `user-onboarding-ci.yml` | push/PR touching onboarding files | Validate register/login/profile routes end-to-end |
| `frontend-ci.yml` | push/PR to `main`/`develop` | Frontend lint, test, build |
| `frontend-quality.yml` | PR | Frontend quality gate (lint, test, build) |
| `contract-testnet-deploy.yml` | push to `main` (contracts path) | Deploy Soroban contract to testnet |
| `smoke-testnet.yml` | Manual | Post-deploy smoke test on testnet |
| `dependency-audit.yml` | Weekly / manual | `npm audit` for high-severity vulnerabilities |

## Mainnet launch readiness

- `mainnet-deploy.yml` enforces a strict gate sequence: secret validation → backend verification → readiness gate → deploy → smoke test → rollback instructions on failure.
- `cancel-in-progress: false` ensures an in-flight mainnet deploy is never cancelled by a concurrent run.
- `backend-deploy.yml` validates production deploy configuration and required secrets before triggering Render.
- `user-onboarding-ci.yml` validates the full register → login → profile lifecycle on every onboarding-related change.
- CI pipelines use concurrency groups to cancel stale runs and keep mainline validation fast.
- Operational rollback guidance is documented in `docs/runbooks/mainnet-launch.md`, `docs/runbooks/user-onboarding.md`, and `docs/runbooks/api-evolution.md`.

## Frontend API Evolution

The `ApiClient` (`frontend/src/lib/api-client.ts`) provides:

- **`ApiError`** — typed error class with `isNotFound`, `isUnauthorized`, `isServerError`, `isClientError` helpers and a machine-readable `code` field.
- **Smart retry** — 4xx client errors are not retried (fail fast); 5xx and network errors retry up to 3 times with back-off.
- **Enriched Sentry tags** — `httpStatus` and `errorCode` on every captured `ApiError`.
- **Response mapping** — `mapProjectToCamelCase` handles both camelCase and snake_case backend responses for safe field-naming migrations.

See [API Evolution Runbook](./docs/runbooks/api-evolution.md) for change procedures.
- `backend-deploy.yml` now validates production deploy configuration, data integrity, and backend build/test before triggering Render.
- `mainnet-deploy.yml` now runs an explicit manual production release gate with deploy config validation, data integrity, backend lint, build, and tests.
- A new CI/CD incident management runbook documents incident triage, smoke-check failure handling, rollback, and recovery.
- CI pipelines use concurrency groups to cancel stale runs and keep mainline validation fast.
- Operational rollback guidance is documented in `docs/runbooks/ci-data-integrity.md`, `docs/runbooks/incident-management.md`, and `docs/deployment.md`.

## License

MIT
