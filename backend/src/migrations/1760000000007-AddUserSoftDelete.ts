import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddUserSoftDelete1760000000007
 *
 * Soft-delete marker for user-owned records (#1333). Only `users` gets this
 * column — `transactions` and `audit_log` are financial/audit history and
 * must never be soft-deletable, so this migration does not touch them.
 */
export class AddUserSoftDelete1760000000007 implements MigrationInterface {
  name = "AddUserSoftDelete1760000000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD "deletedAt" TIMESTAMPTZ
    `);

    // Lookups filter on deletedAt IS NULL on essentially every read path
    // (login, /me, public profile lookup), so index it.
    await queryRunner.query(`
      CREATE INDEX "IDX_users_deleted_at" ON "users" ("deletedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
  }
}
