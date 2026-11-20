/// <reference types="@testing-library/jest-dom" />
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SplitApp } from "./split-app";
import { ToastProvider } from "./toast-provider";
import { WalletProvider } from "./wallet-provider";

const mocks = vi.hoisted(() => ({
  mockUseWallet: vi.fn(),
  mockGetWalletState: vi.fn(),
  mockConnectWallet: vi.fn(),
  mockSignWithWallet: vi.fn(),
  mockGetAllSplits: vi.fn(),
  mockGetClaimable: vi.fn(),
  mockGetSplit: vi.fn(),
  mockGetProjectHistory: vi.fn(),
  mockGetTokenAllowlist: vi.fn(),
  mockBuildLockProjectXdr: vi.fn(),
  mockBuildDistributeXdr: vi.fn(),
  mockBuildCreateSplitXdr: vi.fn(),
  mockBuildDepositXdr: vi.fn(),
  mockBuildAllowTokenXdr: vi.fn(),
  mockBuildDisallowTokenXdr: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockPollTransaction: vi.fn(),
  mockGetTransaction: vi.fn(),
  mockUseMaintenanceStatus: vi.fn()
}));

// Default: no maintenance-mode gating for the pre-existing test suites below.
// Individual tests in the "#934 maintenance-mode write gating" describe
// block override this per-case.
beforeEach(() => {
  mocks.mockUseMaintenanceStatus.mockReturnValue({
    status: "ok",
    isWriteDisabled: false,
    message: undefined
  });
});

vi.mock("@/hooks/useMaintenanceStatus", () => ({
  useMaintenanceStatus: mocks.mockUseMaintenanceStatus
}));

vi.mock("@/lib/wallet", () => {
  const mockRpc = () => ({
    sendTransaction: mocks.mockSendTransaction,
    pollTransaction: mocks.mockPollTransaction,
    getTransaction: mocks.mockGetTransaction
  });
  return {
    getWalletState: mocks.mockGetWalletState,
    connectWallet: mocks.mockConnectWallet,
    signWithWallet: mocks.mockSignWithWallet,
    createSorobanRpcServer: mockRpc,
    // Mirrors lib/soroban-transaction: only an accepted submission resolves.
    sendSorobanTransaction: async (server: ReturnType<typeof mockRpc>, transaction: unknown) => {
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status !== "PENDING" && submitResponse.status !== "DUPLICATE") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction rejected.");
      }
      return { hash: submitResponse.hash as string };
    },
    submitSorobanTransactionAndPoll: async (
      server: ReturnType<typeof mockRpc>,
      transaction: unknown,
      options?: { afterSubmitted?: (hash: string) => void; pollAttempts?: number }
    ) => {
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR" || submitResponse.status === "TRY_AGAIN_LATER") {
        throw new Error(
          submitResponse.errorResult?.toString() ?? "Transaction rejected."
        );
      }
      const hash = submitResponse.hash as string | undefined;
      if (!hash) {
        throw new Error("Submission did not return a transaction hash.");
      }
      options?.afterSubmitted?.(hash);
      const polled = await server.pollTransaction(hash, {
        attempts: options?.pollAttempts ?? 90
      });
      if (polled.status !== "SUCCESS") {
        throw new Error(`Unexpected transaction status: ${String(polled.status)}`);
      }
      return { hash };
    }
  };
});

vi.mock("@/hooks/useWallet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const WalletContext = React.createContext(null);
  return {
    useWallet: mocks.mockUseWallet,
    useWalletState: () => {
      try {
        const val = mocks.mockUseWallet();
        if (val) return val;
      } catch (err) {
        void err;
      }
      return {
        wallet: null,
        loading: false,
        error: null,
        connect: vi.fn(),
        refresh: vi.fn(),
        disconnect: vi.fn()
      };
    },
    WalletContext
  };
});

