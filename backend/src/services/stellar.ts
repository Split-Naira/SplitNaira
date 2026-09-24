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
import { configureReadCache, getReadCache } from "./read-cache.js";
import {
  recordRpcRetryAttempt,
  recordRpcRetryBackoff,
  recordRpcRetryBudget,
  recordRpcRetryOutcome
} from "./metrics.js";
import { DEFAULT_RPC_MAX_RETRIES, boundRetryBudget } from "./rpc-retry-budget.js";

export { RPC_RETRY_BUDGET_MAX_RETRIES, boundRetryBudget } from "./rpc-retry-budget.js";

/**
 * Issue #836: normalise an RPC error message for log output.
 *
 * Defence-in-depth scrubber:
 * - Drops everything after a newline so multi-line stack traces don't bloat logs.
 * - Trims trailing whitespace.
 * - Substitutes known sensitive substrings with `[REDACTED]` markers:
 *     * `secret_key=...` and `secretkey=...` (any case) \u2014 key=value hints.
 *     * `xdr=...` followed by base64-ish characters \u2014 unsigned XDR blobs.
 *     * Raw Stellar **secret seeds** (`S[A-Z2-7]{55}`) \u2014 secret key strings.
 *     * 64-char hex sequences \u2014 probable private key / signature material.
 *     * 56-char Stellar **public keys** are NOT redacted: ops need them for
 *       incident triage. Only opaque secret material is.
 * - Caps the final length at 512 chars to keep log lines bounded.
 *
 * IMPORTANT: callers MUST NOT put private keys, XDR blobs, signed payloads,
 * or full request/response bodies into the string passed in here. Upstream
 * RPC errors include only host-level diagnostics so this scrubber does not
 * need to walk the value; that is the responsibility of every call site.
 */
function sanitizeRpcErrorMessage(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "unknown";
  }
  const text = typeof raw === "string" ? raw : String(raw);
  const oneLine = text.split("\n")[0]?.trim() ?? "unknown";

  return oneLine
    // key=value style hints with any quote form
    .replace(/secret[_]?key\s*=\s*"?[^\s,"}]+"?/gi, "secret_key=[REDACTED]")
    // base64 XDR blobs (12+ chars to keep the heuristic tight)
    .replace(/xdr\s*=\s*"?[A-Za-z0-9+/=]{12,}"?/gi, "xdr=[REDACTED]")
    // Raw Stellar secret seeds (S + 55 base32 chars)
    .replace(/\bS[A-Z2-7]{55}\b/g, "[REDACTED_SECRET_SEED]")
    // 64-char hex strings (likely signing material / private keys)
    .replace(/\b[0-9a-fA-F]{64}\b/g, "[REDACTED_HEX]")
    .slice(0, 512);
}

/**
 * Issue #836: categorise an error for retry metrics without leaking
 * sensitive values. Stable categories keep dashboard labels consistent.
 */
type RpcRetryOutcome = "success" | "transient_failure" | "timeout" | "validation_error" | "exhausted";


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
  /**
   * Issue #836: short label identifying the operation being retried
   * (e.g. `simulateTransaction`, `getEvents`). Plumbed into
   * structured logs and Prometheus retry metrics so operators can
   * alert per-operation. Defaults to `unknown` when omitted.
   */
  operation?: string;
  /**
   * Issue #836: short label identifying the configured RPC endpoint.
   * Defaults to `rpc` so dashboard labels stay consistent.
   */
  endpoint?: string;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: DEFAULT_RPC_MAX_RETRIES,
  initialDelayMs: 1000,
  timeoutMs: 10000,
  operation: "unknown",
  endpoint: "rpc"
};

