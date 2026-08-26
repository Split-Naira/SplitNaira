#!/usr/bin/env node
/**
 * Synthetic contract check for GET /ops/mainnet-readiness.
 *
 * Usage:
 *   BACKEND_URL=https://api.example.com node scripts/check-mainnet-readiness.mjs
 *
 * Set REQUIRE_READY=true for a deployment gate. Without it, either the normal
 * ready (200) or diagnostic not_ready (503) response is accepted as long as
 * the response shape remains compatible.
 */
const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");
const requireReady = process.env.REQUIRE_READY === "true";
const endpoint = `${backendUrl}/ops/mainnet-readiness`;

function fail(message) {
  throw new Error(`Mainnet readiness synthetic check failed: ${message}`);
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
}

function assertResponseShape(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("response must be a JSON object");
  if (body.status !== "ready" && body.status !== "not_ready") fail("status must be ready or not_ready");
  if (typeof body.requestId !== "string" || body.requestId.length === 0) fail("requestId must be a non-empty string");

  const components = body.components;
  if (!components || typeof components !== "object" || Array.isArray(components)) fail("components must be an object");
  for (const name of ["env", "db", "cache", "deploy"]) {
    if (!components[name] || typeof components[name] !== "object") fail(`components.${name} must be an object`);
    assertBoolean(components[name].ok, `components.${name}.ok`);
  }
}

async function main() {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => fail("response is not valid JSON"));
  assertResponseShape(body);

  if (response.status !== 200 && response.status !== 503) {
    fail(`expected HTTP 200 or 503, received ${response.status}`);
  }
  if (response.status === 200 && body.status !== "ready") {
    fail("HTTP 200 response must have status=ready");
  }
  if (response.status === 503 && body.status !== "not_ready") {
    fail("HTTP 503 response must have status=not_ready");
  }
  if (requireReady && (!response.ok || body.status !== "ready")) {
    fail(`expected a ready response, received HTTP ${response.status} (${body.status})`);
  }

  console.log(`Mainnet readiness response shape passed (HTTP ${response.status}, status=${body.status}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
