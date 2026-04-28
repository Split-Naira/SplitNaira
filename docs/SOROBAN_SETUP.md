# Soroban SDK & CLI Setup

This doc explains the supported Soroban toolchain for SplitNaira.

## Supported versions
- Rust: `1.76+` (stable)
- Cargo: included with Rust
- Soroban CLI: `>=0.28.0` (test coverage in repo built against current network)
- Stellar CLI: latest stable

## Install

### Rust (Windows)
```powershell
# Using rustup (PowerShell or CMD)
winget install Rustlang.Rust.MSVC

# Or manually
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup update
```

### Visual Studio Build Tools
Soroban contracts require MSVC build tools. Install via:

1. Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Select "Desktop development with C++" workload
3. Ensure Windows 10/11 SDK is included

Alternatively, run in PowerShell:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --add Microsoft.VisualStudio.Workload.VC
```

### Soroban CLI
```bash
cargo install soroban-cli --locked
```

### Stellar CLI
```bash
cargo install stellar-cli
```

## Troubleshooting Windows Build Errors

### "LINK : fatal error LNK1181"
**Cause:** Missing MSVC build tools.

**Fix:** Install Visual Studio Build Tools with C++ workload.

### "error: program 'link.exe' not found"
**Cause:** Windows SDK path not in PATH.

**Fix:** Open "Developer Command Prompt for VS2022" or run:
```cmd
"%VSINSTALLDIR%\VC\Auxiliary\Build\vcvars64.bat"
```

### "error: could not find native static library `c++`"
**Cause:** C++ standard library not linked.

**Fix:** Ensure MSVC is properly installed and run from VS Developer Prompt.

## Workspace steps
```bash
# Install the Soroban WASM target (one-time)
rustup target add wasm32v1-none

cd contracts
cargo test --locked
cargo build --release --target wasm32v1-none --locked
```

## Deploy artifacts
- `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm`
- `contracts/target/wasm32v1-none/release/splitnaira_contract.wasm.sha256`

## Notes
- `soroban contract deploy` is the preferred deployment command.
- `cargo test` must pass before deploy.