/**
 * Issue #836: retry-aware RPC call wrapper.
 *
 * - Records per-attempt counters and a final-outcome counter per operation/endpoint.
 * - Emits structured Winston logs on every retry and on terminal outcomes.
 * - Scrubs error messages before they reach the log pipeline so transaction
 *   secrets / XDR blobs cannot leak through this code path.
 *
 * Backwards compatibility: callers passing only the legacy
 * `(operation, { maxRetries, initialDelayMs, timeoutMs })` form continue to
 * work — the new fields default to `operation = "unknown"` and `endpoint = "rpc"`.
 *
 * Metric semantics:
 *   - Each *attempt* (including the first) increments `..._retry_attempts_total`.
 *   - Each *retry schedule* (not the first attempt) records an additional
 *     backoff in `..._retry_duration_ms_total`.
 *   - The **final outcome** of the sequence is recorded exactly once with
 *     one of: `success`, `validation_error`, `timeout`, `exhausted`.
 *   - Issue #1089: `maxRetries` is clamped to `RPC_RETRY_BUDGET_MAX_RETRIES`,
 *     and each sequence records its budget (retries allowed), the retries it
 *     actually used, and whether it exhausted the budget.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { initialDelayMs, timeoutMs, operation: operationLabel, endpoint } = opts;
  const maxRetries = boundRetryBudget(opts.maxRetries);
  if (maxRetries !== opts.maxRetries) {
    logger.warn("RPC retry budget clamped", {
      operation: operationLabel,
      endpoint,
      requestedMaxRetries: opts.maxRetries,
      appliedMaxRetries: maxRetries,
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Count every attempt (including the first) up front so the per-attempt
    // counter is monotonic and matches what dashboards call `attempts_total`.
    // This call is the sole source of truth for the attempts counter; the
    // backoff-only helper below must NOT also call into the attempts counter.
    recordRpcRetryAttempt(operationLabel, endpoint, attempt + 1);

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new RpcTimeoutError()), timeoutMs);
      });

      try {
        const result = await Promise.race([operation(), timeoutPromise]);
        // Successful attempt \u2014 record the final outcome and return.
        // Without this, success-rate per operation cannot be computed.
        recordRpcRetryOutcome(operationLabel, "success", endpoint);
        recordRpcRetryBudget(operationLabel, endpoint, maxRetries, attempt, false);
        return result;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } catch (error) {
      lastError = error as Error;
      const safeMessage = sanitizeRpcErrorMessage(
        error instanceof Error ? error.message : error
      );
      const errorKind = error instanceof Error ? error.name : typeof error;

      // Don't retry validation errors \u2014 they will always fail.
      if (error instanceof RequestValidationError) {
        logger.warn("RPC operation rejected before retrying", {
          operation: operationLabel,
          endpoint,
          attempt: attempt + 1,
          maxRetries,
          errorKind,
          errorMessage: safeMessage,
        });
        recordRpcRetryOutcome(operationLabel, "validation_error", endpoint);
        recordRpcRetryBudget(operationLabel, endpoint, maxRetries, attempt, false);
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(
          initialDelayMs * Math.pow(2, attempt),
          // 30s cap avoids pathological waits if a caller raises initialDelayMs.
          30_000,
        );
        logger.warn("RPC retry scheduled", {
          operation: operationLabel,
          endpoint,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          maxRetries,
          delayMs: delay,
          errorKind,
          errorMessage: safeMessage,
        });
        // Record scheduler-side backoff so tail-latency is observable. The
        // attempt itself was already counted at the top of the loop via
        // `recordRpcRetryAttempt`, so we use the dedicated helper that only
        // increments `splitnaira_rpc_retry_duration_ms_total` and never
        // touches the attempts counter.
        recordRpcRetryBackoff(operationLabel, endpoint, attempt + 1, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Loop exited without returning \u2014 retries were exhausted.
  // Classify the terminal outcome using the last captured error.
  const finalOutcome: RpcRetryOutcome = lastError instanceof RpcTimeoutError
    ? "timeout"
    : "exhausted";

  const safeMessage = sanitizeRpcErrorMessage(
    lastError instanceof Error ? lastError.message : lastError
  );
  const errorKind = lastError instanceof Error ? lastError.name : typeof lastError;

  logger.error("RPC retries exhausted", {
    operation: operationLabel,
    endpoint,
    maxRetries,
    errorKind,
    errorMessage: safeMessage,
  });
  recordRpcRetryOutcome(operationLabel, finalOutcome, endpoint);
  // Every retry was spent whether the last attempt errored or timed out.
  recordRpcRetryBudget(operationLabel, endpoint, maxRetries, maxRetries, true);
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

/**
 * Issue #1033: Returns a cached value if present, or coalesces concurrent
 * callers onto the same in-flight Promise. Only one upstream fetch is
 * performed per cache key while a prior call is still pending.
 */
export async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  return getReadCache().getOrFetch(key, fetcher);
}

export function getCacheStats(): { size: number; keys: string[] } {
  return getReadCache().stats();
}

export interface SorobanReachabilityStatus {
  rpc: {
    ok: boolean;
    message?: string;
    /** Issue #935: round-trip time for the `getAccount` call, in milliseconds. */
    latencyMs?: number;
  };
  contract: {
    ok: boolean;
    message?: string;
    /** Issue #935: round-trip time for the `simulateTransaction` call, in milliseconds. */
    latencyMs?: number;
  };
}

/**
 * Issue #935: probes Soroban RPC reachability and contract simulation,
 * capturing latency for each call so the readiness endpoint can distinguish
 * "reachable but slow" (degraded) from "unreachable" (down). Latency is
 * measured around the full `executeWithRetry` call (including any retries),
 * since a caller waiting on this endpoint cares about total wall-clock time,
 * not just the final attempt.
 */
export async function checkSorobanReachability(): Promise<SorobanReachabilityStatus> {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  const rpcStart = Date.now();
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount), {
      maxRetries: 1,
      timeoutMs: 5_000,
      operation: "checkSorobanReachability.getAccount"
    });
  } catch (error) {
    return {
      rpc: {
        ok: false,
        latencyMs: Date.now() - rpcStart,
        message: error instanceof Error ? error.message : "Soroban RPC account lookup failed"
      },
      contract: {
        ok: false,
        message: "Skipped because Soroban RPC is unreachable"
      }
    };
  }
  const rpcLatencyMs = Date.now() - rpcStart;

  const contractStart = Date.now();
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
      timeoutMs: 5_000,
      operation: "checkSorobanReachability.simulateProjectExists"
    });
  } catch (error) {
    return {
      rpc: { ok: true, latencyMs: rpcLatencyMs },
      contract: {
        ok: false,
        latencyMs: Date.now() - contractStart,
        message: error instanceof Error ? error.message : "Contract simulation failed"
      }
    };
  }

  return {
    rpc: { ok: true, latencyMs: rpcLatencyMs },
    contract: { ok: true, latencyMs: Date.now() - contractStart }
  };
}
