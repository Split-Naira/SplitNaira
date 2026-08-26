#!/usr/bin/env node
// Issue #872 & Issue: validation locale parity
// Fails CI when a locale's message keys drift from the base locale (en),
// or when translation values contain empty strings, missing required wizard validation
// keys, or mismatched placeholder parameters (e.g. {remaining}, {over}).
//
// Usage: node scripts/check-i18n-keys.mjs
// To intentionally allow a locale to differ from `en` for a specific key,
// add it to messages/i18n-ignore.json.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.join(__dirname, "..", "messages");
const IGNORE_FILE = path.join(MESSAGES_DIR, "i18n-ignore.json");

// Keep in sync with frontend/src/i18n/routing.ts `defaultLocale`.
const BASE_LOCALE = "en";

// Expected wizard validation keys that must exist in every locale
export const REQUIRED_WIZARD_VALIDATION_KEYS = [
  "SplitApp.wizard.validation.projectIdRequired",
  "SplitApp.wizard.validation.titleRequired",
  "SplitApp.wizard.validation.tokenRequired",
  "SplitApp.wizard.validation.invalidTokenAddress",
  "SplitApp.wizard.validation.projectTypeRequired",
  "SplitApp.wizard.validation.addressRequired",
  "SplitApp.wizard.validation.invalidAddress",
  "SplitApp.wizard.validation.invalidAddressGeneral",
  "SplitApp.wizard.validation.duplicateAddress",
  "SplitApp.wizard.validation.aliasRequired",
  "SplitApp.wizard.validation.shareRequired",
  "SplitApp.wizard.validation.shareWholeInteger",
  "SplitApp.wizard.validation.shareValidNumber",
  "SplitApp.wizard.validation.shareMax",
  "SplitApp.wizard.validation.sharesValid",
  "SplitApp.wizard.validation.underAllocated",
  "SplitApp.wizard.validation.overAllocated",
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function flattenEntries(obj, prefix = "") {
  const entries = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(entries, flattenEntries(value, path));
    } else {
      entries[path] = value;
    }
  }
  return entries;
}

export function flattenKeys(obj, prefix = "") {
  return Object.keys(flattenEntries(obj, prefix));
}

export function extractPlaceholders(str) {
  if (typeof str !== "string") return [];
  const matches = [...str.matchAll(/\{([a-zA-Z0-9_]+)\}/g)];
  return [...new Set(matches.map((m) => m[1]))].sort();
}

function loadIgnoreList() {
  if (!existsSync(IGNORE_FILE)) {
    return { ignoreMissingKeys: {}, ignoreExtraKeys: {} };
  }
  const parsed = readJson(IGNORE_FILE);
  return {
    ignoreMissingKeys: parsed.ignoreMissingKeys ?? {},
    ignoreExtraKeys: parsed.ignoreExtraKeys ?? {},
  };
}

function discoverLocaleFiles() {
  return readdirSync(MESSAGES_DIR)
    .filter((name) => name.endsWith(".json") && name !== "i18n-ignore.json")
    .map((name) => ({
      locale: name.replace(/\.json$/, ""),
      filePath: path.join(MESSAGES_DIR, name),
    }));
}

function main() {
  const localeFiles = discoverLocaleFiles();
  const baseFile = localeFiles.find((f) => f.locale === BASE_LOCALE);

  if (!baseFile) {
    console.error(`i18n check: base locale "${BASE_LOCALE}" not found in ${MESSAGES_DIR}`);
    process.exit(1);
  }

  const baseJson = readJson(baseFile.filePath);
  const baseEntries = flattenEntries(baseJson);
  const baseKeys = new Set(Object.keys(baseEntries));
  const { ignoreMissingKeys, ignoreExtraKeys } = loadIgnoreList();

  let hasFailures = false;

  // 1. Verify required wizard validation keys in base locale
  const missingWizardKeys = REQUIRED_WIZARD_VALIDATION_KEYS.filter((key) => !baseKeys.has(key));
  if (missingWizardKeys.length > 0) {
    hasFailures = true;
    console.error(`i18n check: base locale "${BASE_LOCALE}" is missing required wizard validation keys:`);
    for (const key of missingWizardKeys) {
      console.error(`  - ${key}`);
    }
  }

  // 2. Check each locale
  for (const { locale, filePath } of localeFiles) {
    const localeJson = readJson(filePath);
    const localeEntries = flattenEntries(localeJson);
    const localeKeys = new Set(Object.keys(localeEntries));
    const ignoredMissing = new Set(ignoreMissingKeys[locale] ?? []);
    const ignoredExtra = new Set(ignoreExtraKeys[locale] ?? []);

    // Check key parity
    const missing = [...baseKeys]
      .filter((key) => !localeKeys.has(key) && !ignoredMissing.has(key))
      .sort();
    const extra = [...localeKeys]
      .filter((key) => !baseKeys.has(key) && !ignoredExtra.has(key))
      .sort();

    // Check empty strings or invalid types
    const emptyValues = [];
    for (const [key, val] of Object.entries(localeEntries)) {
      if (typeof val !== "string" || val.trim().length === 0) {
        emptyValues.push(key);
      }
    }

    // Check placeholder parity with base locale
    const placeholderMismatches = [];
    if (locale !== BASE_LOCALE) {
      for (const key of baseKeys) {
        if (!localeKeys.has(key) || ignoredMissing.has(key)) continue;
        const basePlaceholders = extractPlaceholders(baseEntries[key]);
        const locPlaceholders = extractPlaceholders(localeEntries[key]);
        if (basePlaceholders.join(",") !== locPlaceholders.join(",")) {
          placeholderMismatches.push({
            key,
            expected: basePlaceholders,
            actual: locPlaceholders,
          });
        }
      }
    }

    if (
      missing.length === 0 &&
      extra.length === 0 &&
      emptyValues.length === 0 &&
      placeholderMismatches.length === 0
    ) {
      console.log(`i18n check: ${locale}.json — OK (${localeKeys.size} keys, placeholders and values valid)`);
      continue;
    }

    hasFailures = true;
    console.error(`i18n check: ${locale}.json — ISSUES DETECTED:`);

    if (missing.length > 0) {
      console.error(`  Missing keys (present in ${BASE_LOCALE}.json, absent in ${locale}.json):`);
      for (const key of missing) console.error(`    - ${key}`);
    }
    if (extra.length > 0) {
      console.error(`  Extra keys (present in ${locale}.json, absent in ${BASE_LOCALE}.json):`);
      for (const key of extra) console.error(`    - ${key}`);
    }
    if (emptyValues.length > 0) {
      console.error(`  Empty/Blank values in ${locale}.json:`);
      for (const key of emptyValues) console.error(`    - ${key}`);
    }
    if (placeholderMismatches.length > 0) {
      console.error(`  Placeholder mismatches in ${locale}.json vs ${BASE_LOCALE}.json:`);
      for (const { key, expected, actual } of placeholderMismatches) {
        console.error(`    - ${key}: expected {${expected.join(", ")}}, got {${actual.join(", ")}}`);
      }
    }
  }

  if (hasFailures) {
    console.error(
      "\ni18n check failed. Add all missing keys, fix placeholders/empty values, " +
        "or add an explicit exception to frontend/messages/i18n-ignore.json.",
    );
    process.exit(1);
  }

  console.log("i18n check: all locales match and passed validation checks.");
}

// Only run main() if executed directly from node CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
