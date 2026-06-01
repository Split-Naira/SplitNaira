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

### Data integrity & release ops

```bash
npm run verify:data-integrity   # contract interface + generated types in sync
```

## Mainnet launch readiness

- `backend-deploy.yml` now validates production deploy configuration and required secrets before triggering Render.
- `mainnet-deploy.yml` provides an explicit manual production release gate for human-reviewed mainnet launch.
- CI pipelines use concurrency groups to cancel stale runs and keep mainline validation fast.
- Operational rollback guidance is documented in `docs/runbooks/ci-data-integrity.md` and `docs/deployment.md`.

## License

MIT
