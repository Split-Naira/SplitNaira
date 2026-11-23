import { describe, expect, it } from "vitest";

import {
  CANONICAL_SPLIT_RESPONSE_FIXTURE,
  LEGACY_SPLIT_RESPONSE_FIELDS,
  LEGACY_SPLIT_RESPONSE_FIXTURE,
  SPLIT_RESPONSE_COMPATIBILITY_WINDOW,
  normalizeSplitResponse,
} from "./split-response.compatibility.js";

describe("legacy split response compatibility fixtures (#1637)", () => {
  it("normalizes the legacy snake_case response to the canonical response", () => {
    expect(normalizeSplitResponse(LEGACY_SPLIT_RESPONSE_FIXTURE)).toEqual(
      CANONICAL_SPLIT_RESPONSE_FIXTURE,
    );
  });

  it("keeps the canonical camelCase response unchanged", () => {
    expect(normalizeSplitResponse(CANONICAL_SPLIT_RESPONSE_FIXTURE)).toEqual(
      CANONICAL_SPLIT_RESPONSE_FIXTURE,
    );
  });

  it("pins every supported legacy alias on both fixtures", () => {
    for (const field of LEGACY_SPLIT_RESPONSE_FIELDS) {
      if ("nestedIn" in field) {
        for (const collaborator of LEGACY_SPLIT_RESPONSE_FIXTURE.collaborators) {
          expect(collaborator, field.legacy).toHaveProperty(field.legacy);
        }
        for (const collaborator of CANONICAL_SPLIT_RESPONSE_FIXTURE.collaborators) {
          expect(collaborator, field.canonical).toHaveProperty(field.canonical);
        }
        continue;
      }

      expect(LEGACY_SPLIT_RESPONSE_FIXTURE, field.legacy).toHaveProperty(field.legacy);
      expect(CANONICAL_SPLIT_RESPONSE_FIXTURE, field.canonical).toHaveProperty(
        field.canonical,
      );
    }

    // Pinned field list: adding or removing a legacy alias is an API change.
    expect(LEGACY_SPLIT_RESPONSE_FIELDS.map((field) => field.legacy)).toEqual([
      "project_id",
      "project_type",
      "total_distributed",
      "distribution_round",
      "basis_points",
    ]);
  });

  it("prefers camelCase when a payload contains both casings", () => {
    const normalized = normalizeSplitResponse({
      ...LEGACY_SPLIT_RESPONSE_FIXTURE,
      projectId: "camel_wins",
      project_id: "legacy_loses",
      totalDistributed: "99",
      total_distributed: "11",
      collaborators: [
        {
          address: CANONICAL_SPLIT_RESPONSE_FIXTURE.collaborators[0].address,
          alias: "Producer",
          basisPoints: 9000,
          basis_points: 1000,
        },
      ],
    });

    expect(normalized.projectId).toBe("camel_wins");
    expect(normalized.totalDistributed).toBe("99");
    expect(normalized.collaborators[0].basisPoints).toBe(9000);
  });

  it("fills boundary defaults for a legacy response with absent optional fields", () => {
    const normalized = normalizeSplitResponse({
      project_id: "legacy_minimal",
      title: "Minimal",
    });

    expect(normalized).toEqual({
      projectId: "legacy_minimal",
      title: "Minimal",
      projectType: "",
      token: "",
      owner: "",
      locked: false,
      balance: "0",
      totalDistributed: "0",
      distributionRound: 0,
      collaborators: [],
    });
  });

  it("declares a valid compatibility window that sunsets after deprecation", () => {
    const deprecatedAt = new Date(
      SPLIT_RESPONSE_COMPATIBILITY_WINDOW.deprecatedAt,
    ).getTime();
    const sunset = new Date(SPLIT_RESPONSE_COMPATIBILITY_WINDOW.sunset).getTime();

    expect(Number.isNaN(deprecatedAt)).toBe(false);
    expect(Number.isNaN(sunset)).toBe(false);
    expect(sunset).toBeGreaterThan(deprecatedAt);
    expect(SPLIT_RESPONSE_COMPATIBILITY_WINDOW.preferredCasing).toBe("camelCase");
    expect(SPLIT_RESPONSE_COMPATIBILITY_WINDOW.legacyCasing).toBe("snake_case");
  });

  it("preserves financial precision as strings rather than coercing to numbers", () => {
    const normalized = normalizeSplitResponse({
      ...LEGACY_SPLIT_RESPONSE_FIXTURE,
      balance: "9007199254740993",
      total_distributed: "9007199254740995",
    });

    expect(normalized.balance).toBe("9007199254740993");
    expect(normalized.totalDistributed).toBe("9007199254740995");
    expect(typeof normalized.totalDistributed).toBe("string");
  });
});
