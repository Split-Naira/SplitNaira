import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, type QueryRunner } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddUserSoftDelete1760000000007 } from "../migrations/1760000000007-AddUserSoftDelete";
import { AddUserSessionVersionAndEmailVerification1760000000012 } from "../migrations/1760000000012-AddUserSessionVersionAndEmailVerification";

let dataSource: DataSource | null = null;
let queryRunner: QueryRunner | null = null;

function db(): QueryRunner {
  if (!queryRunner) throw new Error("Database is not available");
  return queryRunner;
}

async function insertUser(): Promise<string> {
  const walletAddress = `G${randomUUID().replace(/-/g, "").padEnd(55, "0").slice(0, 55)}`;
  const rows = (await db().query(
    `INSERT INTO "users" ("walletAddress", "role", "isActive")
     VALUES ($1, 'user', true)
     RETURNING "id"`,
    [walletAddress],
  )) as Array<{ id: string }>;
  return rows[0].id;
}

describe("destructive user-data migration rollbacks", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.CI) throw new Error("DATABASE_URL is required in CI");
      return;
    }

    try {
      dataSource = new DataSource({ type: "postgres", url });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
    } catch (error) {
      if (process.env.CI) throw error;
      queryRunner = null;
      dataSource = null;
    }
  });

  afterAll(async () => {
    if (queryRunner) {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("refuses to remove soft-delete state from users", async (ctx) => {
    if (!queryRunner) return ctx.skip();
    await db().query("SAVEPOINT rollback_soft_delete");
    const userId = await insertUser();
    await db().query(
      `UPDATE "users" SET "deletedAt" = now() WHERE "id" = $1`,
      [userId],
    );

    await expect(
      new AddUserSoftDelete1760000000007().down(db()),
    ).rejects.toThrow('"users"."deletedAt" contains data');

    const rows = (await db().query(
      `SELECT "deletedAt" FROM "users" WHERE "id" = $1`,
      [userId],
    )) as Array<{ deletedAt: Date | null }>;
    expect(rows[0]?.deletedAt).not.toBeNull();
    await db().query("ROLLBACK TO SAVEPOINT rollback_soft_delete");
  });

  it("refuses to remove session-version and email-verification state", async (ctx) => {
    if (!queryRunner) return ctx.skip();
    await db().query("SAVEPOINT rollback_user_security");
    const userId = await insertUser();
    await db().query(
      `UPDATE "users"
       SET "sessionVersion" = 1, "emailVerifiedAt" = now()
       WHERE "id" = $1`,
      [userId],
    );

    await expect(
      new AddUserSessionVersionAndEmailVerification1760000000012().down(db()),
    ).rejects.toThrow("contains session or email-verification data");

    const rows = (await db().query(
      `SELECT "sessionVersion", "emailVerifiedAt" FROM "users" WHERE "id" = $1`,
      [userId],
    )) as Array<{ sessionVersion: number; emailVerifiedAt: Date | null }>;
    expect(rows[0]?.sessionVersion).toBe(1);
    expect(rows[0]?.emailVerifiedAt).not.toBeNull();
    await db().query("ROLLBACK TO SAVEPOINT rollback_user_security");
  });
});
