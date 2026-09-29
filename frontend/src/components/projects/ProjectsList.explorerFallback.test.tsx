/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectsList } from "./ProjectsList";
import {
  getExplorerLabel,
  getTransactionExplorerUrl,
} from "@/lib/explorer";
import type { ProjectHistoryItem } from "@/lib/api";
import type { SplitProject } from "@/lib/stellar";
import type { WalletState } from "@/lib/wallet";

const HASH = "b".repeat(64);

const project: SplitProject = {
  projectId: "P1",
  title: "Default Project",
  projectType: "App",
  token: "",
  owner: "GOWNER",
  collaborators: [{ address: "GADDR1", alias: "Alice", basisPoints: 10_000 }],
  locked: false,
  totalDistributed: "0",
  distributionRound: 1,
  balance: "500",
};

const history: ProjectHistoryItem[] = [
  {
    id: "payment-1",
    type: "payment",
    round: 1,
    amount: "100",
    recipient: "GRECIPIENT",
    ledgerCloseTime: 1_700_000_000,
    txHash: HASH,
  },
];

const wallet = (network: string | null): WalletState => ({
  connected: true,
  address: "GVIEWER",
  network,
});

function baseProps(
  network: string | null,
  overrides: Partial<ComponentProps<typeof ProjectsList>> = {},
) {
  return {
    wallet: wallet(network),
    selectedProjectId: "P1",
    setSelectedProjectId: vi.fn(),
    projectsList: [project],
    onFetchProjectsList: vi.fn().mockResolvedValue(undefined),
    isLoadingProjectsList: false,
    projectsListError: null,
    isProjectsListStale: false,
    hasMoreProjects: false,
    fetchedProject: project,
    setFetchedProject: vi.fn(),
    fetchHistory: vi.fn().mockResolvedValue(undefined),
    isLoadingHistory: false,
    history,
    historyError: null,
    isHistoryStale: false,
    historyCursor: null,
    setShowDistributeModal: vi.fn(),
    adminStatus: null,
    receipt: null,
    sorobanSplitFlowBusy: false,
    // The real explorer helpers, so this exercises the actual null contract
    // rather than a stubbed stub of it.
    getExplorerUrl: getTransactionExplorerUrl,
    getExplorerLabel,
    ...overrides,
  };
}

describe("ProjectsList explorer link fallback", () => {
  it("links each history row to the matching explorer on a supported network", () => {
    render(<ProjectsList {...baseProps("testnet")} />);

    const link = screen.getByTestId("history-explorer-link");
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
    expect(link).toHaveTextContent(/Stellar\.expert \(Testnet\)/);
    expect(
      screen.queryByTestId("history-explorer-link-unavailable"),
    ).toBeNull();
  });

  it("renders a readable fallback instead of an href-less anchor on an unsupported network", () => {
    render(<ProjectsList {...baseProps("futurenet")} />);

    expect(screen.queryByTestId("history-explorer-link")).toBeNull();
    expect(
      screen.getByTestId("history-explorer-link-unavailable"),
    ).toHaveTextContent(/Explorer link unavailable for this network/i);
  });

  it("renders the fallback when no wallet network is known", () => {
    render(<ProjectsList {...baseProps(null)} />);

    expect(screen.queryByTestId("history-explorer-link")).toBeNull();
    expect(
      screen.getByTestId("history-explorer-link-unavailable"),
    ).toBeInTheDocument();
  });

  it("keeps the receipt link working independently of the history fallback", () => {
    render(<ProjectsList {...baseProps("futurenet")} />);

    // The payment row still offers its in-app receipt, which does not depend
    // on an explorer URL at all.
    expect(
      screen.getByRole("link", { name: "View receipt" }),
    ).toHaveAttribute("href", `/receipts/${HASH}`);
  });
});
