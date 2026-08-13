import { describe, expect, it } from "vitest";
import { resolveMigrationConfig } from "../../scripts/run-migration-dry-run.mjs";

describe("resolveMigrationConfig", () => {
  it("prefers isolated migration env vars over the general DATABASE_URL", () => {
    const config = resolveMigrationConfig({
      DATABASE_URL: "postgresql://prod:prod@prod.example.com:5432/production",
      MIGRATION_DRY_RUN_DATABASE_URL: "postgresql://ci:ci@localhost:5432/splitnaira_ci",
      MIGRATION_DRY_RUN_DATABASE_NAME: "splitnaira_ci",
      MIGRATION_DRY_RUN_ADMIN_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
    });

    expect(config.databaseUrl).toBe("postgresql://ci:ci@localhost:5432/splitnaira_ci");
    expect(config.adminConnectionString).toBe("postgresql://postgres:postgres@localhost:5432/postgres");
    expect(config.databaseName).toBe("splitnaira_ci");
  });

  it("builds a migration URL from CI DB_* variables when no explicit URL is provided", () => {
    const config = resolveMigrationConfig({
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_USERNAME: "splitnaira_test",
      DB_PASSWORD: "test_password_123",
      DB_NAME: "splitnaira_migration_test",
    });

    expect(config.databaseUrl).toBe(
      "postgresql://splitnaira_test:test_password_123@localhost:5432/splitnaira_migration_test"
    );
    expect(config.databaseName).toBe("splitnaira_migration_test");
  });
});