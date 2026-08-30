export {
  ApiClient,
  ApiError,
  type CreateSplitPayload,
  type ProjectHistoryItem,
  type ProjectHistoryResponse,
  type ClaimableInfo,
  type TokenAllowlistState,
  type AdminStatusState,
  type UnallocatedBalanceState,
  type IdempotencyStats,
  type WithdrawUnallocatedPayload,
  type WithdrawUnallocatedResponse,
  type ListProjectsParams,
  type SystemStatus,
  type SystemStatusResponse,
} from "./api-client";

import { ApiClient, type IdempotencyStats, type ListProjectsParams, type SystemStatusResponse } from "./api-client";
import type { SplitProject, Collaborator } from "./stellar";

const client = new ApiClient();

export async function buildCreateSplitXdr(payload: {
  owner: string;
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: Array<Collaborator>;
}): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildCreateSplitXdr(payload);
}

export async function buildDistributeXdr(
  projectId: string,
  sourceAddress: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildDistributeXdr(projectId, sourceAddress);
}

export async function buildLockProjectXdr(
  projectId: string,
  owner: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildLockProjectXdr(projectId, owner);
}

export async function buildDepositXdr(
  projectId: string,
  from: string,
  amount: number,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildDepositXdr(projectId, from, amount);
}

export async function buildUpdateMetadataXdr(
  projectId: string,
  owner: string,
  title: string,
  projectType: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildUpdateMetadataXdr(projectId, owner, title, projectType);
}

export async function buildUpdateCollaboratorsXdr(
  projectId: string,
  owner: string,
  collaborators: Array<Collaborator>,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildUpdateCollaboratorsXdr(projectId, owner, collaborators);
}

export async function buildAllowTokenXdr(
  admin: string,
  token: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildAllowTokenXdr(admin, token);
}

export async function buildDisallowTokenXdr(
  admin: string,
  token: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildDisallowTokenXdr(admin, token);
}

export async function buildPauseDistributionsXdr(
  admin: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildPauseDistributionsXdr(admin);
}

export async function buildUnpauseDistributionsXdr(
  admin: string,
): Promise<{ xdr: string; metadata: { networkPassphrase: string; contractId: string; operation?: string } }> {
  return client.buildUnpauseDistributionsXdr(admin);
}

export async function buildWithdrawUnallocatedXdr(payload: {
  admin: string;
  token: string;
  to: string;
  amount: number;
}): Promise<{
  xdr: string;
  metadata: { networkPassphrase: string; contractId: string; operation?: string; auditContext: { token: string; destination: string; amount: number; initiatedAt: string } };
}> {
  return client.buildWithdrawUnallocatedXdr(payload);
}

export async function getSplit(projectId: string): Promise<SplitProject> {
  return client.getSplit(projectId);
}

export async function getAllSplits(): Promise<SplitProject[]> {
  return client.getAllSplits();
}

export async function listProjects(params?: ListProjectsParams): Promise<SplitProject[]> {
  return client.listProjects(params);
}

export async function getClaimable(
  projectId: string,
  address: string,
): Promise<{ claimed: string | number; claimable?: string | number; distributionRound?: number }> {
  return client.getClaimable(projectId, address);
}

export async function getProjectHistory(
  projectId: string,
  cursor?: string,
): Promise<{ items: Array<{ id: string; type: "round" | "payment"; round: number; amount: string | number; recipient: string; txHash: string; ledgerCloseTime: number }>; nextCursor: string | null }> {
  return client.getProjectHistory(projectId, cursor);
}

export async function getTokenAllowlist(
  start?: number,
  limit?: number,
): Promise<{ admin: string | null; allowedTokenCount: number; tokens: string[]; start: number; limit: number }> {
  return client.getTokenAllowlist(start, limit);
}

export async function getAdminStatus(): Promise<{ admin: string | null; isPaused: boolean }> {
  return client.getAdminStatus();
}

export async function isTokenAllowed(token: string): Promise<{ token: string; isAllowed: boolean }> {
  return client.isTokenAllowed(token);
}

export async function getAdminTokenCount(): Promise<{ count: number }> {
  return client.getAdminTokenCount();
}

export async function getUnallocatedBalance(token: string): Promise<{ token: string; unallocated: string }> {
  return client.getUnallocatedBalance(token);
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return client.getSystemStatus();
}

export async function getIdempotencyStats(): Promise<IdempotencyStats> {
  return client.getIdempotencyStats();
}
