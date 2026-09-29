import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Issue #1336: foreign-key integrity audit. See docs/foreign-key-integrity-audit.md.
 *
 * Every reference-like column in this schema points at on-chain state or at a
 * wallet address, none of which has a local parent table, so no foreign keys
 * exist today. These tests pin that decision and check the integrity rules the
 * schema does enforce.
 *
 * Runs against a migrated Postgres (DATABASE_URL) inside one transaction that
 * is rolled back at the end, so nothing persists. Skips locally when no
 * database is reachable; fails in CI so it can never pass by skipping.
 */

// Foreign keys that are documented in docs/foreign-key-integrity-audit.md,
// as "table.constraint_name". Add an entry here when (and only when) a
// migration introduces one deliberately.
const DOCUMENTED_FOREIGN_KEYS: string[] = [];

const UNIQUE_VIOLATION = "23505";

let ds: DataSource | null = null;
let runner: QueryRunner | null = null;

function db(): QueryRunner {
  if (!runner) throw new Error("Database is not available");
  return runner;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = (await db().query(sql, params)) as Array<{ count: string }>;
  return Number(rows[0]?.count ?? 0);
}

// A failed statement aborts the surrounding Postgres transaction, so each
// expected failure runs inside a savepoint that is rolled back afterwards.
async function expectUniqueViolation(sql: string, params: unknown[]): Promise<void> {
  await db().query("SAVEPOINT integrity_check");
  let code: string | undefined;
  try {
    await db().query(sql, params);
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  await db().query("ROLLBACK TO SAVEPOINT integrity_check");
  expect(code).toBe(UNIQUE_VIOLATION);
}

function wallet(): string {
  return `GINTEGRITY${randomUUID()}`;
}

const INSERT_TRANSACTION = `
  INSERT INTO "transactions"
    ("roundId", "recipient", "amount", "token", "timestamp", "txHash", "status")
  VALUES ($1, $2, '1', 'Native', 1760000000, $3, 'pending')`;

const INSERT_NOTIFICATION = `
  INSERT INTO "notifications"
    ("recipient", "category", "title", "body", "eventKey", "source")
  VALUES ($1, 'system', 'title', 'body', $2, 'integrity-test')`;

const INSERT_PREFERENCE = `
  INSERT INTO "notification_preferences" ("wallet", "category", "enabled")
  VALUES ($1, 'marketing', true)`;

const INSERT_CANCELLATION = `
  INSERT INTO "split_cancellations" ("projectId", "cancelledBy")
  VALUES ($1, $2)`;

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
  runner = candidate.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
});

afterAll(async () => {
  if (runner) {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
    runner = null;
  }
  if (ds) {
    await ds.destroy();
    ds = null;
  }
});

describe("foreign-key integrity audit (#1336)", () => {
  describe("schema", () => {
    it("has no foreign key constraints beyond the documented list", async () => {
      if (!ds) return;
      const rows = (await db().query(
        `SELECT conrelid::regclass::text AS "table", conname
           FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace
          ORDER BY 1, 2`,
      )) as Array<{ table: string; conname: string }>;
      const found = rows.map((row) => `${row.table}.${row.conname}`);
      expect(
        found,
        "A foreign key exists that is not in DOCUMENTED_FOREIGN_KEYS. " +
          "Document it in docs/foreign-key-integrity-audit.md and add it to this test.",
      ).toEqual(DOCUMENTED_FOREIGN_KEYS);
    });

    it("gives every table a primary key", async () => {
      if (!ds) return;
      const rows = (await db().query(
        `SELECT c.relname AS "table"
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'p'
            )
          ORDER BY 1`,
      )) as Array<{ table: string }>;
      expect(rows.map((row) => row.table)).toEqual([]);
    });
  });

  describe("wallet and on-chain references are intentionally not foreign keys", () => {
    it("accepts a transaction for a wallet that is not a registered user", async () => {
      if (!ds) return;
      const recipient = wallet();
      expect(await count(`SELECT count(*) FROM "users" WHERE "walletAddress" = $1`, [recipient])).toBe(0);
      await db().query(INSERT_TRANSACTION, ["round-with-no-local-parent", recipient, `tx-${randomUUID()}`]);
      expect(await count(`SELECT count(*) FROM "transactions" WHERE "recipient" = $1`, [recipient])).toBe(1);
    });

    it("accepts a notification for a wallet that is not a registered user", async () => {
      if (!ds) return;
      const recipient = wallet();
      await db().query(INSERT_NOTIFICATION, [recipient, `event-${randomUUID()}`]);
      expect(await count(`SELECT count(*) FROM "notifications" WHERE "recipient" = $1`, [recipient])).toBe(1);
    });

    it("accepts a notification preference for a wallet that is not a registered user", async () => {
      if (!ds) return;
      const owner = wallet();
      await db().query(INSERT_PREFERENCE, [owner]);
      expect(await count(`SELECT count(*) FROM "notification_preferences" WHERE "wallet" = $1`, [owner])).toBe(1);
    });

    it("accepts a cancellation for an on-chain project with no local parent row", async () => {
      if (!ds) return;
      const projectId = `project-${randomUUID()}`;
      await db().query(INSERT_CANCELLATION, [projectId, wallet()]);
      expect(await count(`SELECT count(*) FROM "split_cancellations" WHERE "projectId" = $1`, [projectId])).toBe(1);
    });
  });

  describe("uniqueness the database enforces", () => {
    it("rejects a second transaction with the same txHash", async () => {
      if (!ds) return;
      const txHash = `tx-${randomUUID()}`;
      await db().query(INSERT_TRANSACTION, ["round-1", wallet(), txHash]);
      await expectUniqueViolation(INSERT_TRANSACTION, ["round-2", wallet(), txHash]);
    });

    it("rejects a second cancellation for the same project", async () => {
      if (!ds) return;
      const projectId = `project-${randomUUID()}`;
      await db().query(INSERT_CANCELLATION, [projectId, wallet()]);
      await expectUniqueViolation(INSERT_CANCELLATION, [projectId, wallet()]);
    });

    it("rejects a duplicate notification event for one recipient but not for another", async () => {
      if (!ds) return;
      const eventKey = `event-${randomUUID()}`;
      const first = wallet();
      await db().query(INSERT_NOTIFICATION, [first, eventKey]);
      await expectUniqueViolation(INSERT_NOTIFICATION, [first, eventKey]);
      await db().query(INSERT_NOTIFICATION, [wallet(), eventKey]);
    });

    it("rejects a duplicate (wallet, category) preference but not another wallet", async () => {
      if (!ds) return;
      const owner = wallet();
      await db().query(INSERT_PREFERENCE, [owner]);
      await expectUniqueViolation(INSERT_PREFERENCE, [owner]);
      await db().query(INSERT_PREFERENCE, [wallet()]);
    });

    it("rejects a second user with the same walletAddress", async () => {
      if (!ds) return;
      const walletAddress = wallet();
      const insertUser = `INSERT INTO "users" ("walletAddress") VALUES ($1)`;
      await db().query(insertUser, [walletAddress]);
      await expectUniqueViolation(insertUser, [walletAddress]);
    });
  });
});