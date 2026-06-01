#!/usr/bin/env node
/**
 * SplitNaira — post-deploy contract smoke test (issue #361)
 *
 * Exercises the core contract lifecycle on testnet:
 *   1. create_project  — register a 2-collaborator split project
 *   2. deposit         — fund the project with XLM (via token contract)
 *   3. distribute      — trigger payout and assert both collaborators received funds
 *
 * Exits 0 only if every step succeeds.  Intended as a manual-dispatch CI job
 * and as a post-deploy sanity check before promoting to production.
 *
 * Usage:
 *   STELLAR_SECRET_KEY=S... CONTRACT_ID=C... node scripts/smoke-testnet.mjs
 *
 * Required env vars:
 *   STELLAR_SECRET_KEY   Funded testnet secret key (never commit)
 *   CONTRACT_ID          Deployed SplitNaira contract ID
 *
 * Optional env vars:
 *   STELLAR_RPC_URL      Default: https://soroban-testnet.stellar.org
 *   STELLAR_NETWORK_PASSPHRASE  Default: Test SDF Network ; September 2015
 *   XLM_CONTRACT_ID      Native XLM contract alias. Default: use stellar CLI
 *   SMOKE_DEPOSIT_AMOUNT Stroops to deposit. Default: 10000000 (1 XLM)
 *   VERBOSE              Set to "1" for full CLI output
 *
 * Prerequisites:
 *   - stellar CLI in PATH  (https://developers.stellar.org/docs/tools/cli)
 *   - Node.js 20+
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";
const SECRET_KEY = process.env.STELLAR_SECRET_KEY ?? "";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const DEPOSIT_AMOUNT = process.env.SMOKE_DEPOSIT_AMOUNT ?? "10000000"; // 1 XLM
const VERBOSE = process.env.VERBOSE === "1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[smoke] ${msg}`);
}
function step(n, msg) {
  console.log(`\n[smoke] ── Step ${n}: ${msg}`);
}
function die(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

/** Run a stellar CLI command and return trimmed stdout. */
function stellar(...args) {
  if (VERBOSE) log(`$ stellar ${args.join(" ")}`);
  try {
    const out = execFileSync("stellar", args, {
      env: {
        ...process.env,
        STELLAR_RPC_URL: RPC_URL,
        STELLAR_NETWORK_PASSPHRASE: PASSPHRASE,
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", VERBOSE ? "inherit" : "pipe"],
    });
    return out.trim();
  } catch (err) {
    const msg = err.stderr?.toString().trim() ?? err.message;
    die(`stellar ${args[0]} failed:\n${msg}`);
  }
}

/** Invoke a contract function. Returns parsed JSON output. */
function invoke(fn, ...fnArgs) {
  const args = [
    "contract",
    "invoke",
    "--id",
    CONTRACT_ID,
    "--source",
    "smoke_key",
    "--network",
    "testnet",
    "--",
    fn,
    ...fnArgs,
  ];
  const raw = stellar(...args);
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // some calls return plain strings
  }
}

// ─── Preflight ────────────────────────────────────────────────────────────────

if (!SECRET_KEY) die("STELLAR_SECRET_KEY env var is required");
if (!CONTRACT_ID) die("CONTRACT_ID env var is required");

// Check stellar CLI is available
try {
  execFileSync("stellar", ["--version"], { stdio: "pipe" });
} catch {
  die("'stellar' CLI not found. Install from https://developers.stellar.org/docs/tools/cli");
}

log(`Contract: ${CONTRACT_ID}`);
log(`RPC:      ${RPC_URL}`);

// ─── Setup: import key under a temp alias ─────────────────────────────────────

step(0, "Import signing key");
try {
  stellar("keys", "add", "smoke_key", "--secret-key", "--overwrite");
  // pipe the secret key via stdin
  execFileSync(
    "stellar",
    ["keys", "add", "smoke_key", "--secret-key", "--overwrite"],
    {
      input: SECRET_KEY + "\n",
      encoding: "utf8",
      stdio: ["pipe", VERBOSE ? "inherit" : "pipe", VERBOSE ? "inherit" : "pipe"],
      env: { ...process.env, STELLAR_RPC_URL: RPC_URL, STELLAR_NETWORK_PASSPHRASE: PASSPHRASE },
    }
  );
} catch (err) {
  // Key may already exist from a previous run — that's fine
  if (VERBOSE) log("Key import notice: " + (err.stderr?.toString().trim() ?? err.message));
}

