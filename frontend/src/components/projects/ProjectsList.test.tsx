/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectsList } from "./ProjectsList";
import type { SplitProject } from "@/lib/stellar";
import type { WalletState } from "@/lib/wallet";

const wallet: WalletState = { connected: false, address: null, network: "testnet" };

const buildProject = (overrides: Partial<SplitProject> = {}): SplitProject => ({
  projectId: "P1",
  title: "Default Project",
  projectType: "App",
  token: "",
  owner: "GOWNER",
  collaborators: [{ address: "GADDR1", alias: "Alice", basisPoints: 10_000 }],
  locked: false,
  totalDistributed: "0",
  distributionRound: 0,
  balance: "0",
  ...overrides,
});

function baseProps(overrides: Partial<ComponentProps<typeof ProjectsList>> = {}) {
  return {
    wallet,
    selectedProjectId: null,
    setSelectedProjectId: vi.fn(),
    projectsList: [] as SplitProject[],
    onFetchProjectsList: vi.fn().mockResolvedValue(undefined),
    isLoadingProjectsList: false,
    projectsListError: null,
    isProjectsListStale: false,
    hasMoreProjects: false,
    fetchedProject: null,
    setFetchedProject: vi.fn(),
    fetchHistory: vi.fn().mockResolvedValue(undefined),
    isLoadingHistory: false,
    history: [],
    historyError: null,
    isHistoryStale: false,
    historyCursor: null,
    setShowDistributeModal: vi.fn(),
    adminStatus: null,
    receipt: null,
    sorobanSplitFlowBusy: false,
    getExplorerUrl: vi.fn().mockReturnValue("https://example.com"),
    getExplorerLabel: vi.fn().mockReturnValue("Explorer"),
    ...overrides,
  };
}

const searchInput = () => screen.getByRole("textbox", { name: /search projects/i });
const clearButton = () => screen.getByRole("button", { name: /clear search/i });

describe("ProjectsList search and filtering", () => {
  it("renders all projects when no search query is entered (baseline)", () => {
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.getByText("Beta Launch")).toBeInTheDocument();
  });

  it("narrows results when searching by project title", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    await user.type(searchInput(), "Alpha");

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.queryByText("Beta Launch")).not.toBeInTheDocument();
  });

  it("narrows results when searching by collaborator alias", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({
        projectId: "P1",
        title: "Alpha Rocket",
        collaborators: [{ address: "GADDR1", alias: "Zara", basisPoints: 10_000 }],
      }),
      buildProject({
        projectId: "P2",
        title: "Beta Launch",
        collaborators: [{ address: "GADDR2", alias: "Marcus", basisPoints: 10_000 }],
      }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    await user.type(searchInput(), "zara");

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.queryByText("Beta Launch")).not.toBeInTheDocument();
  });

  it("narrows results when searching by collaborator address", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({
        projectId: "P1",
        title: "Alpha Rocket",
        collaborators: [{ address: "GSPECIALADDRESS", alias: "Zara", basisPoints: 10_000 }],
      }),
      buildProject({
        projectId: "P2",
        title: "Beta Launch",
        collaborators: [{ address: "GOTHERADDRESS", alias: "Marcus", basisPoints: 10_000 }],
      }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    await user.type(searchInput(), "specialaddress");

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.queryByText("Beta Launch")).not.toBeInTheDocument();
  });

  it("restores full results when the Clear button is clicked", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    await user.type(searchInput(), "Alpha");
    expect(screen.queryByText("Beta Launch")).not.toBeInTheDocument();

    await user.click(clearButton());

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.getByText("Beta Launch")).toBeInTheDocument();
    expect(searchInput()).toHaveValue("");
  });

  it("restores full results when the search text is manually cleared by deleting", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    const input = searchInput();
    await user.type(input, "Alpha");
    expect(screen.queryByText("Beta Launch")).not.toBeInTheDocument();

    await user.clear(input);

    expect(screen.getByText("Alpha Rocket")).toBeInTheDocument();
    expect(screen.getByText("Beta Launch")).toBeInTheDocument();
  });

  it("shows a distinct no-matches empty state when a search yields zero of N loaded projects", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    await user.type(searchInput(), "nonexistent-project-xyz");

    expect(screen.getByText(/no projects match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/no projects found\. click refresh projects to load\./i)).not.toBeInTheDocument();
    // A way to clear the search from this empty state too (in addition to the
    // always-present header Clear button, the empty state itself renders one).
    expect(screen.getAllByRole("button", { name: /clear search/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("shows the original empty state when zero projects are loaded at all (no search active)", () => {
    render(<ProjectsList {...baseProps({ projectsList: [] })} />);

    expect(screen.getByText(/no projects found\. click refresh projects to load\./i)).toBeInTheDocument();
    expect(screen.queryByText(/no projects match your search/i)).not.toBeInTheDocument();
  });

  it("keeps keyboard focus on the search input across multiple sequential keystrokes", async () => {
    const user = userEvent.setup();
    const projectsList = [
      buildProject({ projectId: "P1", title: "Alpha Rocket" }),
      buildProject({ projectId: "P2", title: "Beta Launch" }),
    ];
    render(<ProjectsList {...baseProps({ projectsList })} />);

    const input = searchInput();
    await user.click(input);
    expect(input).toHaveFocus();

    for (const char of "Alpha") {
      await user.keyboard(char);
      expect(input).toHaveFocus();
      expect(document.activeElement).toBe(input);
    }
  });
});

describe("ProjectsList payout receipts", () => {
  it("links a payout to its receipt, but not a distribution round", () => {
    const hash = "a".repeat(64);
    const history = [
      { id: "payment-1", type: "payment" as const, round: 1, amount: "100", recipient: "GRECIPIENT", ledgerCloseTime: 1_700_000_000, txHash: hash },
      { id: "round-1", type: "round" as const, round: 1, amount: "100", recipient: "", ledgerCloseTime: 1_700_000_000, txHash: "b".repeat(64) },
    ];
    render(<ProjectsList {...baseProps({ selectedProjectId: "P1", fetchedProject: buildProject(), history })} />);

    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute("href", `/receipts/${hash}`);
  });
});
