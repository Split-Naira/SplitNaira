import { describe, expect, it } from "vitest";
import {
  compareOwnershipSnapshot,
  reconcileOwnershipSnapshots,
  resolveAuthoritativeOwner,
  type OwnershipSnapshot,
} from "../ownership-reconcile.js";

const base = (over: Partial<OwnershipSnapshot> = {}): OwnershipSnapshot => ({
  projectId: "proj-1",
  dbOwner: "GDBOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  chainOwner: "GDBOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  ...over,
});

describe("ownership snapshot reconciliation (#1633)", () => {
  it("reports match when db and chain agree (case-insensitive)", () => {
    const snap = base({
      dbOwner: "gdbownerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      chainOwner: "GDBOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });
    expect(compareOwnershipSnapshot(snap)).toBeNull();
    const report = reconcileOwnershipSnapshots([snap]);
    expect(report.matches).toBe(1);
    expect(report.mismatches).toHaveLength(0);
  });

  it("reports mismatch without implying db should overwrite chain", () => {
    const snap = base({
      dbOwner: "GDBONLYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      chainOwner: "GCHAINXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });
    const mismatch = compareOwnershipSnapshot(snap);
    expect(mismatch).not.toBeNull();
    expect(mismatch!.authoritative).toBe("chain");
    expect(mismatch!.chainOwner).toContain("GCHAIN");
    expect(resolveAuthoritativeOwner(snap)).toBe(mismatch!.chainOwner);
  });

  it("does not promote db owner when chain is missing", () => {
    const snap = base({ chainOwner: null });
    const mismatch = compareOwnershipSnapshot(snap);
    expect(mismatch).not.toBeNull();
    expect(resolveAuthoritativeOwner(snap)).toBeNull();
  });

  it("aggregates batch mismatches and incomplete counts", () => {
    const report = reconcileOwnershipSnapshots([
      base(),
      base({ projectId: "p2", dbOwner: "GA", chainOwner: "GB" }),
      base({ projectId: "p3", dbOwner: null, chainOwner: "GC" }),
    ]);
    expect(report.checked).toBe(3);
    expect(report.matches).toBe(1);
    expect(report.mismatches).toHaveLength(2);
    expect(report.incomplete).toBeGreaterThanOrEqual(1);
    // Boundary: empty batch
    expect(reconcileOwnershipSnapshots([]).checked).toBe(0);
  });
});
