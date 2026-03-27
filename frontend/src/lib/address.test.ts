import { describe, expect, it } from "vitest";

import { isOwner } from "./address";

describe("isOwner", () => {
  it("returns true for matching addresses", () => {
    expect(isOwner("GABC123", "GABC123")).toBe(true);
  });

  it("returns true for case-insensitive matches", () => {
    expect(isOwner("gabc123", "GABC123")).toBe(true);
  });

  it("returns false for mismatched addresses", () => {
    expect(isOwner("GABC123", "GDEF456")).toBe(false);
  });

  it("returns false when connected address is null or undefined", () => {
    expect(isOwner("GABC123", null)).toBe(false);
    expect(isOwner("GABC123", undefined)).toBe(false);
  });
});
