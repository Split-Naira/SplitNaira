import { In } from "typeorm";
import { ProjectEditHistory } from "../entities/ProjectEditHistory.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { getDataSource } from "./database.js";

const EXPIRATION_ACTIONS = [
  "expiration.configured",
  "expiration.updated",
  "expiration.cleared",
] as const;

export interface ProjectExpiration {
  projectId: string;
  createdAt: string;
  expiresAt: string | null;
}

async function recordExpirationEvent(
  projectId: string,
  actor: string,
  action: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const repo = getDataSource().getRepository(ProjectEditHistory);
  await repo.save(repo.create({ projectId, actor, action, changes }));
}

export async function recordSplitCreated(
  projectId: string,
  actor: string,
  expiresAt?: string,
): Promise<void> {
  const createdAt = new Date();
  await recordExpirationEvent(projectId, actor, "split.created", {
    createdAt: createdAt.toISOString(),
  });
  if (expiresAt) {
    await configureProjectExpiration(projectId, actor, expiresAt, createdAt);
  }
}

export async function getProjectExpiration(
  projectId: string,
): Promise<ProjectExpiration | undefined> {
  const repo = getDataSource().getRepository(ProjectEditHistory);
  const history = await repo.find({
    where: {
      projectId,
      action: In(["split.created", ...EXPIRATION_ACTIONS]),
    },
    order: { createdAt: "ASC" },
  });
  if (history.length === 0) return undefined;

  const creation = history.find((entry) => entry.action === "split.created");
  const createdAtValue = creation?.changes?.createdAt;
  const createdAt = typeof createdAtValue === "string"
    ? createdAtValue
    : history[0]!.createdAt.toISOString();
  const latestExpiration = history
    .filter((entry) => EXPIRATION_ACTIONS.includes(entry.action as (typeof EXPIRATION_ACTIONS)[number]))
    .at(-1);

  if (!latestExpiration) {
    return { projectId, createdAt, expiresAt: null };
  }

  const expiresAt = latestExpiration.changes?.expiresAt;
  return {
    projectId,
    createdAt,
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
  };
}

export async function configureProjectExpiration(
  projectId: string,
  actor: string,
  expiresAt: string | null,
  createdAtOverride?: Date,
  now = new Date(),
): Promise<ProjectExpiration> {
  const existing = await getProjectExpiration(projectId);
  const createdAt = createdAtOverride ?? (existing ? new Date(existing.createdAt) : now);
  let normalizedExpiration: string | null = null;

  if (expiresAt !== null) {
    const deadline = new Date(expiresAt);
    if (Number.isNaN(deadline.getTime())) {
      throw expirationError(ErrorCode.INVALID_EXPIRATION, "Invalid expiration timestamp", 400);
    }
    if (deadline.getTime() <= createdAt.getTime()) {
      throw expirationError(
        ErrorCode.EXPIRATION_BEFORE_CREATION,
        "expiresAt must be after project creation time",
        400,
      );
    }
    if (deadline.getTime() <= now.getTime()) {
      throw expirationError(ErrorCode.EXPIRATION_IN_PAST, "expiresAt must be in the future", 400);
    }
    normalizedExpiration = deadline.toISOString();
  }

  const action = normalizedExpiration === null
    ? "expiration.cleared"
    : existing?.expiresAt
      ? "expiration.updated"
      : "expiration.configured";
  await recordExpirationEvent(projectId, actor, action, {
    createdAt: createdAt.toISOString(),
    expiresAt: normalizedExpiration,
  });

  return {
    projectId,
    createdAt: createdAt.toISOString(),
    expiresAt: normalizedExpiration,
  };
}

export async function assertProjectNotExpired(projectId: string): Promise<void> {
  const expiration = await getProjectExpiration(projectId);
  if (!expiration?.expiresAt || new Date(expiration.expiresAt).getTime() > Date.now()) {
    return;
  }

  const repo = getDataSource().getRepository(ProjectEditHistory);
  const reached = await repo.findOne({
    where: { projectId, action: "expiration.reached" },
  });
  if (!reached) {
    await recordExpirationEvent(projectId, "system", "expiration.reached", {
      createdAt: expiration.createdAt,
      expiresAt: expiration.expiresAt,
    });
  }

  throw expirationError(
    ErrorCode.SPLIT_EXPIRED,
    "This split has expired; funding and distribution are closed",
    410,
  );
}

function expirationError(code: ErrorCode, message: string, status: number): AppError {
  const error = new AppError(
    status === 410 ? ErrorType.CONFLICT : ErrorType.VALIDATION,
    code,
    message,
  );
  (error as AppError & { statusCode?: number }).statusCode = status;
  return error;
}