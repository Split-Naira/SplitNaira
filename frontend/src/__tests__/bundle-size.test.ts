import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const configPath = path.resolve(frontendDir, "bundle-budget.config.json");

describe("frontend bundle budget", () => {
  it("bundle budget configuration exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.bundles).toBeDefined();
    expect(Array.isArray(config.bundles)).toBe(true);
    expect(config.bundles.length).toBeGreaterThan(0);

    for (const bundle of config.bundles) {
      expect(bundle.name).toBeDefined();
      expect(typeof bundle.maxSizeKB).toBe("number");
      expect(bundle.maxSizeKB).toBeGreaterThan(0);
    }
  });

  it("bundle sizes are defined for critical entry points", () => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const bundleNames = config.bundles.map((b) => b.name);

    expect(bundleNames).toContain("main");
    expect(bundleNames).toContain("vendor");
  });

  it("bundle budget thresholds are reasonable", () => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    for (const bundle of config.bundles) {
      expect(bundle.maxSizeKB).toBeLessThan(2000);
      expect(bundle.maxSizeKB).toBeGreaterThan(10);
    }
  });
});
