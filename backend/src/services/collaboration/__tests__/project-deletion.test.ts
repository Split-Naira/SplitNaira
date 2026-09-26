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
