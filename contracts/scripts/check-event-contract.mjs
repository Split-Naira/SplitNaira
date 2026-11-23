
#!/usr/bin/env node

/**
 * Contract event integration guard.
 *
 * Usage:
 *   node contracts/scripts/check-event-contract.mjs
 *     Extracts events from contracts/events.rs and compares them with the
 *     committed snapshot (contracts/interface/events.contract.json).
 *     Fails if the event contract has drifted.
 *
 *   node contracts/scripts/check-event-contract.mjs --update [--allow-breaking]
 *     Regenerates the snapshot from source and bumps its version:
 *       breaking      -> major
 *       additive      -> minor
 *       informational  -> patch
 *     Refuses breaking changes unless --allow-breaking is provided.
 *
 *   node contracts/scripts/check-event-contract.mjs --base <snapshot.json>
 *     Compares the committed snapshot against a base snapshot and validates
 *     that the version bump matches the classified changes.
 *     A missing base file is treated as first adoption.
 *
 * Exit codes:
 *   0 - Check passed
 *   1 - Contract violation
 *   2 - Usage or environment error
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENT_CONTRACT_SCHEMA,
  buildSnapshot,
  bumpVersion,
  checkVersionBump,
  diffEventContracts,
  extractEventContract,
} from "./event-contract.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACT_DIR = resolve(SCRIPT_DIR, "..");

const EVENTS_PATH = resolve(CONTRACT_DIR, "events.rs");
const LIB_PATH = resolve(CONTRACT_DIR, "lib.rs");
const SNAPSHOT_PATH = resolve(
  CONTRACT_DIR,
  "interface",
  "events.contract.json",
);

const args = process.argv.slice(2);

/**
 * Checks whether a command-line flag is present.
 *
 * @param {string} name - Flag to check.
 * @returns {boolean} Whether the flag exists in the arguments.
 */
function hasFlag(name) {
  return args.includes(name);
}

/**
 * Retrieves the value associated with a command-line option.
 *
 * @param {string} name - Option name.
 * @returns {string | undefined} Option value, if present.
 */
