/**
 * Project ownership transfer workflow (#1297).
 *
 * Requires authorization from the current owner, validates the new owner
 * wallet, and records the transfer in an in-process audit log (mirrors the
 * shape of AuditLog payloads for later DB persistence).
 */

export interface OwnershipTransferRecord {
  id: string;
  projectId: string;
  fromOwner: string;
  toOwner: string;
  authorizedBy: string;
  transferredAt: string;
}

export interface OwnershipAuditEntry {
  action: "ownership.transferred";
  projectId: string;
  fromOwner: string;
  toOwner: string;
  authorizedBy: string;
  at: string;
}

/** Current owner per project — seeded from on-chain reads in production. */
const owners = new Map<string, string>();
const transfers: OwnershipTransferRecord[] = [];
const audit: OwnershipAuditEntry[] = [];

function newId(): string {
  return `own_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function norm(addr: string): string {
  return addr.trim().toUpperCase();
}

export function resetOwnershipTransferForTests(): void {
  owners.clear();
  transfers.length = 0;
  audit.length = 0;
}

/** Seed or sync the known owner (e.g. after fetchProjectById). */
export function setProjectOwner(projectId: string, owner: string): void {
  owners.set(projectId, norm(owner));
}

export function getProjectOwner(projectId: string): string | undefined {
  return owners.get(projectId);
}

/**
 * Transfer ownership. `actor` must be the current owner. `newOwner` must be a
 * non-empty distinct wallet address.
 */
export function transferOwnership(input: {
  projectId: string;
  actor: string;
  newOwner: string;
}): OwnershipTransferRecord {
  const current = owners.get(input.projectId);
  if (!current) {
    throw Object.assign(new Error("project_owner_unknown"), {
      code: "project_owner_unknown",
      status: 404,
      message: "Project owner is not registered; sync from chain first",
    });
  }

  const actor = norm(input.actor);
  if (actor !== current) {
    throw Object.assign(new Error("forbidden_not_owner"), {
      code: "forbidden_not_owner",
      status: 403,
      message: "Only the current owner may transfer ownership",
    });
  }

  const newOwner = norm(input.newOwner);
  if (!newOwner || newOwner.length < 4) {
    throw Object.assign(new Error("invalid_new_owner"), {
      code: "invalid_new_owner",
      status: 400,
      message: "newOwner must be a valid wallet address",
    });
  }
  if (newOwner === current) {
    throw Object.assign(new Error("new_owner_same_as_current"), {
      code: "new_owner_same_as_current",
      status: 400,
    });
  }

  const at = new Date().toISOString();
  const record: OwnershipTransferRecord = {
    id: newId(),
    projectId: input.projectId,
    fromOwner: current,
    toOwner: newOwner,
    authorizedBy: actor,
    transferredAt: at,
  };

  owners.set(input.projectId, newOwner);
  transfers.push(record);
  audit.push({
    action: "ownership.transferred",
    projectId: input.projectId,
    fromOwner: current,
    toOwner: newOwner,
    authorizedBy: actor,
    at,
  });

  return record;
}

/** Whether `wallet` is the current owner (for access checks before/after). */
export function isCurrentOwner(projectId: string, wallet: string): boolean {
  const current = owners.get(projectId);
  if (!current) return false;
  return current === norm(wallet);
}

export function listOwnershipTransfers(
  projectId?: string,
): readonly OwnershipTransferRecord[] {
  if (!projectId) return transfers;
  return transfers.filter((t) => t.projectId === projectId);
}

export function listOwnershipAudit(
  projectId?: string,
): readonly OwnershipAuditEntry[] {
  if (!projectId) return audit;
  return audit.filter((e) => e.projectId === projectId);
}
