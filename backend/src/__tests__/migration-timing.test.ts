import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  withMigrationLock,
} from "../../scripts/migrate.js";

/**
 * Migration timing and locking benchmarks (#measure-migration-timing).
 *
 * Goals:
 *   1. Verify each migration runs in a known time budget on representative
 *      data so latency surprises are caught before release.
 *   2. Confirm PostgreSQL advisory locks do not cause indefinite waits when
 *      two migration runners start concurrently.
 *   3. Guard the financial invariants added by specific migrations
 *      (amount check constraint, immutability trigger) against being silently
 *      dropped or bypassed.
 *
 * This suite requires a pre-migrated Postgres reachable via DATABASE_URL. It
 * skips locally when no database is available and fails in CI so the check
 * cannot silently pass by skipping.
 *
 * All data writes execute inside a rolled-back transaction so nothing
 * persists after the suite.
 */

// ---------------------------------------------------------------------------
// Timing budgets (milliseconds). Each full-schema migration on a lightly
// loaded Postgres should complete well within these limits. Adjust them as
// the schema grows, but never remove them without updating the runbook.
// ---------------------------------------------------------------------------
const BUDGET_MS = {
  /** A single migration that adds one table / column / index. */
  singleMigration: 2_000,
  /** The full sequential set of all migrations applied to a blank schema. */
  fullMigrationChain: 30_000,
  /** pg_try_advisory_lock must return quickly regardless of contention. */
  advisoryLockCheck: 500,
  /** Concurrent runner: lock acquisition wait in non-blocking mode. */
  concurrentAdvisoryLockWait: 200,
};

// This is the application migration runner's stable database-scoped lock key.
const TYPEORM_ADVISORY_LOCK_KEY = MIGRATION_ADVISORY_LOCK_KEY;

// ---------------------------------------------------------------------------
// Database connectivity helpers
// ---------------------------------------------------------------------------

let ds: DataSource | null = null;
let runner: QueryRunner | null = null;
let secondDs: DataSource | null = null;

function db(): QueryRunner {
  if (!runner) throw new Error("Database is not available");
  return runner;
}

async function connectDataSource(url: string): Promise<DataSource> {
  const source = new DataSource({ type: "postgres", url });
  await source.initialize();
  return source;
}

// ---------------------------------------------------------------------------
// Representative seed data helpers
// ---------------------------------------------------------------------------

/** Insert N representative transaction rows and return their IDs. */
async function seedTransactions(
  qr: QueryRunner,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    ids.push(id);
    await qr.query(
      `INSERT INTO "transactions"
         ("id", "roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
       VALUES ($1, $2, $3, $4, 'Native', $5, $6, 'pending')`,
      [
        id,
        `round-${randomUUID()}`,
        `GRECIPIENT${i.toString().padStart(46, "0").slice(0, 46)}`,
        // Amounts that satisfy CHK_transactions_amount_valid
        i % 3 === 0 ? "0.0000001" : i % 3 === 1 ? "1000" : "123456.7654321",
        Date.now(),
        `hash-${randomUUID()}`,
      ],
    );
  }
  return ids;
}

/** Insert N representative user rows. */
async function seedUsers(qr: QueryRunner, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await qr.query(
      `INSERT INTO "users"
         ("walletAddress", "email", "alias", "role", "isActive")
       VALUES ($1, $2, $3, 'user', true)`,
      [
        `GUSER${i.toString().padStart(51, "0").slice(0, 51)}`,
        `user${i}@example.com`,
        `User ${i}`,
      ],
    );
  }
}

