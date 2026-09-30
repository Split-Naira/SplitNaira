/**
 * Split lifecycle derivation (#1305, #1306).
 *
 * Both completion state and participant payment status are *derived*, never
 * stored as client-settable fields. The contract and the transaction records
 * are the authoritative sources; anything writable by a client would be a
 * second source of truth that can disagree with the money.
 *
 * Everything here is pure, so the rules are testable without a chain or a
 * database.
 */

/** Payment states a single participant can be in. */
export const PARTICIPANT_STATUSES = [
  "paid",
  "pending",
  "failed",
  "unpaid",
] as const;

export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/** Lifecycle states a split can be in. */
export const SPLIT_STATES = [
  "draft",
  "active",
  "distributing",
  "settled",
  "cancelled",
  "expired",
] as const;

export type SplitState = (typeof SPLIT_STATES)[number];

export interface Collaborator {
  address: string;
  alias?: string;
  basisPoints: number;
}

/** The subset of on-chain project state the derivation depends on. */
export interface ProjectSnapshot {
  projectId: string;
  locked: boolean;
  balance: string | number | bigint;
  totalDistributed: string | number | bigint;
  distributionRound: number;
  collaborators: Collaborator[];
  /** When true, force lifecycle state to draft (off-chain draft flag, #1302). */
  isDraft?: boolean;
  /** ISO timestamp deadline; when past, force expired (#1303). */
  expiresAt?: string | null;
}

/** The subset of a transaction record the derivation depends on. */
export interface PaymentRecord {
  recipient: string;
  status: "pending" | "completed" | "failed";
  roundId: string;
  timestamp: number;
}

/** Off-chain cancellation marker, when one exists. */
export interface CancellationSnapshot {
  cancelledAt: Date;
  cancelledBy: string;
  reason: string | null;
}

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value?.trim?.() ?? "";
  if (!trimmed) return 0n;
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

/** Addresses compare case-insensitively; Stellar strkeys are upper-case. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * Derives a split's lifecycle state (#1305).
 *
 * Ordering matters and is deliberate:
 *
 *  - Cancellation wins over everything. A cancelled split is cancelled even
 *    if it still holds a balance, and the UI must not present it as active.
 *  - `settled` requires *both* that something was distributed and that no
 *    balance remains. A zero-balance split that never distributed is not
 *    settled, it is a split nobody funded — reporting those as settled would
 *    overstate how much has actually been paid out.
 *  - `distributing` is a locked split with a balance still to pay out; it is
 *    distinct from `active` because new funding is no longer accepted.
 */
export function deriveSplitState(
  project: ProjectSnapshot,
  cancellation?: CancellationSnapshot | null,
  now: Date = new Date(),
): SplitState {
  if (cancellation) return "cancelled";

  // Explicit off-chain draft marker wins over balance heuristics (#1302).
  if (project.isDraft) return "draft";

  // Optional completion deadline (#1303). Expired blocks further funding in the API.
  if (project.expiresAt) {
    const deadline = new Date(project.expiresAt).getTime();
    if (!Number.isNaN(deadline) && deadline <= now.getTime()) {
      return "expired";
    }
  }

  const balance = toBigInt(project.balance);
  const distributed = toBigInt(project.totalDistributed);

  if (project.locked) {
    return balance > 0n ? "distributing" : "settled";
  }

  if (distributed > 0n && balance === 0n) return "settled";
  if (distributed === 0n && balance === 0n) return "draft";
  return "active";
}

/** True when the split has reached a state no further funding should enter. */
export function isTerminal(state: SplitState): boolean {
  return state === "settled" || state === "cancelled" || state === "expired";
}

/**
 * Mutating actions a caller can ask for against a split (#1305).
 *
 * `read` is included because it is the one action every state permits; keeping
 * it in the same table is what lets the guard be a single decision rather than
 * a scattering of state comparisons at each call site.
 */
export const SPLIT_ACTIONS = [
  "read",
  "deposit",
  "update_metadata",
  "update_collaborators",
  "lock",
  "distribute",
  "cancel",
] as const;

export type SplitAction = (typeof SPLIT_ACTIONS)[number];

/**
 * Whether `action` is permitted in `state` (#1305).
 *
 * Terminal states accept no mutation at all:
 *
 *  - `cancelled` — the split was called off; nothing downstream should act on
 *    it, including another cancellation.
 *  - `settled` — every claim has been paid. Editing participants or metadata
 *    now would rewrite the record that the payments were made against.
 *
 * `distributing` is a locked split that still holds a balance, so it accepts
 * only `distribute`: the remaining payouts. New funding, new collaborators and
 * metadata edits are all closed at lock time.
 */
export function isActionAllowed(state: SplitState, action: SplitAction): boolean {
  if (action === "read") return true;
  if (state === "cancelled" || state === "settled" || state === "expired") return false;
  if (state === "distributing") return action === "distribute";
  return true; // draft / active
}

