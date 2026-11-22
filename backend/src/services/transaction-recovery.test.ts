import { describe, expect, it, vi } from "vitest";
import type { DataSource, Repository } from "typeorm";
import { AuditLog } from "../entities/AuditLog.js";
import { TransactionAttempt } from "../entities/TransactionAttempt.js";
import { requestContext } from "./request-context.js";
import {
  PAYOUT_ATTEMPT_TRANSITIONS,
  PAYOUT_SYSTEM_ACTOR,
  PAYOUT_SYSTEM_IP_HASH,
  PAYOUT_TRANSITION_AUDIT_ACTION,
  PayoutAttemptConflictError,
  PayoutTransitionError,
  SUBMISSION_EXPIRY_MS,
  canTransitionPayoutAttempt,
  decideRecoveryStatus,
  registerPayoutAttempt,
  updatePayoutAttemptFromObservation,
  verifyPayoutAuditTrail,
  type PayoutTransitionAuditPayload,
} from "./transaction-recovery.js";

const now = 1_800_000_000_000;

function attempt(status: "pending" | "completed" | "failed" = "pending") {
  return {
    id: "attempt-id",
    txHash: "a".repeat(64),
    projectId: "project_1",
    sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    networkPassphrase: "Test SDF Network ; September 2015",
    submittedAt: now,
    status,
    failureCode: null,
    failureLedger: null,
    lastCheckedAt: null,
  } as TransactionAttempt;
}

const metadata = {
  txHash: "a".repeat(64),
  projectId: "project_1",
  sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  networkPassphrase: "Test SDF Network ; September 2015",
};

/**
 * In-memory stand-in for the two tables involved, with the semantics the
 * service relies on: conditional `update` reports `affected`, and
 * `transaction` rolls back every write when its callback throws.
 */
