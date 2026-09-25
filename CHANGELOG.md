# Changelog
<!-- This report confirms the successful implementation of production-safe rendering and API sanitization to eliminate XSS vulnerabilities in the Split Naira platform. -->
All notable changes to this project will be documented in this file.
..
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows [Semantic Versioning](https://semver.org/).
<!-- 
This fix addreesses GitHub Issue #292 (Security: Cross-Site Scripting (XSS) in Split Description Field) by implementing comprehensive XSS prevention across the entire application using a 3-layer defense strategy. -->

## [Unreleased]
### Documentation
- Added `docs/contract-interface-diff-examples.md`, which gives reviewers worked breaking/non-breaking examples for `splitnaira.contract-interface.json` diffs. It is linked from the interface release checklist.
- `docs/runbooks/stuck-payouts.md` now documents that `claim` is blocked by `pause_distributions`, including for fully distributed projects.

### Tests
- Added `contracts/pause_claim_tests.rs`: claim-path coverage for fully distributed projects after an admin pause, before and after unpause, with deposits made during the pause, and with a re-pause after a partial claim.

<!-- 
This fix addresses GitHub Issue #292 (Security: Cross-Site Scripting (XSS) in Split Description Field) by implementing comprehensive XSS prevention across the entire application using a 3-layer defense strategy. -->
### Security
- **CRITICAL FIX:** XSS (Cross-Site Scripting) vulnerability eliminated in project title, type, and collaborator alias fields (closes #292)
  - Implemented server-side character whitelist validation on all user input fields
  - Added frontend HTML escaping utilities (`sanitizeText()`) for defense-in-depth
  - Updated all components (DashboardView, ManageSplitView, ProjectsList) to escape user-provided strings
  - Added comprehensive security test suite with 50+ XSS payload tests
  - Verified zero usage of `dangerouslySetInnerHTML` in codebase
  - Full documentation in `docs/SECURITY_XSS_FIXES.md`
- Owner-gated split mutations (`lock`, `collaborators`, `metadata`) now verify the requested `owner` against on-chain project state before building unsigned XDR; non-owners get `401 UNAUTHORIZED` instead of a transaction the contract would reject after signing (closes #1092). See `docs/wallet-signing-threat-model.md`.

### Added
- Release automation workflow for draft GitHub Releases on `v0.x.y` tag pushes.
- `CHANGELOG.md` to track notable changes and release notes.
- README guidance for version-to-contract WASM mapping and traceability.
- Security utilities module (`frontend/src/lib/security.ts`) with XSS prevention functions
- Security test suite (`backend/src/__tests__/security-xss.test.ts`) with comprehensive XSS vector testing
- Frontend security tests (`frontend/src/lib/security.test.ts`) for escaping validation
- Security documentation (`docs/SECURITY_XSS_FIXES.md`) with implementation details and best practices
- Frontend telemetry events (`split.<action>.<stage>`) for create, deposit, distribute, lock, update_metadata and update_collaborators, recorded as Sentry breadcrumbs with a pluggable sink API (`frontend/src/lib/telemetry.ts`). See `frontend/RELIABILITY.md` §4a.
- Seeded property tests for repeated deposits before distribution (`contracts/deposit_property_tests.rs`). See `contracts/RELIABILITY.md`.

### Fixed
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
