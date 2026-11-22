import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager, Repository } from "typeorm";
import { AuditLog } from "../entities/AuditLog.js";
import { TransactionAttempt, type TransactionAttemptStatus } from "../entities/TransactionAttempt.js";
import { getRequestId } from "./request-context.js";

export const SUBMISSION_EXPIRY_MS = 360_000;

/** `audit_log.action` for every recorded payout attempt state change (#1643). */
export const PAYOUT_TRANSITION_AUDIT_ACTION = "payout_attempt_transition";

/** Actor recorded when no authenticated principal drove the transition. */
export const PAYOUT_SYSTEM_ACTOR = "system:payout-recovery";

/** `audit_log.ip_hash` used when the transition did not come from a request. */
export const PAYOUT_SYSTEM_IP_HASH = "system";

/** Matches `audit_log.request_id` (varchar 64). */
const MAX_CORRELATION_ID_LENGTH = 64;

/**
 * Allowed payout attempt status transitions (#1643).
 *
 * `completed` is terminal: once the network confirmed a payout, nothing may
 * move it back. `failed` can only be promoted to `completed`, for a
 * transaction that was given up on (e.g. expired) but did land. Self-loops are
 * listed so a no-change reconciliation is always valid.
 */
export const PAYOUT_ATTEMPT_TRANSITIONS: Readonly<
  Record<TransactionAttemptStatus, readonly TransactionAttemptStatus[]>
> = Object.freeze({
  pending: ["pending", "completed", "failed"],
  failed: ["failed", "completed"],
  completed: ["completed"],
});

export function canTransitionPayoutAttempt(
  from: TransactionAttemptStatus,
  to: TransactionAttemptStatus,
): boolean {
  return PAYOUT_ATTEMPT_TRANSITIONS[from].includes(to);
}

export interface PayoutAttemptInput {
  txHash: string;
  projectId: string;
  sourceAccount: string;
  networkPassphrase: string;
}

export interface RecoveryObservation {
  status: "NOT_FOUND" | "SUCCESS" | "FAILED";
  ledger?: number;
}

export interface RecoveryDecision {
  status: TransactionAttemptStatus;
  failureCode: string | null;
  failureLedger: number | null;
}

/**
 * Correlation metadata stored with each transition audit row. Every field is
 * optional: the correlation id falls back to the active request context, and
 * then to a fresh UUID, so a row is never written without one.
 */
export interface PayoutAuditContext {
  correlationId?: string;
  actor?: string | null;
  ipHash?: string;
}

/** Shape of `audit_log.payload` for {@link PAYOUT_TRANSITION_AUDIT_ACTION}. */
export interface PayoutTransitionAuditPayload {
  attemptId: string;
  txHash: string;
  projectId: string;
  /** `null` only for the registration row that creates the attempt. */
  previousStatus: TransactionAttemptStatus | null;
  nextStatus: TransactionAttemptStatus;
  previousFailureCode: string | null;
  failureCode: string | null;
  failureLedger: number | null;
  /** RPC observation that caused the change; `null` for registration. */
  observation: { status: RecoveryObservation["status"]; ledger: number | null } | null;
  /** Server-side epoch milliseconds of the transition. */
  occurredAt: number;
}

export class PayoutAttemptConflictError extends Error {
  constructor() {
    super("Transaction hash is already registered with different payout metadata.");
    this.name = "PayoutAttemptConflictError";
  }
}

export class PayoutTransitionError extends Error {
  constructor(
    readonly from: TransactionAttemptStatus,
    readonly to: TransactionAttemptStatus,
  ) {
    super(`Payout attempt cannot move from ${from} to ${to}.`);
    this.name = "PayoutTransitionError";
  }
}

