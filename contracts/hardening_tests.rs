#![cfg(test)]

use dx_tooling::validator::run_checks;

#[test]
fn test_hardening_checks() {
    // Read the source of the main contract
    let contract_source = include_str!("lib.rs");
    let violations = run_checks(contract_source);
    
    assert!(
        violations.is_empty(),
        "Hardening checks failed!\nViolations found:\n{:#?}",
        violations
    );
}

#[test]
fn test_tooling_catches_violations() {
    // Validate that our tooling actually catches missing auth
    let bad_source = r#"
        pub fn claim(env: Env, claimer: Address) {
            // no auth here!
            let x = 1;
        }

        pub fn transfer_project_ownership(env: Env, new_owner: Address) {
            // no auth here either!
        }
    "#;
    
    let violations = run_checks(bad_source);
    assert_eq!(violations.len(), 2, "Expected exactly 2 violations for missing auth");
}
