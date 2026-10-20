import "reflect-metadata";
import type { DataSource, QueryRunner } from "typeorm";
import { createDataSource } from "./services/database.js";

export const MIGRATION_ADVISORY_LOCK_KEY = 1_000_000_007n;

export async function withMigrationLock<T>(
  queryRunner: QueryRunner,
  operation: () => Promise<T>,
): Promise<T> {
  let acquired = false;
  let operationError: unknown;

  try {
    await queryRunner.connect();
    const rows = (await queryRunner.query(
      `SELECT pg_try_advisory_lock($1) AS "acquired"`,
      [MIGRATION_ADVISORY_LOCK_KEY],
    )) as Array<{ acquired: boolean }>;

    acquired = rows[0]?.acquired === true;
    if (!acquired) {
      throw new Error(
        "Another migration process holds the database migration lock; no migrations were run.",
      );
    }

    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      if (acquired) {
        const rows = (await queryRunner.query(
          `SELECT pg_advisory_unlock($1) AS "released"`,
          [MIGRATION_ADVISORY_LOCK_KEY],
        )) as Array<{ released: boolean }>;
        if (rows[0]?.released !== true) {
          throw new Error("The database migration lock was not released.");
        }
      }
    } catch (error) {
      cleanupError = error;
    }

    try {
      await queryRunner.release();
    } catch (error) {
      cleanupError ??= error;
    }

    if (cleanupError) {
      if (operationError) {
        console.error("Failed to clean up the migration lock connection", cleanupError);
      } else {
        throw cleanupError;
      }
    }
  }
}

export async function runMigrationsWithLock<T>(
  dataSource: DataSource,
  operation: () => Promise<T>,
): Promise<T> {
  return withMigrationLock(dataSource.createQueryRunner(), operation);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";
  if (command !== "run" && command !== "revert") {
    throw new Error(`Unsupported migration command "${command}". Use "run" or "revert".`);
  }

  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    await runMigrationsWithLock(dataSource, async () => {
      if (command === "revert") {
        const migration = await dataSource.undoLastMigration();
        console.log(migration ? `Reverted ${migration.name}` : "No migration to revert.");
        return migration;
      }

      const migrations = await dataSource.runMigrations();
      console.log(
        migrations.length
          ? `Applied ${migrations.length} migration(s).`
          : "No pending migrations.",
      );
      return migrations;
    });
  } finally {
    await dataSource.destroy();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  main().catch((error: unknown) => {
    console.error("Migration command failed", error);
    process.exitCode = 1;
  });
}
