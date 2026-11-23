# Changelog

<!-- This report confirms the successful implementation of production-safe rendering and API sanitization to eliminate XSS vulnerabilities in the Split Naira platform. -->

All notable changes to this project will be documented in this file.
..
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows [Semantic Versioning](https://semver.org/).

<!--
This fix addreesses GitHub Issue #292 (Security: Cross-Site Scripting (XSS) in Split Description Field) by implementing comprehensive XSS prevention across the entire application using a 3-layer defense strategy. -->

## [Unreleased]

### Added

- Backend: OpenAPI security verification compares every documented operation's `security` with the guard middleware on the real route, so a protected endpoint cannot be documented as public (or vice versa) (#1635).
- Backend: bounded graceful shutdown drains in-flight database transactions before closing the pool, with configurable drain and force-exit deadlines; unit tests cover commit, rollback, timeout, and forced termination (#1638).
- Backend: pinned compatibility fixtures for legacy `snake_case` split response fields, including casing precedence, boundary defaults, and the compatibility window (#1637).

### Documentation

- OpenAPI now documents unknown payout outcomes: `pending`/`NOT_FOUND` is unconfirmed, must be polled, expires after 6 minutes, and may only be retried once `failed` (#1636).
- Added `docs/contract-interface-diff-examples.md`, which gives reviewers worked breaking/non-breaking examples for `splitnaira.contract-interface.json` diffs. It is linked from the interface release checklist.
- `docs/runbooks/stuck-payouts.md` now documents that `claim` is blocked by `pause_distributions`, including for fully distributed projects.
- Add Horizon/Soroban RPC compatibility matrix and bounded smoke suite (#1499)

### Tests

- Added `contracts/pause_claim_tests.rs`: claim-path coverage for fully distributed projects after an admin pause, before and after unpause, with deposits made during the pause, and with a re-pause after a partial claim.

<!--
This fix addresses GitHub Issue #292 (Security: Cross-Site Scripting (XSS) in Split Description Field) by implementing comprehensive XSS prevention across the entire application using a 3-layer defense strategy. -->

### Security

- Contract: after an upgrade, a missing `AccountedTokenBalance` cache is now seeded from the live project balances, not `0`. Before this, the first `deposit`/`distribute`/`claim` on prior state made existing project funds look unallocated, and `withdraw_unallocated` could have drained them. See `docs/contract-storage-layout-and-migrations.md`.
- **CRITICAL FIX:** XSS (Cross-Site Scripting) vulnerability eliminated in project title, type, and collaborator alias fields (closes #292)
  - Implemented server-side character whitelist validation on all user input fields
  - Added frontend HTML escaping utilities (`sanitizeText()`) for defense-in-depth
  - Updated all components (DashboardView, ManageSplitView, ProjectsList) to escape user-provided strings
  - Added comprehensive security test suite with 50+ XSS payload tests
  - Verified zero usage of `dangerouslySetInnerHTML` in codebase
  - Full documentation in `docs/SECURITY_XSS_FIXES.md`
- Owner-gated split mutations (`lock`, `collaborators`, `metadata`) now verify the requested `owner` against on-chain project state before building unsigned XDR; non-owners get `401 UNAUTHORIZED` instead of a transaction the contract would reject after signing (closes #1092). See `docs/wallet-signing-threat-model.md`.

### Added

- Backend: route × persona authorization matrix tests for the collaboration resource routes. They cover anonymous, malformed, owner, admin, editor, viewer and unrelated callers, plus cross-project, fail-closed and body-spoofing boundaries (`backend/src/routes/collaboration.authz-matrix.test.ts`). See `docs/authorization-coverage-tests.md`.
- Backend: a read-only restore drill (`npm run restore-drill:capture` / `restore-drill:validate`). It checks a restored database against a baseline captured at backup time: row counts, per-table checksums and exact financial totals. It also runs the existing consistency audit on the restored data. See `docs/runbooks/postgres-backup-restore.md` § 3.5.
- Contract event integration contract: `contracts/interface/events.contract.json` is a versioned wire-shape snapshot of all 17 events. `npm run check:events` checks it in CI against `events.rs`, and on PRs against the base branch's snapshot. Breaking changes need a MAJOR bump (`npm run events:update -- --allow-breaking`). See `docs/contract-events.md#compatibility-policy`.
- Prior-state fixture tests (`contracts/prior_state_fixture_tests.rs`) that run today's contract against v1 (flat index), v2 (pre-accounting-cache) and v3 (mixed index) storage layouts.
- Release automation workflow for draft GitHub Releases on `v0.x.y` tag pushes.
- `CHANGELOG.md` to track notable changes and release notes.
- README guidance for version-to-contract WASM mapping and traceability.
- Security utilities module (`frontend/src/lib/security.ts`) with XSS prevention functions
- Security test suite (`backend/src/__tests__/security-xss.test.ts`) with comprehensive XSS vector testing
- Frontend security tests (`frontend/src/lib/security.test.ts`) for escaping validation
- Security documentation (`docs/SECURITY_XSS_FIXES.md`) with implementation details and best practices
- Frontend telemetry events (`split.<action>.<stage>`) for create, deposit, distribute, lock, update_metadata and update_collaborators, recorded as Sentry breadcrumbs with a pluggable sink API (`frontend/src/lib/telemetry.ts`). See `frontend/RELIABILITY.md` §4a.
- Seeded property tests for repeated deposits before distribution (`contracts/deposit_property_tests.rs`). See `contracts/RELIABILITY.md`.
- Test coverage for failed token address parsing across all admin token routes and service builders (`backend/src/__tests__/admin-token-parsing.test.ts`).
- Distribution remainder accounting documentation (`docs/contract-distribution-remainder-accounting.md`): remainder rule, invariants, zero-share and `claim` edge cases, off-chain preview guidance.

### Fixed

- Contract: `create_project` on a contract that still has the legacy flat `ProjectIds` index now folds it into buckets first, so legacy IDs are no longer hidden. `migrate_flat_to_buckets` now merges a mixed index instead of deleting the flat list, which used to lose legacy IDs.
- `buildWithdrawUnallocatedUnsignedXdr` now validates `admin`/`token`/`to` addresses before any RPC call and raises `RequestValidationError` instead of a generic error.
- Backend: SSE routes return `503 shutting_down` for new streams once shutdown starts, so late subscribers can no longer hold the process open until the force-exit timer (#1094).
- Backend: `withTransaction()` always releases its connection (even when `startTransaction()` fails), keeps the caller's error when rollback fails, and no longer throws on release failure after a commit (#1091).
- Docs: the idempotency retry guide now shows the actual `200` responses and the `IDEMPOTENCY_KEY_CONFLICT` 409 envelope (#1093).

### Changed

- Backend: added test coverage for SSE shutdown draining (#1094), idempotency 409 payload mismatches (#1093), token allowlist read-cache behavior across allow/disallow mutations (#1095), and nested `withTransaction()` failures (#1091).
- Documentation now references secret management and release tagging.
- Backend input validation enhanced with character whitelist restrictions
- All components updated to use `sanitizeText()` for user-provided content rendering

## [0.1.0] - 2026-06-01

### Added

- Initial release tracking support.
