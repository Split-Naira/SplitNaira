"use client";

import * as Sentry from "@sentry/nextjs";
import type { SplitProject, Collaborator } from "./stellar";
import { getEnv } from "./env";
import { withRetry } from "./retry";

// ── API Error classification ──────────────────────────────────────────────────

/**
 * Typed error thrown by ApiClient for all non-2xx responses.
 * Consumers can branch on `status` or `code` for user-facing messages.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True for 4xx client errors (bad request, not found, etc.) */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** True for 5xx server errors */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /** True for 404 Not Found */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** True for 401 / 403 auth errors */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface CreateSplitPayload {
  owner: string;
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: Array<Collaborator>;
}

export interface ProjectHistoryItem {
  id: string;
  type: "round" | "payment";
  round: number;
  amount: string | number;
  recipient: string;
  ledgerCloseTime: number;
  txHash: string;
}

export interface ProjectHistoryResponse {
  items: ProjectHistoryItem[];
  nextCursor: string | null;
}

export interface ClaimableInfo {
  claimed: string | number;
  claimable?: string | number;
  distributionRound?: number;
}

export interface TokenAllowlistState {
  admin: string | null;
  allowedTokenCount: number;
  tokens: string[];
  start: number;
  limit: number;
}

export interface AdminStatusState {
  admin: string | null;
  isPaused: boolean;
}

export interface UnallocatedBalanceState {
  token: string;
  unallocated: string;
}

export interface IdempotencyStats {
  conflictsTotal: number;
  replaysTotal: number;
}

/**
 * Simplified frontend-side system status, derived from the backend health
 * endpoint response.
 *
 * ── ASSUMED BACKEND CONTRACT (not yet merged upstream) ──────────────────────
 * As of this writing, `GET /health` (aliased `/health/ready`) returns
 * `{ status: "ready" | "not_ready", error?, message?, issues?, requestId? }`
 * with a 503 on `not_ready`. A parallel, separate piece of work is adding a
 * three-way `"ready" | "degraded" | "not_ready"` status (200 for
 * ready/degraded, 503 for not_ready) for a dependency-level breakdown. That
 * work is unmerged, so its exact final shape is unknown here — this is a
 * best-guess, tolerant mapping, not a byte-for-byte match to what the
 * backend ultimately ships:
 *   - "ready" / "ok"        -> "ok"          (fully operational)
 *   - "degraded"            -> "degraded"    (banner only; reads AND writes
 *                                             still work)
 *   - "not_ready" / "maintenance" / an unrecognized body on a 503
 *                           -> "maintenance" (banner + writes disabled;
 *                                             reads keep working)
 * Anything else (network error, timeout, unparseable JSON, unexpected
 * shape on a 2xx) fails open to "ok" so a broken health check never itself
 * breaks the app.
 */
export type SystemStatus = "ok" | "degraded" | "maintenance";

export interface SystemStatusResponse {
  status: SystemStatus;
  message?: string;
}

interface BuildSplitResponse {
  xdr: string;
  metadata: {
    networkPassphrase: string;
    contractId: string;
    operation?: string;
  };
}

export interface ListProjectsParams {
  start?: number;
  limit?: number;
  search?: string;
  type?: string;
}

export interface WithdrawUnallocatedPayload {
  admin: string;
  token: string;
  to: string;
  amount: number;
}

export interface WithdrawUnallocatedResponse extends BuildSplitResponse {
  metadata: BuildSplitResponse["metadata"] & {
    auditContext: {
      token: string;
      destination: string;
      amount: number;
      initiatedAt: string;
    };
  };
}

