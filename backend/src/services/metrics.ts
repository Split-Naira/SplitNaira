interface RequestCountKey {
  method: string;
  route: string;
  status: number;
}

interface RequestDurationKey {
  method: string;
  route: string;
}

interface RequestDurationMetrics {
  sumSeconds: number;
  count: number;
}

const requestCounters = new Map<string, number>();
const requestDurations = new Map<string, RequestDurationMetrics>();
let inflightRequests = 0;

function formatRequestCountKey(method: string, route: string, status: number): string {
  return `${method}||${route}||${status}`;
}

function formatRequestDurationKey(method: string, route: string): string {
  return `${method}||${route}`;
}

function parseRequestCountKey(key: string): RequestCountKey {
  const [method, route, status] = key.split("||");
  return {
    method,
    route,
    status: Number(status),
  };
}

function parseRequestDurationKey(key: string): RequestDurationKey {
  const [method, route] = key.split("||");
  return {
    method,
    route,
  };
}

export function incrementInflightRequests(): void {
  inflightRequests += 1;
}

export function decrementInflightRequests(): void {
  inflightRequests = Math.max(0, inflightRequests - 1);
}

export function recordRequestMetrics(
  method: string,
  route: string,
  status: number,
  durationMs: number,
): void {
  const counterKey = formatRequestCountKey(method, route, status);
  requestCounters.set(counterKey, (requestCounters.get(counterKey) ?? 0) + 1);

  const durationKey = formatRequestDurationKey(method, route);
  const current = requestDurations.get(durationKey) ?? { sumSeconds: 0, count: 0 };
  requestDurations.set(durationKey, {
    sumSeconds: current.sumSeconds + durationMs / 1000,
    count: current.count + 1,
  });
}

export function getRequestCountSnapshots(): Array<RequestCountKey & { count: number }> {
  return Array.from(requestCounters.entries()).map(([key, count]) => ({
    ...parseRequestCountKey(key),
    count,
  }));
}

export function getRequestDurationSnapshots(): Array<RequestDurationKey & { sumSeconds: number; count: number }> {
  return Array.from(requestDurations.entries()).map(([key, metrics]) => ({
    ...parseRequestDurationKey(key),
    sumSeconds: metrics.sumSeconds,
    count: metrics.count,
  }));
}

export function getInflightRequestCount(): number {
  return inflightRequests;
}

export function resetRequestMetrics(): void {
  requestCounters.clear();
  requestDurations.clear();
  inflightRequests = 0;

  projectsCreatedTotal = 0;
  distributionsExecutedTotal = 0;
  depositsReceivedTotal = 0;
  sseConnectionsActive = 0;
  sseDisconnectsTotal = 0;
  rpcRetryAttemptsByKey.clear();
  rpcRetryAttemptsTotal = 0;
  rpcRetryDurationMsTotal = 0;
  rpcRetryMaxAttemptsReachedTotal = 0;
}

/**
 * RPC retry observability counters.
 *
 * Issue #836: the operations and routes that hit Soroban JSON-RPC need
 * structured visibility into retry counts, delays, and final outcomes so
 * operators can alert on RPC reliability without scraping log strings.
 *
 * Labels: `operation` (e.g. `getAccount`, `simulateTransaction`,
 *      `getEvents`, `getLatestLedger`), `outcome` (one of
 *      `success`, `transient_failure`, `exhausted`, `validation_error`,
 *      `timeout`), and `endpoint` (a normalised host label like `rpc`).
 *
 * We expose four aggregate series from {@link getRpcRetrySnapshots}:
 * - `splitnaira_rpc_retry_attempts_total`  - attempts cumulatively, including the first try.
 * - `splitnaira_rpc_retry_max_attempts_reached_total` - times we burned the full retry budget.
 * - `splitnaira_rpc_retry_duration_ms_total` - sum of `attempt-1` retry-sleep ms, useful for tail latency.
 * - `splitnaira_rpc_retry_outcomes_total` - final outcome of a retry sequence, by label tuple.
 */
interface RpcRetryKey {
  operation: string;
  outcome: string;
  endpoint: string;
}

interface RpcRetrySnapshot extends RpcRetryKey {
  count: number;
}

const rpcRetryAttemptsByKey = new Map<string, number>();
let rpcRetryMaxAttemptsReachedTotal = 0;
let rpcRetryDurationMsTotal = 0;
let rpcRetryAttemptsTotal = 0;

function formatRpcRetryKey(key: RpcRetryKey): string {
  return `${key.operation}||${key.outcome}||${key.endpoint}`;
}

function parseRpcRetryKey(raw: string): RpcRetryKey {
  const [operation, outcome, endpoint] = raw.split("||");
  return { operation, outcome, endpoint };
}

