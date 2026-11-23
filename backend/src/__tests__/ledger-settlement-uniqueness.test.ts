import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AddLedgerSettlementTxHashUniqueness1760000000018 } from "../migrations/1760000000018-AddLedgerSettlementTxHashUniqueness";
import { LedgerBlock } from "../entities/LedgerBlock.js";
import {
  SETTLEMENT_UNIQUE_INDEX,
  SettlementConflictError,
  recordSettlement,
  type SettlementInput,
} from "../services/ledger-settlement.js";

/**
 * Issue #1641: database uniqueness for ledger settlement references.
 *
 * Proves, against a real migrated Postgres, that concurrent writers on
 * separate connections cannot create two `settlement` ledger entries (or two
 * payout records) for one transaction hash. Every test uses its own random
 * txHash prefix and removes its ledger rows afterwards; payout (`transactions`)
 * rows are immutable, so those tests only ever roll back.
 *
 * Skips locally when no database is reachable; fails in CI so it can never
 * pass by skipping.
 */

const UNIQUE_VIOLATION = "23505";
const WRITERS = 8;
const RUN_PREFIX = `tst1641-${randomUUID().slice(0, 8)}`;

let ds: DataSource | null = null;

function db(): DataSource {
  if (!ds) throw new Error("Database is not available");
  return ds;
}

function txHash(label: string): string {
  return `${RUN_PREFIX}-${label}-${randomUUID()}`;
}

function settlement(hash: string, overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    txHash: hash,
    ledgerSeq: 4242,
    ledgerClosedAt: new Date("2026-01-01T00:00:00.000Z"),
    projectId: "project_1641",
    recipient: "GRECIPIENT1641",
    amount: "125.5000001",
    ...overrides,
  };
}

const INSERT_BLOCK = `
  INSERT INTO "ledger_blocks" ("ledgerSeq", "txHash", "type", "projectId", "recipient", "amount", "ledgerClosedAt")
  VALUES ($1, $2, $3, 'project_1641', 'GRECIPIENT1641', $4, now())`;