function createStore(options: { failAuditInsert?: boolean } = {}) {
  let attempts: TransactionAttempt[] = [];
  let audit: Partial<AuditLog>[] = [];
  let nextId = 1;

  const matches = (row: TransactionAttempt, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof TransactionAttempt] === value);

  const attemptRepo = {
    findOneBy: vi.fn(async (where: Record<string, unknown>) => {
      const row = attempts.find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    insert: vi.fn(async (values: Partial<TransactionAttempt>) => {
      if (attempts.some((row) => row.txHash === values.txHash)) {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      attempts.push({ id: `attempt-${nextId++}`, ...values } as TransactionAttempt);
    }),
    update: vi.fn(async (where: Record<string, unknown>, patch: Partial<TransactionAttempt>) => {
      let affected = 0;
      attempts = attempts.map((row) => {
        if (!matches(row, where)) return row;
        affected += 1;
        return { ...row, ...patch };
      });
      return { affected };
    }),
  };

  const auditRepo = {
    insert: vi.fn(async (values: Partial<AuditLog>) => {
      if (options.failAuditInsert) throw new Error("audit_log unavailable");
      audit.push({ ...values });
    }),
  };

  const getRepository = (entity: unknown) => {
    if (entity === TransactionAttempt) return attemptRepo;
    if (entity === AuditLog) return auditRepo;
    throw new Error("unexpected repository");
  };

  const dataSource = {
    getRepository: vi.fn(getRepository),
    transaction: vi.fn(async (work: (manager: unknown) => Promise<unknown>) => {
      const attemptsBefore = attempts.map((row) => ({ ...row }));
      const auditBefore = [...audit];
      try {
        return await work({ getRepository });
      } catch (error) {
        attempts = attemptsBefore;
        audit = auditBefore;
        throw error;
      }
    }),
  } as unknown as DataSource;

  return {
    dataSource,
    attemptRepo,
    auditRepo,
    get attempts() {
      return attempts;
    },
    get audit() {
      return audit;
    },
    payloads(): PayoutTransitionAuditPayload[] {
      return audit.map((row) => row.payload as unknown as PayoutTransitionAuditPayload);
    },
    /** Moves a row behind the service's back, as a concurrent writer would. */
    forceStatus(id: string, status: TransactionAttempt["status"]) {
      attempts = attempts.map((row) => (row.id === id ? { ...row, status } : row));
    },
  };
}

describe("decideRecoveryStatus", () => {
  it("marks an on-ledger failure deterministically and records its ledger", () => {
    expect(
      decideRecoveryStatus(attempt(), { status: "FAILED", ledger: 42 }, now),
    ).toEqual({
      status: "failed",
      failureCode: "transaction_failed",
      failureLedger: 42,
    });
  });

  it("keeps a not-found transaction pending until its validity window and margin pass", () => {
    expect(
      decideRecoveryStatus(attempt(), { status: "NOT_FOUND" }, now + SUBMISSION_EXPIRY_MS - 1),
    ).toMatchObject({ status: "pending" });
    expect(
      decideRecoveryStatus(attempt(), { status: "NOT_FOUND" }, now + SUBMISSION_EXPIRY_MS),
    ).toMatchObject({ status: "failed", failureCode: "transaction_expired" });
  });

  it("never downgrades a confirmed payout, including on a stale failed observation", () => {
    expect(
      decideRecoveryStatus(attempt("completed"), { status: "FAILED", ledger: 40 }, now),
    ).toMatchObject({ status: "completed", failureCode: null });
  });

  it("promotes a previously failed attempt if the network confirms it", () => {
    expect(
      decideRecoveryStatus(attempt("failed"), { status: "SUCCESS", ledger: 42 }, now),
    ).toMatchObject({ status: "completed", failureCode: null });
  });

  it("only ever proposes transitions the state machine allows", () => {
    const observations = [
      { status: "SUCCESS", ledger: 7 },
      { status: "FAILED", ledger: 7 },
      { status: "NOT_FOUND" },
    ] as const;
    for (const from of ["pending", "failed", "completed"] as const) {
      for (const observation of observations) {
        for (const at of [now, now + SUBMISSION_EXPIRY_MS]) {
          const { status } = decideRecoveryStatus(attempt(from), observation, at);
          expect(canTransitionPayoutAttempt(from, status)).toBe(true);
        }
      }
    }
  });
});

describe("payout attempt state machine", () => {
  it("treats completed as terminal and failed as promotable only", () => {
    expect(PAYOUT_ATTEMPT_TRANSITIONS.completed).toEqual(["completed"]);
    expect(canTransitionPayoutAttempt("completed", "failed")).toBe(false);
    expect(canTransitionPayoutAttempt("completed", "pending")).toBe(false);
    expect(canTransitionPayoutAttempt("failed", "pending")).toBe(false);
    expect(canTransitionPayoutAttempt("failed", "completed")).toBe(true);
    expect(canTransitionPayoutAttempt("pending", "failed")).toBe(true);
    expect(canTransitionPayoutAttempt("pending", "completed")).toBe(true);
  });
});

describe("registerPayoutAttempt", () => {
  function dataSource(repository: Partial<Repository<TransactionAttempt>>) {
    return {
      getRepository: vi.fn().mockReturnValue(repository),
      transaction: vi.fn(),
    } as unknown as DataSource;
  }

  it("is idempotent for a previously registered hash and writes no audit row", async () => {
    const saved = attempt();
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(saved),
      insert: vi.fn(),
    };
    const ds = dataSource(repo);

    await expect(registerPayoutAttempt(ds, metadata, now)).resolves.toBe(saved);
    expect(repo.insert).not.toHaveBeenCalled();
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it("persists new attempts as pending with a server-side timestamp", async () => {
    const store = createStore();

    const created = await registerPayoutAttempt(store.dataSource, metadata, now);

    expect(created).toMatchObject({ ...metadata, status: "pending", submittedAt: now });
    expect(store.attemptRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        ...metadata,
        submittedAt: now,
        status: "pending",
        failureCode: null,
      }),
    );
  });

  it("records the registration as a null -> pending transition with correlation metadata", async () => {
    const store = createStore();

    const created = await registerPayoutAttempt(store.dataSource, metadata, now, {
      correlationId: "req-register-1",
      ipHash: "0123456789abcdef",
      actor: "GACTOR",
    });

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({
      action: PAYOUT_TRANSITION_AUDIT_ACTION,
      requestId: "req-register-1",
      ipHash: "0123456789abcdef",
      actor: "GACTOR",
      outcome: "success",
    });
    expect(store.payloads()[0]).toEqual({
      attemptId: created.id,
      txHash: metadata.txHash,
      projectId: metadata.projectId,
      previousStatus: null,
      nextStatus: "pending",
      previousFailureCode: null,
      failureCode: null,
      failureLedger: null,
      observation: null,
      occurredAt: now,
    });
  });

  it("rolls the attempt back when its audit row cannot be written", async () => {
    const store = createStore({ failAuditInsert: true });

    await expect(registerPayoutAttempt(store.dataSource, metadata, now)).rejects.toThrow(
      "audit_log unavailable",
    );
    expect(store.attempts).toHaveLength(0);
  });

  it("returns the winner of a concurrent registration without a second audit row", async () => {
    const store = createStore();
    const winner = await registerPayoutAttempt(store.dataSource, metadata, now);
    // The loser read "no row" before the winner committed.
    store.attemptRepo.findOneBy.mockResolvedValueOnce(null);

    await expect(registerPayoutAttempt(store.dataSource, metadata, now + 5)).resolves.toEqual(
      winner,
    );
    expect(store.attempts).toHaveLength(1);
    expect(store.audit).toHaveLength(1);
  });

  it("rejects reuse of a hash with different metadata", async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(attempt()) };

    await expect(
      registerPayoutAttempt(dataSource(repo), { ...metadata, projectId: "other_project" }, now),
    ).rejects.toBeInstanceOf(PayoutAttemptConflictError);
  });
});

