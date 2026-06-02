# Issue 541 Implementation Plan

> **Issue:** #541
> **Track:** Contracts — Platform Hardening
> **Priority:** High
> **Status:** In progress

---

## Objective

Strengthen contract platform resilience by making unallocated token recovery queries O(1) and preserving project accounting invariants across deposits, distributions, and collaborator claims.

## Audit Findings

- `get_unallocated_balance` currently computes unallocated funds by summing every project balance in the contract.
- This scan is expensive and brittle as the number of projects grows, creating a platform-level reliability risk for recovery and monitoring workflows.
- `deposit`, `distribute`, and `claim` update project balances, but no global token-accounted cache exists to support efficient unallocated balance reads.

## Fix Summary

- Added a cached token-level project balance total using `DataKey::AccountedTokenBalance(Address)`.
- Updated `deposit` to increment the cached total when project funds are deposited.
- Updated `distribute` and `claim` to decrement the cached total when project funds leave the account-level project pool.
- Hardened `get_unallocated_balance` to read the cached balance when present, falling back to the existing scan for backwards compatibility.

## Test Coverage

- Added a regression test ensuring `get_unallocated_balance` remains stable after a collaborator claim and does not include project-accounted funds.
- Existing unallocated recovery tests validate admin-only withdrawal, contract self-transfer blocking, and over-withdrawal protection.

## Rollback Notes

- This change is additive-only: it adds a cached accounting key and preserves existing behavior.
- There is no storage schema migration that invalidates prior state; older state without the cache falls back to the legacy sum.
- Rollback is simply a contract WASM revert to the prior deployed version.

## Operational Impact

- Improves platform hardening by limiting the cost of unallocated balance queries.
- Helps monitoring, recovery, and analytics consumers rely on a more stable contract query surface.
- Keeps existing admin recovery semantics intact.
