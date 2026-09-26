/**
 * Issue #1299 – Collaborator invitation lifecycle registry.
 *
 * Tracks pending invitations so owners can cancel them. Cancelled invitations
 * cannot be accepted. Cancellation events are recorded for audit.
 */

export type InvitationStatus = "pending" | "accepted" | "cancelled";

export interface InvitationRecord {
  id: string;
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
  status: InvitationStatus;
  createdAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  acceptedAt?: string;
}

export interface InvitationCancelEvent {
  type: "invitation.cancelled";
  invitationId: string;
  email: string;
  projectId?: string;
  cancelledBy: string;
  at: string;
}

/** In-memory store suitable for unit tests; swap for DB in production. */
const invitations = new Map<string, InvitationRecord>();
const tokenIndex = new Map<string, string>(); // tokenJti -> invitationId
const events: InvitationCancelEvent[] = [];

function newId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resetInvitationRegistryForTests(): void {
  invitations.clear();
  tokenIndex.clear();
  events.length = 0;
}

export function registerInvitation(input: {
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
}): InvitationRecord {
  const record: InvitationRecord = {
    id: newId(),
    email: input.email.toLowerCase(),
    tokenJti: input.tokenJti,
    projectId: input.projectId,
    inviterWalletAddress: input.inviterWalletAddress,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  invitations.set(record.id, record);
  tokenIndex.set(record.tokenJti, record.id);
  return record;
}

export function getInvitationById(id: string): InvitationRecord | undefined {
  return invitations.get(id);
}

export function getInvitationByTokenJti(jti: string): InvitationRecord | undefined {
  const id = tokenIndex.get(jti);
  return id ? invitations.get(id) : undefined;
}

/**
 * Cancel a pending invitation. Only the original inviter (or project owner
 * address passed as `actor`) may cancel.
 */
export function cancelInvitation(input: {
  invitationId: string;
  actorWalletAddress: string;
}): InvitationRecord {
  const record = invitations.get(input.invitationId);
  if (!record) {
    throw Object.assign(new Error("invitation_not_found"), { code: "invitation_not_found", status: 404 });
  }
  if (record.status === "cancelled") {
    return record; // idempotent
  }
  if (record.status === "accepted") {
    throw Object.assign(new Error("invitation_already_accepted"), {
      code: "invitation_already_accepted",
      status: 409,
    });
  }

  const actor = input.actorWalletAddress.trim();
  const inviter = (record.inviterWalletAddress ?? "").trim();
  if (inviter && actor !== inviter) {
    throw Object.assign(new Error("forbidden_not_inviter"), {
      code: "forbidden_not_inviter",
      status: 403,
    });
  }
  if (!inviter && !actor) {
    throw Object.assign(new Error("forbidden_not_inviter"), {
      code: "forbidden_not_inviter",
      status: 403,
    });
  }

  record.status = "cancelled";
  record.cancelledAt = new Date().toISOString();
  record.cancelledBy = actor;

  const event: InvitationCancelEvent = {
    type: "invitation.cancelled",
    invitationId: record.id,
    email: record.email,
    projectId: record.projectId,
    cancelledBy: actor,
    at: record.cancelledAt,
  };
  events.push(event);

  return record;
}

/**
 * Attempt to accept an invitation identified by token jti.
 * Rejects cancelled invitations.
 */
export function acceptInvitationByTokenJti(jti: string): InvitationRecord {
  const record = getInvitationByTokenJti(jti);
  if (!record) {
    // Token may pre-date registry; treat as accept-ok without record.
    throw Object.assign(new Error("invitation_not_tracked"), {
      code: "invitation_not_tracked",
      status: 404,
    });
  }
  if (record.status === "cancelled") {
    throw Object.assign(new Error("invitation_cancelled"), {
      code: "invitation_cancelled",
      status: 410,
    });
  }
  if (record.status === "accepted") {
    return record;
  }
  record.status = "accepted";
  record.acceptedAt = new Date().toISOString();
  return record;
}

export function listCancellationEvents(): readonly InvitationCancelEvent[] {
  return events;
}

export function listPendingInvitations(filter?: {
  projectId?: string;
  inviterWalletAddress?: string;
}): InvitationRecord[] {
  return Array.from(invitations.values()).filter((r) => {
    if (r.status !== "pending") return false;
    if (filter?.projectId && r.projectId !== filter.projectId) return false;
    if (
      filter?.inviterWalletAddress &&
      r.inviterWalletAddress !== filter.inviterWalletAddress
    ) {
      return false;
    }
    return true;
  });
}
