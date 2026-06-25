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
    // Retry on network/timeout errors
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
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(`${this.baseUrl}${path}`, {
              ...init,
              signal: controller.signal,
            });
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
            clearTimeout(timeoutId);
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
}

function mapProjectToCamelCase(p: Record<string, unknown>): SplitProject {
  if (!p) return p as unknown as SplitProject;
  return {
    projectId: p.projectId ?? p.project_id ?? "",
    title: p.title ?? "",
    projectType: p.projectType ?? p.project_type ?? "",
    token: p.token ?? "",
    owner: p.owner ?? "",
    locked: p.locked ?? false,
    balance: p.balance ?? "0",
    totalDistributed: p.totalDistributed ?? p.total_distributed ?? "0",
    distributionRound: p.distributionRound ?? p.distribution_round ?? 0,
    collaborators: ((p.collaborators as Record<string, unknown>[]) ?? []).map((c) => ({
      address: (c.address as string) ?? "",
      alias: (c.alias as string) ?? "",
      basisPoints: (c.basisPoints as number) ?? (c.basis_points as number) ?? 0,
    })),
  };
}
