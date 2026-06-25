extern crate alloc;
use alloc::string::{String as RustString, ToString};
use alloc::vec::Vec as RustVec;
use alloc::format;

use crate::errors::err;
use crate::types::ContractArtifact;

pub fn validate_artifact(artifact: &ContractArtifact) -> Result<(), RustString> {
    if artifact.wasm_hash.len() == 0 {
        return Err(err("INVALID_WASM_HASH"));
    }

    if artifact.version == 0 {
        return Err(err("INVALID_VERSION"));
    }

    Ok(())
}

pub fn run_checks(contract_source: &str) -> RustVec<RustString> {
    let mut violations = RustVec::new();
    let lines: RustVec<&str> = contract_source.lines().collect();
    
    let target_funcs = [
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
        "pub fn disallow_token"
    ];
    
    for (i, line) in lines.iter().enumerate() {
        for func in target_funcs.iter() {
            if line.contains(func) {
                let mut found_auth = false;
                let end = core::cmp::min(i + 15, lines.len());
                for j in i..end {
                    if lines[j].contains(".require_auth()") || lines[j].contains("require_contract_admin") || lines[j].contains("require_auth") {
                        found_auth = true;
                        break;
                    }
                    if lines[j].contains("pub fn") && j != i {
                        break;
                    }
                }
                if !found_auth {
                    violations.push(format!("Function {} missing require_auth()", func));
                }
            }
        }
    }
    
    violations
}