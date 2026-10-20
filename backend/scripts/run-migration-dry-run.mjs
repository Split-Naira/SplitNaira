#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
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

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/**
 * Run `spawnSync` for a migration step and return the wall-clock duration in
 * milliseconds together with the exit status.
 *
 * @param {string} label   Human-readable step name for the timing report.
 * @param {Function} fn    Synchronous function to time. Must throw or return a
 *                         value that indicates failure via a `.status` property.
 * @returns {{ label: string, ms: number }}
 */
export function measureMigrationTiming(label, fn) {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  return { label, ms };
}

/**
 * Open a short-lived connection to `databaseUrl`, acquire a PostgreSQL
 * session-level advisory lock, and report whether the lock was available.
 *
 * Uses `pg_try_advisory_lock` (non-blocking) so it always returns quickly.
 * If a concurrent migration runner holds the same lock the function returns
 * `{ held: false, ms }` without waiting.
 *
 * The caller is responsible for releasing the lock if `held === true`.
 *
 * @param {string} databaseUrl
 * @param {bigint} [lockKey=1_000_000_007n]  Arbitrary 64-bit key.
 * @returns {Promise<{ held: boolean, ms: number }>}
 */
export async function checkAdvisoryLock(databaseUrl, lockKey = 1_000_000_007n) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const start = performance.now();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS held",
      [lockKey],
    );
    const ms = performance.now() - start;
    const held = result.rows[0]?.held === true;
    if (held) {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    }
    return { held, ms };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Migration execution with per-step timing
// ---------------------------------------------------------------------------

/**
 * Run the TypeORM migration:run command and emit structured timing output.
 *
 * When `MIGRATION_TIMING` is set to `"1"` or `"true"` in the environment the
 * function emits a JSON timing report on stdout after migrations complete.
 *
 * @param {{ timingEnabled?: boolean }} [opts]
 * @returns {{ ms: number }}  Wall-clock time of the full migration run.
 */
export function runMigrationsWithTiming(opts = {}) {
  const timingEnabled =
    opts.timingEnabled ??
    ["1", "true"].includes((process.env.MIGRATION_TIMING ?? "").toLowerCase());

  const { ms } = measureMigrationTiming("migration:run", () => {
    const result = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "migration:run"],
      {
        cwd: backendRoot,
        stdio: "inherit",
        env: process.env,
      },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  });

  if (timingEnabled) {
    const report = {
      event: "migration_timing",
      step: "migration:run",
      durationMs: Math.round(ms),
      timestamp: new Date().toISOString(),
    };
    // Write to stdout on its own line so CI can capture it independently of
    // the TypeORM output that goes to inherited stdio above.
    process.stdout.write("\n" + JSON.stringify(report) + "\n");
  }

  return { ms };
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
  const { ms } = runMigrationsWithTiming();
  console.log(
    `[migration:dry-run] Completed successfully. (migration:run took ${Math.round(ms)}ms)`,
  );
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === scriptFile;

if (isDirectExecution) {
  main().catch((error) => {
    console.error("[migration:dry-run] Failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
