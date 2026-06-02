# Issue #531: [Contracts] Wallet & Payments - Wave 5 execution track

## Implementation Plan

### Overview
This PR addresses the contracts workstream under Wallet & Payments for SplitNaira Wave 5. The focus is on closing contract-level gaps in payment flows, hardening recoverability, adding regression tests, and updating operational documentation so the release remains deploy-safe and rollback-aware.

### Audit Findings
The current contract implementation already provides a strong Wallet & Payments surface, but the audit found one contract accounting gap and several documentation gaps:

- `claim` did not update the project-level `total_distributed` amount for pull-based payouts
- Wallet & Payments production guidance lacked a Wave 5 contract-specific compliance summary
- Existing contract docs did not explicitly call out Wallet & Payments recovery, pause, and admin controls

### Implementation Summary

#### Contract Fix
- Updated `claim` so self-service collaborator payouts are recorded in `SplitProject.total_distributed`
- This preserves the invariant that `total_distributed` reflects all funds paid out from the contract, whether via push `distribute` or pull `claim`

#### Regression Coverage
- Added a new contract test verifying `total_distributed` increments when a collaborator claims funds
- Existing contract tests already cover deposit, distribution, allowlist, pause/unpause, unallocated recovery, and event emission paths

#### Documentation Updates
- Added `docs/issue-531-implementation-plan.md` as the PR implementation plan and description support
- Enhanced `docs/compliance/contracts-wave5.md` with Wallet & Payments compliance details, allowlist/recovery rules, access control, and rollback notes

### Deployment Safety
- Code change is isolated to the contract accounting path for claims
- No ABI-breaking changes are introduced
- Existing contract IDs remain valid until frontend/backend configuration moves to the new contract
- Backend `PAYMENTS_ADMIN_WRITE_ENABLED=false` remains available to freeze payout-impacting admin actions during rollout or rollback

### Rollback Notes
- Contract upgrades require switching the client-side `CONTRACT_ID` back to a prior stable deployment
- The contract admin recovery path (`withdraw_unallocated`) remains available for accidental direct token transfers
- Backend admin write freeze provides a fast rollback guard for payout operations

### Acceptance Criteria
- [x] Clear implementation plan included in PR description (`docs/issue-531-implementation-plan.md`)
- [x] Contract code adjusted to preserve Wallet & Payments accounting invariants
- [x] Added regression test coverage for the claim accounting path
- [x] Wallet & Payments contract compliance docs updated
- [x] Notes included for deploy safety and rollback operations
