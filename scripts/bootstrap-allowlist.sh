#!/usr/bin/env bash
# Bootstraps a freshly deployed SplitNaira contract on testnet.
# It sets the contract admin and allowlists the standard testnet tokens.
#
# Usage:
#   CONTRACT_ID=<contract id> ADMIN_SECRET=<admin secret> ./scripts/bootstrap-allowlist.sh
#
# Optional:
#   ADMIN_PUBLIC=<admin public key>
#   NETWORK=testnet
#   RPC_URL=https://soroban-testnet.stellar.org
#   NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

set -euo pipefail

CONTRACT_ID="${1:-${CONTRACT_ID:-}}"
ADMIN_SECRET="${2:-${ADMIN_SECRET:-}}"
ADMIN_PUBLIC="${ADMIN_PUBLIC:-}"
NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[error] '$1' not found. Please install it before running this script." >&2; exit 1; }
}

log() { echo "[bootstrap] $*"; }
die() { echo "[error] $*" >&2; exit 1; }

require_cmd soroban

if [ -z "$CONTRACT_ID" ]; then
  die "CONTRACT_ID is required. Example: CONTRACT_ID=<contract id> ADMIN_SECRET=<admin secret> ./scripts/bootstrap-allowlist.sh"
fi

if [ -z "$ADMIN_SECRET" ]; then
  die "ADMIN_SECRET is required. Example: CONTRACT_ID=<contract id> ADMIN_SECRET=<admin secret> ./scripts/bootstrap-allowlist.sh"
fi

if [ -z "$ADMIN_PUBLIC" ]; then
  log "Deriving admin public key from ADMIN_SECRET..."
  ADMIN_PUBLIC="$(soroban keys address "$ADMIN_SECRET" 2>/dev/null || true)"
fi

if [ -z "$ADMIN_PUBLIC" ]; then
  die "ADMIN_PUBLIC is required. Provide ADMIN_PUBLIC=<admin public key> or ensure 'soroban keys address <secret>' works."
fi

declare -A TOKENS=(
  ["USD Coin (USDC)"]="CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR"
  ["Soroban Waved USD (wUSD)"]="CDLZJQG2OZZXZAU3YICESOJE73SOXREH74DRBEDAFTMPAQWX3JD3YQ"
)

invoke_contract() {
  local fn="$1"; shift
  local args=("$@")

  log "Invoking $fn..."
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --network "$NETWORK" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL" \
    --fn "$fn" \
    --args "${args[@]}"
}

log "Bootstrapping SplitNaira contract allowlist on $NETWORK"
log "Contract ID: $CONTRACT_ID"
log "Admin: $ADMIN_PUBLIC"

log "Setting admin on contract..."
invoke_contract set_admin address "$ADMIN_PUBLIC"

for token_name in "${!TOKENS[@]}"; do
  token_id="${TOKENS[$token_name]}"
  log "Allowlisting token: $token_name ($token_id)"
  invoke_contract allow_token address "$ADMIN_PUBLIC" address "$token_id"
  log "Verifying allowlist status for $token_name"
  invoke_contract is_token_allowed address "$token_id"
done

log "Bootstrap complete. Standard testnet tokens are allowlisted."
log "If the commands above output transaction hashes, record them for audit and verification."
