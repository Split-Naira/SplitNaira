import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddNotificationPreferences1760000000007
 *
 * Persists participant notification preferences (#1327).
 *
 * The `NotificationPreference` entity and its service landed with #1307, but no
 * migration ever created the table on databases that had already run
 * AddSplitLifecycle1760000000006 before it included preferences: reads
 * silently degraded to "no rows saved" and every write failed on a missing
 * relation, so opting out was impossible beyond the lifetime of a request.
 *
 * AddSplitLifecycle now creates the same objects, so on a fresh database this
 * migration would fail with "type ... already exists". Every statement here is
 * therefore idempotent: it creates the enum, table and indexes only when they
 * are missing, and reuses the unique index AddSplitLifecycle already created
 * instead of adding a duplicate.
 *
 * The unique index is load-bearing rather than decorative. The service saves
 * with `upsert(..., ["wallet", "category"])`, which compiles to
 * `ON CONFLICT ("wallet", "category")`; Postgres rejects that target unless a
 * unique index covers exactly those columns, so a plain index would make every
 * preference save raise
 * "there is no unique or exclusion constraint matching the ON CONFLICT specification".
 */
export class AddNotificationPreferences1760000000007
  implements MigrationInterface
{
  name = "AddNotificationPreferences1760000000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Deliberately a separate type from `notification_category_enum`: the two
    // vocabularies differ (delivery groups "project"/"participant", preferences
    // group "project_activity"/"participant_activity"), and sharing one enum
    // would let a preference be written for a category that is never delivered.
    // Postgres has no CREATE TYPE IF NOT EXISTS, so swallow duplicate_object.
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "notification_preference_category_enum" AS ENUM (
          'security', 'payment', 'project_activity', 'participant_activity', 'marketing'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "wallet" character varying(128) NOT NULL,
        "category" "notification_preference_category_enum" NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id")
      )
    `);

    // AddSplitLifecycle names this index IDX_..., this migration used UQ_...
    // Create it only when neither exists, so there is exactly one unique index.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'notification_preferences'
            AND indexname IN (
              'IDX_notification_preferences_wallet_category',
              'UQ_notification_preferences_wallet_category'
            )
        ) THEN
          CREATE UNIQUE INDEX "UQ_notification_preferences_wallet_category"
            ON "notification_preferences" ("wallet", "category");
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_preferences_wallet"
        ON "notification_preferences" ("wallet")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS everywhere: AddSplitLifecycle owns the same objects on fresh
    // databases and its own down() drops them too.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_preferences_wallet"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_notification_preferences_wallet_category"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_preferences_wallet_category"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "notification_preference_category_enum"`,
    );
  }
}