vi.mock("@/lib/api", () => ({
  getAllSplits: mocks.mockGetAllSplits,
  listProjects: vi.fn().mockImplementation(async (...args) => {
    await mocks.mockGetSplit("dummy-id");
    return mocks.mockGetAllSplits(...args);
  }),
  getClaimable: mocks.mockGetClaimable,
  getSplit: mocks.mockGetSplit,
  getProjectHistory: mocks.mockGetProjectHistory,
  getTokenAllowlist: mocks.mockGetTokenAllowlist,
  buildLockProjectXdr: mocks.mockBuildLockProjectXdr,
  buildDistributeXdr: mocks.mockBuildDistributeXdr,
  buildCreateSplitXdr: mocks.mockBuildCreateSplitXdr,
  buildDepositXdr: mocks.mockBuildDepositXdr,
  buildAllowTokenXdr: mocks.mockBuildAllowTokenXdr,
  buildDisallowTokenXdr: mocks.mockBuildDisallowTokenXdr,
  buildUpdateMetadataXdr: vi.fn().mockResolvedValue({ xdr: "MOCK_UPDATE_METADATA_XDR" }),
  buildUpdateCollaboratorsXdr: vi.fn().mockResolvedValue({ xdr: "MOCK_UPDATE_COLLAB_XDR" }),
  getUnallocatedBalance: vi.fn().mockResolvedValue({ balance: "0", owner: "" }),
  buildWithdrawUnallocatedXdr: vi.fn().mockResolvedValue({ xdr: "MOCK_WITHDRAW_XDR" }),
  getAdminStatus: vi.fn().mockResolvedValue({ paused: false, admin: "GOWNER123" }),
  buildPauseDistributionsXdr: vi.fn().mockResolvedValue({ xdr: "MOCK_PAUSE_XDR" }),
  buildUnpauseDistributionsXdr: vi.fn().mockResolvedValue({ xdr: "MOCK_UNPAUSE_XDR" })
}));

vi.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: () => true,
    isValidContract: () => true
  },
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      sendTransaction: mocks.mockSendTransaction,
      pollTransaction: mocks.mockPollTransaction
    }))
  },
  Transaction: vi.fn(function MockStellarTransaction(this: { toXDR: () => string }) {
    this.toXDR = () => "MOCK_TX_XDR";
  })
}));

function renderSplitApp() {
  return render(
    <ToastProvider>
      <WalletProvider>
        <SplitApp />
      </WalletProvider>
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

const baseAllowlist = {
  admin: "GOWNER123",
  allowedTokenCount: 1,
  tokens: ["CTOKEN1"],
  start: 0,
  limit: 100
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
    mocks.mockUseWallet.mockReturnValue({
      wallet: {
        connected: true,
        address: "GOWNER123",
        network: "testnet"
      },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildLockProjectXdr.mockResolvedValue({
      xdr: "LOCK_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockBuildDepositXdr.mockResolvedValue({
      xdr: "DEPOSIT_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockBuildAllowTokenXdr.mockResolvedValue({
      xdr: "ALLOW_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockBuildDisallowTokenXdr.mockResolvedValue({
      xdr: "DISALLOW_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_1" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("shows lock button for owner when project is unlocked", async () => {
    await loadProject();
    expect(screen.getByRole("button", { name: "Lock Project" })).toBeTruthy();
  });

  it("hides lock button for non-owner", async () => {
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GNOTOWNER", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GNOTOWNER",
      network: "testnet"
    });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
  });

  it("hides lock button and shows locked indicator when already locked", async () => {
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, locked: true });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
    expect(screen.getByText("Split locked - immutable")).toBeTruthy();
  });

  it("renders warning text and cancel closes modal without lock action", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Lock Project" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(
        "This action is permanent and cannot be undone. Once locked, the split configuration can never be changed."
      )
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
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

    expect(
      within(dialog).getByRole("button", { name: /Signing & locking|Confirming on ledger/i })
    ).toHaveProperty("disabled", true);

    const flushLock = resolveLock as (() => void) | null;
    if (flushLock) {
      flushLock();
    }
    await waitFor(() => {
      expect(mocks.mockBuildLockProjectXdr).toHaveBeenCalledWith("project_1", "GOWNER123");
    });
  });
});

// ============================================================
//  ISSUE #174 — Owner-gating & Lock Lifecycle UI Tests
// ============================================================

