import "reflect-metadata";
import { DataSource, type QueryRunner } from "typeorm";
import { getEnv } from "../config/env.js";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
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

  // Production guidance:
  // - `DATABASE_POOL_MAX` controls the PG connection pool size (TypeORM -> pg `max`).
  //   Set this based on your Postgres instance limits and expected concurrency.
  //   A conservative default is 10; for Render or managed DBs, ensure the total
  //   connections across app instances stays below the DB's max_connections.
  // - SSL is automatically enabled for non-localhost hosts unless overridden
  //   in the DATABASE_URL (sslmode/ssl). For strict environments set
  //   `DATABASE_URL` with `sslmode=require` or configure a CA and set
  //   `PGSSLMODE` accordingly.
  const poolMax = env.DATABASE_POOL_MAX
    ? Number(env.DATABASE_POOL_MAX)
    : 10;

  // Additional pool tuning options exposed via env vars if needed
  const poolIdleMs = env.DATABASE_POOL_IDLE_MS ? Number(env.DATABASE_POOL_IDLE_MS) : 30000;
  const poolConnTimeoutMs = env.DATABASE_POOL_CONN_TIMEOUT_MS ? Number(env.DATABASE_POOL_CONN_TIMEOUT_MS) : 2000;

  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    synchronize: false,
    logging: process.env.NODE_ENV === "development",
    entities: [User, TransactionRecord, AuditLog],
    migrations: ["src/migrations/*.ts"],
    migrationsTableName: "migrations",
    extra: {
      // `max` is the maximum number of clients in the pool.
      max: poolMax,
      // Idle timeout (ms) before a client is closed
      idleTimeoutMillis: poolIdleMs,
      // How long to wait when connecting a new client
      connectionTimeoutMillis: poolConnTimeoutMs
    },
    ssl: needsSsl
      ? {
        rejectUnauthorized: false
      }
      : false
  });
}

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource?.isInitialized) {
    return AppDataSource;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

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

/**
 * Execute a callback function within a database transaction.
 * Automatically rolls back on error.
 * @param callback - Async function to execute within transaction
 * @returns Promise with the callback result
 */
export async function withTransaction<T>(
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  const dataSource = getDataSource();
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const result = await callback(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

export async function closeDatabase(): Promise<void> {
  if (initializationPromise && !AppDataSource?.isInitialized) {
    try {
      await initializationPromise;
    } catch {
      // Ignore initialization failures during cleanup.
    }
  }

  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
    logger.info("Database connection closed");
  }

  AppDataSource = null;
  initializationPromise = null;
}
