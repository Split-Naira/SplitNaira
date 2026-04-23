import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  xdr
} from "@stellar/stellar-sdk";
import { getEnv } from "../config/env.js";

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

/**
 * Shape returned by every unsigned-transaction builder — what the client
 * receives to sign with Freighter and submit back to the network.
 */
export interface UnsignedTxResponse {
  xdr: string;
  metadata: {
    contractId: string;
    networkPassphrase: string;
    sourceAccount: string;
    sequenceNumber: string;
    fee: string;
    operation: string;
  };
}

let cachedConfig: StellarConfig | null = null;
let cachedRpcServer: rpc.Server | null = null;

export function loadStellarConfig(): StellarConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = getEnv();

  cachedConfig = {
    horizonUrl: env.HORIZON_URL,
    sorobanRpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    contractId: env.CONTRACT_ID,
    simulatorAccount: env.SIMULATOR_ACCOUNT
  };

  return cachedConfig;
}

export function getStellarRpcServer(): rpc.Server {
  if (cachedRpcServer) {
    return cachedRpcServer;
  }

  const config = loadStellarConfig();
  cachedRpcServer = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });
  return cachedRpcServer;
}

/**
 * Fetch the Soroban account for the given address, or throw a
 * RequestValidationError with a role-specific message if it isn't found on
 * the currently configured network.
 */
export async function resolveSourceAccount(
  address: string,
  roleLabel = "source"
) {
  const server = getStellarRpcServer();
  try {
    return await server.getAccount(address);
  } catch {
    throw new RequestValidationError(
      `${roleLabel} account not found on selected network`
    );
  }
}

/**
 * Parse a Stellar address string into an Address object, or throw a
 * RequestValidationError naming the field that failed validation.
 */
export function parseStellarAddress(
  value: string,
  fieldLabel: string
): Address {
  try {
    return Address.fromString(value);
  } catch {
    throw new RequestValidationError(
      `${fieldLabel} must be a valid Stellar address`
    );
  }
}

/**
 * End-to-end primitive for building an unsigned contract-call transaction:
 * resolves the source account, assembles the contract invocation, prepares
 * the transaction, and shapes the response in the standard UnsignedTxResponse
 * form. New contract operations can be added by calling this with their
 * operation name + pre-built ScVal args.
 */
export async function buildUnsignedContractCall(params: {
  sourceAddress: string;
  sourceRoleLabel?: string;
  operation: string;
  args: xdr.ScVal[];
}): Promise<UnsignedTxResponse> {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  const sourceAccount = await resolveSourceAccount(
    params.sourceAddress,
    params.sourceRoleLabel ?? "source"
  );

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call(params.operation, ...params.args))
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);

  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: params.sourceAddress,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: params.operation
    }
  };
}