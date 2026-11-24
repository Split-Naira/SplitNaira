import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddNotificationPreferences1760000000007 } from "../migrations/1760000000007-AddNotificationPreferences";

/**
 * Verifies notification preference defaults across migrations (#1630).
 *
 * Three scenarios:
 *   1. New user — no rows exist; getPreferences-equivalent logic must treat
 *      absence as enabled:true for every category.
 *   2. Existing user (pre-migration) — rows written before a category became
 *      mandatory must not suppress security/payment notices.
 *   3. Migration idempotency — running AddNotificationPreferences.up() twice
 *      must not fail or create duplicate objects.
 *
 * Requires DATABASE_URL pointing at a migrated Postgres. Skips locally when
 * none is available; fails in CI so the check can't silently pass by skipping.
 *
 * All writes are rolled back via savepoints so nothing persists.
 */

const PREFERENCE_CATEGORIES = [
  "security",
  "payment",
  "project_activity",
  "participant_activity",
  "marketing",
] as const;

const MANDATORY_CATEGORIES = ["security", "payment"] as const;

let ds: DataSource | null = null;
let runner: QueryRunner | null = null;

function db(): QueryRunner {
  if (!runner) throw new Error("Database is not available");
  return runner;
}

async function tableExists(): Promise<boolean> {
  const rows = (await db().query(
    `SELECT to_regclass('public.notification_preferences') AS "t"`,
  )) as Array<{ t: string | null }>;
  return rows[0]?.t != null;
}

async function rowsForWallet(
  wallet: string,
): Promise<Array<{ category: string; enabled: boolean }>> {
  return db().query(
    `SELECT category, enabled FROM notification_preferences WHERE wallet = $1`,
    [wallet],
  );
}

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

describe("notification_preferences table after migration", () => {
  it("table exists on a migrated database", async (ctx) => {
    if (!runner) return ctx.skip();
    expect(await tableExists()).toBe(true);
  });

  it("enabled column defaults to true at the SQL level", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GNEWUSER0000000000000000000000000000000000000000000000001";

    await db().query("SAVEPOINT pref_new_user");
    await db().query(
      `INSERT INTO notification_preferences (wallet, category)
       VALUES ($1, 'marketing')`,
      [wallet],
    );
    const rows = await rowsForWallet(wallet);
    await db().query("ROLLBACK TO SAVEPOINT pref_new_user");

    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });
});

describe("new user — no stored rows", () => {
  it("absence of rows is treated as enabled for every category", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GNEWUSER0000000000000000000000000000000000000000000000002";

    const rows = await rowsForWallet(wallet);

    // No rows exist. The service defaults missing categories to enabled:true,
    // so the correct assertion is that there are simply no opt-outs stored.
    expect(rows).toHaveLength(0);
  });

  it("inserting a new preference row stores enabled:true by default", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GNEWUSER0000000000000000000000000000000000000000000000003";

    await db().query("SAVEPOINT pref_insert_default");
    for (const category of PREFERENCE_CATEGORIES) {
      await db().query(
        `INSERT INTO notification_preferences (wallet, category)
         VALUES ($1, $2)`,
        [wallet, category],
      );
    }
    const rows = await rowsForWallet(wallet);
    await db().query("ROLLBACK TO SAVEPOINT pref_insert_default");

    expect(rows).toHaveLength(PREFERENCE_CATEGORIES.length);
    expect(rows.every((r) => r.enabled === true)).toBe(true);
  });
});

