import { describe, expect, it, vi } from "vitest";
import type { DataSource, Repository } from "typeorm";
import { TransactionAttempt } from "../entities/TransactionAttempt.js";
import {
  PayoutAttemptConflictError,
  SUBMISSION_EXPIRY_MS,
  decideRecoveryStatus,
  registerPayoutAttempt,
  updatePayoutAttemptFromObservation,
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
});

describe("registerPayoutAttempt", () => {
  const metadata = {
    txHash: "a".repeat(64),
    projectId: "project_1",
    sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  function dataSource(repository: Partial<Repository<TransactionAttempt>>) {
    return {
      getRepository: vi.fn().mockReturnValue(repository),
    } as unknown as DataSource;
  }

  it("is idempotent for a previously registered hash", async () => {
    const saved = attempt();
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(saved),
      insert: vi.fn(),
    };

    await expect(registerPayoutAttempt(dataSource(repo), metadata, now)).resolves.toBe(saved);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("persists new attempts as pending with a server-side timestamp", async () => {
    const saved = attempt();
    const repo = {
      findOneBy: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(saved),
      insert: vi.fn().mockResolvedValue(undefined),
    };

    await expect(registerPayoutAttempt(dataSource(repo), metadata, now)).resolves.toBe(saved);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        ...metadata,
        submittedAt: now,
        status: "pending",
        failureCode: null,
      }),
    );
  });

  it("rejects reuse of a hash with different metadata", async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(attempt()) };

    await expect(
      registerPayoutAttempt(dataSource(repo), { ...metadata, projectId: "other_project" }, now),
    ).rejects.toBeInstanceOf(PayoutAttemptConflictError);
  });
});

describe("updatePayoutAttemptFromObservation", () => {
  it("writes the failure status only from pending and preserves confirmed state", async () => {
    const saved = attempt();
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const findOneBy = vi.fn().mockResolvedValue({ ...saved, status: "failed" });
    const repository = { update, findOneBy };
    const dataSource = {
      getRepository: vi.fn().mockReturnValue(repository),
    } as unknown as DataSource;

    await updatePayoutAttemptFromObservation(
      dataSource,
      saved,
      { status: "FAILED", ledger: 42 },
      now + 10,
    );

    expect(update).toHaveBeenCalledWith(
      { id: saved.id, status: "pending" },
      expect.objectContaining({ status: "failed", failureLedger: 42, lastCheckedAt: now + 10 }),
    );
  });
});