export function decideRecoveryStatus(
  attempt: Pick<TransactionAttempt, "status" | "submittedAt">,
  observation: RecoveryObservation,
  now: number,
): RecoveryDecision {
  if (observation.status === "SUCCESS") {
    return { status: "completed", failureCode: null, failureLedger: null };
  }
  if (attempt.status === "completed" || attempt.status === "failed") {
    return {
      status: attempt.status,
      failureCode: attempt.status === "failed" ? "transaction_failed" : null,
      failureLedger: attempt.status === "failed" ? observation.ledger ?? null : null,
    };
  }
  if (observation.status === "FAILED") {
    return {
      status: "failed",
      failureCode: "transaction_failed",
      failureLedger: observation.ledger ?? null,
    };
  }
  if (now - attempt.submittedAt >= SUBMISSION_EXPIRY_MS) {
    return {
      status: "failed",
      failureCode: "transaction_expired",
      failureLedger: null,
    };
  }
  return { status: "pending", failureCode: null, failureLedger: null };
}

function resolveCorrelationId(context: PayoutAuditContext | undefined): string {
  const candidate = context?.correlationId?.trim() || getRequestId() || randomUUID();
  return candidate.slice(0, MAX_CORRELATION_ID_LENGTH);
}

/**
 * Writes one transition row inside the caller's transaction, so a status
 * change and its audit entry are committed (or rolled back) together.
 */
async function recordPayoutTransition(
  manager: EntityManager,
  payload: PayoutTransitionAuditPayload,
  context: PayoutAuditContext | undefined,
): Promise<void> {
  const entry: Partial<AuditLog> = {
    action: PAYOUT_TRANSITION_AUDIT_ACTION,
    ipHash: context?.ipHash ?? PAYOUT_SYSTEM_IP_HASH,
    requestId: resolveCorrelationId(context),
    actor: context?.actor ?? PAYOUT_SYSTEM_ACTOR,
    outcome: "success",
    payload: { ...payload },
  };
  // TypeORM's deep-partial insert type cannot express a free-form jsonb
  // column, so the fully typed entry is narrowed to the insert parameter.
  await manager
    .getRepository(AuditLog)
    .insert(entry as Parameters<Repository<AuditLog>["insert"]>[0]);
}

function assertSameAttempt(
  existing: TransactionAttempt,
  input: PayoutAttemptInput,
): void {
  if (
    existing.projectId !== input.projectId ||
    existing.sourceAccount !== input.sourceAccount ||
    existing.networkPassphrase !== input.networkPassphrase
  ) {
    throw new PayoutAttemptConflictError();
  }
}

/**
 * Registers a submitted payout as `pending`. A new attempt and its
 * registration audit row (`null -> pending`) are written in one transaction.
 * Re-registering the same hash is idempotent and writes no audit row.
 */
