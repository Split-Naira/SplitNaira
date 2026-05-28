import { describe, expect, it } from "vitest";
import { Address } from "@stellar/stellar-sdk";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import {
  STELLAR_ADDRESS_HEADER,
  canAccessProject,
  createUnauthorizedProjectAccessError,
  parseStellarAddressHeader,
  type ProjectAccessTarget,
} from "./auth.js";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const COLLABORATOR = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

describe("AuthService", () => {
  describe("parseStellarAddressHeader", () => {
    it("accepts a valid Stellar address and trims whitespace", () => {
      const result = parseStellarAddressHeader(`  ${VALID_ADDRESS}  `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.address).toBe(VALID_ADDRESS);
        expect(() => Address.fromString(result.address)).not.toThrow();
      }
    });

    it("rejects a missing header", () => {
      const result = parseStellarAddressHeader(undefined);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(AppError);
        expect(result.error.type).toBe(ErrorType.AUTH);
        expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
        expect(result.error.message).toContain(STELLAR_ADDRESS_HEADER);
        expect(result.error.message).toContain("Missing required header");
      }
    });

    it("rejects an empty string header", () => {
      const result = parseStellarAddressHeader("   ");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(ErrorType.AUTH);
        expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
      }
    });

    it("rejects non-string header values (e.g. array)", () => {
      const result = parseStellarAddressHeader([
        VALID_ADDRESS,
      ] as unknown as string);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(ErrorType.AUTH);
        expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
      }
    });

    it("rejects malformed addresses with a validation error", () => {
      const result = parseStellarAddressHeader("not-a-stellar-address");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(ErrorType.VALIDATION);
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.error.message).toContain("Invalid Stellar address");
      }
    });

    it("rejects addresses with an invalid prefix", () => {
      const result = parseStellarAddressHeader(
        "XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe(ErrorType.VALIDATION);
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });
  });

  describe("canAccessProject", () => {
    const target: ProjectAccessTarget = {
      owner: VALID_ADDRESS,
      collaborators: [COLLABORATOR],
    };

    it("allows the project owner", () => {
      expect(canAccessProject(VALID_ADDRESS, target)).toBe(true);
    });

    it("allows a listed collaborator", () => {
      expect(canAccessProject(COLLABORATOR, target)).toBe(true);
    });

    it("denies a wallet that is neither owner nor collaborator", () => {
      expect(canAccessProject(OTHER_ADDRESS, target)).toBe(false);
    });

    it("denies when collaborators is empty and requester is not the owner", () => {
      const ownerOnly: ProjectAccessTarget = {
        owner: VALID_ADDRESS,
        collaborators: [],
      };

      expect(canAccessProject(OTHER_ADDRESS, ownerOnly)).toBe(false);
      expect(canAccessProject(VALID_ADDRESS, ownerOnly)).toBe(true);
    });

    it("allows owner even when they also appear in collaborators", () => {
      const shared: ProjectAccessTarget = {
        owner: VALID_ADDRESS,
        collaborators: [VALID_ADDRESS, COLLABORATOR],
      };

      expect(canAccessProject(VALID_ADDRESS, shared)).toBe(true);
    });
  });

  describe("createUnauthorizedProjectAccessError", () => {
    it("returns a consistent unauthorized AppError", () => {
      const error = createUnauthorizedProjectAccessError();

      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe(ErrorType.AUTH);
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.message).toBe(
        "You are not authorized to access this project.",
      );
    });
  });
});