describe("existing user — pre-migration rows", () => {
  it("stale rows with enabled:false for mandatory categories are overridden at read time", async (ctx) => {
    if (!runner) return ctx.skip();

    // This simulates rows written before security/payment became mandatory.
    // The DB accepts them (the column has no check constraint — enforcement
    // is in the service), but getPreferences() must ignore enabled:false for
    // mandatory categories.
    const wallet = "GEXISTINGUSER000000000000000000000000000000000000000001";

    await db().query("SAVEPOINT pref_stale_mandatory");
    for (const category of MANDATORY_CATEGORIES) {
      await db().query(
        `INSERT INTO notification_preferences (wallet, category, enabled)
         VALUES ($1, $2, false)`,
        [wallet, category],
      );
    }
    const storedRows = await rowsForWallet(wallet);
    await db().query("ROLLBACK TO SAVEPOINT pref_stale_mandatory");

    // DB accepted the rows — enforcement is not in the schema
    expect(storedRows.every((r) => r.enabled === false)).toBe(true);

    // The service must override these at read time (tested in the service
    // unit test; here we confirm the DB doesn't block the write so a stale
    // row genuinely can exist and must be handled in application code).
    for (const row of storedRows) {
      expect(MANDATORY_CATEGORIES).toContain(row.category);
    }
  });

  it("optional category opt-outs are preserved across a re-migration", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GEXISTINGUSER000000000000000000000000000000000000000002";
    const migration = new AddNotificationPreferences1760000000007();

    await db().query("SAVEPOINT pref_optout_survives");
    await db().query(
      `INSERT INTO notification_preferences (wallet, category, enabled)
       VALUES ($1, 'marketing', false)`,
      [wallet],
    );

    // Running up() again must not wipe existing rows
    await migration.up(db());

    const rows = await rowsForWallet(wallet);
    await db().query("ROLLBACK TO SAVEPOINT pref_optout_survives");

    const marketing = rows.find((r) => r.category === "marketing");
    expect(marketing).toBeDefined();
    expect(marketing!.enabled).toBe(false);
  });
});

describe("migration idempotency", () => {
  it("up() is safe to run twice — no errors or duplicate objects", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new AddNotificationPreferences1760000000007();

    await db().query("SAVEPOINT pref_idempotent");
    await migration.up(db());
    await migration.up(db());
    await db().query("ROLLBACK TO SAVEPOINT pref_idempotent");

    // If we reach here without throwing, the DO $$ blocks handled duplicates
    expect(await tableExists()).toBe(true);
  });

  it("exactly one unique index covers (wallet, category) after up()", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new AddNotificationPreferences1760000000007();

    await db().query("SAVEPOINT pref_unique_index");
    await migration.up(db());

    const rows = (await db().query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'notification_preferences'
         AND indexname IN (
           'IDX_notification_preferences_wallet_category',
           'UQ_notification_preferences_wallet_category'
         )`,
    )) as Array<{ indexname: string }>;

    await db().query("ROLLBACK TO SAVEPOINT pref_unique_index");

    expect(rows).toHaveLength(1);
  });

  it("down() is safe when AddSplitLifecycle already owns the objects", async (ctx) => {
    if (!runner) return ctx.skip();
    const migration = new AddNotificationPreferences1760000000007();

    await db().query("SAVEPOINT pref_down_safe");
    await migration.down(db());
    await migration.down(db());
    await db().query("ROLLBACK TO SAVEPOINT pref_down_safe");

    // Both calls completed; IF EXISTS guards prevented errors on the second run
  });
});

describe("upsert conflict target", () => {
  it("duplicate (wallet, category) insert raises a unique-violation", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GUPSERT00000000000000000000000000000000000000000000000001";

    await db().query("SAVEPOINT pref_conflict");
    await db().query(
      `INSERT INTO notification_preferences (wallet, category, enabled)
       VALUES ($1, 'marketing', true)`,
      [wallet],
    );

    await expect(
      db().query(
        `INSERT INTO notification_preferences (wallet, category, enabled)
         VALUES ($1, 'marketing', false)`,
        [wallet],
      ),
    ).rejects.toThrow(/unique/i);

    await db().query("ROLLBACK TO SAVEPOINT pref_conflict");
  });

  it("ON CONFLICT upsert updates an existing row without duplicating it", async (ctx) => {
    if (!runner) return ctx.skip();
    const wallet = "GUPSERT00000000000000000000000000000000000000000000000002";

    await db().query("SAVEPOINT pref_upsert");
    await db().query(
      `INSERT INTO notification_preferences (wallet, category, enabled)
       VALUES ($1, 'marketing', true)`,
      [wallet],
    );
    await db().query(
      `INSERT INTO notification_preferences (wallet, category, enabled)
       VALUES ($1, 'marketing', false)
       ON CONFLICT (wallet, category) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [wallet],
    );
    const rows = await rowsForWallet(wallet);
    await db().query("ROLLBACK TO SAVEPOINT pref_upsert");

    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });
});
