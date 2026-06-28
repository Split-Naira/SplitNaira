#![cfg(test)]

extern crate std;

use dx_tooling::validator::run_checks;

/// Source code of the contract under test.
const CONTRACT_SOURCE: &str = include_str!("lib.rs");

/// Deliberately insecure contract used to verify the validator.
const INVALID_CONTRACT_SOURCE: &str = r#"
    pub fn claim(env: Env, claimer: Address) {
        // Missing authorization
        let _x = 1;
    }

    pub fn transfer_project_ownership(env: Env, new_owner: Address) {
        // Missing authorization
    }
"#;

#[test]
fn validates_contract_passes_all_hardening_checks() {
    let violations = run_checks(CONTRACT_SOURCE);

    assert!(
        violations.is_empty(),
        "Expected no hardening violations, but found {}:\n{:#?}",
        violations.len(),
        violations
    );
}

#[test]
fn validator_detects_missing_authorization() {
    let violations = run_checks(INVALID_CONTRACT_SOURCE);

    assert_eq!(
        violations.len(),
        2,
        "Expected exactly 2 authorization violations, found {}:\n{:#?}",
        violations.len(),
        violations
    );

    let violations_text = std::format!("{:#?}", violations);

    assert!(
        violations_text.contains("claim"),
        "Expected validator to flag the 'claim' function.\nViolations:\n{}",
        violations_text
    );

    assert!(
        violations_text.contains("transfer_project_ownership"),
        "Expected validator to flag the 'transfer_project_ownership' function.\nViolations:\n{}",
        violations_text
    );
}

#[test]
fn validator_returns_no_false_positives_for_valid_contract() {
    let violations = run_checks(CONTRACT_SOURCE);

    assert!(
        violations.is_empty(),
        "Validator reported unexpected violations:\n{:#?}",
        violations
    );
}