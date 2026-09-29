/**
 * Optional split expiration / completion deadline (#1303).
 *
 * Expiration is off-chain configuration attached to a project id. Once past
 * `expiresAt`, funding and distribution via the API are rejected. Lifecycle
 * transitions are recorded for audit.
 */

export type ExpirationTransition =
  | "expiration.configured"
  | "expiration.updated"
  | "expiration.cleared"
  | "expiration.reached";

export interface SplitExpirationRecord {
  projectId: string;
  /** ISO timestamp of project creation (or first registration). */
  createdAt: string;
  /** ISO timestamp after which the split is expired; null means no deadline. */
  expiresAt: string | null;
  configuredBy: string;
  updatedAt: string;
}

export interface ExpirationLifecycleEvent {
  type: ExpirationTransition;
  projectId: string;
  actor: string;
  expiresAt: string | null;
  at: string;
}

const records = new Map<string, SplitExpirationRecord>();
const events: ExpirationLifecycleEvent[] = [];

export function resetSplitExpirationRegistryForTests(): void {
  records.clear();
  events.length = 0;
}

/**
 * Configure or update expiration. `expiresAt` must be strictly after
 * `createdAt` (and after now when first set).
 */
export function configureExpiration(input: {
  projectId: string;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  actor: string;
  now?: Date;
}): SplitExpirationRecord {
  const now = input.now ?? new Date();
  const createdAt = new Date(input.createdAt);
  const existing = records.get(input.projectId);

  let expiresAtIso: string | null = null;
  if (input.expiresAt != null) {
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw Object.assign(new Error("invalid_expiration"), {
        code: "invalid_expiration",
        status: 400,
      });
    }
    if (expiresAt.getTime() <= createdAt.getTime()) {
      throw Object.assign(new Error("expiration_before_creation"), {
        code: "expiration_before_creation",
        status: 400,
        message: "expiresAt must be after project creation time",
      });
    }
    if (!existing && expiresAt.getTime() <= now.getTime()) {
      throw Object.assign(new Error("expiration_in_past"), {
        code: "expiration_in_past",
        status: 400,
        message: "expiresAt must be in the future when first configured",
      });
    }
    expiresAtIso = expiresAt.toISOString();
  }

  const transition: ExpirationTransition = !existing
    ? "expiration.configured"
    : expiresAtIso == null
      ? "expiration.cleared"
      : "expiration.updated";

  const record: SplitExpirationRecord = {
    projectId: input.projectId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAtIso,
    configuredBy: input.actor,
    updatedAt: now.toISOString(),
  };
  records.set(input.projectId, record);

  events.push({
    type: transition,
    projectId: input.projectId,
    actor: input.actor,
    expiresAt: expiresAtIso,
    at: record.updatedAt,
  });

  return record;
}

export function getExpiration(
  projectId: string,
): SplitExpirationRecord | undefined {
  return records.get(projectId);
}

export function isSplitExpired(
  projectId: string,
  now: Date = new Date(),
): boolean {
  const record = records.get(projectId);
  if (!record?.expiresAt) return false;
  return new Date(record.expiresAt).getTime() <= now.getTime();
}

/**
 * Call before deposit / distribute / lock. Records a lifecycle transition the
 * first time expiry is observed.
 */
export function assertNotExpired(
  projectId: string,
  now: Date = new Date(),
): void {
  const record = records.get(projectId);
  if (!record?.expiresAt) return;
  if (new Date(record.expiresAt).getTime() > now.getTime()) return;

  const already = events.some(
    (e) => e.projectId === projectId && e.type === "expiration.reached",
  );
  if (!already) {
    events.push({
      type: "expiration.reached",
      projectId,
      actor: "system",
      expiresAt: record.expiresAt,
      at: now.toISOString(),
    });
  }

  throw Object.assign(new Error("split_expired"), {
    code: "split_expired",
    status: 410,
    message: "This split has expired; funding and distribution are closed",
  });
}

export function listExpirationEvents(
  projectId?: string,
): readonly ExpirationLifecycleEvent[] {
  if (!projectId) return events;
  return events.filter((e) => e.projectId === projectId);
}