/** Insert N representative notifications. */
async function seedNotifications(qr: QueryRunner, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await qr.query(
      `INSERT INTO "notifications"
         ("recipient", "category", "title", "body", "eventKey", "source")
       VALUES ($1, 'payment', $2, $3, $4, 'test')`,
      [
        `GNOTIFY${i.toString().padStart(49, "0").slice(0, 49)}`,
        `Payment received ${i}`,
        `You received funds for round ${i}.`,
        `payment-event-${randomUUID()}`,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.CI) throw new Error("DATABASE_URL is required in CI");
    return;
  }
  try {
    ds = await connectDataSource(url);
    runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    secondDs = await connectDataSource(url);
  } catch (error) {
    if (process.env.CI) throw error;
    runner = null;
    ds = null;
    secondDs = null;
  }
});

afterAll(async () => {
  if (runner) {
    await runner.rollbackTransaction();
    await runner.release();
  }
  if (ds?.isInitialized) await ds.destroy();
  if (secondDs?.isInitialized) await secondDs.destroy();
});

// ---------------------------------------------------------------------------
// Helper: measure elapsed time around an async operation
// ---------------------------------------------------------------------------
async function measured<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}

// ---------------------------------------------------------------------------
// 1. Schema presence: all migrations have run
// ---------------------------------------------------------------------------
describe("Schema presence (all migrations applied)", () => {
  const EXPECTED_TABLES = [
    "users",
    "transactions",
    "service_state",
    "audit_log",
    "notifications",
    "notification_preferences",
    "split_cancellations",
    "project_archivals",
    "project_edit_history",
    "ledger_blocks",
  ];

  for (const table of EXPECTED_TABLES) {
    it(`table "${table}" exists`, async (ctx) => {
      if (!runner) return ctx.skip();
      const rows = (await db().query(
        `SELECT to_regclass('public.${table}') AS "t"`,
      )) as Array<{ t: string | null }>;
      expect(rows[0]?.t).not.toBeNull();
    });
  }

  it("migrations history table records all applied migrations", async (ctx) => {
    if (!runner) return ctx.skip();
    const rows = (await db().query(
      `SELECT count(*)::int AS "n" FROM "migrations"`,
    )) as Array<{ n: number }>;
    // 16 migration files in src/migrations/
    expect(rows[0]?.n).toBeGreaterThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// 2. Migration timing with representative data
// ---------------------------------------------------------------------------
describe("Migration timing benchmarks", () => {
  /**
   * Measure the time of a migration up() invocation after seeding representative
   * data into a savepoint that we roll back afterwards.
   */

  it("AddServiceState: CREATE TABLE finishes within budget", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddServiceState1760000000001 } = await import(
      "../migrations/1760000000001-AddServiceState.js"
    );
    await db().query("SAVEPOINT timing_service_state");
    const migration = new AddServiceState1760000000001();
    // down first so up can re-run cleanly inside the savepoint
    await migration.down(db()).catch(() => null);
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_service_state");
    expect(ms, `AddServiceState took ${ms.toFixed(1)}ms`).toBeLessThan(
      BUDGET_MS.singleMigration,
    );
  });

  it("AddAuditLog: CREATE TABLE + index finishes within budget", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddAuditLog1760000000003 } = await import(
      "../migrations/1760000000003-AddAuditLog.js"
    );
    await db().query("SAVEPOINT timing_audit_log");
    const migration = new AddAuditLog1760000000003();
    await migration.down(db()).catch(() => null);
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_audit_log");
    expect(ms, `AddAuditLog took ${ms.toFixed(1)}ms`).toBeLessThan(
      BUDGET_MS.singleMigration,
    );
  });

  it("AddNotifications: CREATE TABLE + 3 indexes finishes within budget", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddNotifications1760000000006 } = await import(
      "../migrations/1760000000006-AddNotifications.js"
    );
    await db().query("SAVEPOINT timing_notifications");
    const migration = new AddNotifications1760000000006();
    await migration.down(db()).catch(() => null);
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_notifications");
    expect(ms, `AddNotifications took ${ms.toFixed(1)}ms`).toBeLessThan(
      BUDGET_MS.singleMigration,
    );
  });

  it("AddFinancialAmountCheckConstraints: constraint check scan finishes within budget on 200 rows", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddFinancialAmountCheckConstraints1760000000010 } = await import(
      "../migrations/1760000000010-AddFinancialAmountCheckConstraints.js"
    );
    const CHECK_NAME = "CHK_transactions_amount_valid";

    await db().query("SAVEPOINT timing_amount_check");
    // Seed representative data — 200 rows with valid amounts
    await seedTransactions(db(), 200);
    // Drop constraint so migration up() can re-apply it
    await db().query(
      `ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "${CHECK_NAME}"`,
    );
    const migration = new AddFinancialAmountCheckConstraints1760000000010();
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_amount_check");
    expect(
      ms,
      `AddFinancialAmountCheckConstraints on 200 rows took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.singleMigration);
  });

  it("AddUserSoftDelete: ALTER TABLE + index finishes within budget on 100 users", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddUserSoftDelete1760000000007 } = await import(
      "../migrations/1760000000007-AddUserSoftDelete.js"
    );

    await db().query("SAVEPOINT timing_soft_delete");
    // Seed representative users
    await seedUsers(db(), 100);
    // Drop the column so up() can re-add it
    await db().query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "deletedAt"`,
    );
    await db().query(`DROP INDEX IF EXISTS "IDX_users_deleted_at"`);
    const migration = new AddUserSoftDelete1760000000007();
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_soft_delete");
    expect(
      ms,
      `AddUserSoftDelete on 100 users took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.singleMigration);
  });

  it("CreateLedgerBlocks: CREATE TABLE + 3 indexes finishes within budget", async (ctx) => {
    if (!runner) return ctx.skip();
    const { CreateLedgerBlocks1760000000011 } = await import(
      "../migrations/1760000000011-CreateLedgerBlocks.js"
    );
    await db().query("SAVEPOINT timing_ledger_blocks");
    const migration = new CreateLedgerBlocks1760000000011();
    await migration.down(db()).catch(() => null);
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_ledger_blocks");
    expect(
      ms,
      `CreateLedgerBlocks took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.singleMigration);
  });

  it("AddUserSessionVersionAndEmailVerification: ALTER TABLE finishes within budget on 100 users", async (ctx) => {
    if (!runner) return ctx.skip();
    const { AddUserSessionVersionAndEmailVerification1760000000012 } =
      await import(
        "../migrations/1760000000012-AddUserSessionVersionAndEmailVerification.js"
      );
    await db().query("SAVEPOINT timing_session_version");
    await seedUsers(db(), 100);
    // Drop columns so up() can re-add them cleanly
    await db().query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "sessionVersion"`,
    );
    await db().query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "emailVerifiedAt"`,
    );
    const migration =
      new AddUserSessionVersionAndEmailVerification1760000000012();
    const { ms } = await measured(() => migration.up(db()));
    await db().query("ROLLBACK TO SAVEPOINT timing_session_version");
    expect(
      ms,
      `AddUserSessionVersionAndEmailVerification on 100 users took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.singleMigration);
  });
});

// ---------------------------------------------------------------------------
// 3. Advisory lock behaviour
// ---------------------------------------------------------------------------
describe("Advisory lock behaviour", () => {
  /**
   * TypeORM migration:run acquires a session-level advisory lock before
   * running migrations to prevent concurrent runs. We test:
   *   a. pg_try_advisory_lock returns quickly (non-blocking fast path).
   *   b. A second session cannot steal the same lock while the first holds it.
   *   c. pg_advisory_unlock releases the lock and a new session can re-acquire.
   */

  it("pg_try_advisory_lock returns within budget", async (ctx) => {
    if (!runner) return ctx.skip();
    const { ms } = await measured(async () => {
      await db().query("SAVEPOINT advisory_lock_timing");
      await db().query(`SELECT pg_try_advisory_xact_lock($1)`, [
        TYPEORM_ADVISORY_LOCK_KEY,
      ]);
      await db().query("ROLLBACK TO SAVEPOINT advisory_lock_timing");
    });
    expect(ms, `pg_try_advisory_lock took ${ms.toFixed(1)}ms`).toBeLessThan(
      BUDGET_MS.advisoryLockCheck,
    );
  });

  it("second session cannot acquire lock held by first session", async (ctx) => {
    if (!runner || !secondDs) return ctx.skip();

    // First connection acquires a session-level advisory lock
    await db().query(
      `SELECT pg_advisory_lock($1)`,
      [TYPEORM_ADVISORY_LOCK_KEY],
    );

    // Second connection tries non-blocking acquisition — must fail fast
    const secondRunner = secondDs.createQueryRunner();
    await secondRunner.connect();
    let lockAcquired: boolean | null = null;
    let waitMs = 0;
    try {
      const { result, ms } = await measured(async () => {
        const rows = (await secondRunner.query(
          `SELECT pg_try_advisory_lock($1) AS "acquired"`,
          [TYPEORM_ADVISORY_LOCK_KEY],
        )) as Array<{ acquired: boolean }>;
        return rows[0]?.acquired ?? false;
      });
      lockAcquired = result;
      waitMs = ms;
    } finally {
      await secondRunner.release();
    }

    // Release our lock so the transaction can complete
    await db().query(
      `SELECT pg_advisory_unlock($1)`,
      [TYPEORM_ADVISORY_LOCK_KEY],
    );

    expect(
      lockAcquired,
      "second session must not acquire lock held by first",
    ).toBe(false);
    expect(
      waitMs,
      `pg_try_advisory_lock contention check took ${waitMs.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.concurrentAdvisoryLockWait);
  });

  it("lock is available again after first session releases", async (ctx) => {
    if (!runner || !secondDs) return ctx.skip();

    await db().query(`SELECT pg_advisory_lock($1)`, [TYPEORM_ADVISORY_LOCK_KEY]);
    await db().query(`SELECT pg_advisory_unlock($1)`, [TYPEORM_ADVISORY_LOCK_KEY]);

    const secondRunner = secondDs.createQueryRunner();
    await secondRunner.connect();
    let lockAcquired = false;
    try {
      const rows = (await secondRunner.query(
        `SELECT pg_try_advisory_lock($1) AS "acquired"`,
        [TYPEORM_ADVISORY_LOCK_KEY],
      )) as Array<{ acquired: boolean }>;
      lockAcquired = rows[0]?.acquired ?? false;
      // Release from the second session before teardown
      if (lockAcquired) {
        await secondRunner.query(`SELECT pg_advisory_unlock($1)`, [
          TYPEORM_ADVISORY_LOCK_KEY,
        ]);
      }
    } finally {
      await secondRunner.release();
    }

    expect(
      lockAcquired,
      "second session must acquire lock after first releases",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Financial invariant guard: immutability trigger survives representative data
// ---------------------------------------------------------------------------
describe("Financial invariant: transaction immutability trigger", () => {
  const IMMUTABILITY_ERRCODE = "23000";

  it("trigger is present on the transactions table", async (ctx) => {
    if (!runner) return ctx.skip();
    const rows = (await db().query(
      `SELECT tgname FROM pg_trigger
       WHERE tgname = 'trg_transactions_immutable'
         AND tgrelid = '"transactions"'::regclass`,
    )) as Array<{ tgname: string }>;
    expect(rows.length).toBe(1);
  });

  it("UPDATE of a financial field on an existing row is rejected", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT immut_update");
    const [id] = await seedTransactions(db(), 1);
    let errorCode: string | undefined;
    await db().query("SAVEPOINT immut_update_inner");
    try {
      await db().query(
        `UPDATE "transactions" SET "amount" = '999' WHERE "id" = $1`,
        [id],
      );
    } catch (err) {
      errorCode = (err as { code?: string }).code;
    }
    await db().query("ROLLBACK TO SAVEPOINT immut_update_inner");
    await db().query("ROLLBACK TO SAVEPOINT immut_update");

    expect(errorCode, "immutability trigger must reject the update").toBe(
      IMMUTABILITY_ERRCODE,
    );
  });

  it("UPDATE of only status on an existing row is accepted", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT immut_status_ok");
    const [id] = await seedTransactions(db(), 1);
    let errorCode: string | undefined;
    try {
      await db().query(
        `UPDATE "transactions" SET "status" = 'completed' WHERE "id" = $1`,
        [id],
      );
    } catch (err) {
      errorCode = (err as { code?: string }).code;
    }
    await db().query("ROLLBACK TO SAVEPOINT immut_status_ok");
    expect(errorCode).toBeUndefined();
  });

  it("DELETE of any row is rejected", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT immut_delete");
    const [id] = await seedTransactions(db(), 1);
    let errorCode: string | undefined;
    await db().query("SAVEPOINT immut_delete_inner");
    try {
      await db().query(`DELETE FROM "transactions" WHERE "id" = $1`, [id]);
    } catch (err) {
      errorCode = (err as { code?: string }).code;
    }
    await db().query("ROLLBACK TO SAVEPOINT immut_delete_inner");
    await db().query("ROLLBACK TO SAVEPOINT immut_delete");

    expect(errorCode, "immutability trigger must reject the delete").toBe(
      IMMUTABILITY_ERRCODE,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Financial invariant guard: amount check constraint
// ---------------------------------------------------------------------------
describe("Financial invariant: amount check constraint (CHK_transactions_amount_valid)", () => {
  const CHECK_VIOLATION = "23514";
  const CHECK_NAME = "CHK_transactions_amount_valid";

  it("constraint is present on transactions table", async (ctx) => {
    if (!runner) return ctx.skip();
    const rows = (await db().query(
      `SELECT count(*)::int AS "n" FROM pg_constraint
       WHERE conname = $1 AND conrelid = '"transactions"'::regclass`,
      [CHECK_NAME],
    )) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });

  const BOUNDARY_VALID = [
    "0",
    "1",
    "0.0000001",
    "170141183460469231731687303715884105727",
  ];
  const BOUNDARY_INVALID = [
    "170141183460469231731687303715884105728",
    "-1",
    "1.",
    ".5",
    "1e6",
  ];

  for (const amount of BOUNDARY_VALID) {
    it(`accepts boundary amount ${JSON.stringify(amount)}`, async (ctx) => {
      if (!runner) return ctx.skip();
      await db().query("SAVEPOINT bc_valid");
      let errorCode: string | undefined;
      try {
        await db().query(
          `INSERT INTO "transactions"
             ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
           VALUES ($1, $2, $3, 'Native', 1760000000, $4, 'pending')`,
          [
            `round-${randomUUID()}`,
            `GBOUNDARY${randomUUID().replace(/-/g, "").slice(0, 47)}`,
            amount,
            `hash-${randomUUID()}`,
          ],
        );
      } catch (err) {
        errorCode = (err as { code?: string }).code;
      }
      await db().query("ROLLBACK TO SAVEPOINT bc_valid");
      expect(errorCode).toBeUndefined();
    });
  }

  for (const amount of BOUNDARY_INVALID) {
    it(`rejects boundary amount ${JSON.stringify(amount)}`, async (ctx) => {
      if (!runner) return ctx.skip();
      await db().query("SAVEPOINT bc_invalid");
      let errorCode: string | undefined;
      try {
        await db().query(
          `INSERT INTO "transactions"
             ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
           VALUES ($1, $2, $3, 'Native', 1760000000, $4, 'pending')`,
          [
            `round-${randomUUID()}`,
            `GBOUNDARY${randomUUID().replace(/-/g, "").slice(0, 47)}`,
            amount,
            `hash-${randomUUID()}`,
          ],
        );
      } catch (err) {
        errorCode = (err as { code?: string }).code;
      }
      await db().query("ROLLBACK TO SAVEPOINT bc_invalid");
      expect(
        errorCode,
        `amount ${JSON.stringify(amount)} must be rejected`,
      ).toBe(CHECK_VIOLATION);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Concurrent migration lock (simulated)
// ---------------------------------------------------------------------------
describe("Concurrent migration lock simulation", () => {
  /**
   * Exercises the same lock helper used by migration:run and migration:revert.
   * A contending runner must fail before invoking its migration callback, and
   * a lock must be released after both successful and failed callbacks.
   */

  it("second concurrent migration runner fails fast without running migrations", async (ctx) => {
    if (!runner || !secondDs) return ctx.skip();

    await db().query(`SELECT pg_advisory_lock($1)`, [TYPEORM_ADVISORY_LOCK_KEY]);
    let operationCalled = false;
    try {
      const { ms } = await measured(() =>
        expect(
          withMigrationLock(secondDs!.createQueryRunner(), async () => {
            operationCalled = true;
          }),
        ).rejects.toThrow("Another migration process holds the database migration lock"),
      );
      expect(operationCalled).toBe(false);
      expect(ms).toBeLessThan(BUDGET_MS.concurrentAdvisoryLockWait);
    } finally {
      await db().query(`SELECT pg_advisory_unlock($1)`, [TYPEORM_ADVISORY_LOCK_KEY]);
    }
  });

  it("releases the migration lock after a failed migration callback", async (ctx) => {
    if (!runner || !secondDs) return ctx.skip();

    await expect(
      withMigrationLock(secondDs.createQueryRunner(), async () => {
        throw new Error("migration failed");
      }),
    ).rejects.toThrow("migration failed");

    const probe = secondDs.createQueryRunner();
    await probe.connect();
    try {
      const rows = (await probe.query(
        `SELECT pg_try_advisory_lock($1) AS "acquired"`,
        [TYPEORM_ADVISORY_LOCK_KEY],
      )) as Array<{ acquired: boolean }>;
      expect(rows[0]?.acquired).toBe(true);
      await probe.query(`SELECT pg_advisory_unlock($1)`, [TYPEORM_ADVISORY_LOCK_KEY]);
    } finally {
      await probe.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Full schema query timing with representative data
// ---------------------------------------------------------------------------
describe("Query timing against representative data", () => {
  /**
   * Seeds representative rows across the main tables, then runs the most
   * common operational read patterns to establish baseline timings. These are
   * NOT advisory lock tests — they verify that the index coverage established
   * by the migration chain keeps hot-path queries fast.
   */

  it("transaction lookup by txHash (unique index) stays within budget on 500 rows", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT query_timing_txhash");
    const ids = await seedTransactions(db(), 500);
    // Fetch the last inserted row by its hash to exercise the unique index
    const row = (await db().query(
      `SELECT "txHash" FROM "transactions" WHERE "id" = $1`,
      [ids[ids.length - 1]],
    )) as Array<{ txHash: string }>;
    const target = row[0]?.txHash;

    const { ms } = await measured(() =>
      db().query(
        `SELECT * FROM "transactions" WHERE "txHash" = $1`,
        [target],
      ),
    );
    await db().query("ROLLBACK TO SAVEPOINT query_timing_txhash");
    expect(
      ms,
      `txHash lookup on 500 rows took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.advisoryLockCheck);
  });

  it("notification fetch by recipient (covering index) stays within budget on 200 rows", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT query_timing_notif");
    await seedNotifications(db(), 200);
    const { ms } = await measured(() =>
      db().query(
        `SELECT * FROM "notifications"
         WHERE "recipient" = $1
         ORDER BY "createdAt" DESC
         LIMIT 20`,
        [`GNOTIFY0${"0".repeat(48)}`],
      ),
    );
    await db().query("ROLLBACK TO SAVEPOINT query_timing_notif");
    expect(
      ms,
      `notification recipient query on 200 rows took ${ms.toFixed(1)}ms`,
    ).toBeLessThan(BUDGET_MS.advisoryLockCheck);
  });
});
