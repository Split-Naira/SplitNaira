# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security
- **CRITICAL FIX:** XSS (Cross-Site Scripting) vulnerability eliminated in project title, type, and collaborator alias fields (closes #292)
  - Implemented server-side character whitelist validation on all user input fields
  - Added frontend HTML escaping utilities (`sanitizeText()`) for defense-in-depth
  - Updated all components (DashboardView, ManageSplitView, ProjectsList) to escape user-provided strings
  - Added comprehensive security test suite with 50+ XSS payload tests
  - Verified zero usage of `dangerouslySetInnerHTML` in codebase
  - Full documentation in `docs/SECURITY_XSS_FIXES.md`

### Added
- Release automation workflow for draft GitHub Releases on `v0.x.y` tag pushes.
- `CHANGELOG.md` to track notable changes and release notes.
- README guidance for version-to-contract WASM mapping and traceability.
- Security utilities module (`frontend/src/lib/security.ts`) with XSS prevention functions
- Security test suite (`backend/src/__tests__/security-xss.test.ts`) with comprehensive XSS vector testing
- Frontend security tests (`frontend/src/lib/security.test.ts`) for escaping validation
- Security documentation (`docs/SECURITY_XSS_FIXES.md`) with implementation details and best practices

### Changed
- Documentation now references secret management and release tagging.
- Backend input validation enhanced with character whitelist restrictions
- All components updated to use `sanitizeText()` for user-provided content rendering

## [0.1.0] - 2026-06-01

### Added
- Initial release tracking support.
