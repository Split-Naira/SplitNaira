import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc
} from "@stellar/stellar-sdk";
import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { logger } from "./logger.js";
import { configureReadCache, getReadCache } from "./read-cache.js";

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
        logger.warn("RPC retry", { attempt: attempt + 1, delay, error });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new RpcError("RPC operation failed after retries");
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
  configureReadCache({
    defaultTtlMs: env.READ_CACHE_TTL_MS
      ? Number(env.READ_CACHE_TTL_MS)
      : undefined,
    maxEntries: env.READ_CACHE_MAX_ENTRIES
      ? Number(env.READ_CACHE_MAX_ENTRIES)
      : undefined,
  });

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

/** Default TTL for read-cache entries (override via `READ_CACHE_TTL_MS`). */
export const READ_CACHE_TTL_MS = 30_000;

export function getCached<T>(key: string): T | undefined {
  return getReadCache().get<T>(key);
}

export function setCached<T>(
  key: string,
  value: T,
  ttlMs = READ_CACHE_TTL_MS,
): void {
  getReadCache().set(key, value, ttlMs);
}

export function invalidateCache(key: string): void {
  getReadCache().delete(key);
}

export function invalidateCacheByPrefix(prefix: string): void {
  getReadCache().deleteByPrefix(prefix);
}

export function getCacheStats(): { size: number; keys: string[] } {
  return getReadCache().stats();
}

export interface SorobanReachabilityStatus {
  rpc: {
    ok: boolean;
    message?: string;
  };
  contract: {
    ok: boolean;
    message?: string;
  };
}

export async function checkSorobanReachability(): Promise<SorobanReachabilityStatus> {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount), {
      maxRetries: 1,
      timeoutMs: 5_000
    });
  } catch (error) {
    return {
      rpc: {
        ok: false,
        message: error instanceof Error ? error.message : "Soroban RPC account lookup failed"
      },
      contract: {
        ok: false,
        message: "Skipped because Soroban RPC is unreachable"
      }
    };
  }

  try {
    Address.fromString(config.contractId);
    const contract = new Contract(config.contractId);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(contract.call("project_exists", nativeToScVal("__healthcheck__", { type: "symbol" })))
      .setTimeout(30)
      .build();

    await executeWithRetry(() => server.simulateTransaction(tx), {
      maxRetries: 1,
      timeoutMs: 5_000
    });
  } catch (error) {
    return {
      rpc: { ok: true },
      contract: {
        ok: false,
        message: error instanceof Error ? error.message : "Contract simulation failed"
      }
    };
  }

  return {
    rpc: { ok: true },
    contract: { ok: true }
  };
}
