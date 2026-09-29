import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Issue #1339: `transactions` rows are append-only financial records.
 * Needs a migrated Postgres (DATABASE_URL). Skips locally when none is
 * reachable; fails in CI so it can never pass by skipping.
 */
const TEST_PREFIX = "immutability-test-";
const TRIGGER = "trg_transactions_immutable";

const SAMPLE = {
  roundId: "round-immutable-1",
  recipient: "GRECIPIENTIMMUTABLETEST",
  amount: "1000000",
  token: "Native",
  timestamp: 1_760_000_000,
};

const PROTECTED_UPDATES: Array<[string, string]> = [
  ["id", "uuid_generate_v4()"],
  ["roundId", "'other-round'"],
  ["recipient", "'GSOMEONEELSE'"],
  ["amount", "'999'"],
  ["token", "'other-token'"],
  ["timestamp", "1"],
  ["txHash", "'immutability-test-changed'"],
];

let ds: DataSource | null = null;

function db(): DataSource {
  if (!ds) throw new Error("Database is not available");
  return ds;
}

async function insertRecord(): Promise<{ id: string; txHash: string }> {
  const txHash = `${TEST_PREFIX}${randomUUID()}`;
  const rows = (await db().query(
    `INSERT INTO "transactions"
       ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING "id"`,
    [SAMPLE.roundId, SAMPLE.recipient, SAMPLE.amount, SAMPLE.token, SAMPLE.timestamp, txHash],
  )) as Array<{ id: string }>;
  return { id: rows[0].id, txHash };
}

async function readRecord(id: string): Promise<Record<string, unknown>> {
  const rows = (await db().query(`SELECT * FROM "transactions" WHERE "id" = $1`, [id])) as Array
    Record<string, unknown>
  >;
  return rows[0];
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.CI) throw new Error("DATABASE_URL is required in CI");
    return;
  }
  const candidate = new DataSource({ type: "postgres", url });
  try {
    await candidate.initialize();
  } catch (error) {
    if (process.env.CI) throw error;
    return;
  }
  ds = candidate;
});

afterAll(async () => {
  if (!ds) return;
  // Rows are undeletable by design, so cleanup briefly disables the trigger
  // inside one transaction and restores it before committing.
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`ALTER TABLE "transactions" DISABLE TRIGGER "${TRIGGER}"`);
    await runner.query(`DELETE FROM "transactions" WHERE "txHash" LIKE $1`, [`${TEST_PREFIX}%`]);
    await runner.query(`ALTER TABLE "transactions" ENABLE TRIGGER "${TRIGGER}"`);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await ds.destroy();
    ds = null;
  }
});

describe("immutable transactions table", () => {
  it.each(PROTECTED_UPDATES)("rejects changing %s", async (column, expression) => {
    if (!ds) return;
    const { id } = await insertRecord();
    await expect(
      db().query(`UPDATE "transactions" SET "${column}" = ${expression} WHERE "id" = $1`, [id]),
    ).rejects.toThrow(/immutable/i);
  });

  it("keeps the original values after rejected updates", async () => {
    if (!ds) return;
    const { id } = await insertRecord();
    const before = await readRecord(id);

    for (const [column, expression] of PROTECTED_UPDATES) {
      await expect(
        db().query(`UPDATE "transactions" SET "${column}" = ${expression} WHERE "id" = $1`, [id]),
      ).rejects.toThrow();
    }

    expect(await readRecord(id)).toEqual(before);
  });

  it("rejects deleting a record", async () => {
    if (!ds) return;
    const { id } = await insertRecord();
    await expect(db().query(`DELETE FROM "transactions" WHERE "id" = $1`, [id])).rejects.toThrow(
      /immutable/i,
    );
    expect(await readRecord(id)).toBeDefined();
  });

  it("does not partially apply an update that touches a protected column", async () => {
    if (!ds) return;
    const { id } = await insertRecord();
    await expect(
      db().query(`UPDATE "transactions" SET "status" = 'completed', "amount" = '5' WHERE "id" = $1`, [id]),
    ).rejects.toThrow(/immutable/i);
    expect((await readRecord(id)).status).toBe("pending");
  });

  it("still allows status to move from pending to completed", async () => {
    if (!ds) return;
    const { id } = await insertRecord();
    await db().query(`UPDATE "transactions" SET "status" = 'completed' WHERE "id" = $1`, [id]);
    expect((await readRecord(id)).status).toBe("completed");
  });

  it("still allows a no-op upsert of identical data (event listener path)", async () => {
    if (!ds) return;
    const { txHash } = await insertRecord();
    await db().query(
      `INSERT INTO "transactions"
         ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT ("txHash") DO UPDATE SET
         "roundId" = EXCLUDED."roundId", "recipient" = EXCLUDED."recipient",
         "amount" = EXCLUDED."amount", "token" = EXCLUDED."token",
         "timestamp" = EXCLUDED."timestamp", "status" = EXCLUDED."status"`,
      [SAMPLE.roundId, SAMPLE.recipient, SAMPLE.amount, SAMPLE.token, SAMPLE.timestamp, txHash],
    );
  });

  it("rejects an upsert that would change the amount of an existing record", async () => {
    if (!ds) return;
    const { txHash } = await insertRecord();
    await expect(
      db().query(
        `INSERT INTO "transactions"
           ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
         VALUES ($1, $2, '1', $3, $4, $5, 'pending')
         ON CONFLICT ("txHash") DO UPDATE SET "amount" = EXCLUDED."amount"`,
        [SAMPLE.roundId, SAMPLE.recipient, SAMPLE.token, SAMPLE.timestamp, txHash],
      ),
    ).rejects.toThrow(/immutable/i);
  });
});