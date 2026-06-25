import { describe, it, expect } from "vitest";
import { toCollaboratorScVal } from "../services/contract-helpers.js";

describe("toCollaboratorScVal", () => {
  it("should throw an error if alias exceeds 100 characters", () => {
    const longAlias = "a".repeat(101);
    
    expect(() => {
      toCollaboratorScVal({
        address: "GDTM6Q3ZGE4A4I7V2B2D7N4X2O4YI6L4S4Z4L6U3Y6V4Q2Z2F4E2K4M4",
        alias: longAlias,
        basisPoints: 5000
      });
    }).toThrow("Alias too long");
  });

  it("should not throw an error if alias is 100 characters or less", () => {
    const validAlias = "a".repeat(100);
    
    expect(() => {
      toCollaboratorScVal({
        address: "GDTM6Q3ZGE4A4I7V2B2D7N4X2O4YI6L4S4Z4L6U3Y6V4Q2Z2F4E2K4M4",
        alias: validAlias,
        basisPoints: 5000
      });
    }).not.toThrow();
  });
});
