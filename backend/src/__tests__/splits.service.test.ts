import { describe, it, expect, vi } from "vitest";
import { buildDepositUnsignedXdr } from "../services/splits.service.js";

// Mock the splits service to return a specific project configuration
vi.mock("../services/splits.service.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetchProjectById: vi.fn().mockResolvedValue({
      token: "PROJECT_TOKEN_ADDRESS"
    })
  };
});

describe("buildDepositUnsignedXdr", () => {
  it("should fail if the token does not match the project token", async () => {
    await expect(
      buildDepositUnsignedXdr({
        projectId: "test_project",
        from: "GDTM6Q3ZGE4A4I7V2B2D7N4X2O4YI6L4S4Z4L6U3Y6V4Q2Z2F4E2K4M4",
        amount: 100,
        token: "WRONG_TOKEN_ADDRESS"
      })
    ).rejects.toThrow("Token address does not match project token address");
  });
});
