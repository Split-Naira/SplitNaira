# CI/CD Data Integrity Runbook (#437)

## Purpose

GitHub Actions must block merges when contract artifacts drift, when Rust formatting fails, or when app tests break against the committed interface.

## Workflows

| Workflow | Trigger | Gates |
|----------|---------|-------|
| `ci.yml` | PR + push to `main` | `data-integrity` → frontend, backend, contracts |
| `frontend-ci.yml` | PR + push to `main` / `develop` | lint, test, build |
| `contract-testnet-deploy.yml` | `contracts/**` on `main` | testnet WASM deploy + config commit |
| `backend-deploy.yml` | backend release path | deploy config validation, data integrity, Render deploy |
| `mainnet-deploy.yml` | manual production release | deploy config validation, data integrity, backend lint/build/test |

## Data integrity job

The `data-integrity` job runs first:

```bash
npm ci
npm run verify:data-integrity
```

Downstream jobs (`frontend`, `backend`, `contracts`) depend on it so artifact drift fails fast.

The `contracts` job additionally:

- `cargo fmt --check`
- `cargo test --locked`
- `cargo build --release --target wasm32v1-none --locked`

## Local parity

```bash
npm run verify:data-integrity
npm run test
```

## Operational impact

| Failure | Meaning | Action |
|---------|---------|--------|
| `verify:data-integrity` | Uncommitted generated files | Run generators, commit |
| `cargo fmt` | Rust style drift | `cargo fmt` in `contracts/` |
| Backend tests | API/contract mismatch | Fix routes or refresh types |
| Frontend build | Env or type errors | Fix `frontend/src/lib/env.ts` / types |

## Rollback

1. **Revert the failing PR** — CI returns green on `main`.
2. **Skip deploy workflows** — Do not run `contract-testnet-deploy` or `backend-deploy` manually if production secrets are invalid.
3. **Use the GitHub environment rollback path** — Render keeps previous deploys and the backend workflow is safe to rerun.
4. **Re-run failed jobs** — Transient RPC or npm registry issues; no config change.

## Adding new checks

1. Extend `scripts/verify-data-integrity.mjs` for deterministic, diff-based gates.
2. Wire `npm run verify:data-integrity` in `ci.yml` only (single source of truth).
3. Document new checks in this runbook.
