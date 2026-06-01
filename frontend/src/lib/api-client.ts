"use client";

import * as Sentry from "@sentry/nextjs";
import type { SplitProject, Collaborator } from "./stellar";
import { getEnv } from "./env";
import { withRetry } from "./retry";

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

  private toErrorMessage(
    status: number,
    payload: unknown,
    fallback: string,
  ): string {
    if (payload && typeof payload === "object" && "message" in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    return `${fallback} (status ${status})`;
  }

  private async requestJson<T>(
    path: string,
    fallbackMessage: string,
    init?: RequestInit & { timeout?: number },
  ): Promise<T> {
    try {
      return await withRetry(async () => {
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
            throw new Error(this.toErrorMessage(response.status, body, fallbackMessage));
          }
          return body as T;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error(`Request timed out after ${timeout}ms: ${path}`);
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
        }
      }, 3, 500);
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "api-client",
            path,
          },
          extra: {
            fallbackMessage,
            init,
          }
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
    const raw = await this.requestJson<any>(
      `/splits/${encodeURIComponent(projectId)}`,
      "Failed to fetch split project",
    );
    return mapProjectToCamelCase(raw);
  }

  async getAllSplits(): Promise<SplitProject[]> {
    const raws = await this.requestJson<any[]>(
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
    const raws = await this.requestJson<any[]>(
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

function mapProjectToCamelCase(p: any): SplitProject {
  if (!p) return p;
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
    collaborators: (p.collaborators ?? []).map((c: any) => ({
      address: c.address ?? "",
      alias: c.alias ?? "",
      basisPoints: c.basisPoints ?? c.basis_points ?? 0,
    })),
  };
}
