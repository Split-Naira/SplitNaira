# Issue #536: [Contracts] Analytics & Insights - Wave 5 execution track

## Implementation Plan

### Overview
This PR delivers a contract-focused Analytics & Insights workstream for SplitNaira Wave 5. The goal is to harden contract-level telemetry and query surfaces so analytics consumers can reliably derive insights from on-chain project and payout activity.

### Audit Findings
The current contract already exposes a solid set of read-only query methods and event signals. The audit identified two practical gaps:

- Analytics consumers rely on stable event schema, but event topics and payload shapes were not explicitly documented or covered with dedicated regression tests.
- The contract compliance docs did not explicitly call out Analytics & Insights as a Wave 5 contract requirement.

### Implementation Summary

#### 1. Analytics event validation tests
- Added contract regression tests covering event emissions for `distribution_complete`, `payment_sent`, and `collaborator_claimed`.
- These tests verify the contract emits stable event topics and payloads for Analytics & Insights workflows.

#### 2. Documentation updates
- Added `docs/issue-536-implementation-plan.md` as the PR implementation plan and audit summary.
- Extended `docs/compliance/contracts-wave5.md` with an Analytics & Insights section describing the contract-side telemetry surface.

#### 3. Deploy-safety and rollback notes
- No production state or ABI changes introduced.
- All changes are read-only test and documentation improvements.
- Existing contract IDs remain valid until a new contract is deployed and promoted.

### Acceptance Criteria
- [x] Clear implementation plan included in PR description (`docs/issue-536-implementation-plan.md`)
- [x] Code changes merged with tests passing in CI
- [x] Contract analytics documentation updated in `docs/` and existing Wave 5 compliance material
- [x] Rollback guidance remains safe and unchanged for contract updates

### Operational Impact
- Improves analytics confidence by stabilizing contract event schema for downstream dashboards and pipelines.
- Makes contract telemetry explicit in Wave 5 compliance documentation.
- Supports analytics teams with documented read-only query surfaces and event topics.
