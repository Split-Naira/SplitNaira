import "reflect-metadata";
import { DataSource, type QueryRunner } from "typeorm";
import { getEnv } from "../config/env.js";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { ServiceState } from "../entities/ServiceState.js";
import { AuditLog } from "../entities/AuditLog.js";
import { LedgerBlock } from "../entities/LedgerBlock.js";
import { logger } from "./logger.js";

let AppDataSource: DataSource | null = null;
let initializationPromise: Promise<DataSource> | null = null;

export function createDataSource(): DataSource {
  const env = getEnv();
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database initialization.");
  }

  const databaseHost = new URL(databaseUrl).hostname;
  const needsSsl =
    databaseHost !== "localhost" &&
    databaseHost !== "127.0.0.1" &&
    !databaseUrl.includes("sslmode=") &&
    !databaseUrl.includes("ssl=");

  const poolMax = env.DATABASE_POOL_MAX ? Number(env.DATABASE_POOL_MAX) : 10;
  const poolIdleMs = env.DATABASE_POOL_IDLE_MS ? Number(env.DATABASE_POOL_IDLE_MS) : 30000;
  const poolConnTimeoutMs = env.DATABASE_POOL_CONN_TIMEOUT_MS ? Number(env.DATABASE_POOL_CONN_TIMEOUT_MS) : 2000;

  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    synchronize: false,
    logging: process.env.NODE_ENV === "development",
    entities: [User, TransactionRecord, ServiceState, AuditLog, LedgerBlock],
    migrations: ["src/migrations/*.ts"],
    migrationsTableName: "migrations",
    extra: {
      max: poolMax,
      idleTimeoutMillis: poolIdleMs,
      connectionTimeoutMillis: poolConnTimeoutMs,
    },
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });
}

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource?.isInitialized) return AppDataSource;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    AppDataSource = createDataSource();
    try {
      await AppDataSource.initialize();
      logger.info("Database connection established");
      return AppDataSource;
    } catch (error) {
      AppDataSource = null;
      logger.error("Failed to initialize database", { error });
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}


export function setDataSourceForTests(dataSource: DataSource | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setDataSourceForTests is only available in test mode.");
  }
  AppDataSource = dataSource;
  initializationPromise = null;
}
export function getDataSource(): DataSource {
  if (!AppDataSource?.isInitialized) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return AppDataSource;
}

const DEADLOCK_ERROR_CODE = "40P01";
const DEADLOCK_MAX_RETRIES = 3;
const DEADLOCK_RETRY_DELAY_MS = 50;

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === DEADLOCK_ERROR_CODE
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rollbackPreservingError(queryRunner: QueryRunner, originalError: unknown): Promise<void> {
  try {
    await queryRunner.rollbackTransaction();
  } catch (rollbackError) {
    // Surface the caller's error, not the rollback failure; Postgres aborts
    // the transaction on its own once the connection is released or dropped.
    logger.error("Transaction rollback failed", { rollbackError, originalError });
  }
}

async function releaseSafely(queryRunner: QueryRunner): Promise<void> {
  try {
    await queryRunner.release();
  } catch (releaseError) {
    // Never let a release failure replace a committed result or the
    // callback's error: callers would otherwise retry a write that landed.
    logger.error("Failed to release query runner", { error: releaseError });
  }
}

/**
 * Execute a callback within a database transaction.
 * Automatically rolls back on error and retries up to 3 times on PostgreSQL
 * deadlock errors (error code 40P01).
 *
 * Failure handling (Issue #1091):
 *  - The query runner is always released, including when `connect()` or
 *    `startTransaction()` fails.
 *  - If rollback itself fails, the callback's original error is still the
 *    one that is thrown (the rollback failure is logged).
 *  - A release failure is logged, never thrown.
 *
 * Nesting: calling `withTransaction` inside another `withTransaction`
 * callback does NOT create a savepoint. The inner call checks out its own
 * pooled connection and commits or rolls back independently, so an inner
 * commit survives a later outer rollback, and each nesting level holds one
 * extra connection. To make nested work atomic, pass the outer `queryRunner`
 * down instead of opening a new transaction.
 */
export async function withTransaction<T>(
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  const dataSource = getDataSource();
  let attempt = 0;

  while (true) {
    const queryRunner = dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    } catch (error) {
      await releaseSafely(queryRunner);
      throw error;
    }

    try {
      const result = await callback(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await rollbackPreservingError(queryRunner, error);

      if (isDeadlockError(error) && attempt < DEADLOCK_MAX_RETRIES - 1) {
        attempt++;
        logger.warn("Deadlock detected, retrying transaction", { attempt, maxRetries: DEADLOCK_MAX_RETRIES });
        await sleep(DEADLOCK_RETRY_DELAY_MS * attempt);
      } else {
        throw error;
      }
    } finally {
      await releaseSafely(queryRunner);
    }
  }
}

export async function closeDatabase(): Promise<void> {
  if (initializationPromise && !AppDataSource?.isInitialized) {
    try { await initializationPromise; } catch { /* ignore */ }
  }
  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
    logger.info("Database connection closed");
  }
  AppDataSource = null;
  initializationPromise = null;
}
