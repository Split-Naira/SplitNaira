import type { SplitProject } from "./stellar";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
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
interface BuildSplitResponse {
  xdr: string;
  metadata: {
    networkPassphrase: string;
    contractId: string;
  };
}
export interface ProjectHistoryItem {
  id: string;
  type: "round" | "payment";
  txHash: string;
  ledgerCloseTime: string;
  round?: number;
  amount: string;
  recipient?: string;
}
function toErrorMessage(status: number, payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return `${fallback} (status ${status})`;
}
export async function buildCreateSplitXdr(payload: CreateSplitPayload): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, "Failed to build split transaction"));
  }
  return body as BuildSplitResponse;
}
// SplitProject is imported from ./stellar
export async function buildDistributeXdr(projectId: string, sourceAddress: string): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/distribute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceAddress })
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, "Failed to build distribution transaction"));
  }
  return body as BuildSplitResponse;
}
export async function buildLockProjectXdr(projectId: string, owner: string): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner })
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, "Failed to build lock transaction"));
  }
  return body as BuildSplitResponse;
}
export async function buildDepositXdr(
  projectId: string,
  from: string,
  amount: number
): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, amount })
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, "Failed to build deposit transaction"));
  }
  return body as BuildSplitResponse;
}
export async function getSplit(projectId: string): Promise<SplitProject> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}`);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(toErrorMessage(response.status, body, "Failed to fetch split project"));
  }
  return body as SplitProject;
}
export async function getProjectHistory(
  projectId: string,
): Promise<ProjectHistoryItem[]> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/history`);
  if (!response.ok) {
    throw new Error("Failed to fetch project history");
  }
  return (await response.json()) as ProjectHistoryItem[];
}