describe("Issue #174: owner gating and lock lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: {
        connected: true,
        address: "GOWNER123",
        network: "testnet"
      },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildLockProjectXdr.mockResolvedValue({
      xdr: "LOCK_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "LIFECYCLE_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("non-owner without wallet connection cannot see lock button and sees no locked banner on unlocked project", async () => {
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: false, address: null, network: null },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: false,
      address: null,
      network: null
    });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
    expect(screen.queryByText("Split locked - immutable")).toBeNull();
  });

  it("non-owner with wallet connected to a different address cannot lock", async () => {
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GATTACKER_NOT_OWNER", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GATTACKER_NOT_OWNER",
      network: "testnet"
    });

    await loadProject();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
  });

  it("owner sees both lock button AND no locked banner on unlocked project", async () => {
    await loadProject();
    expect(screen.getByRole("button", { name: "Lock Project" })).toBeTruthy();
    expect(screen.queryByText("Split locked - immutable")).toBeNull();
    expect(screen.queryByText(/Locked state active/)).toBeNull();
  });

  it("locked project shows both locked-immutable badge and 'Locked state active' secondary message", async () => {
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, locked: true });

    await loadProject();
    expect(screen.getByText("Split locked - immutable")).toBeTruthy();
    expect(screen.getByText(/Locked state active/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
  });

  it("lifecycle: confirming the lock modal invokes buildLockProjectXdr with owner address and project id", async () => {
    const user = await loadProject();
    expect(screen.getByRole("button", { name: "Lock Project" })).toBeTruthy();
    expect(screen.queryByText("Split locked - immutable")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Lock Project" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Lock Project" }));

    await waitFor(() => {
      expect(mocks.mockBuildLockProjectXdr).toHaveBeenCalledWith("project_1", "GOWNER123");
    });
    // Owner address is forwarded to the backend so the contract's owner-gating check can reject non-owners.
    expect(mocks.mockBuildLockProjectXdr).toHaveBeenCalledTimes(1);
  });

  it("even a non-owner viewing a locked project sees the locked banner (observer view)", async () => {
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GRANDOM_USER", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GRANDOM_USER",
      network: "testnet"
    });
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, locked: true });

    await loadProject();
    expect(screen.getByText("Split locked - immutable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lock Project" })).toBeNull();
  });
});

describe("SplitApp admin allowlist flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: {
        connected: true,
        address: "GOWNER123",
        network: "testnet"
      },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildAllowTokenXdr.mockResolvedValue({
      xdr: "ALLOW_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockBuildDisallowTokenXdr.mockResolvedValue({
      xdr: "DISALLOW_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "ALLOWLIST_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("shows the admin allowlist panel for the configured admin wallet", async () => {
    renderSplitApp();

    expect(await screen.findByText("Admin Token Allowlist")).toBeTruthy();
    expect(screen.getByText("CTOKEN1")).toBeTruthy();
  });

  it("hides the admin allowlist panel for a non-admin wallet", async () => {
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GNOTADMIN",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);

    renderSplitApp();

    await waitFor(() => {
      expect(screen.queryByText("Admin Token Allowlist")).toBeNull();
    });
  });

  it("submits an allow-token action and refreshes allowlist state", async () => {
    const user = userEvent.setup();
    const updatedAllowlist = {
      ...baseAllowlist,
      allowedTokenCount: 2,
      tokens: ["CTOKEN1", "CTOKEN2"]
    };
    mocks.mockGetTokenAllowlist.mockReset();
    mocks.mockGetTokenAllowlist.mockResolvedValueOnce(baseAllowlist);
    mocks.mockGetTokenAllowlist.mockResolvedValue(updatedAllowlist);

    renderSplitApp();

    await screen.findByRole("heading", { name: "Admin Token Allowlist" });
    const allowlistPanel = screen
      .getByRole("heading", { name: "Admin Token Allowlist" })
      .closest(".glass-card") as HTMLElement;
    expect(allowlistPanel).toBeTruthy();
    await user.type(
      within(allowlistPanel).getByPlaceholderText(/Enter token address to allow or disallow/i),
      "CTOKEN2"
    );
    await user.click(within(allowlistPanel).getByRole("button", { name: "Allow Token" }));

    await waitFor(() => {
      expect(mocks.mockBuildAllowTokenXdr).toHaveBeenCalledWith("GOWNER123", "CTOKEN2");
    });
    await waitFor(() => {
      expect(mocks.mockGetTokenAllowlist.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect((await screen.findAllByText("CTOKEN2")).length).toBeGreaterThan(0);
  });
});

describe("SplitApp distribute flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: {
        connected: true,
        address: "GOWNER123",
        network: "testnet"
      },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, balance: "5000" });
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildDistributeXdr.mockResolvedValue({
      xdr: "DISTRIBUTE_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "DIST_TX_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("shows distribute button when project has balance and wallet connected", async () => {
    await loadProject();
    expect(screen.getByRole("button", { name: "Trigger Distribution" })).toBeTruthy();
  });

  it("opens distribution modal with Final Confirmation heading", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));

    expect(screen.getByRole("heading", { name: "Final Confirmation" })).toBeTruthy();
    expect(screen.getByText(/Splitting/)).toBeTruthy();
    expect(screen.getByText("5,000 stroops")).toBeTruthy();
  });

  it("shows collaborator payment preview in modal", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));

    const modal = screen.getByRole("heading", { name: "Final Confirmation" }).parentElement;
    expect(within(modal!).getByText("60.00% Share")).toBeTruthy();
    expect(within(modal!).getByText("40.00% Share")).toBeTruthy();
  });

  it("cancels distribution when cancel button clicked", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Final Confirmation" })).toBeNull();
    });
    expect(mocks.mockBuildDistributeXdr).not.toHaveBeenCalled();
  });

  it("executes distribution and calls buildDistributeXdr", async () => {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    await user.click(screen.getByRole("button", { name: "Execute Payout" }));

    await waitFor(() => {
      expect(mocks.mockBuildDistributeXdr).toHaveBeenCalledWith("project_1", "GOWNER123");
    });
  });

  it("disables distribute button when wallet not connected", async () => {
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: false, address: null, network: null },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: false,
      address: null,
      network: null
    });

    await loadProject();
    expect(screen.getByRole("button", { name: "Trigger Distribution" })).toHaveProperty("disabled", true);
  });

  it("disables distribute button when balance is zero", async () => {
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, balance: "0" });

    await loadProject();
    expect(screen.getByRole("button", { name: "Trigger Distribution" })).toHaveProperty("disabled", true);
    expect(screen.getByText("No funds available to distribute")).toBeTruthy();
  });
});

