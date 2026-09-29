/**
 * Collaborator invitation lifecycle registry (#1299, #1298).
 *
 * Tracks pending invitations so owners can cancel them and so expired
 * invitations cannot be accepted. Cancellation and expiry events are recorded
 * for audit. In-memory store is suitable for unit tests; swap for DB in prod.
 */

export type InvitationStatus = "pending" | "accepted" | "cancelled" | "expired";

/** Default invitation time-to-live: 7 days. */
export const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitationRecord {
  id: string;
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
  status: InvitationStatus;
  createdAt: string;
  /** ISO timestamp after which the invitation may not be accepted. */
  expiresAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  acceptedAt?: string;
  expiredAt?: string;
}

/** How the cancelling actor was authorized. */
export type InvitationCancelAuthority = "inviter" | "project_owner";

export interface InvitationCancelEvent {
  type: "invitation.cancelled";
  invitationId: string;
  email: string;
  projectId?: string;
  cancelledBy: string;
  /** Which authorization path allowed the cancellation. */
  authority: InvitationCancelAuthority;
  at: string;
}

export interface InvitationExpiredEvent {
  type: "invitation.expired";
  invitationId: string;
  email: string;
  projectId?: string;
  at: string;
}

/** In-memory store suitable for unit tests; swap for DB in production. */
const invitations = new Map<string, InvitationRecord>();
const tokenIndex = new Map<string, string>(); // tokenJti -> invitationId
const cancelEvents: InvitationCancelEvent[] = [];
const expiredEvents: InvitationExpiredEvent[] = [];

function newId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resetInvitationRegistryForTests(): void {
  invitations.clear();
  tokenIndex.clear();
  cancelEvents.length = 0;
  expiredEvents.length = 0;
}

function markExpiredIfNeeded(
  record: InvitationRecord,
  now: Date = new Date(),
): InvitationRecord {
  if (record.status !== "pending") return record;
  if (new Date(record.expiresAt).getTime() > now.getTime()) return record;

  record.status = "expired";
  record.expiredAt = now.toISOString();
  expiredEvents.push({
    type: "invitation.expired",
    invitationId: record.id,
    email: record.email,
    projectId: record.projectId,
    at: record.expiredAt,
  });
  return record;
}

export function isInvitationExpired(
  record: InvitationRecord,
  now: Date = new Date(),
): boolean {
  if (record.status === "expired") return true;
  if (record.status !== "pending") return false;
  return new Date(record.expiresAt).getTime() <= now.getTime();
}