async function countBlocks(hash: string, type: "settlement" | "milestone"): Promise<number> {
  const rows = (await db().query(
    `SELECT count(*)::int AS "n" FROM "ledger_blocks" WHERE "txHash" = $1 AND "type" = $2`,
    [hash, type],
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Runs `fn` on a dedicated connection, so callers really race in Postgres. */
async function onOwnConnection<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = db().createQueryRunner();
  await runner.connect();
  try {
    return await fn(runner);
  } finally {
    await runner.release();
  }
}

function errorCode(error: unknown): string | undefined {
  const err = error as { code?: string; driverError?: { code?: string } };
  return err.code ?? err.driverError?.code;
}

describe("ledger settlement uniqueness (#1641)", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || !/^postgres(ql)?:\/\//.test(url)) {
      if (process.env.CI) throw new Error("A postgres DATABASE_URL is required in CI");
      return;
    }
    try {
      ds = new DataSource({
        type: "postgres",
        url,
        entities: [LedgerBlock],
        extra: { max: WRITERS + 2 },
      });
      await ds.initialize();
    } catch (error) {
      if (process.env.CI) throw error;
      ds = null;
    }
  });

  afterEach(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM "ledger_blocks" WHERE "txHash" LIKE $1`, [`${RUN_PREFIX}-%`]);
    }
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it("has a unique, settlement-only index on ledger_blocks.txHash", async (ctx) => {
    if (!ds) return ctx.skip();
    const rows = (await db().query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'ledger_blocks' AND indexname = $1`,
      [SETTLEMENT_UNIQUE_INDEX],
    )) as Array<{ indexdef: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/\("txHash"\)/);
    expect(rows[0].indexdef).toMatch(/WHERE \(type = 'settlement'::ledger_blocks_type_enum\)/);
  });

  it("concurrent raw inserts of one settlement: exactly one commits, the rest get 23505", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("raw");
    const results = await Promise.allSettled(
      Array.from({ length: WRITERS }, () =>
        onOwnConnection((runner) => runner.query(INSERT_BLOCK, [4242, hash, "settlement", "10"])),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(WRITERS - 1);
    for (const r of rejected) expect(errorCode(r.reason)).toBe(UNIQUE_VIOLATION);
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("a second writer blocks on the first uncommitted settlement and fails once it commits", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("blocking");
    const first = db().createQueryRunner();
    const second = db().createQueryRunner();
    await first.connect();
    await second.connect();
    try {
      await first.startTransaction();
      await second.startTransaction();
      await first.query(INSERT_BLOCK, [1, hash, "settlement", "10"]);

      let settled = false;
      const racing = second.query(INSERT_BLOCK, [1, hash, "settlement", "10"]).finally(() => {
        settled = true;
      });
      // The unique index makes the second insert wait for the first transaction.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled).toBe(false);

      await first.commitTransaction();
      await expect(racing).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
      await second.rollbackTransaction();
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();
      if (second.isTransactionActive) await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("if the first writer rolls back, the waiting writer's settlement wins (no lost write, no duplicate)", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("rollback");
    const first = db().createQueryRunner();
    const second = db().createQueryRunner();
    await first.connect();
    await second.connect();
    try {
      await first.startTransaction();
      await second.startTransaction();
      await first.query(INSERT_BLOCK, [1, hash, "settlement", "10"]);
      const racing = second.query(INSERT_BLOCK, [1, hash, "settlement", "10"]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await first.rollbackTransaction();
      await expect(racing).resolves.toBeDefined();
      await second.commitTransaction();
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();
      if (second.isTransactionActive) await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("recordSettlement is idempotent under concurrency: one row, one creator, same id for all", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("service");
    const input = settlement(hash);
    const results = await Promise.all(
      Array.from({ length: WRITERS }, () => recordSettlement(db(), input)),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.block.id));
    expect(ids.size).toBe(1);
    for (const r of results) expect(r.block.amount).toBe("125.5000001");
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("a repeated write with an equal amount in a different canonical form is still idempotent", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("canonical");
    await recordSettlement(db(), settlement(hash, { amount: "100.5" }));
    const again = await recordSettlement(db(), settlement(hash, { amount: "100.5000000" }));
    expect(again.created).toBe(false);
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("conflicting concurrent settlements for one txHash never both persist", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("conflict");
    const results = await Promise.allSettled([
      recordSettlement(db(), settlement(hash, { amount: "1" })),
      recordSettlement(db(), settlement(hash, { amount: "2" })),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(SettlementConflictError);
    expect((rejected[0].reason as SettlementConflictError).field).toBe("amount");
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("rejects a later settlement that disagrees on recipient or ledger", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("fields");
    await recordSettlement(db(), settlement(hash));
    await expect(recordSettlement(db(), settlement(hash, { recipient: "GOTHER" }))).rejects.toMatchObject({
      field: "recipient",
    });
    await expect(recordSettlement(db(), settlement(hash, { ledgerSeq: 1 }))).rejects.toMatchObject({
      field: "ledgerSeq",
    });
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("rejects invalid amounts before touching the database", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("invalid");
    await expect(recordSettlement(db(), settlement(hash, { amount: "-1" }))).rejects.toThrow(
      /not a valid ledger amount/,
    );
    expect(await countBlocks(hash, "settlement")).toBe(0);
  });

  it("distinct transactions settle concurrently without interference", async (ctx) => {
    if (!ds) return ctx.skip();
    const hashes = Array.from({ length: WRITERS }, (_, i) => txHash(`distinct${i}`));
    const results = await Promise.all(hashes.map((h) => recordSettlement(db(), settlement(h))));
    expect(results.every((r) => r.created)).toBe(true);
    for (const h of hashes) expect(await countBlocks(h, "settlement")).toBe(1);
  });

  it("milestone entries may share a txHash with each other and with its settlement", async (ctx) => {
    if (!ds) return ctx.skip();
    const hash = txHash("milestone");
    await onOwnConnection(async (runner) => {
      await runner.query(INSERT_BLOCK, [1, hash, "milestone", null]);
      await runner.query(INSERT_BLOCK, [2, hash, "milestone", null]);
      await runner.query(INSERT_BLOCK, [3, hash, "settlement", "5"]);
    });
    expect(await countBlocks(hash, "milestone")).toBe(2);
    expect(await countBlocks(hash, "settlement")).toBe(1);
  });

  it("concurrent payout records for one txHash: the second writer waits, then cannot duplicate", async (ctx) => {
    if (!ds) return ctx.skip();
    // transactions rows are immutable (no DELETE), so nothing here commits.
    const hash = txHash("payout");
    const insert = `
      INSERT INTO "transactions" ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
      VALUES ('round-1641', 'GRECIPIENT1641', '10', 'Native', 1760000000, $1, 'pending')`;
    const first = db().createQueryRunner();
    const second = db().createQueryRunner();
    await first.connect();
    await second.connect();
    try {
      await first.startTransaction();
      await second.startTransaction();
      await first.query(insert, [hash]);

      let settled = false;
      const racing = second.query(insert, [hash]).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled).toBe(false);

      // Within the first writer's own transaction a duplicate is rejected outright.
      await first.query("SAVEPOINT dup");
      await expect(first.query(insert, [hash])).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
      await first.query("ROLLBACK TO SAVEPOINT dup");

      await first.rollbackTransaction();
      await expect(racing).resolves.toBeDefined();
      await second.rollbackTransaction();
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();
      if (second.isTransactionActive) await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
  });

  it("migration refuses to run over existing duplicate settlements and round-trips cleanly", async (ctx) => {
    if (!ds) return ctx.skip();
    const migration = new AddLedgerSettlementTxHashUniqueness1760000000018();
    const hash = txHash("migration");
    await onOwnConnection(async (runner) => {
      await runner.startTransaction();
      try {
        await migration.down(runner);
        await runner.query(INSERT_BLOCK, [1, hash, "settlement", "1"]);
        await runner.query(INSERT_BLOCK, [2, hash, "settlement", "1"]);
        await runner.query("SAVEPOINT refuse");
        await expect(migration.up(runner)).rejects.toThrow(/duplicate settlement ledger entries/);
        await runner.query("ROLLBACK TO SAVEPOINT refuse");

        await runner.query(`DELETE FROM "ledger_blocks" WHERE "txHash" = $1`, [hash]);
        await migration.up(runner);
        await migration.up(runner); // re-runnable
        await runner.query("SAVEPOINT after_up");
        await runner.query(INSERT_BLOCK, [1, hash, "settlement", "1"]);
        await expect(runner.query(INSERT_BLOCK, [2, hash, "settlement", "1"])).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
        });
        await runner.query("ROLLBACK TO SAVEPOINT after_up");
      } finally {
        await runner.rollbackTransaction();
      }
    });
    const rows = (await db().query(
      `SELECT count(*)::int AS "n" FROM pg_indexes WHERE tablename = 'ledger_blocks' AND indexname = $1`,
      [SETTLEMENT_UNIQUE_INDEX],
    )) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });
});