export async function registerPayoutAttempt(
  dataSource: DataSource,
  input: PayoutAttemptInput,
  now = Date.now(),
  context?: PayoutAuditContext,
): Promise<TransactionAttempt> {
  const repository = dataSource.getRepository(TransactionAttempt);
  const existing = await repository.findOneBy({ txHash: input.txHash });
  if (existing) {
    assertSameAttempt(existing, input);
    return existing;
  }

  try {
    return await dataSource.transaction(async (manager) => {
      const attempts = manager.getRepository(TransactionAttempt);
      await attempts.insert({
        ...input,
        submittedAt: now,
        status: "pending",
        failureCode: null,
        failureLedger: null,
        lastCheckedAt: null,
      });

      const created = await attempts.findOneBy({ txHash: input.txHash });
      if (!created) {
        throw new Error("Payout attempt was inserted but could not be read back.");
      }

      await recordPayoutTransition(
        manager,
        {
          attemptId: created.id,
          txHash: created.txHash,
          projectId: created.projectId,
          previousStatus: null,
          nextStatus: "pending",
          previousFailureCode: null,
          failureCode: null,
          failureLedger: null,
          observation: null,
          occurredAt: now,
        },
        context,
      );
      return created;
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "23505") throw error;
    // A concurrent request registered the same hash first; its transaction
    // already wrote the registration audit row.
    const raced = await repository.findOneBy({ txHash: input.txHash });
    if (!raced) throw error;
    assertSameAttempt(raced, input);
    return raced;
  }
}

/**
 * Reconciles an attempt against a fresh RPC observation.
 *
 * A status change is applied with an optimistic guard on the status the
 * caller read (`WHERE status = attempt.status`), so the audit row's
 * `previousStatus` is exactly the state that was overwritten. If another
 * writer moved the row first, nothing is written and no audit row is
 * recorded; the returned record shows the current state. The update and its
 * audit row share one transaction, so the trail can never miss a transition.
 *
 * @throws PayoutTransitionError when the decision would leave a terminal
 *   state (defence in depth: `decideRecoveryStatus` never proposes one).
 */
export async function updatePayoutAttemptFromObservation(
  dataSource: DataSource,
  attempt: TransactionAttempt,
  observation: RecoveryObservation,
  now = Date.now(),
  context?: PayoutAuditContext,
): Promise<TransactionAttempt> {
  const decision = decideRecoveryStatus(attempt, observation, now);
  if (!canTransitionPayoutAttempt(attempt.status, decision.status)) {
    throw new PayoutTransitionError(attempt.status, decision.status);
  }

  const update = {
    status: decision.status,
    failureCode: decision.failureCode,
    failureLedger: decision.failureLedger,
    lastCheckedAt: now,
  };

  await dataSource.transaction(async (manager) => {
    const attempts = manager.getRepository(TransactionAttempt);

    if (decision.status !== attempt.status) {
      const result = await attempts.update(
        { id: attempt.id, status: attempt.status },
        update,
      );
      if (result.affected === 0) return;

      await recordPayoutTransition(
        manager,
        {
          attemptId: attempt.id,
          txHash: attempt.txHash,
          projectId: attempt.projectId,
          previousStatus: attempt.status,
          nextStatus: decision.status,
          previousFailureCode: attempt.failureCode,
          failureCode: decision.failureCode,
          failureLedger: decision.failureLedger,
          observation: { status: observation.status, ledger: observation.ledger ?? null },
          occurredAt: now,
        },
        context,
      );
    } else if (attempt.status === "pending") {
      // Still pending: only the last-checked timestamp moves. Not a
      // transition, so no audit row.
      await attempts.update({ id: attempt.id, status: "pending" }, update);
    }
  });

  const refreshed = await dataSource.getRepository(TransactionAttempt).findOneBy({ id: attempt.id });
  if (!refreshed) {
    throw new Error("Payout attempt disappeared during status reconciliation.");
  }
  return refreshed;
}

export interface PayoutAuditTrailReport {
  complete: boolean;
  problems: string[];
}

/**
 * Checks that an attempt's transition rows (oldest first) form an unbroken
 * chain from registration to `currentStatus`:
 *
 * - exactly one registration row (`null -> pending`), and it comes first;
 * - each row starts where the previous one ended;
 * - every row is an allowed, real change (no self-loops, nothing leaves
 *   `completed`);
 * - every row carries a correlation id;
 * - the last row ends at the attempt's current status.
 */
export function verifyPayoutAuditTrail(
  trail: ReadonlyArray<Pick<AuditLog, "requestId"> & { payload: unknown }>,
  currentStatus: TransactionAttemptStatus,
): PayoutAuditTrailReport {
  const problems: string[] = [];
  let state: TransactionAttemptStatus | null = null;

  trail.forEach((row, index) => {
    const payload = row.payload as Partial<PayoutTransitionAuditPayload> | null;
    const previous = payload?.previousStatus ?? null;
    const next = payload?.nextStatus;

    if (!row.requestId) {
      problems.push(`row ${index}: missing correlation id`);
    }
    if (!next) {
      problems.push(`row ${index}: missing nextStatus`);
      return;
    }
    if (previous !== state) {
      problems.push(`row ${index}: starts at ${previous ?? "null"} but trail was at ${state ?? "null"}`);
    }
    if (previous === null) {
      if (index !== 0 || next !== "pending") {
        problems.push(`row ${index}: registration must be the first row and end at pending`);
      }
    } else if (previous === next || !canTransitionPayoutAttempt(previous, next)) {
      problems.push(`row ${index}: ${previous} -> ${next} is not an allowed transition`);
    }
    state = next;
  });

  if (trail.length === 0) {
    problems.push("trail is empty: registration row missing");
  } else if (state !== currentStatus) {
    problems.push(`trail ends at ${state ?? "null"} but attempt is ${currentStatus}`);
  }

  return { complete: problems.length === 0, problems };
}
