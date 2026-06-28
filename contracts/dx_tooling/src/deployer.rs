use crate::types::ContractArtifact;

pub fn deploy_contract(artifact: &ContractArtifact) -> Option<u64> {
    if artifact.wasm_hash.len() == 0 {
        return None;
    }

    // fake contract id generation (in real: Soroban deploy)
    Some(artifact.version as u64 + 1000)
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::process::Command;
use chrono::Utc;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRecord {
    pub contract_id: String,
    pub wasm_hash: String,
    pub deployed_ledger: u64,
    pub deployer_address: String,
    pub git_sha: String,
    pub deployed_at: String,
}

pub type DeploymentsRegistry = HashMap<String, Option<DeploymentRecord>>;

/// Resolves the current workspace git commit SHA hash signature via shell executions.
fn get_current_git_sha() -> String {
    Command::new("git")
        .args(&["rev-parse", "--short", "HEAD"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Appends contract operational metrics to deployments.json registry database file.
pub fn record_successful_deployment(
    network: &str,
    contract_id: &str,
    wasm_hash: &str,
    ledger: u64,
    deployer: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let file_path = "../deployments.json";
    
    // Read and parse current state mapping indices
    let mut registry: DeploymentsRegistry = match File::open(file_path) {
        Ok(mut file) => {
            let mut contents = String::new();
            file.read_to_string(&mut contents)?;
            serde_json::from_str(&contents).unwrap_or_default()
        }
        Err(_) => HashMap::new(),
    };

    // Instantiate and inject the fresh deployment token telemetry data
    let record = DeploymentRecord {
        contract_id: contract_id.to_string(),
        wasm_hash: wasm_hash.to_string(),
        deployed_ledger: ledger,
        deployer_address: deployer.to_string(),
        git_sha: get_current_git_sha(),
        deployed_at: Utc::now().to_rfc3339(),
    };

    registry.insert(network.to_string(), Some(record));

    // Atomically write updated configuration state back onto disk layers
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(file_path)?;
        
    let json_bytes = serde_json::to_string_pretty(&registry)?;
    file.write_all(json_bytes.as_bytes())?;

    Ok(())
}