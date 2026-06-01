import { describe, expect, it } from "vitest";
import {
  normalizeDeployEnvironment,
  resolveDeployTarget,
  validateDeployConfig,
  validateProductionSecrets,
} from "./deploy-config";

describe("deploy-config", () => {
  describe("normalizeDeployEnvironment", () => {
    it("accepts staging and production values case-insensitively", () => {
      expect(normalizeDeployEnvironment("staging")).toBe("staging");
      expect(normalizeDeployEnvironment("Production")).toBe("production");
      expect(normalizeDeployEnvironment(" PRODuction ")).toBe("production");
    });

    it("throws for invalid environments", () => {
      expect(() => normalizeDeployEnvironment("invalid")).toThrow(
        /Invalid deploy environment: invalid/,
      );
    });
  });

  describe("resolveDeployTarget", () => {
    it("prefers explicit input over repo variable", () => {
      expect(resolveDeployTarget("render", "custom")).toBe("render");
    });

    it("falls back to repo variable when input is empty", () => {
      expect(resolveDeployTarget("", "render")).toBe("render");
      expect(resolveDeployTarget(undefined, "RENDER")).toBe("render");
    });

    it("uses default render target when no inputs are provided", () => {
      expect(resolveDeployTarget(undefined, undefined)).toBe("render");
    });
  });

  describe("validateProductionSecrets", () => {
    it("throws when required production secrets are missing", () => {
      expect(() => validateProductionSecrets({})).toThrow(
        /Missing required production secrets: RENDER_BACKEND_DEPLOY_HOOK_URL, MAINNET_CONTRACT_ID/,
      );
    });

    it("passes when required production secrets are present", () => {
      expect(() =>
        validateProductionSecrets({
          RENDER_BACKEND_DEPLOY_HOOK_URL: "https://example.com/hook",
          MAINNET_CONTRACT_ID: "CABC...",
        }),
      ).not.toThrow();
    });
  });

  describe("validateDeployConfig", () => {
    it("returns normalized values for staging without production secrets", () => {
      expect(validateDeployConfig({ deployEnvironment: "staging" })).toEqual({
        deployEnvironment: "staging",
        deployTarget: "render",
      });
    });

    it("validates production environment and secrets", () => {
      expect(validateDeployConfig({
        deployEnvironment: "production",
        deployTarget: "render",
        secrets: {
          RENDER_BACKEND_DEPLOY_HOOK_URL: "https://example.com/hook",
          MAINNET_CONTRACT_ID: "CABC...",
        },
      })).toEqual({
        deployEnvironment: "production",
        deployTarget: "render",
      });
    });
  });
});
