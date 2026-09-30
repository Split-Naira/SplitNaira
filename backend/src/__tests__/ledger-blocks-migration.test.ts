import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateLedgerBlocks1760000000011 } from "../migrations/1760000000011-CreateLedgerBlocks";

/**
 * ledger_blocks must exist on a migrated database. Runs against a migrated
 * Postgres (DATABASE_URL) inside one transaction that is rolled back at the
 * end. Skips locally when no database is reachable; fails in CI.
 */

const EXPECTED_INDEXES = [
  "IDX_ledger_blocks_ledger_seq",
  "IDX_ledger_blocks_tx_hash",
  "IDX_ledger_blocks_project_id",
];

let ds: DataSource | null = null;
let runner: QueryRunner | null = null;

function db(): QueryRunner {
  if (!runner) throw new Error("Database is not available");
  return runner;
}

async function tableExists(): Promise<boolean> {
  const rows = (await db().query(
    `SELECT to_regclass('public.ledger_blocks') AS "t"`,
  )) as Array<{ t: string | null }>;
  return rows[0]?.t != null;
}

describe("ledger_blocks migration", () => {
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

  it("creates the table and its indexes on a migrated database", async (ctx) => {
    if (!runner) return ctx.skip();
    expect(await tableExists()).toBe(true);
    const rows = (await db().query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'ledger_blocks'`,
    )) as Array<{ indexname: string }>;
    expect(rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(EXPECTED_INDEXES));
  });

  it("up is safe to re-run", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new CreateLedgerBlocks1760000000011();
    await db().query("SAVEPOINT ledger_up");
    await migration.up(db());
    await migration.up(db());
    expect(await tableExists()).toBe(true);
    await db().query("ROLLBACK TO SAVEPOINT ledger_up");
  });

  it("down removes an empty table and up brings it back", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new CreateLedgerBlocks1760000000011();
    await db().query("SAVEPOINT ledger_down_empty");
    await migration.down(db());
    expect(await tableExists()).toBe(false);
    await migration.up(db());
    expect(await tableExists()).toBe(true);
    await db().query("ROLLBACK TO SAVEPOINT ledger_down_empty");
  });

  it("down never drops a table that holds rows", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new CreateLedgerBlocks1760000000011();
    await db().query("SAVEPOINT ledger_down_rows");
    await db().query(
      `INSERT INTO "ledger_blocks" ("ledgerSeq", "txHash", "type", "ledgerClosedAt")
       VALUES (1, $1, 'settlement', now())`,
      [`hash-${randomUUID()}`],
    );
    await migration.down(db());
    expect(await tableExists()).toBe(true);
    await db().query("ROLLBACK TO SAVEPOINT ledger_down_rows");
  });
});