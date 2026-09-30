import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddFinancialAmountCheckConstraints1760000000010 } from "../migrations/1760000000010-AddFinancialAmountCheckConstraints";

/**
 * Issue #1337: database check constraint for financial amounts.
 *
 * Runs against a migrated Postgres (DATABASE_URL) inside one transaction that
 * is rolled back at the end, so nothing persists. Skips locally when no
 * database is reachable; fails in CI so it can never pass by skipping.
 */

const CHECK_VIOLATION = "23514";
const CHECK_NAME = "CHK_transactions_amount_valid";

const VALID_AMOUNTS = [
  "0",
  "1",
  "1000",
  "1000000",
  "100.00",
  "0.5",
  "0.0000001",
  "1234567.1234567",
  "170141183460469231731687303715884105727",
];

const INVALID_AMOUNTS = [
  "",
  "-1",
  "-0.5",
  "+1",
  "1.12345678",
  "abc",
  "1e6",
  "NaN",
  " 1",
  "1 ",
  "01",
  "1.",
  ".5",
  "1,000",
  "170141183460469231731687303715884105728",
  "1000000000000000000000000000000000000000",
];

const INSERT_TRANSACTION = `
  INSERT INTO "transactions"
    ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
  VALUES ($1, $2, $3, 'Native', 1760000000, $4, 'pending')`;

let ds: DataSource | null = null;
let runner: QueryRunner | null = null;

function db(): QueryRunner {
  if (!runner) throw new Error("Database is not available");
  return runner;
}

// A failed statement aborts the surrounding Postgres transaction, so each
// insert runs inside a savepoint that is always rolled back afterwards.
async function insertResultCode(amount: string): Promise<string | undefined> {
  await db().query("SAVEPOINT amount_check");
  let code: string | undefined;
  try {
    await db().query(INSERT_TRANSACTION, [
      `round-${randomUUID()}`,
      `GAMOUNT${randomUUID()}`,
      amount,
      `hash-${randomUUID()}`,
    ]);
  } catch (error) {
    code = (error as { code?: string }).code ?? "unknown";
  }
  await db().query("ROLLBACK TO SAVEPOINT amount_check");
  return code;
}

async function constraintCount(): Promise<number> {
  const rows = (await db().query(
    `SELECT count(*)::int AS "n" FROM pg_constraint
     WHERE conname = $1 AND conrelid = '"transactions"'::regclass`,
    [CHECK_NAME],
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

describe("transactions.amount check constraint (#1337)", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.CI) throw new Error("DATABASE_URL is required in CI");
      return;
    }
    try {
      ds = new DataSource({ type: "postgres", url });
      await ds.initialize();
      runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
    } catch (error) {
      if (process.env.CI) throw error;
      runner = null;
      ds = null;
    }
  });

  afterAll(async () => {
    if (runner) {
      await runner.rollbackTransaction();
      await runner.release();
    }
    if (ds?.isInitialized) await ds.destroy();
  });

  it("has the constraint on a migrated database", async (ctx) => {
    if (!runner) return ctx.skip();
    expect(await constraintCount()).toBe(1);
  });

  for (const amount of VALID_AMOUNTS) {
    it(`accepts ${JSON.stringify(amount)}`, async (ctx) => {
      if (!runner) return ctx.skip();
      expect(await insertResultCode(amount)).toBeUndefined();
    });
  }

  for (const amount of INVALID_AMOUNTS) {
    it(`rejects ${JSON.stringify(amount)}`, async (ctx) => {
      if (!runner) return ctx.skip();
      expect(await insertResultCode(amount)).toBe(CHECK_VIOLATION);
    });
  }

  it("migration refuses to run over existing invalid rows", async (ctx) => {
    if (!runner) return ctx.skip();
    await db().query("SAVEPOINT migration_check");
    await db().query(`ALTER TABLE "transactions" DROP CONSTRAINT "${CHECK_NAME}"`);
    await db().query(INSERT_TRANSACTION, [
      `round-${randomUUID()}`,
      `GAMOUNT${randomUUID()}`,
      "-5",
      `hash-${randomUUID()}`,
    ]);
    const migration = new AddFinancialAmountCheckConstraints1760000000010();
    await expect(migration.up(db())).rejects.toThrow(/invalid amount/);
    await db().query("ROLLBACK TO SAVEPOINT migration_check");
    expect(await constraintCount()).toBe(1);
  });

  it("migration up is re-runnable and down removes the constraint", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new AddFinancialAmountCheckConstraints1760000000010();
    await db().query("SAVEPOINT migration_roundtrip");
    await migration.down(db());
    expect(await constraintCount()).toBe(0);
    await migration.up(db());
    await migration.up(db());
    expect(await constraintCount()).toBe(1);
    await migration.down(db());
    expect(await constraintCount()).toBe(0);
    await db().query("ROLLBACK TO SAVEPOINT migration_roundtrip");
    expect(await constraintCount()).toBe(1);
  });
});