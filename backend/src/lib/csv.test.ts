import { describe, expect, it } from "vitest";
import { toCsvRow, toSafeCsvCell } from "./csv.js";

describe("toSafeCsvCell", () => {
  it("returns a plain value unchanged", () => {
    expect(toSafeCsvCell("hello")).toBe("hello");
    expect(toSafeCsvCell(1000)).toBe("1000");
  });

  it("renders null and undefined as an empty cell", () => {
    expect(toSafeCsvCell(null)).toBe("");
    expect(toSafeCsvCell(undefined)).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(toSafeCsvCell("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(toSafeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(toSafeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it.each(["=cmd", "+cmd", "-cmd", "@cmd", "\tcmd", "\rcmd"])(
    "neutralizes a formula-triggering value %j with a leading apostrophe",
    (value) => {
      const result = toSafeCsvCell(value);
      // The apostrophe must land right before the trigger character so
      // spreadsheet apps render it as literal text, not a formula.
      expect(result.replace(/^"|"$/g, "")).toMatch(/^'[=+\-@\t\r]/);
    },
  );

  it("does not neutralize a value that merely contains a trigger character mid-string", () => {
    expect(toSafeCsvCell("total=5")).toBe("total=5");
  });

  it("still quotes a neutralized formula value that also contains a comma", () => {
    // e.g. "=cmd|'calc'!A1,B1" — starts with '=' AND has a comma
    const result = toSafeCsvCell("=SUM(A1,B1)");
    expect(result).toBe('"\'=SUM(A1,B1)"');
  });
});

describe("toCsvRow", () => {
  it("joins cells with commas and terminates with CRLF", () => {
    expect(toCsvRow(["a", "b", 3])).toBe("a,b,3\r\n");
  });

  it("safely formats every cell in the row", () => {
    expect(toCsvRow(["=evil", "plain", null])).toBe("'=evil,plain,\r\n");
  });
});
