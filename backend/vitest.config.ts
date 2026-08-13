import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [
      "node_modules",
      "dist",
      "src/health/**",
      "src/mainnet/**",
      "src/observability/**"
    ]
  }
});
