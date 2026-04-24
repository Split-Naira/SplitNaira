import type { SplitProject } from "./stellar";
import { getEnv } from "./env";

const API_BASE_URL = getEnv().NEXT_PUBLIC_API_BASE_URL;

export interface CreateSplitPayload {
  owner: string;
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: Array<{
    address: string;
    alias: string;
    basisPoints: number;
  }>;
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

interface BuildSplitResponse {
  xdr: string;
  metadata: {
    networkPassphrase: string;
    contractId: string;
  };
}
export interface RemediationHint {
  message: string;
  action?: string;
  docsUrl?: string;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
  type: string;
  message: string;
  remediation?: RemediationHint;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: ApiErrorResponse,
    fallback: string
  ) {
    super(payload?.message || fallback);
    this.name = "ApiError";
  }

  get remediation() {
    return this.payload?.remediation;
  }

  get code() {
    return this.payload?.code;
  }
}

function toErrorMessage(status: number, payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const errorPayload = payload as ApiErrorResponse;
    if (errorPayload.message) {
      let msg = errorPayload.message;
      if (errorPayload.remediation) {
        msg += `\n\nSuggestion: ${errorPayload.remediation.message}`;
      }
      return msg;
    }
  }
  return `${fallback} (status ${status})`;
}

async function requestJson<T>(
  path: string,
  fallbackMessage: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, fallbackMessage));
  }
  return body as T;
}

export async function buildCreateSplitXdr(
  payload: CreateSplitPayload
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>("/splits", "Failed to build split transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function buildDistributeXdr(
  projectId: string,
  sourceAddress: string
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    `/splits/${encodeURIComponent(projectId)}/distribute`,
    "Failed to build distribution transaction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceAddress })
    }
  );
}

export async function buildLockProjectXdr(
  projectId: string,
  owner: string
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    `/splits/${encodeURIComponent(projectId)}/lock`,
    "Failed to build lock transaction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner })
    }
  );
}

export async function buildDepositXdr(
  projectId: string,
  from: string,
  amount: number
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    `/splits/${encodeURIComponent(projectId)}/deposit`,
    "Failed to build deposit transaction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, amount })
    }
  );
}

export async function buildAllowTokenXdr(
  admin: string,
  token: string
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    "/splits/admin/allow-token",
    "Failed to build allow token transaction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin, token })
    }
  );
}

export async function buildDisallowTokenXdr(
  admin: string,
  token: string
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    "/splits/admin/disallow-token",
    "Failed to build disallow token transaction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin, token })
    }
  );
}

export async function buildUpdateMetadataXdr(
  projectId: string,
  owner: string,
  title: string,
  projectType: string
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    `/splits/${encodeURIComponent(projectId)}/metadata`,
    "Failed to build metadata update transaction",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, title, projectType })
    }
  );
}

export async function buildUpdateCollaboratorsXdr(
  projectId: string,
  owner: string,
  collaborators: Array<{ address: string; alias: string; basisPoints: number }>
): Promise<BuildSplitResponse> {
  return requestJson<BuildSplitResponse>(
    `/splits/${encodeURIComponent(projectId)}/collaborators`,
    "Failed to build collaborators update transaction",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, collaborators })
    }
  );
}

export async function getSplit(projectId: string): Promise<SplitProject> {
  return requestJson<SplitProject>(
    `/splits/${encodeURIComponent(projectId)}`,
    "Failed to fetch split project"
  );
}

export async function getAllSplits(): Promise<SplitProject[]> {
  return requestJson<SplitProject[]>("/splits", "Failed to fetch projects");
}

export async function getClaimable(
  projectId: string,
  address: string
): Promise<ClaimableInfo> {
  return requestJson<ClaimableInfo>(
    `/splits/${encodeURIComponent(projectId)}/claimable/${encodeURIComponent(address)}`,
    "Failed to fetch claimable info"
  );
}

export async function getProjectHistory(
  projectId: string,
  cursor?: string
): Promise<ProjectHistoryResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestJson<ProjectHistoryResponse>(
    `/splits/${encodeURIComponent(projectId)}/history${query}`,
    "Failed to fetch project history"
  );
}

export async function getTokenAllowlist(
  start = 0,
  limit = 100
): Promise<TokenAllowlistState> {
  return requestJson<TokenAllowlistState>(
    `/splits/admin/allowlist?start=${start}&limit=${limit}`,
    "Failed to fetch token allowlist"
  );
}
