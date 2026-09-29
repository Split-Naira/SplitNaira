import { describe, expect, it } from "vitest";
import {
  BASIS_POINTS_TOTAL,
  shouldBlockSubmit,
  validateParticipantPercentages,
} from "./ParticipantPercentageValidation";

describe("participant percentage validation UI (issue #1301)", () => {
  it("shows 100% as valid when basis points sum to 10000", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 6000 },
      { basisPoints: 4000 },
    ]);
    expect(r.isValid).toBe(true);
    expect(r.totalPercent).toBe(100);
    expect(r.totalBasisPoints).toBe(10000);
    expect(r.invalidShares).toEqual([]);
  });

  it("highlights invalid totals under 100%", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 3000 },
      { basisPoints: 3000 },
    ]);
    expect(r.isValid).toBe(false);
    expect(r.totalPercent).toBe(60);
    expect(r.message).toMatch(/add/i);
  });

  it("highlights invalid totals over 100%", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 7000 },
      { basisPoints: 4000 },
    ]);
    expect(r.isValid).toBe(false);
    expect(r.totalPercent).toBe(110);
    expect(r.message).toMatch(/reduce/i);
  });

  it("prevents invalid submission via shouldBlockSubmit", () => {
    expect(shouldBlockSubmit([{ basisPoints: 5000 }])).toBe(true);
    expect(
      shouldBlockSubmit([{ basisPoints: 5000 }, { basisPoints: 5000 }])
    ).toBe(false);
  });
});

describe("participant percentage validation – individual shares (#1301)", () => {
  it("rejects a negative share even when the total is exactly 100%", () => {
    const shares = [
      { label: "Ada", basisPoints: 10500 },
      { label: "Ben", basisPoints: -500 },
    ];
    const r = validateParticipantPercentages(shares);

    expect(r.isValid).toBe(false);
    expect(shouldBlockSubmit(shares)).toBe(true);
    expect(r.invalidShares.map((s) => s.problem)).toEqual(["above_total", "negative"]);
    expect(r.invalidShares.map((s) => s.label)).toEqual(["Ada", "Ben"]);
  });

  it("excludes impossible shares from the reported total", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 10500 },
      { basisPoints: -500 },
    ]);

    // -500 and 10500 are both unusable, so neither is counted.
    expect(r.totalBasisPoints).toBe(0);
    expect(r.totalPercent).toBe(0);
  });

  it("rejects fractional basis points, which the server cannot store", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 10000.5 },
      { basisPoints: -0.5 },
    ]);

    expect(r.isValid).toBe(false);
    expect(r.invalidShares.map((s) => s.problem)).toEqual([
      "not_whole_basis_points",
      "not_whole_basis_points",
    ]);
  });

  it("rejects a share that is not a number", () => {
    const r = validateParticipantPercentages([
      { basisPoints: Number.NaN },
      { basisPoints: BASIS_POINTS_TOTAL },
    ]);

    expect(r.isValid).toBe(false);
    expect(r.invalidShares).toHaveLength(1);
    expect(r.invalidShares[0].problem).toBe("not_a_number");
    // The usable share is still totalled, so the message can stay useful.
    expect(r.totalBasisPoints).toBe(BASIS_POINTS_TOTAL);
  });

  it("names the offending participant in the message", () => {
    const r = validateParticipantPercentages([
      { label: "Ada", basisPoints: 6000 },
      { label: "Ben", basisPoints: -1 },
    ]);

    expect(r.message).toMatch(/Ben/);
    expect(r.message).toMatch(/negative/i);
  });

  it("counts the remaining broken shares in the message", () => {
    const r = validateParticipantPercentages([
      { label: "Ada", basisPoints: -1 },
      { label: "Ben", basisPoints: -2 },
      { label: "Cleo", basisPoints: 10002 },
    ]);

    expect(r.invalidShares).toHaveLength(3);
    expect(r.message).toMatch(/Ada/);
    expect(r.message).toMatch(/And 2 more shares need fixing/);
  });

  it("accepts a zero share, which is a legitimate exclusion", () => {
    const r = validateParticipantPercentages([
      { basisPoints: 10000 },
      { basisPoints: 0 },
    ]);

    expect(r.isValid).toBe(true);
    expect(r.invalidShares).toEqual([]);
  });

  it("treats a missing participant list as an empty, invalid form", () => {
    const r = validateParticipantPercentages(undefined as never);
    expect(r.totalBasisPoints).toBe(0);
    expect(r.isValid).toBe(false);
  });

  it("blocks submission when only the individual shares are broken", () => {
    const shares = [
      { basisPoints: 10500 },
      { basisPoints: -500 },
    ];
    // Sums to exactly 10000, so a total-only check would let this through.
    expect(
      shares.reduce((sum, s) => sum + s.basisPoints, 0)
    ).toBe(BASIS_POINTS_TOTAL);
    expect(shouldBlockSubmit(shares)).toBe(true);
  });
});
