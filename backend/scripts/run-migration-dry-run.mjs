#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, "..");

function ensureEnv(key, value) {
  if (!process.env[key] && value !== undefined) {
    process.env[key] = value;
  }
}

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, "") || "postgres",
  };
}

function buildAdminConnectionString(databaseUrl, env = process.env) {
  const adminDb = env.MIGRATION_DRY_RUN_ADMIN_DATABASE || env.MIGRATION_ADMIN_DATABASE || "postgres";
  if (env.MIGRATION_DRY_RUN_ADMIN_DATABASE_URL || env.MIGRATION_ADMIN_DATABASE_URL) {
    return env.MIGRATION_DRY_RUN_ADMIN_DATABASE_URL || env.MIGRATION_ADMIN_DATABASE_URL;
  }

  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${adminDb}`;
  return parsed.toString();
}

export function resolveMigrationConfig(env = process.env) {
  const databaseUrl = env.MIGRATION_DRY_RUN_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or MIGRATION_DRY_RUN_DATABASE_URL is required to run migration dry-run checks.");
  }

  return {
    databaseUrl,
    adminConnectionString: buildAdminConnectionString(databaseUrl, env),
    databaseName: env.MIGRATION_DRY_RUN_DATABASE_NAME || parseDatabaseUrl(databaseUrl).database,
  };
}

async function resetDatabase(databaseUrl) {
  const { databaseName, adminConnectionString } = resolveMigrationConfig({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });

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
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  ensureEnv("NODE_ENV", "test");
  ensureEnv("PORT", "3001");
  ensureEnv("CORS_ORIGIN", "http://localhost:3000");
  ensureEnv("LOG_LEVEL", "info");
  ensureEnv("DATABASE_URL", "postgresql://splitnaira:splitnaira@localhost:5432/splitnaira_ci");
  ensureEnv("HORIZON_URL", "https://horizon-testnet.stellar.org");
  ensureEnv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
  ensureEnv("SOROBAN_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
  ensureEnv("CONTRACT_ID", "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  ensureEnv("SIMULATOR_ACCOUNT", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

  const { databaseUrl } = resolveMigrationConfig(process.env);
  process.env.DATABASE_URL = databaseUrl;

  console.log("[migration:dry-run] Starting TypeORM migration verification against a fresh database");
  await resetDatabase(databaseUrl);
  runMigrations();
  console.log("[migration:dry-run] Completed successfully.");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error("[migration:dry-run] Failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
