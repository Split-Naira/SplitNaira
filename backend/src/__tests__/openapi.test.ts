import { describe, it, expect } from "vitest";
import SwaggerParser from "@apidevtools/swagger-parser";
import { generateOpenApi } from "../openapi.js";

describe("OpenAPI specification", () => {
  it("generates a valid OpenAPI document without $ref errors", async () => {
    const spec = generateOpenApi();

    for (const pathItem of Object.values(spec.paths ?? {})) {
      for (const operation of Object.values(pathItem ?? {})) {
        if (operation && typeof operation === "object" && "summary" in operation) {
          expect(operation.summary).toBeTruthy();
          expect(String(operation.summary).trim().length).toBeGreaterThan(0);
        }
      }
    }

    await expect(SwaggerParser.validate(spec)).resolves.toBeDefined();
  });
});
