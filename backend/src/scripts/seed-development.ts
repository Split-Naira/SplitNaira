/**
 * Writes the deterministic development seed (#1342) to Postgres.
 *
 * Run from the repository root:
 *   npm run seed:dev -w backend
 *
 * Safe to run repeatedly: every insert uses ON CONFLICT DO NOTHING against
 * fixed ids, so a second run adds nothing. It never updates or deletes rows
 * (the `transactions` table is append-only anyway, see
 * migration 1760000000008).
 *
 * Guards, because seed data must never reach a real database:
 *   - refuses to run when NODE_ENV=production;
 *   - refuses any DATABASE_URL host other than localhost / 127.0.0.1 / a bare
 *     docker-compose service name, unless SEED_ALLOW_REMOTE_DB=true is set.
 *
 * `ledger_blocks` has no creating migration (see check-orphaned-transactions),
 * so on a fresh database that table is missing. The seed skips it with a
 * warning instead of failing.
 *
 * See docs/development-seed-data.md.
 */
import "reflect-metadata";
import { fileURLToPath } from "url";
import type { DataSource, EntityManager, EntityTarget, ObjectLiteral } from "typeorm";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { LedgerBlock } from "../entities/LedgerBlock.js";
import { Notification } from "../entities/Notification.js";
import { NotificationPreference } from "../entities/NotificationPreference.js";
import { SplitCancellation } from "../entities/SplitCancellation.js";
import { ProjectEditHistory } from "../entities/ProjectEditHistory.js";
import { initDatabase, closeDatabase } from "../services/database.js";
import { logger } from "../services/logger.js";
import {
  buildDevelopmentSeed,
  summarizeSeed,
  type DevelopmentSeed,
} from "./seed-development-data.js";

/** Postgres error code for "relation does not exist" (undefined_table). */
const UNDEFINED_TABLE_ERROR_CODE = "42P01";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

export class SeedSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedSafetyError";
  }
}

/**
 * Throws SeedSafetyError unless it is safe to seed the given environment.
 * Exported so it can be unit tested without a database.
 */
export function assertSafeToSeed(env: {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  SEED_ALLOW_REMOTE_DB?: string;
}): void {
  if (env.NODE_ENV === "production") {
    throw new SeedSafetyError("Refusing to seed: NODE_ENV is production.");
  }

  if (!env.DATABASE_URL) {
    throw new SeedSafetyError("Refusing to seed: DATABASE_URL is not set.");
  }

  let host: string;
  try {
    host = new URL(env.DATABASE_URL).hostname.toLowerCase();
  } catch {
    throw new SeedSafetyError("Refusing to seed: DATABASE_URL is not a valid URL.");
  }

  if (!LOCAL_HOSTS.has(host) && env.SEED_ALLOW_REMOTE_DB !== "true") {
    throw new SeedSafetyError(
      `Refusing to seed a non-local database host "${host}". ` +
        "Set SEED_ALLOW_REMOTE_DB=true only if this is a disposable development database."
    );
  }
}

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNDEFINED_TABLE_ERROR_CODE
  );
}

async function insertIgnoringDuplicates<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  rows: object[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await manager
    .createQueryBuilder()
    .insert()
    .into(entity)
    .values(rows)
    .orIgnore()
    .returning("id")
    .execute();
  // With ON CONFLICT DO NOTHING, RETURNING yields only rows actually inserted.
  return Array.isArray(result.raw) ? result.raw.length : 0;
}

export interface SeedRunResult {
  inserted: Record<string, number>;
  skippedLedgerBlocks: boolean;
}

/**
 * Inserts the seed inside one transaction. Either everything lands or nothing
 * does, so a failure never leaves a half-seeded database.
 */
export async function applyDevelopmentSeed(
  dataSource: DataSource,
  seed: DevelopmentSeed = buildDevelopmentSeed()
): Promise<SeedRunResult> {
  const inserted: Record<string, number> = {};
  let skippedLedgerBlocks = false;

  await dataSource.transaction(async (manager) => {
    inserted.users = await insertIgnoringDuplicates(manager, User, seed.users);
    inserted.transactions = await insertIgnoringDuplicates(
      manager,
      TransactionRecord,
      seed.transactions
    );

    // A failed statement aborts the whole Postgres transaction, so probe for
    // the table first instead of catching an error mid-transaction.
    const [{ exists }] = (await manager.query(
      `SELECT to_regclass('public.ledger_blocks') IS NOT NULL AS "exists"`
    )) as Array<{ exists: boolean }>;
    if (exists) {
      inserted.ledgerBlocks = await insertIgnoringDuplicates(
        manager,
        LedgerBlock,
        seed.ledgerBlocks
      );
    } else {
      skippedLedgerBlocks = true;
      inserted.ledgerBlocks = 0;
    }

    inserted.notificationPreferences = await insertIgnoringDuplicates(
      manager,
      NotificationPreference,
      seed.notificationPreferences
    );
    inserted.notifications = await insertIgnoringDuplicates(
      manager,
      Notification,
      seed.notifications
    );
    inserted.splitCancellations = await insertIgnoringDuplicates(
      manager,
      SplitCancellation,
      seed.splitCancellations
    );
    inserted.projectEdits = await insertIgnoringDuplicates(
      manager,
      ProjectEditHistory,
      seed.projectEdits
    );
  });

  return { inserted, skippedLedgerBlocks };
}

async function runCli(): Promise<number> {
  try {
    assertSafeToSeed({
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      SEED_ALLOW_REMOTE_DB: process.env.SEED_ALLOW_REMOTE_DB,
    });
  } catch (error) {
    logger.error((error as Error).message);
    return 1;
  }

  let dataSource: DataSource;
  try {
    dataSource = await initDatabase();
  } catch {
    logger.error("Failed to connect to the database. Is Postgres running and migrated?");
    return 1;
  }

  try {
    const seed = buildDevelopmentSeed();
    logger.info("Seeding development data", { planned: summarizeSeed(seed) });
    const result = await applyDevelopmentSeed(dataSource, seed);
    if (result.skippedLedgerBlocks) {
      logger.warn(
        "The ledger_blocks table does not exist, so settlement records were skipped. " +
          "Transaction rows were still seeded."
      );
    }
    logger.info("Development seed complete (rows newly inserted this run)", {
      inserted: result.inserted,
    });
    return 0;
  } catch (error) {
    if (isUndefinedTable(error)) {
      logger.error("A required table is missing. Run `npm run migration:run -w backend` first.");
    } else {
      logger.error("Development seed failed; nothing was written.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return 1;
  } finally {
    await closeDatabase();
  }
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("seed-development.ts") ||
    process.argv[1].endsWith("seed-development.js") ||
    process.argv[1] === __filename);

if (isDirectRun) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      logger.error("Unexpected error while seeding", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
}
