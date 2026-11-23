
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
 * Counts matches of a regular expression in a source string.
 *
 * @param {string} source - Source text to analyze.
 * @param {RegExp} pattern - Pattern used to identify matching occurrences.
 * @returns {number} The total number of matches.
 */
function countMatches(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

const contractSource = readContractFile("lib.rs");
const errorSource = readContractFile("errors.rs");
const eventSource = readContractFile("events.rs");

const publicFunctionCount = countMatches(contractSource, /pub fn /g);
const errorCodeCount = countMatches(errorSource, /= \d+,/g);
const eventTypeCount = countMatches(eventSource, /pub struct /g);

console.log("Contract Surface Analysis");
console.log("--------------------------");
console.log(`Public functions : ${publicFunctionCount}`);
console.log(`Error codes      : ${errorCodeCount}`);
console.log(`Event types      : ${eventTypeCount}`);
