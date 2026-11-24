
extern crate alloc;

use alloc::string::String;

/// Represents a compiled smart contract artifact.
#[derive(Debug, Clone)]
pub struct ContractArtifact {
    /// Hash of the compiled WASM binary.
    pub wasm_hash: String,

    /// Contract source code.
    pub code: String,

    /// Version of the contract artifact.
    pub version: u32,
}