describe("updatePayoutAttemptFromObservation", () => {
  async function registered(store: ReturnType<typeof createStore>) {
    return registerPayoutAttempt(store.dataSource, metadata, now, { correlationId: "req-0" });
  }

  it("writes the failure status only from pending and preserves confirmed state", async () => {
    const store = createStore();
    const saved = await registered(store);

    const result = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "FAILED", ledger: 42 },
      now + 10,
    );

    expect(store.attemptRepo.update).toHaveBeenCalledWith(
      { id: saved.id, status: "pending" },
      expect.objectContaining({ status: "failed", failureLedger: 42, lastCheckedAt: now + 10 }),
    );
    expect(result).toMatchObject({ status: "failed", failureCode: "transaction_failed" });
  });

  it("records prior and next state, observation and correlation id for each transition", async () => {
    const store = createStore();
    const saved = await registered(store);

    const failed = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "NOT_FOUND" },
      now + SUBMISSION_EXPIRY_MS,
      { correlationId: "req-expire", ipHash: "aaaaaaaaaaaaaaaa" },
    );
    await updatePayoutAttemptFromObservation(
      store.dataSource,
      failed,
      { status: "SUCCESS", ledger: 99 },
      now + SUBMISSION_EXPIRY_MS + 1,
      { correlationId: "req-confirm" },
    );

    expect(store.audit.map((row) => row.requestId)).toEqual([
      "req-0",
      "req-expire",
      "req-confirm",
    ]);
    expect(store.audit[1]).toMatchObject({
      action: PAYOUT_TRANSITION_AUDIT_ACTION,
      ipHash: "aaaaaaaaaaaaaaaa",
      actor: PAYOUT_SYSTEM_ACTOR,
      outcome: "success",
    });
    expect(store.payloads()[1]).toEqual({
      attemptId: saved.id,
      txHash: metadata.txHash,
      projectId: metadata.projectId,
      previousStatus: "pending",
      nextStatus: "failed",
      previousFailureCode: null,
      failureCode: "transaction_expired",
      failureLedger: null,
      observation: { status: "NOT_FOUND", ledger: null },
      occurredAt: now + SUBMISSION_EXPIRY_MS,
    });
    expect(store.payloads()[2]).toMatchObject({
      previousStatus: "failed",
      nextStatus: "completed",
      previousFailureCode: "transaction_expired",
      failureCode: null,
      observation: { status: "SUCCESS", ledger: 99 },
    });
    expect(store.attempts[0].status).toBe("completed");

    const report = verifyPayoutAuditTrail(store.audit as AuditLog[], "completed");
    expect(report).toEqual({ complete: true, problems: [] });
  });

  it("falls back to the request context, then a generated id, for correlation", async () => {
    const store = createStore();
    const saved = await registered(store);

    await requestContext.run({ requestId: "ctx-request-id" }, () =>
      updatePayoutAttemptFromObservation(store.dataSource, saved, { status: "FAILED", ledger: 3 }, now),
    );
    expect(store.audit[1].requestId).toBe("ctx-request-id");
    expect(store.audit[1].ipHash).toBe(PAYOUT_SYSTEM_IP_HASH);

    const other = await registerPayoutAttempt(
      store.dataSource,
      { ...metadata, txHash: "b".repeat(64) },
      now,
    );
    expect(store.audit[2].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(other.status).toBe("pending");
  });

  it("does not audit a reconciliation that leaves the status unchanged", async () => {
    const store = createStore();
    const saved = await registered(store);

    const stillPending = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "NOT_FOUND" },
      now + 1_000,
    );

    expect(stillPending).toMatchObject({ status: "pending", lastCheckedAt: now + 1_000 });
    expect(store.audit).toHaveLength(1);
  });

  it("never regresses a completed payout and records nothing for stale failures", async () => {
    const store = createStore();
    const saved = await registered(store);
    const completed = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "SUCCESS", ledger: 50 },
      now + 1,
    );
    const auditRows = store.audit.length;
    store.attemptRepo.update.mockClear();

    for (const observation of [
      { status: "FAILED", ledger: 49 },
      { status: "NOT_FOUND" },
    ] as const) {
      const result = await updatePayoutAttemptFromObservation(
        store.dataSource,
        completed,
        observation,
        now + SUBMISSION_EXPIRY_MS * 2,
      );
      expect(result.status).toBe("completed");
    }

    expect(store.attemptRepo.update).not.toHaveBeenCalled();
    expect(store.audit).toHaveLength(auditRows);
  });

  it("skips the write and the audit row when another writer moved the attempt first", async () => {
    const store = createStore();
    const saved = await registered(store);
    // A concurrent reconciliation confirmed the payout after we read it.
    store.forceStatus(saved.id, "completed");

    const result = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "FAILED", ledger: 12 },
      now + 1,
    );

    expect(result.status).toBe("completed");
    expect(store.audit).toHaveLength(1);
  });

  it("rolls the status change back when its audit row cannot be written", async () => {
    const store = createStore();
    const saved = await registered(store);
    store.auditRepo.insert.mockRejectedValueOnce(new Error("audit_log unavailable"));

    await expect(
      updatePayoutAttemptFromObservation(
        store.dataSource,
        saved,
        { status: "FAILED", ledger: 12 },
        now + 1,
      ),
    ).rejects.toThrow("audit_log unavailable");
    expect(store.attempts[0].status).toBe("pending");
    expect(store.audit).toHaveLength(1);
  });

  it("never moves a failed attempt back to pending and audits nothing for repeat failures", async () => {
    const store = createStore();
    const saved = await registered(store);
    const failed = await updatePayoutAttemptFromObservation(
      store.dataSource,
      saved,
      { status: "FAILED", ledger: 12 },
      now + 1,
    );
    const auditRows = store.audit.length;
    store.attemptRepo.update.mockClear();

    for (const observation of [{ status: "NOT_FOUND" }, { status: "FAILED", ledger: 13 }] as const) {
      const result = await updatePayoutAttemptFromObservation(
        store.dataSource,
        failed,
        observation,
        now + 2,
      );
      expect(result.status).toBe("failed");
    }

    expect(store.attemptRepo.update).not.toHaveBeenCalled();
    expect(store.audit).toHaveLength(auditRows);
  });

  it("describes a refused transition in its error", () => {
    const error = new PayoutTransitionError("completed", "failed");
    expect(error).toMatchObject({ from: "completed", to: "failed", name: "PayoutTransitionError" });
    expect(error.message).toBe("Payout attempt cannot move from completed to failed.");
  });
});

