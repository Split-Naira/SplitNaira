import { describe, expect, it } from "vitest";
import { SOFT_DELETE_RETENTION_DAYS, isPastRetention, purgeEligibleAt } from "./soft-delete.js";

describe("purgeEligibleAt", () => {
  it("adds the retention window in days to deletedAt", () => {
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    const eligible = purgeEligibleAt(deletedAt);
    const expectedMs =
      deletedAt.getTime() + SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(eligible.getTime()).toBe(expectedMs);
  });
});

describe("isPastRetention", () => {
  const deletedAt = new Date("2026-01-01T00:00:00.000Z");

  it("is false the moment a record is deleted", () => {
    expect(isPastRetention(deletedAt, deletedAt)).toBe(false);
  });

  it("is false one day before the retention window ends", () => {
    const almostEligible = new Date(
      purgeEligibleAt(deletedAt).getTime() - 24 * 60 * 60 * 1000,
    );
    expect(isPastRetention(deletedAt, almostEligible)).toBe(false);
  });

  it("is true exactly at the retention boundary", () => {
    expect(isPastRetention(deletedAt, purgeEligibleAt(deletedAt))).toBe(true);
  });

  it("is true well after the retention window", () => {
    const wellAfter = new Date(
      purgeEligibleAt(deletedAt).getTime() + 365 * 24 * 60 * 60 * 1000,
    );
    expect(isPastRetention(deletedAt, wellAfter)).toBe(true);
  });
});
