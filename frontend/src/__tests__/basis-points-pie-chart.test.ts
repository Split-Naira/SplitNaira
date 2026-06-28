import { describe, it, expect } from "vitest";
import type { PieChartEntry } from "../components/BasisPointsPieChart";

function buildChartData(collaborators: PieChartEntry[]) {
  const hasData = collaborators.some((c) => c.basisPoints > 0);
  if (!hasData) return [{ name: "Unallocated", value: 10_000 }];
  return collaborators.filter((c) => c.basisPoints > 0).map((c) => ({ name: c.alias || "Unnamed", value: c.basisPoints }));
}

function getAllocationStatus(total: number): "exact" | "over" | "under" | "empty" {
  if (total === 10_000) return "exact";
  if (total > 10_000)  return "over";
  if (total > 0)       return "under";
  return "empty";
}

describe("BasisPointsPieChart - data computation", () => {
  it("returns placeholder slice when all bp = 0", () => {
    const data = buildChartData([{ alias: "Alice", basisPoints: 0 }, { alias: "Bob", basisPoints: 0 }]);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({ name: "Unallocated", value: 10_000 });
  });
  it("filters zero-bp entries and maps correctly", () => {
    const data = buildChartData([{ alias: "Lead Vocals", basisPoints: 5_000 }, { alias: "Drums", basisPoints: 3_000 }, { alias: "Bass", basisPoints: 0 }]);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ name: "Lead Vocals", value: 5_000 });
  });
  it("uses Unnamed for empty alias", () => {
    const data = buildChartData([{ alias: "", basisPoints: 4_000 }]);
    expect(data[0].name).toBe("Unnamed");
  });
  it("reports over when total > 10000", () => { expect(getAllocationStatus(11_000)).toBe("over"); });
  it("reports under when total between 1-9999", () => { expect(getAllocationStatus(7_500)).toBe("under"); });
  it("reports exact when total = 10000", () => { expect(getAllocationStatus(10_000)).toBe("exact"); });
  it("reports empty when total = 0", () => { expect(getAllocationStatus(0)).toBe("empty"); });
  it("3-collaborator real-world split sums to 10000", () => {
    const collabs: PieChartEntry[] = [{ alias: "Producer", basisPoints: 4_000 }, { alias: "Vocals", basisPoints: 3_500 }, { alias: "Mixing", basisPoints: 2_500 }];
    const total = collabs.reduce((s, c) => s + c.basisPoints, 0);
    expect(total).toBe(10_000);
    expect(getAllocationStatus(total)).toBe("exact");
  });
});