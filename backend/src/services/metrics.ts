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
}

let projectsCreatedTotal = 0;
let distributionsExecutedTotal = 0;
let depositsReceivedTotal = 0;
let sseConnectionsActive = 0;

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

export function decrementSseConnections(): void {
  sseConnectionsActive = Math.max(0, sseConnectionsActive - 1);
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
