#!/usr/bin/env node
/**
 * Issue #835: OpenAPI schema drift check.
 *
 * Regenerates the OpenAPI specification into a temporary directory and
 * compares it byte-for-byte (after JSON normalization) with the committed
 * `docs/openapi.yaml` and `docs/openapi.json` artifacts. Exits with a
 * non-zero status and a human-friendly message when drift is detected.
 *
 * Usage:
 *   node scripts/check-openapi-drift.mjs
 *
 * Exit codes:
 *   0 — committed artifacts are in sync with the generated spec.
 *   1 — drift detected; the contributor must regenerate the artifacts.
 *   2 — environment is misconfigured (missing deps, missing artifacts, ...).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const docsDir = resolve(repoRoot, "docs");
const tempDir = resolve(repoRoot, ".tmp-openapi-drift");

const COMMITTED_YAML = join(docsDir, "openapi.yaml");
const COMMITTED_JSON = join(docsDir, "openapi.json");
const TEMP_YAML = join(tempDir, "openapi.yaml");
const TEMP_JSON = join(tempDir, "openapi.json");

function fatal(message, code = 2) {
  console.error(`\u274c ${message}`);
  process.exit(code);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function ensurePrerequisites() {
  if (!existsSync(docsDir)) {
    fatal(`Docs directory not found: ${docsDir}`);
  }
  if (!existsSync(COMMITTED_YAML)) {
    fatal(`Committed artifact missing: ${COMMITTED_YAML}`);
  }
  if (!existsSync(COMMITTED_JSON)) {
    fatal(`Committed artifact missing: ${COMMITTED_JSON}`);
  }
}

function regenerateSpec() {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  mkdirSync(tempDir, { recursive: true });

  console.log(`\u23f3 Regenerating OpenAPI spec into ${tempDir}`);

  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "generate:openapi", "--workspace=backend"],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENAPI_OUTPUT_DIR: tempDir },
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    fatal("OpenAPI generator exited non-zero; cannot compare.");
  }

  if (!existsSync(TEMP_YAML)) {
    fatal(`Generator did not produce ${TEMP_YAML}`);
  }

  // Drive the JSON artifact from the YAML so contributors only need to
  // update one source of truth. The docs route serves docs/openapi.json.
  const tempSpec = yaml.parse(readFileSync(TEMP_YAML, "utf-8"));
  const tempJson = canonicalJson(tempSpec);
  writeFileSync(TEMP_JSON, `${tempJson}\n`);
}

function reportDrift(drifted, tempContent, committedContent) {
  // Drop the regenerated artifact on disk so the diff against the committed
  // version can be inspected manually if needed.
  const tempArtifact = existsSync(TEMP_YAML)
    ? TEMP_YAML
    : existsSync(TEMP_JSON)
      ? TEMP_JSON
      : null;

  console.error("\n\u274c OpenAPI schema drift detected.");
  for (const file of drifted) {
    console.error(`   \u2022 ${file} is out of sync with the generated spec.`);
  }
  console.error(
    "\nRun the following to bring the artifact back into sync, then commit:",
  );
  console.error("   cd backend && npm run generate:openapi");
  console.error("   # review docs/openapi.yaml and docs/openapi.json");
  if (tempArtifact) {
    console.error(
      `\nFor debugging, diff against the regenerated temp file with:\n   diff ${COMMITTED_YAML.replace(
        /openapi\.yaml$/,
        driftedExtensions(drifted).join(" "),
      )} ${tempArtifact}`,
    );
  }
  console.error(
    `\nTemp artifact for manual inspection: ${tempDir}\n(removed automatically on the next successful run.)`,
  );
  // Touch the variables so they stay referenced for future maintenance.
  void tempContent;
  void committedContent;
}

function driftedExtensions(drifted) {
  return drifted.map((file) => file.split("/").pop());
}

function main() {
  ensurePrerequisites();
  regenerateSpec();

  const tempYamlRaw = readFileSync(TEMP_YAML, "utf-8");
  const committedYamlRaw = readFileSync(COMMITTED_YAML, "utf-8");

  const tempYamlCanonical = canonicalJson(yaml.parse(tempYamlRaw));
  const committedYamlCanonical = canonicalJson(yaml.parse(committedYamlRaw));

  const tempJsonCanonical = readFileSync(TEMP_JSON, "utf-8");
  const committedJsonCanonical = `${canonicalJson(
    JSON.parse(readFileSync(COMMITTED_JSON, "utf-8")),
  )}\n`;

  const drifted = [];
  if (tempYamlCanonical !== committedYamlCanonical) {
    drifted.push(COMMITTED_YAML);
  }
  if (tempJsonCanonical !== committedJsonCanonical) {
    drifted.push(COMMITTED_JSON);
  }

  if (drifted.length > 0) {
    reportDrift(drifted, tempYamlRaw, committedYamlRaw);
    process.exit(1);
  }

  // Cleanup on success.
  rmSync(tempDir, { recursive: true, force: true });
  console.log(
    "\u2705 OpenAPI artifacts are in sync \u2014 docs/openapi.{yaml,json} match the generated spec.",
  );
}

main();