export function registerInvitation(input: {
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
  /** Override TTL; defaults to DEFAULT_INVITATION_TTL_MS from createdAt. */
  ttlMs?: number;
  /** Absolute expiry; takes precedence over ttlMs when provided. */
  expiresAt?: Date | string;
  now?: Date;
}): InvitationRecord {
  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? DEFAULT_INVITATION_TTL_MS;
  const expiresAt =
    input.expiresAt != null
      ? new Date(input.expiresAt)
      : new Date(now.getTime() + ttl);

  if (expiresAt.getTime() <= now.getTime()) {
    throw Object.assign(new Error("invitation_expires_in_past"), {
      code: "invitation_expires_in_past",
      status: 400,
    });
  }

  const record: InvitationRecord = {
    id: newId(),
    email: input.email.toLowerCase(),
    tokenJti: input.tokenJti,
    projectId: input.projectId,
    inviterWalletAddress: input.inviterWalletAddress,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  invitations.set(record.id, record);
  tokenIndex.set(record.tokenJti, record.id);
  return record;
}

/**
 * Safe re-invitation (#1298): if a prior invite for the same email+project is
 * pending, cancel it; if expired/cancelled, leave it and issue a new token.
 */
export function reinvite(input: {
  email: string;
  tokenJti: string;
  projectId?: string;
  inviterWalletAddress?: string;
  ttlMs?: number;
  expiresAt?: Date | string;
  now?: Date;
}): InvitationRecord {
  const now = input.now ?? new Date();
  const email = input.email.toLowerCase();

  for (const existing of invitations.values()) {
    if (existing.email !== email) continue;
    if (input.projectId && existing.projectId !== input.projectId) continue;
    markExpiredIfNeeded(existing, now);
    if (existing.status === "pending" && input.inviterWalletAddress) {
      cancelInvitation({
        invitationId: existing.id,
        actorWalletAddress: input.inviterWalletAddress,
      });
    }
  }

  return registerInvitation({ ...input, now });
}

export function getInvitationById(id: string): InvitationRecord | undefined {
  const record = invitations.get(id);
  if (!record) return undefined;
  return markExpiredIfNeeded(record);
}

export function getInvitationByTokenJti(jti: string): InvitationRecord | undefined {
  const id = tokenIndex.get(jti);
  if (!id) return undefined;
  const record = invitations.get(id);
  if (!record) return undefined;
  return markExpiredIfNeeded(record);
}

/**
 * Cancel a pending invitation.
 *
 * Two actors may cancel: the original inviter, or the project owner (when the
 * owner's address is supplied from authoritative project state).
 *
 * This fails closed. An invitation with no recorded inviter has no inviter to
 * match, so it can *only* be cancelled by an explicitly identified project
 * owner — an unrecognised actor is refused. (Previously any actor at all could
 * cancel such an invitation, which let anyone disable an invitation they had
 * never sent, since a cancelled invitation can no longer be accepted.)
 */
export function cancelInvitation(input: {
  invitationId: string;
  actorWalletAddress: string;
  /**
   * The project owner's address, when it is known from the project record.
   *
   * This is an *authorization claim*: callers must read it from stored project
   * state, never from the request being authorized.
   */
  projectOwnerAddress?: string;
}): InvitationRecord {
  const record = invitations.get(input.invitationId);
  if (!record) {
    throw Object.assign(new Error("invitation_not_found"), {
      code: "invitation_not_found",
      status: 404,
    });
  }
  markExpiredIfNeeded(record);
  if (record.status === "cancelled") {
    return record; // idempotent
  }
  if (record.status === "accepted") {
    throw Object.assign(new Error("invitation_already_accepted"), {
      code: "invitation_already_accepted",
      status: 409,
    });
  }
  if (record.status === "expired") {
    throw Object.assign(new Error("invitation_expired"), {
      code: "invitation_expired",
      status: 410,
    });
  }

  const actor = typeof input.actorWalletAddress === "string" ? input.actorWalletAddress.trim() : "";
  if (!actor) {
    throw Object.assign(new Error("actor_required"), {
      code: "actor_required",
      status: 400,
    });
  }

  const inviter = (record.inviterWalletAddress ?? "").trim();
  const projectOwner = (input.projectOwnerAddress ?? "").trim();

  const isInviter = inviter !== "" && actor === inviter;
  const isProjectOwner = projectOwner !== "" && actor === projectOwner;

  if (!isInviter && !isProjectOwner) {
    // Distinguish "not the inviter" from "there is no inviter to be", so the
    // caller can tell a rejected actor from an invitation that needs an owner.
    const inviterUnknown = inviter === "";
    throw Object.assign(
      new Error(inviterUnknown ? "inviter_unknown" : "forbidden_not_inviter"),
      {
        code: inviterUnknown ? "inviter_unknown" : "forbidden_not_inviter",
        status: 403,
      },
    );
  }

  const authority: InvitationCancelAuthority = isProjectOwner
    ? "project_owner"
    : "inviter";

  record.status = "cancelled";
  record.cancelledAt = new Date().toISOString();
  record.cancelledBy = actor;

  cancelEvents.push({
    type: "invitation.cancelled",
    invitationId: record.id,
    email: record.email,
    projectId: record.projectId,
    cancelledBy: actor,
    authority,
    at: record.cancelledAt,
  });

  return record;
}

/**
 * Attempt to accept an invitation identified by token jti.
 * Rejects cancelled and expired invitations (#1298).
 */
export function acceptInvitationByTokenJti(
  jti: string,
  now: Date = new Date(),
): InvitationRecord {
  const record = getInvitationByTokenJti(jti);
  if (!record) {
    throw Object.assign(new Error("invitation_not_tracked"), {
      code: "invitation_not_tracked",
      status: 404,
    });
  }
  markExpiredIfNeeded(record, now);
  if (record.status === "cancelled") {
    throw Object.assign(new Error("invitation_cancelled"), {
      code: "invitation_cancelled",
      status: 410,
    });
  }
  if (record.status === "expired") {
    throw Object.assign(new Error("invitation_expired"), {
      code: "invitation_expired",
      status: 410,
    });
  }
  if (record.status === "accepted") {
    return record;
  }
  record.status = "accepted";
  record.acceptedAt = now.toISOString();
  return record;
}

export function listCancellationEvents(): readonly InvitationCancelEvent[] {
  return cancelEvents;
}

export function listExpiredEvents(): readonly InvitationExpiredEvent[] {
  return expiredEvents;
}

export function listPendingInvitations(filter?: {
  projectId?: string;
  inviterWalletAddress?: string;
  now?: Date;
}): InvitationRecord[] {
  const now = filter?.now ?? new Date();
  return Array.from(invitations.values()).filter((r) => {
    markExpiredIfNeeded(r, now);
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