function getOption(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Prints an error message and terminates the process.
 *
 * @param {number} code - Exit code.
 * @param {string} message - Error message to display.
 */
function exitWithError(code, message) {
  console.error(message);
  process.exit(code);
}

/**
 * Reads and validates an event-contract snapshot.
 *
 * @param {string} filePath - Snapshot file path.
 * @returns {object} Validated snapshot.
 * @throws {Error} If the snapshot is invalid or unreadable.
 */
function readSnapshot(filePath) {
  const snapshot = JSON.parse(readFileSync(filePath, "utf8"));

  if (snapshot.schema !== EVENT_CONTRACT_SCHEMA) {
    throw new Error(
      `${filePath}: expected schema "${EVENT_CONTRACT_SCHEMA}", ` +
        `got "${snapshot.schema}"`,
    );
  }

  return snapshot;
}

/**
 * Prints classified event-contract changes.
 *
 * @param {object} diff - Event-contract diff result.
 */
function printChanges(diff) {
  for (const change of diff.changes) {
    console.log(
      `  [${change.level}] ${change.event}: ${change.message}`,
    );
  }
}

/**
 * Writes the updated event-contract snapshot to disk.
 *
 * @param {object} snapshot - Snapshot to persist.
 */
function writeSnapshot(snapshot) {
  const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
  writeFileSync(SNAPSHOT_PATH, serializedSnapshot);
}

/**
 * Validates the version bump against the classified contract changes.
 *
 * @param {object} base - Base snapshot.
 * @param {object} head - Current snapshot.
 * @param {object} diff - Event-contract diff.
 */
function validateBaseVersion(base, head, diff) {
  if (diff.level === "none") {
    console.log(`Event contract unchanged (v${head.version}).`);
    process.exit(0);
  }

  console.log(
    `Event contract changes v${base.version} -> v${head.version} (${diff.level}):`,
  );

  printChanges(diff);

  const versionError = checkVersionBump(
    base.version,
    head.version,
    diff.level,
  );

  if (versionError) {
    exitWithError(
      1,
      `\n✖ ${versionError}. See docs/contract-events.md#compatibility-policy.`,
    );
  }

  console.log("\n✔ Version bump matches the change level.");
  process.exit(0);
}

/**
 * Checks for direct event publishing in lib.rs.
 *
 * Events published outside events.rs would bypass the event contract.
 */
function checkDirectEventPublishing() {
  const libSource = readFileSync(LIB_PATH, "utf8");

  if (/events\(\)\.publish\(/.test(libSource)) {
    exitWithError(
      1,
      "✖ contracts/lib.rs publishes events directly. Define them in " +
        "contracts/events.rs so they are covered by the event contract.",
    );
  }
}

/**
 * Creates the initial snapshot or updates an existing snapshot.
 */
function updateSnapshot(extractedEvents) {
  if (!existsSync(SNAPSHOT_PATH)) {
    writeSnapshot(buildSnapshot(extractedEvents, "1.0.0"));
    console.log("Created event contract snapshot v1.0.0.");
    process.exit(0);
  }

  const currentSnapshot = readSnapshot(SNAPSHOT_PATH);
  const diff = diffEventContracts(currentSnapshot.events, extractedEvents);

  if (diff.level === "none") {
    console.log(
      `Event contract already up to date (v${currentSnapshot.version}).`,
    );
    process.exit(0);
  }

  printChanges(diff);

  if (diff.level === "breaking" && !hasFlag("--allow-breaking")) {
    exitWithError(
      1,
      "\n✖ Breaking event changes. Re-run with --allow-breaking after " +
        "coordinating consumers (docs/contract-events.md).",
    );
  }

  const nextVersion = bumpVersion(currentSnapshot.version, diff.level);

  writeSnapshot(buildSnapshot(extractedEvents, nextVersion));

  console.log(
    `\nUpdated event contract v${currentSnapshot.version} -> v${nextVersion}.`,
  );

  process.exit(0);
}

/**
 * Verifies that the current event definitions match the committed snapshot.
 */
function checkSnapshot(extractedEvents) {
  if (!existsSync(SNAPSHOT_PATH)) {
    exitWithError(
      2,
      `Missing ${SNAPSHOT_PATH}; run with --update to create it.`,
    );
  }

  const committedSnapshot = readSnapshot(SNAPSHOT_PATH);
  const diff = diffEventContracts(
    committedSnapshot.events,
    extractedEvents,
  );

  if (diff.level === "none") {
    console.log(
      `✔ contracts/events.rs matches event contract v${committedSnapshot.version}.`,
    );
    process.exit(0);
  }

  console.log(
    `contracts/events.rs drifted from event contract ` +
      `v${committedSnapshot.version} (${diff.level}):`,
  );

  printChanges(diff);

  exitWithError(
    1,
    "\n✖ Run `npm run events:update` (add --allow-breaking for breaking " +
      "changes) and commit the snapshot.",
  );
}

try {
  const basePath = getOption("--base");

  // Validate the contract version against a base snapshot when requested.
  if (basePath !== undefined) {
    if (!existsSync(basePath)) {
      console.log(
        `No base event contract at ${basePath}; treating as first adoption.`,
      );
      process.exit(0);
    }

    const baseSnapshot = readSnapshot(basePath);
    const headSnapshot = readSnapshot(SNAPSHOT_PATH);

    const diff = diffEventContracts(
      baseSnapshot.events,
      headSnapshot.events,
    );

    validateBaseVersion(baseSnapshot, headSnapshot, diff);
  }

  checkDirectEventPublishing();

  const extractedEvents = extractEventContract(
    readFileSync(EVENTS_PATH, "utf8"),
  );

  // Regenerate the committed snapshot when --update is provided.
  if (hasFlag("--update")) {
    updateSnapshot(extractedEvents);
  }

  // Otherwise, validate the current source against the committed snapshot.
  checkSnapshot(extractedEvents);
} catch (error) {
  exitWithError(
    2,
    `Event contract check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}