/**
 * Record a single RPC retry attempt.
 *
 * This helper does NOT record backoff sleep — it counts *attempts*,
 * including the first try. The metrics side effect is exposed via
 * {@link getRpcRetryAttemptsTotal}.
 *
 * @param operation   The caller-provided operation label (e.g. `simulateTransaction`).
 * @param endpoint    A short, host-derived label such as `rpc` or `testnet`.
 *                    Pass an empty string to omit; call sites that do not know
 *                    should default to `rpc` so labels stay consistent.
 * @param attempt     1-based attempt number (1 means the first try).
 */
export function recordRpcRetryAttempt(
  operation: string,
  endpoint: string,
  _attempt: number,
): void {
  const key: RpcRetryKey = {
    operation,
    outcome: "attempt",
    endpoint: endpoint || "rpc",
  };
  const mapKey = formatRpcRetryKey(key);
  rpcRetryAttemptsByKey.set(mapKey, (rpcRetryAttemptsByKey.get(mapKey) ?? 0) + 1);
  rpcRetryAttemptsTotal += 1;
  // `_attempt` is reserved for future per-attempt histogram buckets
  // (e.g. capturing the attempt number alongside latency). Underscore
  // prefix marks it intentionally unused so TypeScript's
  // noUnusedParameters accepts it.
}

/**
 * Record only the backoff sleep duration for a retry attempt.
 *
 * This MUST be called once per retry — i.e. once per failed attempt that
 * is followed by a sleep — and MUST NOT be combined with another
 * `recordRpcRetryAttempt` call that would double-count the attempt itself.
 * Keeping these as separate helpers avoids the mistake of inflating the
 * attempts counter when all you meant to do was charge the backoff timer.
 *
 * `_operation`, `_endpoint`, and `_attempt` are reserved for a future
 * per-(operation, attempt) backoff histogram and are intentionally unused
 * for now.
 */
export function recordRpcRetryBackoff(
  _operation: string,
  _endpoint: string,
  _attempt: number,
  delayMs: number,
): void {
  if (delayMs <= 0) return;
  rpcRetryDurationMsTotal += delayMs;
}

/**
 * Record the final outcome of a retry sequence. `outcome` is one of:
 *   - `success`           : operation succeeded before retry budget was exhausted
 *   - `transient_failure` : retries failed but we did not exhaust them (rare — currently
 *                           we always exhaust on error). Kept for future use and for
 *                           signal-stability so dashboards do not break if behaviour changes.
 *   - `timeout`           : an attempt blew past `timeoutMs` and the helper raised
 *                           `RpcTimeoutError`.
 *   - `validation_error`  : the operation threw `RequestValidationError`, so we
 *                           bailed immediately without retrying.
 *   - `exhausted`         : all retries were used and the final attempt failed.
 */
export function recordRpcRetryOutcome(
  operation: string,
  outcome: string,
  endpoint: string,
): void {
  const key: RpcRetryKey = {
    operation,
    outcome,
    endpoint: endpoint || "rpc",
  };
  const mapKey = formatRpcRetryKey(key);
  rpcRetryAttemptsByKey.set(mapKey, (rpcRetryAttemptsByKey.get(mapKey) ?? 0) + 1);

  if (outcome === "exhausted") {
    rpcRetryMaxAttemptsReachedTotal += 1;
  }
}

export function getRpcRetrySnapshots(): RpcRetrySnapshot[] {
  return Array.from(rpcRetryAttemptsByKey.entries()).map(([key, count]) => ({
    ...parseRpcRetryKey(key),
    count,
  }));
}

export function getRpcRetryAttemptsTotal(): number {
  return rpcRetryAttemptsTotal;
}

export function getRpcRetryMaxAttemptsReachedTotal(): number {
  return rpcRetryMaxAttemptsReachedTotal;
}

export function getRpcRetryDurationMsTotal(): number {
  return rpcRetryDurationMsTotal;
}

let projectsCreatedTotal = 0;
let distributionsExecutedTotal = 0;
let depositsReceivedTotal = 0;
let sseConnectionsActive = 0;
let sseDisconnectsTotal = 0;

export function incrementProjectsCreated(): void {
  projectsCreatedTotal += 1;
}

export function incrementDistributionsExecuted(): void {
  distributionsExecutedTotal += 1;
}

export function incrementDepositsReceived(): void {
  depositsReceivedTotal += 1;
}

export function incrementSseConnections(): void {
  sseConnectionsActive += 1;
}

/**
 * Records an SSE client disconnect (#1166): decrements the active-connection
 * gauge and increments the cumulative disconnects counter. Kept as one call
 * so every disconnect site updates both consistently.
 */
export function recordSseDisconnect(): void {
  sseConnectionsActive = Math.max(0, sseConnectionsActive - 1);
  sseDisconnectsTotal += 1;
}

export function getProjectsCreatedTotal(): number {
  return projectsCreatedTotal;
}

export function getDistributionsExecutedTotal(): number {
  return distributionsExecutedTotal;
}

export function getDepositsReceivedTotal(): number {
  return depositsReceivedTotal;
}

export function getSseConnectionsActive(): number {
  return sseConnectionsActive;
}

export function getSseDisconnectsTotal(): number {
  return sseDisconnectsTotal;
}
