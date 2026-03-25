export interface StellarConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  simulatorAccount: string;
}

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function loadStellarConfig(): StellarConfig {
  const {
    HORIZON_URL,
    SOROBAN_RPC_URL,
    SOROBAN_NETWORK_PASSPHRASE,
    CONTRACT_ID,
    SIMULATOR_ACCOUNT
  } = process.env;

  if (!HORIZON_URL || !SOROBAN_RPC_URL || !SOROBAN_NETWORK_PASSPHRASE || !CONTRACT_ID || !SIMULATOR_ACCOUNT) {
    throw new Error("Missing Stellar configuration env vars.");
  }

  return {
    horizonUrl: HORIZON_URL,
    sorobanRpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: SOROBAN_NETWORK_PASSPHRASE,
    contractId: CONTRACT_ID,
    simulatorAccount: SIMULATOR_ACCOUNT
  };
}