
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    process::Command,
};

const DEPLOYMENTS_FILE: &str = "../deployments.json";
const UNKNOWN_GIT_SHA: &str = "unknown";

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

/// Retrieves the current workspace's short Git commit SHA.
///
/// Returns `"unknown"` if Git is unavailable or the command fails.
fn get_current_git_sha() -> String {
    Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_owned()
        })
        .filter(|sha| !sha.is_empty())
        .unwrap_or_else(|| UNKNOWN_GIT_SHA.to_string())
}

/// Loads the existing deployment registry from disk.
fn load_deployments_registry(
    file_path: &str,
) -> Result<DeploymentsRegistry, Box<dyn std::error::Error>> {
    let mut file = match File::open(file_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HashMap::new());
        }
        Err(error) => return Err(error.into()),
    };

    let mut contents = String::new();
    file.read_to_string(&mut contents)?;

    if contents.trim().is_empty() {
        return Ok(HashMap::new());
    }

    Ok(serde_json::from_str(&contents)?)
}

/// Writes the deployment registry to disk.
fn save_deployments_registry(
    file_path: &str,
    registry: &DeploymentsRegistry,
) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_vec_pretty(registry)?;

    let temp_path = format!("{file_path}.tmp");

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)?;

    file.write_all(&json)?;
    file.sync_all()?;

    fs::rename(&temp_path, file_path)?;

    Ok(())
}

/// Records a successful contract deployment in the deployments registry.
pub fn record_successful_deployment(
    network: &str,
    contract_id: &str,
    wasm_hash: &str,
    ledger: u64,
    deployer: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut registry = load_deployments_registry(DEPLOYMENTS_FILE)?;

    let record = DeploymentRecord {
        contract_id: contract_id.to_owned(),
        wasm_hash: wasm_hash.to_owned(),
        deployed_ledger: ledger,
        deployer_address: deployer.to_owned(),
        git_sha: get_current_git_sha(),
        deployed_at: Utc::now().to_rfc3339(),
    };

    registry.insert(network.to_owned(), Some(record));

    save_deployments_registry(DEPLOYMENTS_FILE, &registry)?;

    Ok(())
}
