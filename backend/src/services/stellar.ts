import { rpc } from "@stellar/stellar-sdk";
import { getEnv } from "../config/env.js";

import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";

export interface StellarConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  simulatorAccount: string;
}

export class RequestValidationError extends AppError {
  constructor(message: string) {
    super(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, message);
    this.name = "RequestValidationError";
  }
}

export class RpcError extends Error {
  constructor(message: string, public statusCode: number = 502) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcTimeoutError extends RpcError {
  constructor(message: string = "RPC operation timed out") {
    super(message, 504);
    this.name = "RpcTimeoutError";
  }
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  timeoutMs: 10000
};

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries, initialDelayMs, timeoutMs } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new RpcTimeoutError()), timeoutMs)
      );

      return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
      lastError = error as Error;

      // Don't retry validation errors or timeouts (unless we want to retry on timeout)
      if (error instanceof RequestValidationError) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        console.warn(`[rpc] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new RpcError("RPC operation failed after retries");
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