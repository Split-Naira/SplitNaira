/* @vitest-environment jsdom */

/**
 * Explorer-link coverage for DashboardView (#1331).
 *
 * Before this fix, the allowlist/recovery/pause confirmation panels each
 * built their "View on Explorer" link with a hardcoded
 * `https://stellar.expert/explorer/testnet/...` string, bypassing the
 * centralized `lib/explorer.ts` helper that every other transaction link
 * in the app goes through. A mainnet transaction rendered through one of
 * these three panels linked to an explorer that has never heard of it.
 *
 * These tests render the real `getTransactionExplorerUrl` from
 * `lib/explorer.ts` (not a mock) through `DashboardView`'s `getExplorerUrl`
 * prop, and assert — for every network the app claims to support — that
 * each of the three panels links to that network's explorer and to no
 * other.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DashboardView } from "./DashboardView";
import type { AllowlistActionResult } from "./DashboardView";
import {
  SUPPORTED_NETWORKS,
  getTransactionExplorerUrl,
  type SupportedNetwork,
} from "@/lib/explorer";
import type { SplitProject } from "@/lib/stellar";
import type { WalletState } from "@/lib/wallet";

function noop() {
  // intentionally empty
}

async function asyncNoop(): Promise<void> {}
async function asyncNoopUnknown(): Promise<unknown> {
  return null;
}

function buildBaseProps(overrides: Record<string, unknown> = {}) {
  return {
    wallet: { connected: true, address: "GADMIN", network: "testnet" } as WalletState,
    isContractAdmin: true,
    tokenAllowlist: {
      admin: "GADMIN",
      allowedTokenCount: 0,
      tokens: [] as string[],
      start: 0,
      limit: 10,
    },
    isLoadingAllowlist: false,
    isUpdatingAllowlist: false,
    allowlistTokenInput: "",
    setAllowlistTokenInput: noop,
    isValidAllowlistToken: false,
    normalizedAllowlistToken: "",
    onSubmitAllowlistAction: async (_action: "allow" | "disallow") => {},
    lastAllowlistTx: null as AllowlistActionResult | null,
    refreshTokenAllowlist: asyncNoopUnknown,
    isLoadingDashboard: false,
    dashboardData: [] as SplitProject[],
    userEarnings: {} as Record<string, string>,
    adminStatus: { admin: "GADMIN", isPaused: false },
    isLoadingAdminStatus: false,
    refreshAdminStatus: asyncNoopUnknown,
    showPauseConfirm: false,
    setShowPauseConfirm: noop,
    showUnpauseConfirm: false,
    setShowUnpauseConfirm: noop,
    isSubmittingPause: false,
    lastPauseTxHash: null as string | null,
    onTogglePause: async (_action: "pause" | "unpause") => {},
    recoveryTokenInput: "",
    setRecoveryTokenInput: noop,
    isLoadingUnallocated: false,
    unallocatedError: null,
    unallocatedBalance: null,
    onInspectUnallocated: asyncNoop,
    recoveryToInput: "",
    setRecoveryToInput: noop,
    recoveryAmountInput: "",
    setRecoveryAmountInput: noop,
    showRecoveryConfirm: false,
    setShowRecoveryConfirm: noop,
    isSubmittingRecovery: false,
    onConfirmRecovery: asyncNoop,
    lastRecoveryTxHash: null as string | null,
    setActiveTab: noop,
    setSearchProjectId: noop,
    setFetchedProject: noop,
    // The real helper, not a mock — passed through exactly as
    // split-app-legacy.tsx does, returning null (not a fallback string)
    // for an unsupported network. These tests exist to prove the wiring
    // reaches lib/explorer.ts, not just that some function got called.
    getExplorerUrl: getTransactionExplorerUrl,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("DashboardView explorer links", () => {
  it.each(SUPPORTED_NETWORKS)(
    "links the allowlist confirmation to the %s explorer, not testnet by default",
    (network: SupportedNetwork) => {
      const txHash = "ALLOWLISTHASH123";
      render(
        <DashboardView
          {...(buildBaseProps({
            wallet: { connected: true, address: "GADMIN", network },
            lastAllowlistTx: {
              action: "allow",
              token: "GTOKEN",
              txHash,
            } as AllowlistActionResult,
          }) as never)}
        />,
      );

      const link = screen.getByRole("link", { name: /view on explorer/i });
      const expected = getTransactionExplorerUrl(txHash, network);
      expect(expected).toBeTruthy();
      expect(link).toHaveAttribute("href", expected as string);
    },
  );

  it.each(SUPPORTED_NETWORKS)(
    "links the recovery confirmation to the %s explorer, not testnet by default",
    (network: SupportedNetwork) => {
      const txHash = "RECOVERYHASH456";
      render(
        <DashboardView
          {...(buildBaseProps({
            wallet: { connected: true, address: "GADMIN", network },
            lastRecoveryTxHash: txHash,
          }) as never)}
        />,
      );

      const link = screen.getByRole("link", { name: /view on explorer/i });
      const expected = getTransactionExplorerUrl(txHash, network);
      expect(expected).toBeTruthy();
      expect(link).toHaveAttribute("href", expected as string);
    },
  );

  it.each(SUPPORTED_NETWORKS)(
    "links the pause confirmation to the %s explorer, not testnet by default",
    (network: SupportedNetwork) => {
      const txHash = "PAUSEHASH789";
      render(
        <DashboardView
          {...(buildBaseProps({
            wallet: { connected: true, address: "GADMIN", network },
            lastPauseTxHash: txHash,
          }) as never)}
        />,
      );

      const link = screen.getByRole("link", { name: /view on explorer/i });
      const expected = getTransactionExplorerUrl(txHash, network);
      expect(expected).toBeTruthy();
      expect(link).toHaveAttribute("href", expected as string);
    },
  );

  it("mainnet and testnet allowlist links never point at the same explorer host", () => {
    const txHash = "SAMEHASHDIFFERENTNETWORKS";

    const { unmount } = render(
      <DashboardView
        {...(buildBaseProps({
          wallet: { connected: true, address: "GADMIN", network: "testnet" },
          lastAllowlistTx: { action: "allow", token: "GTOKEN", txHash } as AllowlistActionResult,
        }) as never)}
      />,
    );
    const testnetHref = screen.getByRole("link", { name: /view on explorer/i }).getAttribute("href");
    unmount();
    cleanup();

    render(
      <DashboardView
        {...(buildBaseProps({
          wallet: { connected: true, address: "GADMIN", network: "mainnet" },
          lastAllowlistTx: { action: "allow", token: "GTOKEN", txHash } as AllowlistActionResult,
        }) as never)}
      />,
    );
    const mainnetHref = screen.getByRole("link", { name: /view on explorer/i }).getAttribute("href");

    expect(testnetHref).toContain("/explorer/testnet/");
    expect(mainnetHref).toContain("/explorer/public/");
    expect(testnetHref).not.toEqual(mainnetHref);
  });

  it("renders no explorer link (rather than a wrong-network one) when the wallet's network is unrecognised", () => {
    render(
      <DashboardView
        {...(buildBaseProps({
          wallet: { connected: true, address: "GADMIN", network: "some-unknown-network" },
          lastPauseTxHash: "UNKNOWNNETWORKHASH",
        }) as never)}
      />,
    );

    // No hardcoded fallback: an unrecognised network must not silently
    // produce a testnet (or any other) link.
    expect(screen.queryByRole("link", { name: /view on explorer/i })).not.toBeInTheDocument();
  });
});
