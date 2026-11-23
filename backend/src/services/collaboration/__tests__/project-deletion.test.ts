import { describe, expect, it, beforeEach } from "vitest";
import {
  CONFIRMATION_PHRASE,
  evaluateProjectDeletion,
  getProjectDeletionAuditLog,
  hasFinancialHistory,
  requestProjectDeletion,
  resetProjectDeletionAuditForTests,
  type ProjectFinancialSnapshot,
} from "../project-deletion.js";

function snap(over: Partial<ProjectFinancialSnapshot> = {}): ProjectFinancialSnapshot {
  return {
    projectId: "proj-1",
    hasDeposits: false,
    hasDistributions: false,
    hasClaims: false,
    transactionCount: 0,
    ...over,
  };
}

describe("project deletion safeguards (issue #1296)", () => {
  beforeEach(() => {
    resetProjectDeletionAuditForTests();
  });

  it("detects projects with financial history", () => {
    expect(hasFinancialHistory(snap())).toBe(false);
    expect(hasFinancialHistory(snap({ hasDeposits: true }))).toBe(true);
    expect(hasFinancialHistory(snap({ transactionCount: 3 }))).toBe(true);
  });

  it("prevents hard deletion when financial history exists", () => {
    const d = evaluateProjectDeletion({
      snapshot: snap({ hasDistributions: true }),
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    expect(d.mode).toBe("soft");
    expect(d.allowed).toBe(true);
  });

  it("blocks deletion without explicit confirmation", () => {
    const d = evaluateProjectDeletion({
      snapshot: snap({ hasDeposits: true }),
      confirmed: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.requiresConfirmation).toBe(true);
  });

  it("allows hard delete only with confirmation and no financial history", () => {
    const d = evaluateProjectDeletion({
      snapshot: snap(),
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    expect(d.allowed).toBe(true);
    expect(d.mode).toBe("hard");
  });

  it("preserves audit information on blocked and soft delete", () => {
    requestProjectDeletion({
      snapshot: snap({ hasClaims: true }),
      actor: "GOWNER",
      confirmed: false,
    });
    requestProjectDeletion({
      snapshot: snap({ hasClaims: true }),
      actor: "GOWNER",
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    const log = getProjectDeletionAuditLog();
    expect(log.some((e) => e.type === "project.hard_delete_blocked")).toBe(true);
    expect(log.some((e) => e.type === "project.soft_deleted")).toBe(true);
    expect(log.every((e) => e.financial.projectId === "proj-1")).toBe(true);
  });
});


describe("project deletion retention and recovery boundaries (#1632)", () => {
  beforeEach(() => {
    resetProjectDeletionAuditForTests();
  });

  it("retains financial snapshot on soft-delete audit (linked-record retention)", () => {
    const snapshot = snap({
      hasDeposits: true,
      hasDistributions: true,
      transactionCount: 4,
    });
    const decision = requestProjectDeletion({
      snapshot,
      actor: "GOWNER",
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    expect(decision.mode).toBe("soft");
    const entry = getProjectDeletionAuditLog().find((e) => e.type === "project.soft_deleted");
    expect(entry).toBeDefined();
    expect(entry!.financial.hasDeposits).toBe(true);
    expect(entry!.financial.transactionCount).toBe(4);
  });

  it("wrong confirmation phrase never allows hard or soft delete", () => {
    const d = evaluateProjectDeletion({
      snapshot: snap(),
      confirmed: true,
      confirmationText: "delete",
    });
    expect(d.allowed).toBe(false);
    expect(d.mode).toBeNull();
  });

  it("hard-delete path is irreversible intent: only when no chain-linked financial history", () => {
    // Boundary: claims alone count as financial history → soft only
    const withClaims = evaluateProjectDeletion({
      snapshot: snap({ hasClaims: true }),
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    expect(withClaims.mode).toBe("soft");

    const clean = evaluateProjectDeletion({
      snapshot: snap({ transactionCount: 0 }),
      confirmed: true,
      confirmationText: CONFIRMATION_PHRASE,
    });
    expect(clean.mode).toBe("hard");
  });

  it("blocked attempts still produce audit for recovery investigation", () => {
    requestProjectDeletion({
      snapshot: snap({ hasDeposits: true }),
      actor: "NOTOWNER",
      confirmed: false,
    });
    const blocked = getProjectDeletionAuditLog().filter((e) => e.type === "project.hard_delete_blocked");
    expect(blocked.length).toBe(1);
    expect(blocked[0].actor).toBe("NOTOWNER");
    expect(blocked[0].financial.projectId).toBe("proj-1");
  });
});