// ============================================================
//  ISSUE #934 — maintenance-mode write-action gating
//
//  Demonstrative write-action gate: the "Execute Payout" button (the actual
//  distribution/write action, inside the distribute confirmation modal in
//  split-app-legacy.tsx) is disabled whenever useMaintenanceStatus() reports
//  isWriteDisabled — while the read-only flow of opening the confirmation
//  modal itself stays available.
// ============================================================

describe("SplitApp maintenance-mode write gating (#934)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, balance: "5000" });
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildDistributeXdr.mockResolvedValue({
      xdr: "DISTRIBUTE_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "DIST_TX_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("keeps Execute Payout enabled and callable when status is ok", async () => {
    mocks.mockUseMaintenanceStatus.mockReturnValue({
      status: "ok",
      isWriteDisabled: false,
      message: undefined
    });

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));

    expect(screen.getByRole("button", { name: "Execute Payout" })).toHaveProperty("disabled", false);
    expect(screen.queryByText("Unavailable during maintenance")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Execute Payout" }));
    await waitFor(() => {
      expect(mocks.mockBuildDistributeXdr).toHaveBeenCalledWith("project_1", "GOWNER123");
    });
  });

  it("disables Execute Payout and shows an inline note when status is maintenance", async () => {
    mocks.mockUseMaintenanceStatus.mockReturnValue({
      status: "maintenance",
      isWriteDisabled: true,
      message: "System is in maintenance mode."
    });

    const user = await loadProject();
    // Read-only flow — opening the confirmation modal — still works.
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    expect(screen.getByRole("heading", { name: "Final Confirmation" })).toBeTruthy();

    const payoutButton = screen.getByRole("button", { name: "Execute Payout" });
    expect(payoutButton).toHaveProperty("disabled", true);
    expect(screen.getByText("Unavailable during maintenance")).toBeTruthy();

    await user.click(payoutButton);
    expect(mocks.mockBuildDistributeXdr).not.toHaveBeenCalled();
  });

  it("does not disable Execute Payout for a merely 'degraded' status", async () => {
    mocks.mockUseMaintenanceStatus.mockReturnValue({
      status: "degraded",
      isWriteDisabled: false,
      message: "Some services are degraded."
    });

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));

    expect(screen.getByRole("button", { name: "Execute Payout" })).toHaveProperty("disabled", false);
    expect(screen.queryByText("Unavailable during maintenance")).toBeNull();
  });

  it("re-enables Execute Payout after leaving maintenance mode", async () => {
    mocks.mockUseMaintenanceStatus.mockReturnValue({
      status: "maintenance",
      isWriteDisabled: true,
      message: undefined
    });

    const user = userEvent.setup();
    const view = renderSplitApp();

    await user.click(screen.getByRole("button", { name: "Manage & Distribute" }));
    await user.type(screen.getByPlaceholderText(/Enter Project ID/i), "project_1");
    await user.click(screen.getByRole("button", { name: "Fetch Stats" }));
    await screen.findByText("Project One");

    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    expect(screen.getByRole("button", { name: "Execute Payout" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Unavailable during maintenance")).toBeTruthy();

    // Maintenance clears — simulate the hook's next poll tick reporting "ok".
    // Force a re-render (as the next poll tick's setState would) so the
    // SPA-root wrapper re-evaluates useMaintenanceStatus() and threads the
    // fresh isWriteDisabled value down as a prop.
    mocks.mockUseMaintenanceStatus.mockReturnValue({
      status: "ok",
      isWriteDisabled: false,
      message: undefined
    });
    view.rerender(
      <ToastProvider>
        <WalletProvider>
          <SplitApp />
        </WalletProvider>
      </ToastProvider>
    );

    expect(screen.getByRole("button", { name: "Execute Payout" })).toHaveProperty("disabled", false);
    expect(screen.queryByText("Unavailable during maintenance")).toBeNull();
  });
});

describe("SplitApp async state handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: {
        connected: true,
        address: "GOWNER123",
        network: "testnet"
      },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("keeps prior project visible and marks it stale when refresh fails", async () => {
    const user = await loadProject();
    mocks.mockGetSplit.mockRejectedValueOnce(new Error("network down"));

    await user.click(screen.getByRole("button", { name: "Fetch Stats" }));

    expect(await screen.findByText(/Showing stale project data/i)).toBeTruthy();
    expect(screen.getByText("Project One")).toBeTruthy();
  });

  it("shows history retry when history refresh fails after existing data", async () => {
    mocks.mockGetProjectHistory
      .mockResolvedValueOnce({
        items: [
          {
            id: "h1",
            type: "round",
            round: 1,
            amount: "100",
            recipient: "",
            ledgerCloseTime: 1700000000,
            txHash: "TX1"
          }
        ],
        nextCursor: null
      })
      .mockRejectedValueOnce(new Error("history unavailable"));

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Fetch Stats" }));

    expect(await screen.findAllByRole("button", { name: "Retry History" })).toBeTruthy();
    expect(screen.getAllByText(/Showing stale history data/i).length).toBeGreaterThan(0);
  });

  it("shows projects empty retry state when list requests fail", async () => {
    mocks.mockGetSplit.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderSplitApp();

    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(await screen.findByText(/Could not load projects\. Retry refresh\./i)).toBeTruthy();
  });
});

