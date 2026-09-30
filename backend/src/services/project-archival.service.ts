import { ProjectArchival } from "../entities/ProjectArchival.js";
import { getDataSource } from "./database.js";

export class AlreadyArchivedError extends Error {
  constructor() {
    super("This project has already been archived.");
    this.name = "AlreadyArchivedError";
  }
}

export class NotArchivedError extends Error {
  constructor() {
    super("This project is not currently archived.");
    this.name = "NotArchivedError";
  }
}

/** Actions the API can be asked to perform against a project. */
export type ProjectAction =
  | "fund"
  | "edit_collaborators"
  | "distribute"
  | "cancel";

// Archiving a project is meant to freeze it, not make its history
// unreadable — read-only actions are never blocked here. Every
// state-changing action is, deliberately including "cancel": an archived
// project has nothing new to cancel, and allowing it would let an archived
// project's state keep changing after archival.
const BLOCKED_WHEN_ARCHIVED: ReadonlySet<ProjectAction> = new Set([
  "fund",
  "edit_collaborators",
  "distribute",
  "cancel",
]);

/**
 * Returns the most recent archival event for a project, or null if the
 * project has never been archived. If the latest event has `restoredAt`
 * set, the project is currently active (not archived).
 */
export async function getLatestArchivalEvent(
  projectId: string,
): Promise<ProjectArchival | null> {
  return getDataSource()
    .getRepository(ProjectArchival)
    .findOne({
      where: { projectId: projectId.trim() },
      order: { archivedAt: "DESC" },
    });
}

/** Whether a project is currently archived (latest event exists and is not yet restored). */
export async function isProjectArchived(projectId: string): Promise<boolean> {
  const latest = await getLatestArchivalEvent(projectId);
  return latest !== null && latest.restoredAt === null;
}

/**
 * Archives a project (#1315).
 *
 * Caller must already have established that `archivedBy` is the project
 * owner — authorisation lives with the existing `assertProjectOwner` guard
 * rather than being re-implemented here, matching `cancelSplit`.
 *
 * **Limitation, stated plainly:** off-chain marker only. See the entity's
 * doc comment — this cannot stop a direct on-chain contract call.
 */
export async function archiveProject(input: {
  projectId: string;
  archivedBy: string;
  reason?: string | null;
}): Promise<ProjectArchival> {
  const projectId = input.projectId.trim();

  if (await isProjectArchived(projectId)) {
    throw new AlreadyArchivedError();
  }

  const repository = getDataSource().getRepository(ProjectArchival);
  const record = repository.create({
    projectId,
    archivedBy: input.archivedBy.trim(),
    reason: input.reason?.trim() || null,
    archivedAt: new Date(),
    restoredBy: null,
    restoredAt: null,
  });

  return repository.save(record);
}

/**
 * Restores a previously archived project (#1315's "authorized restoration").
 *
 * Caller must already have established that `restoredBy` is authorized to
 * do so (the project owner, matching `archiveProject`'s authorization
 * model) — this function only enforces that the project is actually
 * archived, not who is allowed to restore it.
 *
 * Restoring does not delete the archival row — it stamps `restoredBy` /
 * `restoredAt` on it, so the archive-then-restore history stays visible.
 */
export async function restoreProject(input: {
  projectId: string;
  restoredBy: string;
}): Promise<ProjectArchival> {
  const projectId = input.projectId.trim();
  const latest = await getLatestArchivalEvent(projectId);

  if (!latest || latest.restoredAt !== null) {
    throw new NotArchivedError();
  }

  const repository = getDataSource().getRepository(ProjectArchival);
  latest.restoredBy = input.restoredBy.trim();
  latest.restoredAt = new Date();

  return repository.save(latest);
}

/**
 * Guard for mutating project routes (#1315's "block inappropriate
 * actions"). Throws when `action` is not permitted on an archived project;
 * resolves silently for an active project or a permitted action.
 */
export async function assertActionAllowed(
  projectId: string,
  action: ProjectAction,
): Promise<void> {
  if (!BLOCKED_WHEN_ARCHIVED.has(action)) {
    return;
  }
  const latest = await getLatestArchivalEvent(projectId);
  if (latest && latest.restoredAt === null) {
    throw new Error(
      `This project was archived on ${latest.archivedAt.toISOString()} and cannot accept "${action}" until it is restored.`,
    );
  }
}
