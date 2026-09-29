import { getDataSource } from "./database.js";
import { ProjectEditHistory } from "../entities/ProjectEditHistory.js";
import { logger } from "./logger.js";

export async function recordProjectEdit(
  projectId: string,
  actor: string,
  action: string,
  changes: Record<string, unknown>
): Promise<void> {
  try {
    const dataSource = getDataSource();
    const repo = dataSource.getRepository(ProjectEditHistory);

    // Filter out secrets or sensitive information if any
    const sanitizedChanges = { ...changes };
    delete sanitizedChanges.owner; // owner is the actor, no need to duplicate

    const entry = repo.create({
      projectId,
      actor,
      action,
      changes: sanitizedChanges
    });
    await repo.save(entry);
    logger.info(`Recorded project edit history: ${action} for project ${projectId}`);
  } catch (error) {
    logger.error("Failed to record project edit history", { error, projectId, action });
  }
}