const publicKey = stellar("keys", "address", "smoke_key");
log(`Operator: ${publicKey}`);

// ─── Derive native XLM contract ID ───────────────────────────────────────────

step(1, "Resolve XLM token contract");
let xlmContractId = process.env.XLM_CONTRACT_ID ?? "";
if (!xlmContractId) {
  xlmContractId = stellar(
    "contract",
    "id",
    "asset",
    "--asset",
    "native",
    "--network",
    "testnet"
  );
}
log(`XLM contract: ${xlmContractId}`);

// ─── Step 1: create_project ───────────────────────────────────────────────────

step(2, "create_project");

// Generate a unique project ID for this smoke run (max 32 chars for Soroban Symbol)
const projectId = `smoke_${randomBytes(4).toString("hex")}`;

// Two collaborators: operator (70%) + a fixed testnet address (30%)
const COLLAB_B = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"; // fixed testnet addr

const collaborators = JSON.stringify([
  { address: publicKey, alias: "Smoke-A", basis_points: 7000 },
  { address: COLLAB_B, alias: "Smoke-B", basis_points: 3000 },
]);

const createResult = invoke(
  "create_project",
  "--owner", publicKey,
  "--project_id", projectId,
  "--title", `Smoke Run ${projectId}`,
  "--project_type", "other",
  "--token", xlmContractId,
  "--collaborators", collaborators
);

log(`create_project → ${JSON.stringify(createResult)}`);
if (createResult !== null && createResult?.Err !== undefined) {
  die(`create_project returned error: ${JSON.stringify(createResult.Err)}`);
}
log("create_project ✓");

// ─── Step 2: deposit ──────────────────────────────────────────────────────────

step(3, "deposit");

// Approve the contract to pull XLM from the operator wallet
stellar(
  "contract",
  "invoke",
  "--id", xlmContractId,
  "--source", "smoke_key",
  "--network", "testnet",
  "--",
  "approve",
  "--from", publicKey,
  "--spender", CONTRACT_ID,
  "--amount", DEPOSIT_AMOUNT,
  "--expiration_ledger", "999999999"
);
log("XLM allowance approved ✓");

const depositResult = invoke(
  "deposit",
  "--from", publicKey,
  "--project_id", projectId,
  "--token", xlmContractId,
  "--amount", DEPOSIT_AMOUNT
);

log(`deposit → ${JSON.stringify(depositResult)}`);
if (depositResult?.Err !== undefined) {
  die(`deposit returned error: ${JSON.stringify(depositResult.Err)}`);
}
log("deposit ✓");

// ─── Step 3: distribute ───────────────────────────────────────────────────────

step(4, "distribute");

const distributeResult = invoke("distribute", "--project_id", projectId);

log(`distribute → ${JSON.stringify(distributeResult)}`);
if (distributeResult?.Err !== undefined) {
  die(`distribute returned error: ${JSON.stringify(distributeResult.Err)}`);
}
log("distribute ✓");

// ─── Verify: check claimed balances ───────────────────────────────────────────

step(5, "Verify claimed amounts");

const claimedA = invoke(
  "get_claimed_amount",
  "--project_id", projectId,
  "--address", publicKey
);
const claimedB = invoke(
  "get_claimed_amount",
  "--project_id", projectId,
  "--address", COLLAB_B
);

const expectedA = Math.floor((Number(DEPOSIT_AMOUNT) * 7000) / 10_000);
const expectedB = Number(DEPOSIT_AMOUNT) - expectedA; // remainder goes to last collab

log(`Collab A claimed: ${claimedA} (expected ~${expectedA})`);
log(`Collab B claimed: ${claimedB} (expected ~${expectedB})`);

if (Number(claimedA) < expectedA - 1 || Number(claimedA) > expectedA + 1) {
  die(`Collab A claimed ${claimedA}, expected ${expectedA} ± 1 stroop`);
}
if (Number(claimedB) < expectedB - 1 || Number(claimedB) > expectedB + 1) {
  die(`Collab B claimed ${claimedB}, expected ${expectedB} ± 1 stroop`);
}

log("Claim balances verified ✓");

// ─── Done ─────────────────────────────────────────────────────────────────────

console.log("\n[smoke] ✅  All steps passed — contract is healthy on testnet.");
process.exit(0);
