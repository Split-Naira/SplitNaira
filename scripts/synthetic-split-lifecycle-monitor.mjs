#!/usr/bin/env node

// Synthetic monitor for the create-deposit-distribute split lifecycle read path.
// Non-mutating: exercises read endpoints against a known testnet project ID
// and reports latency + failure so operators have signal beyond /health.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";
const MONITOR_PROJECT_ID = process.env.SYNTHETIC_PROJECT_ID;
// Alert if the read path exceeds this latency (ms) or fails outright.
const LATENCY_ALERT_MS = Number(process.env.SYNTHETIC_LATENCY_ALERT_MS ?? 2000);

async function timedGet(path) {
  const start = Date.now();
  const res = await fetch(`${BACKEND_URL}${path}`, { signal: AbortSignal.timeout(5000) });
  const durationMs = Date.now() - start;
  if (!res.ok) throw new Error(`${path} returned ${res.status} after ${durationMs}ms`);
  return { durationMs, body: await res.json() };
}

async function run() {
  if (!MONITOR_PROJECT_ID) {
    throw new Error("SYNTHETIC_PROJECT_ID env var is required");
  }

  const project = await timedGet(`/api/projects/${MONITOR_PROJECT_ID}`);
  const splits = await timedGet(`/api/projects/${MONITOR_PROJECT_ID}/splits`);

  const worst = Math.max(project.durationMs, splits.durationMs);
  const result = { status: worst > LATENCY_ALERT_MS ? "degraded" : "ok", worstLatencyMs: worst };

  console.log(JSON.stringify(result));
  if (result.status === "degraded") process.exitCode = 1;
}

run().catch((err) => {
  console.error(JSON.stringify({ status: "error", message: String(err) }));
  process.exitCode = 1;
});
