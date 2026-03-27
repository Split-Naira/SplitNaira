import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SplitApp } from "./split-app";
import { ToastProvider } from "./toast-provider";

const mocks = vi.hoisted(() => ({
  mockGetFreighterWalletState: vi.fn(),
  mockConnectFreighter: vi.fn(),
  mockSignWithFreighter: vi.fn(),
  mockGetSplit: vi.fn(),
  mockGetProjectHistory: vi.fn(),
  mockBuildLockProjectXdr: vi.fn(),
  mockBuildDistributeXdr: vi.fn(),
  mockBuildCreateSplitXdr: vi.fn(),
  mockSendTransaction: vi.fn()
}));

vi.mock("@/lib/freighter", () => ({
  getFreighterWalletState: mocks.mockGetFreighterWalletState,
  connectFreighter: mocks.mockConnectFreighter,
  signWithFreighter: mocks.mockSignWithFreighter
}));

vi.mock("@/lib/api", () => ({
  getSplit: mocks.mockGetSplit,
  getProjectHistory: mocks.mockGetProjectHistory,
  buildLockProjectXdr: mocks.mockBuildLockProjectXdr,
  buildDistributeXdr: mocks.mockBuildDistributeXdr,
  buildCreateSplitXdr: mocks.mockBuildCreateSplitXdr
}));

vi.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: () => true,
    isValidContract: () => true
  },
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      sendTransaction: mocks.mockSendTransaction
    }))
  },
  Transaction: vi.fn()
}));

function renderSplitApp() {
  return render(
    <ToastProvider>
      <SplitApp />
    </ToastProvider>
  );
}

const baseProject = {
  projectId: "project_1",
  title: "Project One",
  projectType: "music",
  token: "G_TOKEN",
  owner: "GOWNER123",
  collaborators: [
    { address: "GCOLLAB1", alias: "Lead", basisPoints: 6000 },
    { address: "GCOLLAB2", alias: "Producer", basisPoints: 4000 }
  ],
  locked: false,
  totalDistributed: "0",
  distributionRound: 0,
  balance: "1000"
};

async function loadProject() {
  const user = userEvent.setup();
  renderSplitApp();

  await user.click(screen.getByRole("button", { name: "Manage & Distribute" }));
  await user.type(screen.getByPlaceholderText(/Enter Project ID/i), "project_1");
  await user.click(screen.getByRole("button", { name: "Fetch Stats" }));

  await screen.findByText("Project One");
  return user;
}

describe("SplitApp lock project flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetFreighterWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetProjectHistory.mockResolvedValue([]);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithFreighter.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildLockProjectXdr.mockResolvedValue({
      xdr: "LOCK_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_1" });
  });

  it("shows lock button for owner when project is unlocked", async () => {
    await loadProject();
    expect(screen.getByRole("button", { name: "Lock Project" })).toBeInTheDocument();
  });

  it("hides lock button for non-owner", async () => {
    mocks.mockGetFreighterWalletState.mockResolvedValue({
      connected: true,
      address: "GNOTOWNER",
      network: "testnet"
    });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).not.toBeInTheDocument();
  });

  it("hides lock button and shows locked indicator when already locked", async () => {
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, locked: true });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).not.toBeInTheDocument();
    expect(screen.getByText("Split locked - immutable")).toBeInTheDocument();
  });

  it("renders warning text and cancel closes modal without lock action", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Lock Project" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This action is permanent and cannot be undone. Once locked, the split configuration can never be changed."
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mocks.mockBuildLockProjectXdr).not.toHaveBeenCalled();
  });

  it("confirms lock action and disables confirm button while locking", async () => {
    let resolveLock: (() => void) | null = null;
    mocks.mockBuildLockProjectXdr.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLock = () =>
            resolve({
              xdr: "LOCK_XDR",
              metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
            });
        })
    );

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Lock Project" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Lock Project" }));

    expect(within(dialog).getByRole("button", { name: "Locking..." })).toBeDisabled();

    resolveLock?.();
    await waitFor(() => {
      expect(mocks.mockBuildLockProjectXdr).toHaveBeenCalledWith("project_1", "GOWNER123");
    });
  });
});
