pub fn compile_contract(path: &str) -> bool {
    // In real pipeline: cargo build --target wasm32-unknown-unknown
    path.contains("contracts")
}
