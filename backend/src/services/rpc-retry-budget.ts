/**
 * Issue #1089: bounded retry budget policy for Stellar RPC calls.
 *
 * Kept free of imports so `/metrics` can expose the ceiling without pulling
 * in (or tripping test mocks of) the Stellar SDK wrapper in `stellar.ts`.
 */

/** Retries per call when the caller does not ask for a specific budget. */
export const DEFAULT_RPC_MAX_RETRIES = 3;

/**
 * Hard ceiling on retries for a single RPC call, regardless of what the
 * caller asks for. With the 30s backoff cap in `executeWithRetry` this bounds
 * the worst case a request can spend sleeping between attempts, and keeps one
 * bad call site from multiplying load on a degraded RPC endpoint.
 */
export const RPC_RETRY_BUDGET_MAX_RETRIES = 5;

/**
 * Clamp a caller-requested retry count into `[0, RPC_RETRY_BUDGET_MAX_RETRIES]`.
 * Non-finite values (e.g. an explicit `maxRetries: undefined` overriding the
 * default via object spread) fall back to the default budget.
 */
export function boundRetryBudget(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_RPC_MAX_RETRIES;
  }
  return Math.min(Math.max(0, Math.floor(requested)), RPC_RETRY_BUDGET_MAX_RETRIES);
}
