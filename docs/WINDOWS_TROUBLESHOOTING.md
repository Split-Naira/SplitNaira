# Windows Troubleshooting Guide

This guide covers the Windows/PowerShell-specific wrinkles you may hit while
setting up and working on **SplitNaira**. It follows the same setup flow as
[`CONTRIBUTING.md`](../CONTRIBUTING.md#-development-setup) — fork/clone,
install dependencies, configure `.env`, run locally, connect Freighter — but
calls out the commands and gotchas that differ on Windows.

> This guide has not yet been reviewed by a Windows-based contributor.
> If you hit something here that doesn't match your setup, please open an
> issue or PR to correct it.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start in PowerShell](#quick-start-in-powershell)
- [Build & Test Commands](#build--test-commands)
- [Common Node.js Issues](#common-nodejs-issues)
- [Common Rust / Soroban Issues](#common-rust--soroban-issues)
- [Common Docker Issues](#common-docker-issues)
- [Common Path Issues](#common-path-issues)
- [Line Ending Expectations](#line-ending-expectations)
- [Getting Help](#getting-help)

---

## Prerequisites

- **Git for Windows** — https://git-scm.com/download/win (this also provides
  Git Bash, useful as a fallback shell for the `.sh` helper scripts in this
  repo).
- **Node.js 18+** and **npm 8+** (see `engines` in the root `package.json`).
  Prefer installing Node via a version manager rather than the standalone
  installer — see [Common Node.js Issues](#common-nodejs-issues).
- **Rust via `rustup`** — install from https://rustup.rs (the Windows
  installer, `rustup-init.exe`). See
  [Common Rust / Soroban Issues](#common-rust--soroban-issues) below and
  [`docs/SOROBAN_SETUP.md`](./SOROBAN_SETUP.md) for the full Soroban/Stellar
  CLI toolchain.
- **Docker Desktop** with the **WSL2 backend** enabled — required to run the
  Postgres/backend/frontend services defined in the root `docker-compose.yml`.
- **PowerShell 7+ (`pwsh`)** is recommended over the Windows PowerShell 5.1
  that ships with Windows, since it behaves more consistently with modern
  tooling. Everything below is written for PowerShell; note where Windows
  PowerShell 5.1 differs.

---

## Quick Start in PowerShell

### 1. Fork & clone

```powershell
git clone https://github.com/YOUR_USERNAME/splitnaira.git
cd splitnaira
```

### 2. Install dependencies

This repo is an **npm workspaces** monorepo (`frontend` and `backend` are
declared as workspaces in the root `package.json`), so a single install from
the repo root already pulls in both workspace packages' dependencies:

```powershell
npm install
```

The repo also defines a `setup` script that mirrors the full manual sequence
from `CONTRIBUTING.md` (install root, then `frontend`, then `backend`, then
`cargo build` the contracts):

```powershell
npm run setup
```

**Gotcha:** the `setup` script's *source* in `package.json` is written as a
single bash line chained with `&&`:

```
npm install && cd frontend && npm install && cd ../backend && npm install && cd ../contracts && cargo build
```

`npm run setup` itself works fine on Windows because npm invokes package.json
scripts through `cmd.exe`, which understands `&&`. But if you ever copy that
chain out and try to paste it directly into your **PowerShell prompt**, it
will fail — Windows PowerShell 5.1 does not support `&&`/`||` as command
separators at all, and even PowerShell 7+ only added them recently. Run the
steps as separate lines (or separate with `;`) instead:

```powershell
npm install
cd frontend
npm install
cd ..\backend
npm install
cd ..\contracts
cargo build
cd ..
```

### 3. Configure environment

```powershell
Copy-Item .env.example .env
# Fill in your Stellar testnet keys and local DB credentials
```

(`cp` also works if you're using Git Bash or PowerShell 7 with the Unix alias
loaded, but `Copy-Item` is the native PowerShell cmdlet and works everywhere.)

### 4. Run locally

```powershell
# Frontend (from /frontend)
npm run dev

# Backend (from /backend, separate terminal)
npm run dev
```

**Gotcha:** the root convenience script `npm run dev` runs
`npm run dev:frontend & npm run dev:backend` — on Unix shells `&` backgrounds
the first job so both dev servers run concurrently. Because npm runs scripts
through `cmd.exe` on Windows, `&` there just means "run this command, then
run the next one" (sequential, not parallel) — so on Windows, `npm run dev`
from the repo root will start the frontend dev server and never get to the
backend one, since the frontend dev server doesn't exit. **On Windows, open
two terminal tabs and run `npm run dev:frontend` and `npm run dev:backend`
separately instead of the combined `npm run dev`.**

### 5. Connect Freighter Wallet

Same as `CONTRIBUTING.md`: install the
[Freighter browser extension](https://freighter.app), switch it to
**Testnet**, and fund your wallet via
[Stellar Friendbot](https://friendbot.stellar.org). No Windows-specific steps
here — Freighter runs the same in Chrome/Edge/Firefox on Windows.

---

## Build & Test Commands

All of the root npm scripts work the same way from PowerShell as they do from
bash, since npm executes them through its own script-runner shell:

```powershell
npm run build           # build:frontend, build:backend, build:contracts in turn
npm run test            # test:frontend, test:backend, test:contracts in turn
npm run test:frontend
npm run test:backend
npm run test:contracts  # equivalent to: cd contracts; cargo test
npm run lint
```

For contract-only work from inside `contracts/`:

```powershell
cd contracts
cargo test
cargo build
```

**Gotcha:** `npm run clean` runs `rm -rf frontend/build backend/dist && cd contracts && cargo clean`.
`rm` is not a `cmd.exe`/PowerShell built-in, so this script will fail on a
plain Windows setup. Work around it by either:
- running it from **Git Bash** (which provides `rm`), or
- manually removing the build output folders with PowerShell:
  ```powershell
  Remove-Item -Recurse -Force frontend\build, backend\dist -ErrorAction SilentlyContinue
  cd contracts; cargo clean; cd ..
  ```

---

## Common Node.js Issues

For a step-by-step `npm ci`/`npm install` recovery flow, including file-lock,
registry/TLS, and lockfile mismatch triage, see the
[Windows npm Dependency Installation Runbook](./contributors/windows-setup-guide.md).

- **`node-gyp` / native module build failures.** Some npm dependencies
  compile native addons during `npm install`. On Windows this requires the
  same Visual Studio Build Tools ("Desktop development with C++" workload)
  called out for Rust below. Install via:
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --add Microsoft.VisualStudio.Workload.VC
  ```
  If `npm install` fails with errors mentioning `node-gyp`, `MSBUILD`, or
  `gyp ERR!`, this is almost always the missing build tools.
- **Long path failures during install.** Deeply nested `node_modules` inside
  an npm workspaces monorepo (`frontend/node_modules/...`, plus the root
  `node_modules`) can exceed Windows' historical `MAX_PATH` (260 character)
  limit, causing `ENAMETOOLONG` or unexplained `ENOENT` errors during
  `npm install`. Enable long path support:
  ```powershell
  # Run as Administrator
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
    -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```
  and also tell Git to allow long paths (see
  [Common Path Issues](#common-path-issues) below).
- **Node version drift.** The repo requires Node `>=18` (see `engines` in the
  root `package.json`). Rather than relying on a single global Node install,
  use a Windows-friendly version manager:
  - [`nvm-windows`](https://github.com/coreybutler/nvm-windows) — closest
    Windows equivalent to `nvm`, or
  - [`fnm`](https://github.com/Schniz/fnm) — fast, works well in PowerShell
    and cross-platform if you also use WSL2.

---

## Common Rust / Soroban Issues

The contracts in `contracts/` build with standard `cargo`, and Windows
requires an extra toolchain decision that Linux/macOS don't:

- **MSVC vs GNU toolchain.** `rustup`'s default Windows target is
  `x86_64-pc-windows-msvc`, which needs the Visual Studio Build Tools (C++
  workload) installed — the same ones referenced above for `node-gyp`. If you
  see linker errors like `LINK : fatal error LNK1181` or
  `error: program 'link.exe' not found`, it means those build tools (or their
  `PATH`/environment setup) are missing. Alternatively, you can switch to the
  GNU toolchain (`x86_64-pc-windows-gnu`), which uses a bundled `mingw`
  linker instead of MSVC, at the cost of some ecosystem compatibility:
  ```powershell
  rustup toolchain install stable-x86_64-pc-windows-gnu
  rustup default stable-x86_64-pc-windows-gnu
  ```
- **Installing `rustup` itself.** Use the official Windows installer
  (`rustup-init.exe`) from https://rustup.rs rather than a package manager
  fork, so toolchain/target management (`rustup target add`, `rustup update`)
  behaves as documented.
- **Full Soroban/Stellar CLI setup, supported versions, and a Windows-specific
  troubleshooting table (build tool install commands, exact linker error
  messages and fixes, WASM target setup) already exist in
  [`docs/SOROBAN_SETUP.md`](./SOROBAN_SETUP.md#rust-windows) — read that
  doc for anything contract/Soroban-toolchain related rather than duplicating
  it here.**

---

## Common Docker Issues

The root `docker-compose.yml` spins up three services: `postgres`
(`postgres:16-alpine`, exposed on `5432` by default), `backend` (exposed on
`3001`), and `frontend` (exposed on `3000`), all on a shared `splitnaira`
Docker network.

- **Docker Desktop + WSL2 backend is required, not optional.** The legacy
  Hyper-V-only backend is deprecated and noticeably slower for bind-mounted
  volumes. In Docker Desktop: **Settings → General → "Use the WSL 2 based
  engine"**, and under **Settings → Resources → WSL Integration**, enable
  integration with your default WSL distro.
- **`docker-compose` command availability.** Recent Docker Desktop versions
  ship the Compose plugin as `docker compose` (space, no hyphen). If a script
  or your muscle memory uses the hyphenated `docker-compose`, install the
  standalone binary or use `docker compose` consistently — both should work
  side by side on a current Docker Desktop install, but only one may be on
  `PATH` depending on how Docker Desktop was installed.
- **Volume mount path translation.** Bind mounts declared with Windows paths
  in `docker-compose.yml` or `.env` (e.g. `C:\Users\you\splitnaira`) need to
  be reachable from the Linux VM that WSL2 runs. Prefer running
  `docker compose` **from inside a WSL2 distro** (with the repo cloned into
  the Linux filesystem, e.g. `~/splitnaira`) rather than from Windows-native
  PowerShell against a Windows-path checkout — this avoids the
  `/c/Users/...` vs `C:\Users\...` path-translation layer entirely and is
  noticeably faster for file-watching/hot-reload, since crossing the
  WSL2/Windows filesystem boundary on every file change is slow. If you must
  run from Windows-native PowerShell, expect `docker compose` volume mounts
  to auto-translate `C:\Users\you\...` to `/mnt/c/Users/you/...` inside the
  container — this works but file-watching latency (e.g. Next.js hot reload
  in `frontend`) tends to be much slower across that boundary.
- **Line-ending corruption inside mounted volumes.** If `git config
  core.autocrlf` is set to `true` (converting LF to CRLF on checkout), files
  bind-mounted into Linux containers can end up with CRLF line endings that
  break shebang lines or shell scripts run inside the container. Use
  `core.autocrlf=input` as described in
  [Line Ending Expectations](#line-ending-expectations) below to avoid this.

---

## Common Path Issues

- **Backslash vs. forward slash.** Windows paths use `\`, but Node.js,
  npm scripts, and the `.sh` helper scripts in this repo assume POSIX-style
  `/` paths. Inside PowerShell, prefer forward slashes wherever a
  cross-platform tool (Node, npm, git) accepts them — most do — and only use
  backslashes for native PowerShell cmdlets (`Copy-Item`, `Remove-Item`,
  etc.).
- **`MAX_PATH` (260 character) limits.** As noted in
  [Common Node.js Issues](#common-nodejs-issues), the nested `node_modules`
  trees in this npm workspaces monorepo can exceed the legacy 260-character
  path limit. In addition to enabling `LongPathsEnabled` in the registry,
  also enable it for Git so long filenames don't break `git status`/`git
  add`/`git checkout`:
  ```powershell
  git config --global core.longpaths true
  ```
- **PowerShell execution policy blocking `npm`.** npm on Windows ships a
  `npm.ps1` wrapper script. If your PowerShell execution policy is the
  default `Restricted`, running `npm install`/`npm run ...` may fail with
  `... cannot be loaded because running scripts is disabled on this system`.
  Fix it (per-user, doesn't require admin) with:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```
- **Bash helper scripts.** The repo ships `submit_pr.sh` for opening PRs from
  a Unix shell. On native Windows PowerShell/cmd, use the pre-built Windows
  counterpart, **`submit_pr.bat`**, instead — both live in the repo root.
  (You can still use `submit_pr.sh` from Git Bash or WSL2 if you prefer.)

---

## Line Ending Expectations

This repo's [`.editorconfig`](../.editorconfig) sets `end_of_line = lf` for
all files (with default `.md` trailing-whitespace handling), so **all
committed files are expected to use LF (`\n`) line endings**, not Windows-
style CRLF (`\r\n`).

There is **no `.gitattributes` file** in this repo enforcing line endings at
the Git level — line-ending normalization currently relies entirely on
`.editorconfig` being respected by your editor (most editors, including
VS Code, honor it automatically if the EditorConfig extension/support is
enabled) plus your own Git configuration.

Because there's no repo-level `.gitattributes` safety net, **Windows
contributors should explicitly configure Git** to avoid introducing CRLF line
endings into commits (which would otherwise show up as noisy whole-file diffs
or break `.sh` shell scripts that assume LF):

```powershell
git config --global core.autocrlf input
```

`core.autocrlf=input` checks files out with whatever line ending is already
committed (LF, per `.editorconfig`) and normalizes any CRLF you type back to
LF on commit, without forcing CRLF into your working tree. This differs from
the more common Windows default recommendation of `core.autocrlf=true`, which
would convert files to CRLF locally — avoid `true` in this repo, since it
increases the odds of hooks/scripts changed to worse and creates noisy diffs.

If you're using a code editor, also make sure it isn't silently converting
line endings on save — in VS Code, check the line-ending indicator in the
bottom status bar and ensure it says `LF`, not `CRLF`.

---

## Getting Help

If you're stuck on something not covered here, see the
[Community](../CONTRIBUTING.md#-community) section of `CONTRIBUTING.md` for
GitHub Discussions, Twitter/X, and Telegram links, or open a GitHub Issue
describing your environment (Windows version, Node/npm/Rust versions, and the
exact command + error output).
