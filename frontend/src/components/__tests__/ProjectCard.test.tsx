/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ProjectCard } from "../ProjectCard";
import type { SplitProject } from "@/lib/stellar";

const baseProject = (overrides: Partial<SplitProject> = {}): SplitProject => ({
  projectId: "P123",
  title: "Test Project",
  projectType: "App",
  token: "",
  owner: "GABC",
  collaborators: [{ address: "G1", alias: "Alice", basisPoints: 100 }],
  locked: false,
  totalDistributed: "0",
  distributionRound: 1,
  balance: "1500",
  ...overrides,
});

describe("ProjectCard", () => {
  it("renders unlocked project without Locked badge", () => {
    render(<ProjectCard project={baseProject()} />);

    expect(screen.getByText(/Test Project/)).toBeTruthy();
    expect(screen.queryByText(/Locked/)).toBeNull();
    expect(screen.getByText(/Available|Earnings/)).toBeTruthy();
  });

  it("renders locked project with Locked badge", () => {
    render(<ProjectCard project={baseProject({ locked: true })} />);

    expect(screen.getByText(/Locked/)).toBeTruthy();
    expect(screen.getByText(/Test Project/)).toBeTruthy();
  });
});
