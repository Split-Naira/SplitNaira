# Soroban SDK & CLI Setup

This doc explains the supported Soroban toolchain for SplitNaira.

## Supported versions
- Rust: `1.76+` (stable)
- Cargo: included with Rust
- Soroban CLI: `>=0.28.0` (test coverage in repo built against current network)
- Stellar CLI: latest stable

## Install

### Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup update
```

### Soroban CLI
```bash
cargo install soroban-cli --locked
```

### Stellar CLI
```bash
cargo install stellar-cli
```

## Workspace steps
```bash
cd contracts
cargo build
cargo test
```

## Deploy artifacts
- `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`
- `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm.sha256`

## Notes
- `soroban contract deploy` is the preferred deployment command.
- `cargo test` must pass before deploy.