describe("SplitApp UX — skeleton loaders (#322)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
  });

  it("shows project card skeletons while the projects list is loading", async () => {
    let resolveList: (value: unknown) => void = () => {};
    mocks.mockGetAllSplits.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const user = userEvent.setup();
    renderSplitApp();
    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(screen.getByRole("status", { name: "Loading projects" })).toBeTruthy();

    resolveList([baseProject]);
    expect(await screen.findByText("Project One")).toBeTruthy();
  });
});

describe("SplitApp UX — optimistic metadata (#322)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_META" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("updates title optimistically after metadata save", async () => {
    const { buildUpdateMetadataXdr } = await import("@/lib/api");
    vi.mocked(buildUpdateMetadataXdr).mockResolvedValue({
      xdr: "META_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Edit Metadata" }));

    const titleInput = screen.getByDisplayValue("Project One");
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed Project");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Renamed Project")).toBeTruthy();
  });
});

// ============================================================
//  #1266 — Duplicate payment submission protection
// ============================================================

describe("#1266 duplicate payment submission protection", () => {
  const buildResponse = (xdr: string) => ({
    xdr,
    metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue({ ...baseProject, balance: "5000" });
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildDistributeXdr.mockResolvedValue(buildResponse("DISTRIBUTE_XDR"));
    mocks.mockBuildDepositXdr.mockResolvedValue(buildResponse("DEPOSIT_XDR"));
    mocks.mockBuildCreateSplitXdr.mockResolvedValue(buildResponse("CREATE_XDR"));
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "TX_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  async function openDeposit(amount = "10") {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Deposit Funds" }));
    const dialog = screen.getByRole("dialog", { name: "Deposit Funds" });
    await user.type(within(dialog).getByLabelText(/Amount \(in tokens\)/i), amount);
    return { user, dialog };
  }

  it("starts only one payout when Execute Payout is clicked twice before re-rendering", async () => {
    const pending = deferred<ReturnType<typeof buildResponse>>();
    mocks.mockBuildDistributeXdr.mockReturnValue(pending.promise);

    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    const payout = screen.getByRole("button", { name: "Execute Payout" });

    // Two synchronous clicks: no render happens in between, so the button's
    // `disabled` attribute can't be what stops the second one.
    act(() => {
      fireEvent.click(payout);
      fireEvent.click(payout);
    });

    await act(async () => pending.resolve(buildResponse("DISTRIBUTE_XDR")));
    await waitFor(() => expect(mocks.mockSendTransaction).toHaveBeenCalledTimes(1));
    expect(mocks.mockBuildDistributeXdr).toHaveBeenCalledTimes(1);
  });

  it("submits only one deposit when Confirm Deposit is clicked twice before re-rendering", async () => {
    const pending = deferred<ReturnType<typeof buildResponse>>();
    mocks.mockBuildDepositXdr.mockReturnValue(pending.promise);
    const { dialog } = await openDeposit();
    const confirm = within(dialog).getByRole("button", { name: "Confirm Deposit" });

    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(confirm).toHaveAttribute("aria-busy", "true");

    await act(async () => pending.resolve(buildResponse("DEPOSIT_XDR")));
    await waitFor(() => expect(mocks.mockSendTransaction).toHaveBeenCalledTimes(1));
    expect(mocks.mockBuildDepositXdr).toHaveBeenCalledTimes(1);
  });

  it("restores Confirm Deposit after a definitive failure so the user can retry", async () => {
    mocks.mockSignWithWallet.mockRejectedValueOnce(new Error("User rejected the request"));
    const { user, dialog } = await openDeposit();

    await user.click(within(dialog).getByRole("button", { name: "Confirm Deposit" }));
    await waitFor(() => expect(mocks.mockSignWithWallet).toHaveBeenCalledTimes(1));

    const confirm = await within(dialog).findByRole("button", { name: "Confirm Deposit" });
    await waitFor(() => expect(confirm).not.toBeDisabled());

    await user.click(confirm);
    await waitFor(() => expect(mocks.mockBuildDepositXdr).toHaveBeenCalledTimes(2));
    expect(mocks.mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps a deposit blocked while its transaction is unconfirmed, until Check status resolves it", async () => {
    mocks.mockPollTransaction.mockRejectedValueOnce(
      Object.assign(new Error("Transaction was submitted but not confirmed in time."), { name: "TimeoutError" })
    );
    const { user, dialog } = await openDeposit();

    await user.click(within(dialog).getByRole("button", { name: "Confirm Deposit" }));
    expect(await screen.findByRole("heading", { name: "Waiting for network confirmation" })).toBeTruthy();

    const confirm = within(dialog).getByRole("button", { name: "Confirm Deposit" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.mockBuildDepositXdr).toHaveBeenCalledTimes(1);

    // Still not found and inside the validity window: stays blocked.
    mocks.mockGetTransaction.mockResolvedValueOnce({ status: "NOT_FOUND" });
    await user.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(mocks.mockGetTransaction).toHaveBeenCalledWith("TX_HASH"));
    expect(screen.getByRole("heading", { name: "Waiting for network confirmation" })).toBeTruthy();
    expect(confirm).toBeDisabled();

    // The ledger reports a definitive outcome: unblocked.
    mocks.mockGetTransaction.mockResolvedValueOnce({ status: "SUCCESS" });
    await user.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Waiting for network confirmation" })).toBeNull()
    );
  });

  it("warns before leaving the page while a payout is in flight", async () => {
    const pending = deferred<ReturnType<typeof buildResponse>>();
    mocks.mockBuildDistributeXdr.mockReturnValue(pending.promise);
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Trigger Distribution" }));
    await user.click(screen.getByRole("button", { name: "Execute Payout" }));

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await act(async () => pending.resolve(buildResponse("DISTRIBUTE_XDR")));
  });

  describe("create split idempotency keys", () => {
    async function fillCreateForm() {
      const user = userEvent.setup();
      renderSplitApp();
      await user.click(screen.getByRole("button", { name: "Create" }));
      await user.type(screen.getByLabelText("Project Identifier"), "idem_project");
      await user.type(screen.getByLabelText("Display Title"), "Idem Project");
      await user.selectOptions(screen.getByLabelText(/Asset token/i), "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
      await user.type(screen.getByPlaceholderText("Recipient #1"), "GCOLLAB1");
      await user.type(screen.getByPlaceholderText("Recipient #2"), "GCOLLAB2");
      const aliases = screen.getAllByPlaceholderText("e.g. Lead Vocals");
      await user.type(aliases[0], "Lead");
      await user.type(aliases[1], "Producer");
      return user;
    }

    const keyOfCall = (n: number) =>
      (mocks.mockBuildCreateSplitXdr.mock.calls[n]?.[1] as { idempotencyKey?: string } | undefined)
        ?.idempotencyKey;

    it("reuses the key when retrying after a failure before submission, and rotates it once a transaction was submitted", async () => {
      // 1st attempt: wallet rejects (nothing reached the network).
      mocks.mockSignWithWallet.mockRejectedValueOnce(new Error("User rejected the request"));
      // 2nd attempt: submitted, then failed on ledger (sequence number spent).
      mocks.mockPollTransaction.mockResolvedValueOnce({ status: "FAILED" });

      const user = await fillCreateForm();
      await user.click(screen.getByRole("button", { name: /create split project/i }));
      await waitFor(() => expect(mocks.mockBuildCreateSplitXdr).toHaveBeenCalledTimes(1));

      await user.click(await screen.findByRole("button", { name: "Retry Submission" }));
      await waitFor(() => expect(mocks.mockBuildCreateSplitXdr).toHaveBeenCalledTimes(2));

      await user.click(await screen.findByRole("button", { name: "Retry Submission" }));
      await waitFor(() => expect(mocks.mockBuildCreateSplitXdr).toHaveBeenCalledTimes(3));

      expect(keyOfCall(0)).toEqual(expect.any(String));
      expect(keyOfCall(1)).toBe(keyOfCall(0));
      expect(keyOfCall(2)).not.toBe(keyOfCall(1));
    });

    it("starts only one create when the form is submitted twice before re-rendering", async () => {
      const pending = deferred<ReturnType<typeof buildResponse>>();
      mocks.mockBuildCreateSplitXdr.mockReturnValue(pending.promise);
      const user = await fillCreateForm();
      const submit = screen.getByRole("button", { name: /create split project/i });
      await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "false"));

      await act(async () => {
        fireEvent.submit(submit.closest("form")!);
        fireEvent.submit(submit.closest("form")!);
      });
      await act(async () => pending.resolve(buildResponse("CREATE_XDR")));

      await waitFor(() => expect(mocks.mockSendTransaction).toHaveBeenCalledTimes(1));
      expect(mocks.mockBuildCreateSplitXdr).toHaveBeenCalledTimes(1);
      void user;
    });
  });
});