export class ApiClient {
  private baseUrl: string;
  private defaultTimeout: number;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = baseUrl ?? getEnv().NEXT_PUBLIC_API_BASE_URL;
    this.defaultTimeout = timeout ?? 30_000;
  }

  private toApiError(
    status: number,
    payload: unknown,
    fallback: string,
  ): ApiError {
    let message = `${fallback} (status ${status})`;
    let code: string | undefined;

    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (typeof p.message === "string" && p.message.trim()) {
        message = p.message;
      }
      if (typeof p.error === "string" && p.error.trim()) {
        code = p.error;
      } else if (typeof p.code === "string" && p.code.trim()) {
        code = p.code;
      }
    }

    return new ApiError(status, message, code);
  }

  /**
   * Determines whether a failed request should be retried.
   * 4xx client errors (except 429 Too Many Requests) are not retried —
   * they indicate a bad request that will not succeed on retry.
   */
  private shouldRetry(err: unknown): boolean {
    if (err instanceof ApiError) {
      // Retry on 429 (rate limit) and all 5xx server errors
      return err.status === 429 || err.isServerError;
    }
    if (err instanceof Error && /timed out/i.test(err.message)) {
      return false;
    }
    // Retry on transient network errors.
    return true;
  }

  private async requestJson<T>(
    path: string,
    fallbackMessage: string,
    init?: RequestInit & { timeout?: number },
  ): Promise<T> {
    try {
      return await withRetry(
        async () => {
          const timeout = init?.timeout ?? this.defaultTimeout;
          const { timeout: _timeout, ...fetchInit } = init ?? {};
          const controller = new AbortController();
          let timeoutId: ReturnType<typeof setTimeout> | undefined;

          try {
            const timeoutError = new Error(`Request timed out after ${timeout}ms: ${path}`);
            const response = await Promise.race([
              fetch(`${this.baseUrl}${path}`, {
                ...fetchInit,
                signal: controller.signal,
              }),
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  controller.abort();
                  reject(timeoutError);
                }, timeout);
              }),
            ]);

            const body = (await response.json().catch(() => null)) as unknown;
            if (!response.ok) {
              throw this.toApiError(response.status, body, fallbackMessage);
            }
            return body as T;
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              throw new Error(`Request timed out after ${timeout}ms: ${path}`, { cause: err });
            }
            throw err;
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        },
        3,
        500,
        (err) => this.shouldRetry(err),
      );
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "api-client",
            path,
            ...(err instanceof ApiError
              ? { httpStatus: String(err.status), errorCode: err.code ?? "unknown" }
              : {}),
          },
          extra: {
            fallbackMessage,
            init,
          },
        });
      }
      throw err;
    }
  }

  async buildCreateSplitXdr(
    payload: CreateSplitPayload,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      "/splits",
      "Failed to build split transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  async buildDistributeXdr(
    projectId: string,
    sourceAddress: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      `/splits/${encodeURIComponent(projectId)}/distribute`,
      "Failed to build distribution transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAddress }),
      },
    );
  }

  async buildLockProjectXdr(
    projectId: string,
    owner: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      `/splits/${encodeURIComponent(projectId)}/lock`,
      "Failed to build lock transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      },
    );
  }

  async buildDepositXdr(
    projectId: string,
    from: string,
    amount: number,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      `/splits/${encodeURIComponent(projectId)}/deposit`,
      "Failed to build deposit transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, amount }),
      },
    );
  }

  async buildUpdateMetadataXdr(
    projectId: string,
    owner: string,
    title: string,
    projectType: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      `/splits/${encodeURIComponent(projectId)}/metadata`,
      "Failed to build metadata update transaction",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, title, projectType }),
      },
    );
  }

  async buildUpdateCollaboratorsXdr(
    projectId: string,
    owner: string,
    collaborators: Array<Collaborator>,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      `/splits/${encodeURIComponent(projectId)}/collaborators`,
      "Failed to build collaborators update transaction",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, collaborators }),
      },
    );
  }

  async buildAllowTokenXdr(
    admin: string,
    token: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      "/splits/admin/allow-token",
      "Failed to build allow token transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin, token }),
      },
    );
  }

  async buildDisallowTokenXdr(
    admin: string,
    token: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      "/splits/admin/disallow-token",
      "Failed to build disallow token transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin, token }),
      },
    );
  }

  async buildPauseDistributionsXdr(
    admin: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      "/splits/admin/pause-distributions",
      "Failed to build pause transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin }),
      },
    );
  }

  async buildUnpauseDistributionsXdr(
    admin: string,
  ): Promise<BuildSplitResponse> {
    return this.requestJson<BuildSplitResponse>(
      "/splits/admin/unpause-distributions",
      "Failed to build unpause transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin }),
      },
    );
  }

  async buildWithdrawUnallocatedXdr(
    payload: WithdrawUnallocatedPayload,
  ): Promise<WithdrawUnallocatedResponse> {
    return this.requestJson<WithdrawUnallocatedResponse>(
      "/splits/admin/withdraw-unallocated",
      "Failed to build withdraw unallocated transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  async getSplit(projectId: string): Promise<SplitProject> {
    const raw = await this.requestJson<Record<string, unknown>>(
      `/splits/${encodeURIComponent(projectId)}`,
      "Failed to fetch split project",
    );
    return mapProjectToCamelCase(raw);
  }

  async getAllSplits(): Promise<SplitProject[]> {
    const raws = await this.requestJson<Record<string, unknown>[]>(
      "/splits",
      "Failed to fetch projects",
    );
    return raws.map(mapProjectToCamelCase);
  }

  async listProjects(
    params?: ListProjectsParams,
  ): Promise<SplitProject[]> {
    const query = new URLSearchParams();
    if (params?.start !== undefined) query.set("start", String(params.start));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.search !== undefined && params.search) query.set("search", params.search);
    if (params?.type !== undefined && params.type) query.set("type", params.type);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const raws = await this.requestJson<Record<string, unknown>[]>(
      `/splits${suffix}`,
      "Failed to fetch projects",
    );
    return raws.map(mapProjectToCamelCase);
  }

  async getClaimable(
    projectId: string,
    address: string,
  ): Promise<ClaimableInfo> {
    return this.requestJson<ClaimableInfo>(
      `/splits/${encodeURIComponent(projectId)}/claimable/${encodeURIComponent(address)}`,
      "Failed to fetch claimable info",
    );
  }

  async getProjectHistory(
    projectId: string,
    cursor?: string,
  ): Promise<ProjectHistoryResponse> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.requestJson<ProjectHistoryResponse>(
      `/splits/${encodeURIComponent(projectId)}/history${query}`,
      "Failed to fetch project history",
    );
  }

  async getTokenAllowlist(
    start = 0,
    limit = 100,
  ): Promise<TokenAllowlistState> {
    return this.requestJson<TokenAllowlistState>(
      `/splits/admin/allowlist?start=${start}&limit=${limit}`,
      "Failed to fetch token allowlist",
    );
  }

  async getAdminStatus(): Promise<AdminStatusState> {
    return this.requestJson<AdminStatusState>(
      "/splits/admin/status",
      "Failed to fetch admin status",
    );
  }

  async isTokenAllowed(
    token: string,
  ): Promise<{ token: string; isAllowed: boolean }> {
    return this.requestJson<{ token: string; isAllowed: boolean }>(
      `/splits/admin/is-token-allowed?token=${encodeURIComponent(token)}`,
      "Failed to check token allowlist status",
    );
  }

  async getAdminTokenCount(): Promise<{ count: number }> {
    return this.requestJson<{ count: number }>(
      "/splits/admin/token-count",
      "Failed to fetch allowed token count",
    );
  }

  async getUnallocatedBalance(
    token: string,
  ): Promise<UnallocatedBalanceState> {
    return this.requestJson<UnallocatedBalanceState>(
      `/splits/admin/unallocated?token=${encodeURIComponent(token)}`,
      "Failed to fetch unallocated balance",
    );
  }

  async getIdempotencyStats(): Promise<IdempotencyStats> {
    const raw = await this.requestJson<Record<string, unknown>>(
      "/ops/status",
      "Failed to fetch idempotency stats",
    );
    const idempotency = raw.idempotency as Record<string, unknown> | undefined;
    return {
      conflictsTotal: typeof idempotency?.conflictsTotal === "number" ? idempotency.conflictsTotal : 0,
      replaysTotal: typeof idempotency?.replaysTotal === "number" ? idempotency.replaysTotal : 0,
    };
  }

  /**
   * Fetches the backend's health/status endpoint and maps it to the
   * frontend's simplified `SystemStatus`. Never throws — a network error,
   * timeout, or unparseable response resolves to `{ status: "ok" }` (fail
   * open) rather than surfacing a fake maintenance banner because the
   * health check itself is broken. See `SystemStatusResponse` above for the
   * assumed backend contract this maps from.
   */
  async getSystemStatus(): Promise<SystemStatusResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as unknown;
      return normalizeSystemStatus(body, response.status);
    } catch {
      // Network error, timeout, or abort — fail open rather than block the app.
      return { status: "ok" };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Maps a raw `/health` response body (of whichever shape the backend
 * happens to send) to the frontend's simplified `SystemStatus`. Tolerant of
 * a missing/unexpected shape — falls open to "ok" unless the HTTP status
 * itself signals an outage (503).
 */
function normalizeSystemStatus(
  body: unknown,
  httpStatus: number,
): SystemStatusResponse {
  if (!body || typeof body !== "object") {
    return httpStatus === 503 ? { status: "maintenance" } : { status: "ok" };
  }

  const b = body as Record<string, unknown>;
  const rawStatus =
    typeof b.status === "string" ? b.status.toLowerCase() : "";
  const message = typeof b.message === "string" ? b.message : undefined;

  if (rawStatus === "ready" || rawStatus === "ok") {
    return { status: "ok", message };
  }
  if (rawStatus === "degraded") {
    return { status: "degraded", message };
  }
  if (rawStatus === "not_ready" || rawStatus === "maintenance") {
    return { status: "maintenance", message };
  }

  // Unrecognized status string: defer to the HTTP status code.
  return httpStatus === 503
    ? { status: "maintenance", message }
    : { status: "ok", message };
}

function stringFrom(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanFrom(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function mapProjectToCamelCase(p: Record<string, unknown>): SplitProject {
  const collaborators = Array.isArray(p.collaborators)
    ? (p.collaborators as Record<string, unknown>[])
    : [];

  return {
    projectId: stringFrom(p.projectId ?? p.project_id),
    title: stringFrom(p.title),
    projectType: stringFrom(p.projectType ?? p.project_type),
    token: stringFrom(p.token),
    owner: stringFrom(p.owner),
    locked: booleanFrom(p.locked),
    balance: stringFrom(p.balance, "0"),
    totalDistributed: stringFrom(p.totalDistributed ?? p.total_distributed, "0"),
    distributionRound: numberFrom(p.distributionRound ?? p.distribution_round),
    collaborators: collaborators.map((c) => ({
      address: stringFrom(c.address),
      alias: stringFrom(c.alias),
      basisPoints: numberFrom(c.basisPoints ?? c.basis_points),
    })),
  };
}
