# Troubleshooting: Wallet Network Mismatch

## Overview
When interacting with the SplitNaira platform, users may encounter wallet network mismatch errors if their injected Web3/Stellar wallet (e.g., Freighter, Albedo) is connected to a different network cluster than the one configured in the application environment.

---

## Common Symptoms
* Transaction signing requests fail immediately with network mismatch errors.
* Smart contract invocation simulation errors citing incorrect network passphrases.
* UI dashboard displaying an amber warning banner prompting network switching.

---

## Resolution Steps

### 1. Verify Application Environment Configuration
Check your local or production environment variables (`.env` or deployment secrets) to confirm the expected Stellar network configuration:
* **Testnet**: `STELLAR_NETWORK=testnet` (Network Passphrase: `Test SDF Network ; September 2015`)
* **Mainnet**: `STELLAR_NETWORK=mainnet` (Network Passphrase: `Public Global Stellar Network ; September 2015`)

### 2. Switch Wallet Network
1. Open your Stellar wallet extension (e.g., **Freighter**).
2. Navigate to **Settings** -> **Network**.
3. Select the network matching the SplitNaira deployment (Testnet vs. Mainnet).
4. Refresh the SplitNaira application interface and re-attempt connection.

### 3. Clear Local Storage Session Cache
If persistent cached session states retain the stale network ID:
* Open browser Developer Tools (`F12`).
* Go to **Application** -> **Local Storage**.
* Clear keys prefixed with `splitnaira_wallet_` and reload the page.