// ============================================================
//  #1595 — Browser back/forward navigation in the create wizard
// ============================================================
//
// There's no client-side router for the tab switcher, so "back" leaves the
// SPA and "forward" lands on a freshly mounted page. The only way an
// in-progress submission survives that round trip is the per-account draft
// (lib/form-draft.ts, sessionStorage), and the only way a resubmission could
// be duplicated is if mounting replayed a pending request. Simulate the
// round trip by unmounting (back) and rendering fresh (forward).
describe("#1595 browser back/forward navigation in the create wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({
      connected: true,
      address: "GOWNER123",
      network: "testnet"
    });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildCreateSplitXdr.mockResolvedValue({
      xdr: "CREATE_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "TX_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("restores partially entered, validated values after the wizard is torn down and recreated (simulated back/forward)", async () => {
    const user = userEvent.setup();
    const view = renderSplitApp();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.type(screen.getByLabelText("Project Identifier"), "nav_project");
    await user.type(screen.getByLabelText("Display Title"), "Nav Project");
    await user.type(screen.getByPlaceholderText("Recipient #1"), "GCOLLAB1");

    // The draft is written on every change via watch(); let it flush.
    await waitFor(() =>
      expect(window.sessionStorage.getItem("splitnaira:draft:create:GOWNER123")).not.toBeNull()
    );

    // Simulated browser back (page torn down) then forward (fresh mount).
    view.unmount();
    renderSplitApp();

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByLabelText("Project Identifier")).toHaveValue("nav_project");
    expect(screen.getByLabelText("Display Title")).toHaveValue("Nav Project");
    expect(screen.getByPlaceholderText("Recipient #1")).toHaveValue("GCOLLAB1");
    expect(mocks.mockBuildCreateSplitXdr).not.toHaveBeenCalled();
  });

  it("does not auto-submit or duplicate a create transaction when the wizard remounts after navigation", async () => {
    const user = userEvent.setup();
    const view = renderSplitApp();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.type(screen.getByLabelText("Project Identifier"), "nav_project_2");
    await user.type(screen.getByLabelText("Display Title"), "Nav Project 2");
    await user.selectOptions(
      screen.getByLabelText(/Asset token/i),
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
    );
    await user.type(screen.getByPlaceholderText("Recipient #1"), "GCOLLAB1");
    await user.type(screen.getByPlaceholderText("Recipient #2"), "GCOLLAB2");
    const aliases = screen.getAllByPlaceholderText("e.g. Lead Vocals");
    await user.type(aliases[0], "Lead");
    await user.type(aliases[1], "Producer");

    await waitFor(() =>
      expect(window.sessionStorage.getItem("splitnaira:draft:create:GOWNER123")).not.toBeNull()
    );

    view.unmount();
    renderSplitApp();
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Remounting restores the draft but must never trigger a submission by
    // itself — only an explicit click does.
    expect(mocks.mockBuildCreateSplitXdr).not.toHaveBeenCalled();
    expect(mocks.mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ============================================================
//  #1267 — Accessible errors on the deposit (payment) form
// ============================================================

describe("#1267 deposit form accessible errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWallet.mockReturnValue({
      wallet: { connected: true, address: "GOWNER123", network: "testnet" },
      connect: vi.fn(),
      refresh: vi.fn()
    });
    mocks.mockGetWalletState.mockResolvedValue({ connected: true, address: "GOWNER123", network: "testnet" });
    mocks.mockGetAllSplits.mockResolvedValue([]);
    mocks.mockGetClaimable.mockResolvedValue({ claimed: "0", distributionRound: 0 });
    mocks.mockGetProjectHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mockGetTokenAllowlist.mockResolvedValue(baseAllowlist);
    mocks.mockGetSplit.mockResolvedValue(baseProject);
    mocks.mockSignWithWallet.mockResolvedValue("SIGNED_XDR");
    mocks.mockBuildDepositXdr.mockResolvedValue({
      xdr: "DEPOSIT_XDR",
      metadata: { networkPassphrase: "TESTNET", contractId: "CID" }
    });
    mocks.mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "TX_HASH" });
    mocks.mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  async function openDepositDialog() {
    const user = await loadProject();
    await user.click(screen.getByRole("button", { name: "Deposit Funds" }));
    const dialog = screen.getByRole("dialog", { name: "Deposit Funds" });
    return {
      user,
      dialog,
      amount: within(dialog).getByLabelText(/Amount \(in tokens\)/i),
      confirm: within(dialog).getByRole("button", { name: "Confirm Deposit" })
    };
  }

  const describedText = (el: HTMLElement) =>
    document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

  it("keeps Confirm Deposit focusable, and moves focus to the amount with an associated error when it is empty", async () => {
    const { user, amount, confirm } = await openDepositDialog();

    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(amount).toHaveAttribute("aria-invalid", "false");

    await user.click(confirm);

    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(describedText(amount)).toBe("Enter an amount to deposit.");
    expect(mocks.mockBuildDepositXdr).not.toHaveBeenCalled();
  });

  it.each([
    ["0", "Enter an amount greater than 0."],
    ["-5", "Enter an amount greater than 0."],
    ["1.12345678", "Use at most 7 decimal places."]
  ])("explains why %s is not a valid amount", async (value, message) => {
    const { user, amount, confirm } = await openDepositDialog();
    await user.type(amount, value);

    expect(describedText(amount)).toBe(message);
    await user.click(confirm);
    expect(amount).toHaveFocus();
    expect(mocks.mockBuildDepositXdr).not.toHaveBeenCalled();
  });

  it("clears the error once the amount is valid and submits", async () => {
    const { user, amount, confirm } = await openDepositDialog();
    await user.click(confirm);
    await user.type(amount, "2.5");

    expect(amount).toHaveAttribute("aria-invalid", "false");
    expect(amount).not.toHaveAttribute("aria-describedby");
    expect(confirm).toHaveAttribute("aria-disabled", "false");

    await user.click(confirm);
    await waitFor(() => expect(mocks.mockBuildDepositXdr).toHaveBeenCalledWith("project_1", "GOWNER123", 25_000_000));
  });
});
