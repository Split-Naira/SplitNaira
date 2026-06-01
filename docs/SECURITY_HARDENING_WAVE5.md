# Security Hardening — Wave 5 Implementation Plan

> **Issue:** #401  
> **Track:** Contracts — Security Hardening  
> **Priority:** High  
> **Status:** Implemented

---

## Objective

Deliver production-grade security improvements to the SplitNaira Soroban contract, accelerating deployment readiness under the Wave 5 Security Hardening execution track.

---

## Audit Findings

### Critical / High

| ID | Location | Finding | Status |
|----|----------|---------|--------|
| SH-01 | `contracts/lib.rs` — `withdraw_unallocated` | Missing self-transfer guard: `to` could equal `env.current_contract_address()`, locking funds permanently inside the contract. | ✅ Fixed |

### Medium

| ID | Location | Finding | Status |
|----|----------|---------|--------|
| SH-02 | `contracts/lib.rs` — `distribute` | Permissionless: any address can trigger distribution. Intentional design for automated/cron use, but should be documented. | ✅ Documented |
| SH-03 | `contracts/errors.rs` | Error code namespace was fully consumed by code 16; new error variants required a gap extension. | ✅ Fixed (code 17 added) |

### Low / Informational

| ID | Location | Finding | Status |
|----|----------|---------|--------|
| SH-04 | `contracts/lib.rs` — `validate_collaborators` | `checked_add` correctly guards against basis-point overflow. No change required. | ✅ Confirmed safe |
| SH-05 | All admin functions | `require_contract_admin` correctly calls `admin.require_auth()` after identity check. No auth-gap present. | ✅ Confirmed safe |

---

## Changes Implemented

### 1. `contracts/lib.rs` — Self-transfer guard in `withdraw_unallocated`

```rust
// Before (vulnerable)
if amount <= 0 { return Err(SplitError::InvalidAmount); }

// After (hardened)
if amount <= 0 { return Err(SplitError::InvalidAmount); }
if to == env.current_contract_address() {
    return Err(SplitError::InvalidRecipient);   // SH-01
}
```

**Impact:** Prevents admin error that would permanently lock unallocated token
balances inside the contract with no recovery path.

**Rollback:** Remove the `InvalidRecipient` guard block; revert `errors.rs` to
remove variant 17. Zero state migration required (pure logic change).

### 2. `contracts/errors.rs` — New error variant

```rust
InvalidRecipient = 17,  // Withdrawal recipient must not be the contract itself
```

---

## Test Coverage Requirements

All security-related paths should be covered before mainnet deploy:

```
contracts/tests
└── withdraw_unallocated_self_transfer_blocked   ← SH-01 regression test
└── withdraw_unallocated_valid_recipient_passes  ← happy path
```

Add to the existing test module:

```rust
#[test]
fn withdraw_unallocated_to_contract_itself_fails() {
    // setup ...
    let result = client.try_withdraw_unallocated(
        &admin, &token, &contract_id, &100i128,
    );
    assert_eq!(result, Err(Ok(SplitError::InvalidRecipient)));
}
```

---

## Operational Impact & Rollback Notes

### Deploy

- Change is **additive-only** (new error variant + guard block).
- No storage schema change — safe to deploy with zero-downtime upgrade.
- Existing on-chain state is unaffected.

### Rollback Procedure

If the hardened contract must be rolled back to the previous WASM:

1. Re-upload the previous WASM via `stellar contract upload`.
2. Call `update_contract` (or the contract's upgrade function) with the old WASM hash.
3. Verify by calling `withdraw_unallocated` with a normal recipient — should succeed.
4. Document the rollback in `docs/runbooks/contract-release-and-upgrade-runbook.md`.

> See full rollback steps in [contract-release-and-upgrade-runbook.md](contract-release-and-upgrade-runbook.md).

---

## References

- [RELIABILITY.md](../contracts/RELIABILITY.md)
- [BACKEND_COMPLIANCE_AUDIT.md](../BACKEND_COMPLIANCE_AUDIT.md)
- [contract-release-and-upgrade-runbook.md](contract-release-and-upgrade-runbook.md)
- [Soroban Auth model](https://developers.stellar.org/docs/learn/smart-contract-internals/authorization)
