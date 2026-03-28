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

## Getting Started

Prerequisites:

- Node.js >= 18
- Rust + Cargo
- Stellar CLI (optional for deploy)

1. Frontend

```bash
cd frontend
npm install
npm run dev
```

2. Backend

```bash
cd backend
npm install
npm run dev
```

3. Contracts

```bash
cd contracts
cargo build
cargo test
```

4. Environment setup

```bash
# Frontend
cp frontend/.env.example frontend/.env.local

# Backend
cp backend/.env.example backend/.env
```

### Frontend Environment Variables

Create `frontend/.env.local` from the template and configure:

```bash
# Stellar network (testnet or mainnet)
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# Soroban RPC URL for contract interactions
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Horizon URL for Stellar operations
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org

# Deployed Soroban contract ID
NEXT_PUBLIC_CONTRACT_ID=

# Backend API URL
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

### Backend Environment Variables

Create `backend/.env` from the template and configure:

```bash
# Stellar network configuration
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Deployed contract ID
CONTRACT_ID=

# Server configuration
PORT=3001
NODE_ENV=development
```

## Testnet Deployment Guide

Use this guide to build the Soroban contract, deploy to Stellar testnet, and wire the deployed contract ID into backend/frontend.

### Prerequisites

- `stellar` CLI installed and authenticated
- Rust toolchain installed
- A funded Stellar testnet account for deployment

### 1) Build the contract (WASM)

```bash
cd contracts
stellar contract build
```

Built artifact is generated under `contracts/target/wasm32v1-none/release/`.

### 2) Configure testnet in Stellar CLI

```bash
stellar network add testnet --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
```

If your deployer key is not set up yet:

```bash
stellar keys generate alice
stellar keys fund alice --network testnet
```

### 3) Deploy the contract to testnet

From `contracts/`, run:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/splitnaira_contract.wasm \
  --source alice \
  --network testnet
```

Copy the returned contract ID (starts with `C...`).

### 4) Set contract ID in backend

Update `backend/.env`:

```bash
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
CONTRACT_ID=<PASTE_TESTNET_CONTRACT_ID>
```

### 5) Set contract ID in frontend

Update `frontend/.env.local`:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_ID=<PASTE_TESTNET_CONTRACT_ID>
```

### 6) Run backend + frontend against testnet

```bash
# terminal 1
cd backend
npm install
npm run dev
```

```bash
# terminal 2
cd frontend
npm install
npm run dev
```

### 7) Quick verification

- Backend health endpoint responds at `http://localhost:3001/health`
- Frontend loads at `http://localhost:3000`
- Creating a split from frontend/backend flow returns an unsigned XDR built against your deployed testnet contract ID

## Project Structure

```
splitnaira/
  backend/
    src/
      index.ts
      routes/
      services/
      middleware/
  contracts/
    Cargo.toml
    lib.rs
    errors.rs
    events.rs
    tests.rs
  demo/
    frontend demo.html
  frontend/
    src/
      app/
      components/
      lib/
```

## CI

GitHub Actions runs the following checks:

- Frontend: `npm run lint`, `npm run build`
- Backend: `npm run lint`, `npm run build`
- Contracts: `cargo test`

## Contract release runbook

- Main runbook: [docs/contract-release-and-upgrade-runbook.md](./docs/contract-release-and-upgrade-runbook.md)
- Readiness checklist: [docs/release-readiness-checklist.md](./docs/release-readiness-checklist.md)
- Soroban setup: [docs/SOROBAN_SETUP.md](./docs/SOROBAN_SETUP.md)

## Backend CD

- Backend deployment workflow: `.github/workflows/backend-deploy.yml`
- Default deploy target: Render
- Deployment setup docs: [docs/backend-deploy.md](./docs/backend-deploy.md)

## Roadmap

- [x] Contract baseline
- [x] Frontend scaffold
- [x] Backend scaffold
- [ ] Wallet integration
- [ ] Split creation UI wired to Soroban
- [ ] Testnet deployment
- [ ] Earnings dashboard
- [ ] Mainnet launch

## Contributing

We welcome contributions from developers, designers, and creatives who care about fair pay in Nigeria's creative economy.

Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