describe("verifyPayoutAuditTrail", () => {
  const row = (
    previousStatus: PayoutTransitionAuditPayload["previousStatus"],
    nextStatus: PayoutTransitionAuditPayload["nextStatus"],
    requestId = "req",
  ) => ({ requestId, payload: { previousStatus, nextStatus } });

  it("accepts an unbroken trail that ends at the current status", () => {
    expect(
      verifyPayoutAuditTrail([row(null, "pending"), row("pending", "failed"), row("failed", "completed")], "completed"),
    ).toEqual({ complete: true, problems: [] });
    expect(verifyPayoutAuditTrail([row(null, "pending")], "pending").complete).toBe(true);
  });

  it("flags a missing registration row", () => {
    const report = verifyPayoutAuditTrail([row("pending", "completed")], "completed");
    expect(report.complete).toBe(false);
    expect(report.problems[0]).toContain("starts at pending but trail was at null");
    expect(verifyPayoutAuditTrail([], "pending").problems).toEqual([
      "trail is empty: registration row missing",
    ]);
  });

  it("flags a gap between consecutive transitions", () => {
    const report = verifyPayoutAuditTrail(
      [row(null, "pending"), row("failed", "completed")],
      "completed",
    );
    expect(report.problems).toEqual(["row 1: starts at failed but trail was at pending"]);
  });

  it("flags a terminal-state regression and a trail that disagrees with the record", () => {
    const report = verifyPayoutAuditTrail(
      [row(null, "pending"), row("pending", "completed"), row("completed", "failed")],
      "completed",
    );
    expect(report.problems).toEqual([
      "row 2: completed -> failed is not an allowed transition",
      "trail ends at failed but attempt is completed",
    ]);
  });

  it("flags self-loops, repeated registration and missing correlation ids", () => {
    const report = verifyPayoutAuditTrail(
      [row(null, "pending", ""), row("pending", "pending"), row(null, "pending")],
      "pending",
    );
    expect(report.problems).toEqual([
      "row 0: missing correlation id",
      "row 1: pending -> pending is not an allowed transition",
      "row 2: starts at null but trail was at pending",
      "row 2: registration must be the first row and end at pending",
    ]);
  });
});
