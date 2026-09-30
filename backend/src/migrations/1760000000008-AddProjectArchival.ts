import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddProjectArchival1760000000008
 *
 * Off-chain project archival records (#1315), mirroring the
 * split_cancellations table added for #1304.
 */
export class AddProjectArchival1760000000008 implements MigrationInterface {
  name = "AddProjectArchival1760000000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_archivals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" character varying(128) NOT NULL,
        "archivedBy" character varying(128) NOT NULL,
        "reason" character varying(500),
        "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "restoredBy" character varying(128),
        "restoredAt" TIMESTAMPTZ,
        CONSTRAINT "PK_project_archivals" PRIMARY KEY ("id")
      )
    `);

    // Not unique: a project can be archived, restored, and archived again,
    // so this indexes the common "all archival events for a project" and
    // "current archival status" lookups without constraining row count.
    await queryRunner.query(`
      CREATE INDEX "IDX_project_archivals_project"
        ON "project_archivals" ("projectId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_project_archivals_project"`);
    await queryRunner.query(`DROP TABLE "project_archivals"`);
  }
}
