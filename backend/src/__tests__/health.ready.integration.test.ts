import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { clearEnvCache } from "../config/env.js";
import { initDatabase, closeDatabase } from "../services/database.js";

// This test is an integration test that runs only in CI where a Postgres
// service is provided (the CI workflow sets `CI=true` and `DATABASE_URL`).
const shouldRun = process.env.CI === "true" && !!process.env.DATABASE_URL;

const maybeDescribe = shouldRun ? describe : describe.skip;

maybeDescribe("/health readiness (integration)", () => {
  beforeAll(async () => {
    clearEnvCache();
    await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("executes a simple SELECT 1 against Postgres", async () => {
    const ds = await initDatabase();
    const rows = await ds.query("SELECT 1 AS one");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("one");
  });
});
