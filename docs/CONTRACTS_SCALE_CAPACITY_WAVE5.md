# Contracts — Scale & Capacity (Wave 5)

Issue: Split-Naira/SplitNaira #511 — *[Contracts] Scale & Capacity – Wave 5 execution track*

This track restores the contract to a deployable state and adds an operator
lever for per-project capacity. It is split into two parts: **deployment-readiness
repairs** (the contract did not compile on `main`) and a **configurable capacity
limit**.

## 1. Audit findings — contract was not deploy-ready

`cargo build --target wasm32-unknown-unknown --release` failed on `main`, so the
WASM could not be produced and **no tests could run**. Five distinct defects were
found and fixed:

| # | Defect | Symptom | Fix |
|---|--------|---------|-----|
| 1 | `SplitError::TooManyCollaborators` declared twice (`= 19`) | `E0428` / `E0081`, `contracterror` macro failure cascading into ~20 errors | Removed the duplicate variant |
| 2 | `Publishable` trait not imported in `lib.rs` | 15× `no method named publish` (`E0599`) | Imported `events::Publishable` |
| 3 | `SplitError::ArithmeticOverflow` referenced but never declared | 3× `no variant ArithmeticOverflow` (`E0599`) | Declared `ArithmeticOverflow = 14` (the code already documented in the README error table) |
| 4 | `format!` used without `extern crate std` in `hardening_tests.rs` | `cannot find macro format` in the test build | Added `extern crate std;` + qualified `std::format!` |
| 5 | Event topic `splits_updated_with_pending_balance` (35 chars) | Soroban `Symbol` is capped at 32 chars → **non-unwinding host abort** whenever `update_collaborators` ran with a pending balance | Shortened to `splits_updated_pending_balance` (30 chars) |

After these repairs: WASM builds clean and the full suite passes
(**102 tests**, including 5 new ones for the capacity feature).

> Defect #5 is the most operationally significant: it was a latent runtime abort
> on a real user path (`update_collaborators` on a funded project), only masked
> because the contract never compiled.

## 2. Feature — configurable `MAX_COLLABORATORS`

The per-project collaborator cap was a hard-coded constant (`50`) with an in-code
TODO to make it configurable. It is now an admin-tunable instance-storage value.

New entrypoints:

- `set_max_collaborators(admin: Address, value: u32)` — admin-only. Bounds:
  `2 <= value <= 200`.
- `get_max_collaborators() -> u32` — returns the effective cap.
- Event `max_collaborators_set` (topics `("max_collaborators_set", admin)`, data `value`).

### Bounds rationale
- **Floor (2):** a project always requires at least two collaborators.
- **Ceiling (200):** `distribute` iterates over every collaborator in a single
  transaction, so the cap is bounded to keep each distribution within Soroban's
  per-call instruction/resource limits. The ceiling prevents an operator from
  configuring the contract into a state where distributions can no longer fit in
  a ledger.

## 3. Operational impact

- **Backward compatible / deploy-safe.** When the override has never been set,
  `effective_max_collaborators` falls back to the default `50`, so existing
  deployments behave exactly as before. No migration step is required.
- **Scope of effect.** The cap is only consulted when validating *new*
  `create_project` and `update_collaborators` calls. Already-stored projects are
  never re-validated, so changing the cap cannot retroactively invalidate or
  brick an existing project.
- **Auditability.** Every change emits `max_collaborators_set`, so capacity
  changes are observable on-chain by indexers/monitoring.

## 4. Rollback notes

- **Feature rollback (no redeploy):** call
  `set_max_collaborators(admin, 50)` to return to the historical default. Because
  the value lives in instance storage and reads fall back to the default, there is
  no broken intermediate state.
- **A reduction never harms existing projects.** Lowering the cap below the size
  of an existing project does not affect that project; the owner simply cannot
  grow it beyond the new cap on the next `update_collaborators`.
- **Code rollback:** reverting this PR returns the contract to the previous
  *non-compiling* state, so a redeploy from the prior commit is **not** possible.
  Prefer the on-chain `set_max_collaborators(admin, 50)` rollback above; reserve a
  full code revert for a fresh build from a known-good commit.

## 5. Verification

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release   # WASM builds
cargo test                                              # 102 passed; 0 failed
```
