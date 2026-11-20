import { In, type DataSource } from "typeorm";
import { TransactionAttempt, type TransactionAttemptStatus } from "../entities/TransactionAttempt.js";

export const SUBMISSION_EXPIRY_MS = 360_000;

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

export class PayoutAttemptConflictError extends Error {
  constructor() {
    super("Transaction hash is already registered with different payout metadata.");
    this.name = "PayoutAttemptConflictError";
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

export async function registerPayoutAttempt(
  dataSource: DataSource,
  input: PayoutAttemptInput,
  now = Date.now(),
): Promise<TransactionAttempt> {
  const repository = dataSource.getRepository(TransactionAttempt);
  const existing = await repository.findOneBy({ txHash: input.txHash });
  if (existing) {
    assertSameAttempt(existing, input);
    return existing;
  }

  try {
    await repository.insert({
      ...input,
      submittedAt: now,
      status: "pending",
      failureCode: null,
      failureLedger: null,
      lastCheckedAt: null,
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "23505") throw error;
    const raced = await repository.findOneBy({ txHash: input.txHash });
    if (!raced) throw error;
    assertSameAttempt(raced, input);
    return raced;
  }

  const created = await repository.findOneBy({ txHash: input.txHash });
  if (!created) {
    throw new Error("Payout attempt was inserted but could not be read back.");
  }
  return created;
}

export async function updatePayoutAttemptFromObservation(
  dataSource: DataSource,
  attempt: TransactionAttempt,
  observation: RecoveryObservation,
  now = Date.now(),
): Promise<TransactionAttempt> {
  const repository = dataSource.getRepository(TransactionAttempt);
  const decision = decideRecoveryStatus(attempt, observation, now);
  const update = {
    status: decision.status,
    failureCode: decision.failureCode,
    failureLedger: decision.failureLedger,
    lastCheckedAt: now,
  };

  if (decision.status === "completed") {
    await repository.update(
      { id: attempt.id, status: In(["pending", "failed"]) },
      update,
    );
  } else if (attempt.status === "pending") {
    await repository.update({ id: attempt.id, status: "pending" }, update);
  }

  const refreshed = await repository.findOneBy({ id: attempt.id });
  if (!refreshed) {
    throw new Error("Payout attempt disappeared during status reconciliation.");
  }
  return refreshed;
}
