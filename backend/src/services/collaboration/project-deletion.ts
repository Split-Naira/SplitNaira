/**
 * Issue #1296 – Project deletion safeguards.
 *
 * Projects with financial history cannot be hard-deleted. Soft-delete preserves
 * audit information and requires explicit confirmation.
 */

export interface ProjectFinancialSnapshot {
  projectId: string;
  hasDeposits: boolean;
  hasDistributions: boolean;
  hasClaims: boolean;
  transactionCount: number;
  totalVolumeStroops?: string;
}

export type DeletionMode = "hard" | "soft";

export interface DeletionDecision {
  allowed: boolean;
  mode: DeletionMode | null;
  reason: string;
  requiresConfirmation: boolean;
  confirmationPhrase: string;
}

export interface ProjectDeletionAuditEvent {
  type: "project.deletion_requested" | "project.soft_deleted" | "project.hard_delete_blocked";
  projectId: string;
  actor: string;
  mode: DeletionMode | null;
  reason: string;
  at: string;
  financial: ProjectFinancialSnapshot;
}

const auditLog: ProjectDeletionAuditEvent[] = [];

export function resetProjectDeletionAuditForTests(): void {
  auditLog.length = 0;
}

export function getProjectDeletionAuditLog(): readonly ProjectDeletionAuditEvent[] {
  return auditLog;
}

/**
 * Detect whether a project has financial history that blocks hard deletion.
 */
export function hasFinancialHistory(snapshot: ProjectFinancialSnapshot): boolean {
  return (
    snapshot.hasDeposits ||
    snapshot.hasDistributions ||
    snapshot.hasClaims ||
    snapshot.transactionCount > 0
  );
}

export const CONFIRMATION_PHRASE = "DELETE PROJECT";

/**
 * Decide whether deletion is allowed and which mode to use.
 * Hard delete only when there is no financial history AND explicit confirmation.
 */
export function evaluateProjectDeletion(input: {
  snapshot: ProjectFinancialSnapshot;
  confirmed: boolean;
  confirmationText?: string;
}): DeletionDecision {
  const financial = hasFinancialHistory(input.snapshot);

  if (financial) {
    return {
      allowed: input.confirmed && input.confirmationText === CONFIRMATION_PHRASE,
      mode: input.confirmed && input.confirmationText === CONFIRMATION_PHRASE ? "soft" : null,
      reason: financial
        ? "Project has financial history; hard deletion is blocked. Soft-delete requires explicit confirmation."
        : "Confirmation required",
      requiresConfirmation: true,
      confirmationPhrase: CONFIRMATION_PHRASE,
    };
  }

  // No financial history – hard delete still requires confirmation for safety.
  if (!input.confirmed || input.confirmationText !== CONFIRMATION_PHRASE) {
    return {
      allowed: false,
      mode: null,
      reason: "Explicit confirmation required to delete project",
      requiresConfirmation: true,
      confirmationPhrase: CONFIRMATION_PHRASE,
    };
  }

  return {
    allowed: true,
    mode: "hard",
    reason: "No financial history; hard deletion permitted with confirmation",
    requiresConfirmation: true,
    confirmationPhrase: CONFIRMATION_PHRASE,
  };
}

/**
 * Execute deletion policy and always record an audit event.
 * Returns the decision; callers perform actual storage ops for soft/hard delete.
 */
export function requestProjectDeletion(input: {
  snapshot: ProjectFinancialSnapshot;
  actor: string;
  confirmed: boolean;
  confirmationText?: string;
}): DeletionDecision {
  const decision = evaluateProjectDeletion(input);
  const at = new Date().toISOString();

  if (!decision.allowed) {
    auditLog.push({
      type: "project.hard_delete_blocked",
      projectId: input.snapshot.projectId,
      actor: input.actor,
      mode: null,
      reason: decision.reason,
      at,
      financial: input.snapshot,
    });
    return decision;
  }

  if (decision.mode === "soft") {
    auditLog.push({
      type: "project.soft_deleted",
      projectId: input.snapshot.projectId,
      actor: input.actor,
      mode: "soft",
      reason: decision.reason,
      at,
      financial: input.snapshot,
    });
  } else {
    auditLog.push({
      type: "project.deletion_requested",
      projectId: input.snapshot.projectId,
      actor: input.actor,
      mode: "hard",
      reason: decision.reason,
      at,
      financial: input.snapshot,
    });
  }

  return decision;
}
