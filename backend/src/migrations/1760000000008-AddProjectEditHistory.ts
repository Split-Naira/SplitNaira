import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectEditHistory1760000000008 implements MigrationInterface {
  name = "AddProjectEditHistory1760000000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_edit_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" character varying(64) NOT NULL,
        "actor" character varying(128) NOT NULL,
        "action" character varying(128) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "changes" jsonb,
        CONSTRAINT "PK_project_edit_history_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_edit_history_project_id" ON "project_edit_history" ("project_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_project_edit_history_project_id"`);
    await queryRunner.query(`DROP TABLE "project_edit_history"`);
  }
}
