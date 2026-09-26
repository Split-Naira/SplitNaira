import { describe, expect, it } from "vitest";
import {
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
