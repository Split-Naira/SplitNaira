#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const backendRoot = resolve(scriptDir, "..");
const DEFAULT_DATABASE_URL = "postgresql://splitnaira:splitnaira@localhost:5432/splitnaira_ci";
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const RESERVED_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);

function ensureEnv(key, value) {
  if (!process.env[key] && value !== undefined) {
    process.env[key] = value;
  }
}

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "postgres",
  };
}

function buildAdminConnectionString(databaseUrl, adminDatabase) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${adminDatabase}`;
  return parsed.toString();
}

/**
 * Resolve the isolated connection settings used by the destructive migration
 * dry run. Intentionally do not fall back to DATABASE_URL: local shells often
 * point it at a developer or shared database, neither of which is a valid
 * dry-run target.
 */
export function resolveMigrationConfig(environment = process.env) {
  const databaseUrl = environment.MIGRATION_DRY_RUN_DATABASE_URL || DEFAULT_DATABASE_URL;
  const urlDatabaseName = parseDatabaseUrl(databaseUrl).database;
  const databaseName = environment.MIGRATION_DRY_RUN_DATABASE_NAME || urlDatabaseName;

  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      "MIGRATION_DRY_RUN_DATABASE_NAME must be a valid unquoted PostgreSQL database name.",
    );
  }

  if (RESERVED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      "MIGRATION_DRY_RUN_DATABASE_URL must target a dedicated database, not a PostgreSQL system database.",
    );
  }

  if (databaseName !== urlDatabaseName) {
    throw new Error(
      "MIGRATION_DRY_RUN_DATABASE_NAME must match the database in MIGRATION_DRY_RUN_DATABASE_URL.",
    );
  }

  const adminDatabase =
    environment.MIGRATION_DRY_RUN_ADMIN_DATABASE ||
    environment.MIGRATION_ADMIN_DATABASE ||
    "postgres";

  if (!DATABASE_NAME_PATTERN.test(adminDatabase)) {
    throw new Error(
      "MIGRATION_DRY_RUN_ADMIN_DATABASE must be a valid unquoted PostgreSQL database name.",
    );
  }

  return {
    databaseUrl,
    databaseName,
    adminConnectionString:
      environment.MIGRATION_DRY_RUN_ADMIN_DATABASE_URL ||
      environment.MIGRATION_ADMIN_DATABASE_URL ||
      buildAdminConnectionString(databaseUrl, adminDatabase),
  };
}

async function resetDatabase({ adminConnectionString, databaseName }) {
  console.log(`[migration:dry-run] Resetting database ${databaseName} for a fresh migration run`);

  const client = new Client({ connectionString: adminConnectionString });
  await client.connect();

  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

function runMigrations() {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "typeorm", "--", "migration:run", "-d", "src/data-source.ts"],
    {
      cwd: backendRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export async function main() {
  ensureEnv("NODE_ENV", "test");
  ensureEnv("PORT", "3001");
  ensureEnv("CORS_ORIGIN", "http://localhost:3000");
  ensureEnv("LOG_LEVEL", "info");
  ensureEnv("HORIZON_URL", "https://horizon-testnet.stellar.org");
  ensureEnv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
  ensureEnv("SOROBAN_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
  ensureEnv("CONTRACT_ID", "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  ensureEnv("SIMULATOR_ACCOUNT", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

  const config = resolveMigrationConfig();
  // TypeORM reads DATABASE_URL. Overwrite it only in this child process with
  // the explicit dry-run target; do not inherit a normal development/prod URL.
  process.env.DATABASE_URL = config.databaseUrl;

  console.log("[migration:dry-run] Starting TypeORM migration verification against a fresh database");
  await resetDatabase(config);
  runMigrations();
  console.log("[migration:dry-run] Completed successfully.");
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === scriptFile;

if (isDirectExecution) {
  main().catch((error) => {
    console.error("[migration:dry-run] Failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
