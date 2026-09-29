import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddSplitLifecycle1760000000006
 *
 * Off-chain split cancellation records (#1304) and per-participant
 * notification preferences (#1307).
 */
export class AddSplitLifecycle1760000000006 implements MigrationInterface {
  name = "AddSplitLifecycle1760000000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "split_cancellations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" character varying(128) NOT NULL,
        "cancelledBy" character varying(128) NOT NULL,
        "reason" character varying(500),
        "cancelledAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_split_cancellations" PRIMARY KEY ("id")
      )
    `);

    // One cancellation per split, enforced by the database rather than a
    // check-then-write that two concurrent requests can both pass.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_split_cancellations_project"
        ON "split_cancellations" ("projectId")
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_preference_category_enum" AS ENUM (
        'security', 'payment', 'project_activity', 'participant_activity', 'marketing'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "wallet" character varying(128) NOT NULL,
        "category" "notification_preference_category_enum" NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id")
      )
    `);

    // One row per (wallet, category) so an upsert has a conflict target and
    // a wallet cannot accumulate contradictory preferences for one category.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_notification_preferences_wallet_category"
        ON "notification_preferences" ("wallet", "category")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_preferences_wallet"
        ON "notification_preferences" ("wallet")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_preferences_wallet"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_preferences_wallet_category"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_preference_category_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_split_cancellations_project"`);
    await queryRunner.query(`DROP TABLE "split_cancellations"`);
  }
}
