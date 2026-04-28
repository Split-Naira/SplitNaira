#!/bin/bash
# Contract Release Artifact Sync Script
# Run from repository root: ./scripts/sync-contracts.sh

set -e

CONTRACTS_DIR="contracts"
FRONTEND_DIR="frontend"
BACKEND_DIR="backend"
ARTIFACT_DIR="$CONTRACTS_DIR/target/wasm32v1-none/release"

echo "SplitNaira Contract Release Sync"
echo "=============================="

# Check if artifacts exist
if [ ! -f "$ARTIFACT_DIR/splitnaira_contract.wasm" ]; then
    echo "Error: Contract WASM not found."
    echo "Build it first with: (from repo root) npm run build:contracts"
    echo "Or: (from contracts/) cargo build --release --target wasm32v1-none"
    exit 1
fi

# Generate SHA256 hash
echo "Generating artifact checksums..."
sha256sum "$ARTIFACT_DIR/splitnaira_contract.wasm" > "$ARTIFACT_DIR/splitnaira_contract.wasm.sha256"

# Export contract ID (set via environment or prompt)
CONTRACT_ID="${CONTRACT_ID:-}"
if [ -z "$CONTRACT_ID" ]; then
    read -p "Enter deployed contract ID: " CONTRACT_ID
fi

NETWORK="${NETWORK:-testnet}"
echo "Network: $NETWORK"

# Create release artifact JSON
cat > "$ARTIFACT_DIR/release-info.json" << EOF
{
  "contract_id": "$CONTRACT_ID",
  "network": "$NETWORK",
  "wasm_hash": "$(sha256sum $ARTIFACT_DIR/splitnaira_contract.wasm | cut -d' ' -f1)",
  "deployed_at": "$(date -Iseconds)",
  "version": "1.0.0"
}
EOF

echo "Release info saved to $ARTIFACT_DIR/release-info.json"

# Sync to backend config
echo "Syncing to backend..."
mkdir -p "$BACKEND_DIR/src/config"
cat > "$BACKEND_DIR/src/config/contract.json" << EOF
{
  "contractId": "$CONTRACT_ID",
  "network": "$NETWORK"
}
EOF

# Sync to frontend config
echo "Syncing to frontend..."
mkdir -p "$FRONTEND_DIR/src/config"
cat > "$FRONTEND_DIR/src/config/contract.ts" << EOF
export const CONTRACT_ID = '$CONTRACT_ID';
export const NETWORK = '$NETWORK';
EOF

echo "Done! Contract artifacts synced to frontend and backend."
echo "Restart development servers to pick up new configuration."