/**
 * Throws unless `action` is permitted in `state`.
 *
 * The message names both, because "this project is settled" and "you cannot
 * deposit into a locked project" are different problems for the caller.
 */
export function assertActionAllowed(state: SplitState, action: SplitAction): void {
  if (isActionAllowed(state, action)) return;

  throw Object.assign(
    new Error(`split_not_mutable: cannot ${action} a ${state} split`),
    { code: "split_not_mutable", status: 409, state, action },
  );
}

/**
 * Whether a split may still be cancelled (#1304).
 *
 * Cancelling something already settled would rewrite history, and cancelling
 * an already-cancelled split is a no-op the caller should be told about. This
 * delegates to the action table so cancellation can never drift from the rest
 * of the post-completion policy.
 */
export function isCancellable(state: SplitState): boolean {
  return isActionAllowed(state, "cancel");
}

/** Whether the API should reject deposit / distribute / lock (#1302, #1303). */
export function isFinancialActionAllowed(state: SplitState): boolean {
  return state === "active" || state === "distributing";
}

export interface ParticipantPaymentStatus {
  address: string;
  alias: string | null;
  basisPoints: number;
  status: ParticipantStatus;
  /** Round the status was derived from, when any payment exists. */
  roundId: string | null;
  /** Timestamp of the record the status came from. */
  lastUpdated: number | null;
}

/**
 * Derives per-participant payment status from authoritative records (#1306).
 *
 * A participant may have several records for the same round — a failed
 * attempt followed by a retry is normal. Precedence is
 * `completed > pending > failed`, because a later success supersedes an
 * earlier failure, and a payment still in flight is more informative than a
 * historical failure. Taking merely the newest record would flip a paid
 * participant back to "failed" if a stray failed row arrived afterwards.
 *
 * Participants with no records at all are `unpaid`, which is distinct from
 * `failed`: nothing was attempted.
 */
export function deriveParticipantStatuses(
  collaborators: Collaborator[],
  payments: PaymentRecord[],
): ParticipantPaymentStatus[] {
  const precedence: Record<ParticipantStatus, number> = {
    paid: 3,
    pending: 2,
    failed: 1,
    unpaid: 0,
  };

  const statusOf = (
    record: PaymentRecord,
  ): Exclude<ParticipantStatus, "unpaid"> => {
    if (record.status === "completed") return "paid";
    if (record.status === "pending") return "pending";
    return "failed";
  };

  return collaborators.map((collaborator) => {
    const theirs = payments.filter((payment) =>
      sameAddress(payment.recipient, collaborator.address),
    );

    let best: ParticipantPaymentStatus = {
      address: collaborator.address,
      alias: collaborator.alias ?? null,
      basisPoints: collaborator.basisPoints,
      status: "unpaid",
      roundId: null,
      lastUpdated: null,
    };

    for (const record of theirs) {
      const candidate = statusOf(record);
      const higher = precedence[candidate] > precedence[best.status];
      // Same status: keep the most recent record so lastUpdated is meaningful.
      const newer =
        precedence[candidate] === precedence[best.status] &&
        record.timestamp > (best.lastUpdated ?? -Infinity);

      if (higher || newer) {
        best = {
          ...best,
          status: candidate,
          roundId: record.roundId,
          lastUpdated: record.timestamp,
        };
      }
    }

    return best;
  });
}

export interface SplitCompletionSummary {
  state: SplitState;
  /** Participants who have been paid, over the total participant count. */
  paidCount: number;
  totalParticipants: number;
  /** True only when every participant is settled. */
  allParticipantsPaid: boolean;
  /** Basis points still owed to participants who are not yet paid. */
  outstandingBasisPoints: number;
}

/**
 * Summarises completion for API and UI consumption (#1305).
 *
 * `allParticipantsPaid` is deliberately separate from `state`: a split can be
 * `settled` on-chain (no balance remaining) while an individual payout record
 * is still pending, and collapsing the two would hide that from the person
 * waiting on their money.
 */
export function summariseCompletion(
  project: ProjectSnapshot,
  payments: PaymentRecord[],
  cancellation?: CancellationSnapshot | null,
): SplitCompletionSummary {
  const state = deriveSplitState(project, cancellation);
  const participants = deriveParticipantStatuses(project.collaborators, payments);
  const paid = participants.filter((p) => p.status === "paid");

  return {
    state,
    paidCount: paid.length,
    totalParticipants: participants.length,
    allParticipantsPaid:
      participants.length > 0 && paid.length === participants.length,
    outstandingBasisPoints: participants
      .filter((p) => p.status !== "paid")
      .reduce((sum, p) => sum + p.basisPoints, 0),
  };
}
