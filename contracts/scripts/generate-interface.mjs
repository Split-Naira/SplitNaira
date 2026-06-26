#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const contractDir = resolve(scriptDir, "..");
const repoRoot = resolve(contractDir, "..");

const paths = {
  cargo: resolve(contractDir, "Cargo.toml"),
  lib: resolve(contractDir, "lib.rs"),
  events: resolve(contractDir, "events.rs"),
  errors: resolve(contractDir, "errors.rs"),
  output: resolve(contractDir, "interface", "splitnaira.contract-interface.json")
};

const cargo = readText(paths.cargo);
const lib = readText(paths.lib);
const events = readText(paths.events);
const errors = readText(paths.errors);

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function repoRelative(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function sourceHash(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(repoRelative(file));
    hash.update("\0");
    hash.update(readText(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function splitTopLevel(input, separator = ",") {
  const parts = [];
  let current = "";
  let angleDepth = 0;
  let parenDepth = 0;

  for (const char of input) {
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth -= 1;
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;

    if (char === separator && angleDepth === 0 && parenDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeType(type) {
  return type.replace(/\s+/g, " ").trim();
}

function parseFields(body) {
  const fields = [];
  let docs = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///")) {
      docs.push(trimmed.replace(/^\/\/\/\s?/, ""));
      continue;
    }

    const match = trimmed.match(/^pub\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+),$/);
    if (match) {
      fields.push({
        name: match[1],
        type: normalizeType(match[2]),
        doc: docs.join(" ").trim()
      });
    }
    docs = [];
  }

  return fields;
}

function parseEnumVariants(body) {
  const variants = [];
  let docs = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///")) {
      docs.push(trimmed.replace(/^\/\/\/\s?/, ""));
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_]+)(?:\((.*)\))?,?$/);
    if (match) {
      variants.push({
        name: match[1],
        fields: match[2] ? splitTopLevel(match[2]).map(normalizeType) : [],
        doc: docs.join(" ").trim()
      });
    }
    docs = [];
  }

  return variants;
}

function parseContractTypes() {
  const types = {};
  const structRegex =
    /#\[contracttype\][\s\S]*?pub struct\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  const enumRegex =
    /#\[contracttype\][\s\S]*?pub enum\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;

  for (const match of lib.matchAll(structRegex)) {
    types[match[1]] = { kind: "struct", fields: parseFields(match[2]) };
  }

  for (const match of lib.matchAll(enumRegex)) {
    types[match[1]] = { kind: "enum", variants: parseEnumVariants(match[2]) };
  }

  return types;
}

function parseErrors() {
  const body = errors.match(/pub enum\s+SplitError\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const result = [];
  let docs = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///")) {
      docs.push(trimmed.replace(/^\/\/\/\s?/, ""));
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(\d+),$/);
    if (match) {
      result.push({
        name: match[1],
        code: Number(match[2]),
        doc: docs.join(" ").trim()
      });
    }
    docs = [];
  }

  return result;
}

function inferMutability(name) {
  const readMethods = new Set([
    "get_project",
    "project_exists",
    "get_claimed",
    "get_project_count",
    "list_projects",
    "list_project_summaries",
    "get_balance",
    "get_unallocated_balance",
    "is_token_allowed",
    "is_distributions_paused",
    "get_allowed_token_count",
    "get_allowed_tokens",
    "get_admin",
    "get_project_ids",
    "get_claimable"
  ]);

  if (readMethods.has(name)) return "read";
  if (name === "refresh_project_storage") return "maintenance";
  if (name === "migrate_flat_to_buckets") return "maintenance";
  return "write";
}

function parseMethods() {
  const methodRegex =
    /pub fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^{]+))?\{/g;
  const methods = [];

  for (const match of lib.matchAll(methodRegex)) {
    const args = splitTopLevel(match[2].replace(/\n/g, " "))
      .filter((arg) => !arg.startsWith("env:"))
      .map((arg) => {
        const [name, ...typeParts] = arg.split(":");
        return {
          name: name.trim(),
          type: normalizeType(typeParts.join(":"))
        };
      });

    methods.push({
      name: match[1],
      args,
      returnType: normalizeType(match[3] ?? "()"),
      mutability: inferMutability(match[1])
    });
  }

  return methods;
}

function extractPublishArgs(implBody) {
  const marker = "env.events().publish(";
  const start = implBody.indexOf(marker);
  if (start === -1) return [];

  const contentStart = start + marker.length;
  let depth = 1;
  let content = "";

  for (const char of implBody.slice(contentStart)) {
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
    content += char;
  }

  return splitTopLevel(content);
}

function parseEvents() {
  const eventRegex =
    /pub struct\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}\s*\n\s*impl\s+\1\s*\{([\s\S]*?)\n\}/g;
  const result = [];

  for (const match of events.matchAll(eventRegex)) {
    const [, rustName, body, implBody] = match;
    const eventName = implBody.match(/Symbol::new\(env,\s*"([^"]+)"\)/)?.[1] ?? rustName;
    const publishArgs = extractPublishArgs(implBody);
    const firstArg = publishArgs[0] ?? "";
    const dataArg = publishArgs[1] ?? "";
    const subject = firstArg.match(/self\.([a-zA-Z_][a-zA-Z0-9_]*)/)?.[1] ?? null;
    const dataFields = [...dataArg.matchAll(/self\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(
      (field) => field[1]
    );

    result.push({
      name: eventName,
      rustName,
      topics: [
        { position: 0, type: "Symbol", value: eventName },
        { position: 1, type: "from_field", field: subject }
      ],
      data: dataFields.length === 1 ? { field: dataFields[0] } : { tupleFields: dataFields },
      fields: parseFields(body)
    });
  }

  return result;
}

function parseCargoMetadata() {
  const rawSorobanSdk =
    cargo.match(/soroban-sdk\s*=\s*\{\s*version\s*=\s*"([^"]+)"/)?.[1] ?? null;

  return {
    package: cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown",
    version: cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0",
    sorobanSdk: rawSorobanSdk?.replace(/^=/, "") ?? null
  };
}

const sourceFiles = [paths.cargo, paths.lib, paths.events, paths.errors];
const artifact = {
  schema: "https://splitnaira.dev/schemas/contract-interface.v1.json",
  schemaVersion: 1,
  generatedBy: "contracts/scripts/generate-interface.mjs",
  sourceHash: sourceHash(sourceFiles),
  sources: sourceFiles.map(repoRelative),
  contract: {
    name: "SplitNairaContract",
    ...parseCargoMetadata()
  },
  methods: parseMethods(),
  events: parseEvents(),
  types: parseContractTypes(),
  errors: parseErrors()
};

writeFileSync(paths.output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Generated ${repoRelative(paths.output)}`);
