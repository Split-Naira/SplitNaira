# Flaky Test Quarantine Policy

## Purpose

This document defines the process for identifying, quarantining, tracking, and restoring flaky tests in SplitNaira.

A flaky test is a test that produces inconsistent results without a corresponding change to the code under test. Flaky tests can reduce confidence in CI results and make genuine regressions harder to identify.

The quarantine process is intended to isolate known flaky tests without silently hiding new failures.

## Scope

This policy applies to automated tests executed by SplitNaira CI, including:

* Backend tests
* Frontend tests
* Smart-contract tests
* Integration tests
* End-to-end tests

The policy does not change the normal behavior of existing tests unless a test has been explicitly identified and approved for quarantine.

## Quarantine Label

The canonical GitHub label for a quarantined test is:

`flaky-test`

The label indicates that the associated issue, pull request, or test investigation concerns a known or suspected flaky test.

The label must not be used to permanently suppress failing tests.

## When a Test May Be Quarantined

A test may be considered for quarantine when:

1. It has failed intermittently across otherwise equivalent CI runs.
2. The failure cannot be reproduced consistently.
3. The failure appears unrelated to the code changes being tested.
4. There is an open tracking issue describing the flaky behavior.
5. An owner has been identified or assigned to investigate the failure.

A single deterministic test failure must not automatically be classified as flaky.

## Required Tracking Information

A quarantine tracking issue should contain:

* Test name
* Test file and location
* Affected workspace or subsystem
* CI job/workflow where the failure occurs
* Example failing CI run
* Frequency or observed failure pattern
* Suspected cause, when known
* Assigned owner
* Date the test entered quarantine
* Expected remediation or review date

Example:

```text
Test: should_create_split_with_multiple_recipients
Location: tests/splits/create.test.ts
Subsystem: frontend/integration
Workflow: frontend-ci
Owner: @maintainer
Status: quarantined
Reason: intermittent timeout during wallet interaction
```

## Quarantine Rules

Quarantine should be the exception, not the normal state.

When a test is quarantined:

1. The `flaky-test` label must be applied to the tracking issue.
2. The test must remain identifiable in the relevant test suite.
3. The failure must remain documented.
4. The owner should investigate the underlying cause.
5. The quarantine should be reviewed periodically.
6. The test should be restored to normal CI execution after the underlying issue is fixed.

A test must not be deleted merely because it is flaky.

## CI Label Flow

The `flaky-test` label provides a consistent signal for CI and maintainers.

The expected flow is:

```text
Intermittent failure
       │
       ▼
Investigate failure
       │
       ├── Deterministic failure ──► Fix normally
       │
       ▼
Confirmed/suspected flaky
       │
       ▼
Create tracking issue
       │
       ▼
Apply `flaky-test` label
       │
       ▼
Assign owner
       │
       ▼
Investigate + fix
       │
       ▼
Remove quarantine status
       │
       ▼
Return test to normal CI coverage
```

The label alone must not be interpreted as permission to ignore arbitrary CI failures.

## Ownership

The owner of a quarantined test is responsible for:

* Investigating the root cause.
* Keeping the tracking issue updated.
* Avoiding indefinite quarantine.
* Restoring the test when the underlying problem is resolved.
* Updating this documentation when the quarantine process changes.

If ownership is unclear, the subsystem maintainer should be assigned temporarily.

## Review and Expiration

Quarantined tests should be reviewed during normal CI maintenance.

A quarantine that remains unresolved for an extended period should be escalated rather than silently retained.

When the underlying issue is fixed:

1. Restore the test to normal execution.
2. Verify the test passes repeatedly.
3. Remove the `flaky-test` label when the tracking issue is no longer about an active quarantine.
4. Record the resolution in the tracking issue.

## Operational Impact

This policy is intentionally non-invasive.

It does not modify application behavior, contract behavior, or production execution.

Its operational purpose is to:

* Make flaky tests visible.
* Give maintainers a consistent ownership model.
* Prevent flaky failures from being confused with deterministic regressions.
* Provide a documented path from detection to remediation.
* Establish a predictable CI label signal for future automation.

## Security Considerations

Quarantine must not be used to hide security-sensitive test failures.

Tests involving:

* Authentication
* Authorization
* Payment validation
* Transaction validation
* Contract access control
* Financial invariants
* Security boundaries

must not be excluded from CI solely because they are inconvenient or unreliable.

A security-sensitive failure must be investigated as a real failure until its behavior is understood.

## Success Criteria

The quarantine process is considered successful when:

* Flaky tests can be identified consistently.
* Each quarantined test has a tracking issue.
* Ownership is explicit.
* CI failures remain visible.
* Quarantines do not become permanent substitutes for fixes.
* Fixed tests are returned to normal CI coverage.
