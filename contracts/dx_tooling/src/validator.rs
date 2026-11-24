
extern crate alloc;

use alloc::{
    format,
    string::String as RustString,
    vec::Vec as RustVec,
};

use crate::errors::err;
use crate::types::ContractArtifact;

/// Validates a contract artifact before deployment.
///
/// Returns an error if the WASM hash is empty or the version is zero.
pub fn validate_artifact(artifact: &ContractArtifact) -> Result<(), RustString> {
    if artifact.wasm_hash.is_empty() {
        return Err(err("INVALID_WASM_HASH"));
    }

    if artifact.version == 0 {
        return Err(err("INVALID_VERSION"));
    }

    Ok(())
}

/// Checks contract source code for missing authentication requirements.
///
/// Each targeted public function must contain an authentication check
/// within its next 15 lines, stopping at the next public function.
pub fn run_checks(contract_source: &str) -> RustVec<RustString> {
    const AUTH_WINDOW: usize = 15;

    const TARGET_FUNCS: &[&str] = &[
        "pub fn claim",
        "pub fn transfer_project_ownership",
        "pub fn create_project",
        "pub fn update_collaborators",
        "pub fn lock_project",
        "pub fn deposit",
        "pub fn set_admin",
        "pub fn pause_distributions",
        "pub fn unpause_distributions",
        "pub fn allow_token",
        "pub fn disallow_token",
    ];

    let mut violations = RustVec::new();
    let lines: RustVec<&str> = contract_source.lines().collect();

    for (index, line) in lines.iter().enumerate() {
        for &function in TARGET_FUNCS {
            if !line.contains(function) {
                continue;
            }

            let end = core::cmp::min(index + AUTH_WINDOW, lines.len());

            let has_auth = lines[index..end]
                .iter()
                .enumerate()
                .take_while(|(offset, candidate)| {
                    *offset == 0 || !candidate.contains("pub fn")
                })
                .any(|(_, candidate)| {
                    candidate.contains(".require_auth()")
                        || candidate.contains("require_contract_admin")
                        || candidate.contains("require_auth")
                });

            if !has_auth {
                violations.push(format!(
                    "Function {} missing require_auth()",
                    function
                ));
            }
        }
    }

    violations
}
