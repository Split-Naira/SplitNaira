
#!/usr/bin/env node

/**
 * Lightweight static analysis for the SplitNaira Soroban contract.
 *
 * Reports the number of public functions, error codes, and event types
 * without requiring a live Soroban node.
 *
 * Usage:
 *   node contracts/scripts/analyze-contract.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACT_ROOT = resolve(SCRIPT_DIR, "..");

const FILES = {
  contract: "lib.rs",
  errors: "errors.rs",
  events: "events.rs",
};

const PATTERNS = {
  publicFunctions: /\bpub\s+fn\s+/g,
  errorCodes: /=\s*\d+\s*,/g,
  eventTypes: /\bpub\s+struct\s+/g,
};

/**
 * Reads a contract file relative to the contracts directory.
 *
 * @param {string} file - Relative path to the file to read.
 * @returns {string} The file contents as UTF-8 text.
 */
function readContractFile(file) {
  const filePath = resolve(CONTRACT_ROOT, file);

  return readFileSync(filePath, "utf8");
}

/**
 * Counts occurrences of a regular expression in source text.
 *
 * @param {string} source - Source text to analyze.
 * @param {RegExp} pattern - Pattern used to identify matches.
 * @returns {number} The total number of matches.
 */
function countMatches(source, pattern) {
  const matches = source.match(pattern);

  return matches?.length ?? 0;
}

/**
 * Analyzes the contract source files.
 *
 * @returns {{
 *   publicFunctions: number,
 *   errorCodes: number,
 *   eventTypes: number
 * }}
 */
function analyzeContract() {
  const sources = Object.fromEntries(
    Object.entries(FILES).map(([key, file]) => [
      key,
      readContractFile(file),
    ])
  );

  return {
    publicFunctions: countMatches(
      sources.contract,
      PATTERNS.publicFunctions
    ),
    errorCodes: countMatches(
      sources.errors,
      PATTERNS.errorCodes
    ),
    eventTypes: countMatches(
      sources.events,
      PATTERNS.eventTypes
    ),
  };
}

/**
 * Prints the contract analysis results.
 *
 * @param {{
 *   publicFunctions: number,
 *   errorCodes: number,
 *   eventTypes: number
 * }} results - Contract analysis results.
 */
function printResults({
  publicFunctions,
  errorCodes,
  eventTypes,
}) {
  console.log("Contract Surface Analysis");
  console.log("--------------------------");
  console.log(`Public functions : ${publicFunctions}`);
  console.log(`Error codes      : ${errorCodes}`);
  console.log(`Event types      : ${eventTypes}`);
}

function main() {
  const results = analyzeContract();

  printResults(results);
}

main();
