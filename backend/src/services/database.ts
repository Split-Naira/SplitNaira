import "reflect-metadata";
import { DataSource, type QueryRunner } from "typeorm";
import { getEnv } from "../config/env.js";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { ServiceState } from "../entities/ServiceState.js";
import { AuditLog } from "../entities/AuditLog.js";
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
    entities: [User, TransactionRecord, ServiceState, AuditLog],
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
  return (error as any)?.code === DEADLOCK_ERROR_CODE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a callback within a database transaction.
 * Automatically rolls back on error and retries up to 3 times on PostgreSQL
 * deadlock errors (error code 40P01).
 */

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "40001" || error.code === "40P01")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransaction<T>(
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  const dataSource = getDataSource();
  let attempt = 0;

  while (true) {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await callback(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (isDeadlockError(error) && attempt < DEADLOCK_MAX_RETRIES - 1) {
        attempt++;
        logger.warn("Deadlock detected, retrying transaction", { attempt, maxRetries: DEADLOCK_MAX_RETRIES });
        await sleep(DEADLOCK_RETRY_DELAY_MS * attempt);
      } else {
        throw error;
      }
    } finally {
      await queryRunner.release();
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
