/**
 * Issue #1264: WalletAuthChallenge component tests.
 *
 * Verifies:
 * - Explains why a signature is requested (not a payment).
 * - Distinguishes signing from payment approval.
 * - Handles rejection from the wallet (user cancelled).
 * - Handles challenge expiry and shows refresh UI.
 * - Safe challenge refresh calls onRefresh (never reuses expired nonce).
 * - Cancel is always available and calls onCancel.
 * - Sign button is disabled while awaiting wallet.
 * - Success state shown after onSign resolves.
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WalletAuthChallenge } from "../WalletAuthChallenge";

const FUTURE_EXPIRY = Date.now() + 5 * 60 * 1000; // 5 minutes from now
const EXPIRED_EXPIRY = Date.now() - 1000; // already expired

function renderChallenge(overrides: Partial<React.ComponentProps<typeof WalletAuthChallenge>> = {}) {
  const props: React.ComponentProps<typeof WalletAuthChallenge> = {
    challenge: "test-nonce-abc123",
    expiresAt: FUTURE_EXPIRY,
    onSign: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<WalletAuthChallenge {...props} />), props };
}

describe("WalletAuthChallenge — Issue #1264", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Explanation & payment distinction ─────────────────────────────────────

  it("explains that the signature is not a payment", () => {
    renderChallenge();
    expect(screen.getByText(/This is not a payment/i)).toBeInTheDocument();
    expect(screen.getByText(/No tokens will leave your wallet/i)).toBeInTheDocument();
  });

  it("has a title indicating identity verification (not funds)", () => {
    renderChallenge();
    expect(
      screen.getByRole("heading", { name: /sign to verify your identity/i })
    ).toBeInTheDocument();
  });

  it("renders as a dialog with accessible label", () => {
    renderChallenge();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "wallet-auth-title");
  });

  it("shows a security footer noting the signature is session-scoped", () => {
    renderChallenge();
    expect(
      screen.getByText(/SplitNaira never stores your private key/i)
    ).toBeInTheDocument();
  });

  // ── Sign flow ─────────────────────────────────────────────────────────────

  it("calls onSign with the challenge nonce when the sign button is clicked", async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    renderChallenge({ onSign });

    fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));

    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith("test-nonce-abc123");
    });
  });

  it("shows 'Waiting for wallet…' while onSign is pending", async () => {
    let resolveSign!: () => void;
    const onSign = vi.fn(
      () => new Promise<void>((resolve) => { resolveSign = resolve; })
    );

    renderChallenge({ onSign });
    fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/Waiting for wallet/i)).toBeInTheDocument();
    });

    // Sign button should be disabled while awaiting
    expect(
      screen.getByRole("button", { name: /Waiting for wallet/i })
    ).toBeDisabled();

    // Cancel is also disabled during signing
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

    // Resolve the sign promise
    act(() => { resolveSign(); });
    await waitFor(() => {
      expect(screen.queryByText(/Waiting for wallet/i)).not.toBeInTheDocument();
    });
  });

  it("shows success state after onSign resolves", async () => {
    renderChallenge({ onSign: vi.fn().mockResolvedValue(undefined) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Identity verified/i)).toBeInTheDocument();
    });
    // Sign button is gone after success
    expect(
      screen.queryByRole("button", { name: /sign to continue/i })
    ).not.toBeInTheDocument();
  });

  // ── Rejection handling ────────────────────────────────────────────────────

  it("shows rejection message when user rejects in their wallet", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("User rejected the request"));
    renderChallenge({ onSign });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Signature cancelled/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/You dismissed the signing request/i)).toBeInTheDocument();
  });

  it("shows rejection message when wallet reports 'cancelled'", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("Transaction cancelled by user"));
    renderChallenge({ onSign });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Signature cancelled/i)).toBeInTheDocument();
    });
  });

  it("allows retrying after rejection via 'Try again' button", async () => {
    const onSign = vi
      .fn()
      .mockRejectedValueOnce(new Error("User rejected the request"))
      .mockResolvedValueOnce(undefined);

    renderChallenge({ onSign });

    // First attempt — rejected
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Signature cancelled/i)).toBeInTheDocument();
    });

    // In rejected state, the primary button reads "Try again"
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();

    // Click "Start over" to reset to idle (or "Try again" which re-submits)
    // The component shows a "Start over" button to go back to idle
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    });

    // Back to idle — sign button visible again
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /sign to continue/i })
      ).toBeInTheDocument();
    });

    // Sign succeeds on second attempt
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Identity verified/i)).toBeInTheDocument();
    });
  });

  it("shows generic error for non-rejection failures", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("Network error during signing"));
    renderChallenge({ onSign });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Signing failed/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Something went wrong while requesting your signature/i)
      ).toBeInTheDocument();
    });
  });

  // ── Expiry handling ───────────────────────────────────────────────────────

  it("shows expired state when expiresAt is in the past", () => {
    renderChallenge({ expiresAt: EXPIRED_EXPIRY });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/This challenge has expired/i)).toBeInTheDocument();
    // Refresh button should be visible
    expect(
      screen.getByRole("button", { name: /get new challenge/i })
    ).toBeInTheDocument();
    // Sign button should not be visible when expired
    expect(
      screen.queryByRole("button", { name: /sign to continue/i })
    ).not.toBeInTheDocument();
  });

  it("shows a near-expiry warning when <= 30 seconds remain", () => {
    // Set expiry 15 seconds from now
    renderChallenge({ expiresAt: Date.now() + 15_000 });

    expect(screen.getByText(/please sign soon/i)).toBeInTheDocument();
  });

  it("shows a normal timer when more than 30 seconds remain", () => {
    renderChallenge({ expiresAt: Date.now() + 120_000 });

    expect(screen.getByText(/Challenge valid for/i)).toBeInTheDocument();
    expect(screen.queryByText(/please sign soon/i)).not.toBeInTheDocument();
  });

  // ── Safe challenge refresh ────────────────────────────────────────────────

  it("calls onRefresh when 'Get new challenge' is clicked on expired challenge", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderChallenge({ expiresAt: EXPIRED_EXPIRY, onRefresh });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /get new challenge/i }));
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading state during refresh", async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; })
    );

    renderChallenge({ expiresAt: EXPIRED_EXPIRY, onRefresh });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /get new challenge/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /requesting new challenge/i })
      ).toBeDisabled();
    });

    act(() => { resolveRefresh(); });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does not pass the old (expired) nonce to onSign after refresh", async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const { rerender } = renderChallenge({
      challenge: "old-expired-nonce",
      expiresAt: EXPIRED_EXPIRY,
      onSign,
      onRefresh,
      onCancel,
    });

    // Expired — refresh button should be visible
    expect(screen.getByRole("button", { name: /get new challenge/i })).toBeInTheDocument();

    // Refresh gives a new challenge — parent updates props
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /get new challenge/i }));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Parent updates props with the new nonce and a future expiry
    rerender(
      <WalletAuthChallenge
        challenge="new-fresh-nonce"
        expiresAt={Date.now() + 5 * 60 * 1000}
        onSign={onSign}
        onRefresh={onRefresh}
        onCancel={onCancel}
      />
    );

    // Sign button should now be visible with fresh challenge
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /sign to continue/i })
      ).toBeInTheDocument();
    });

    // Sign — must use the NEW nonce
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith("new-fresh-nonce");
      expect(onSign).not.toHaveBeenCalledWith("old-expired-nonce");
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    renderChallenge({ onCancel });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Cancel button is not shown after success", async () => {
    renderChallenge({ onSign: vi.fn().mockResolvedValue(undefined) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    });
  });

  // ── Screen-reader announcements (#1589) ───────────────────────────────────

  const politeRegion = () => screen.getByTestId("wallet-auth-live-polite");
  const assertiveRegion = () => screen.getByTestId("wallet-auth-live-assertive");

  it("announces awaiting signature when the wallet prompt opens", async () => {
    const onSign = vi.fn(() => new Promise<void>(() => {}));
    renderChallenge({ onSign });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(politeRegion()).toHaveTextContent(/Waiting for your wallet to sign/i);
    });
  });

  it("announces rejection assertively", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("User rejected the request"));
    renderChallenge({ onSign });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(assertiveRegion()).toHaveTextContent(/Signature request cancelled/i);
    });
  });

  it("announces expiry assertively", () => {
    renderChallenge({ expiresAt: EXPIRED_EXPIRY });

    expect(assertiveRegion()).toHaveTextContent(/Challenge expired/i);
  });

  it("announces that a refresh is in progress and then that a new challenge is ready", async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; })
    );
    const onSign = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderChallenge({ expiresAt: EXPIRED_EXPIRY, onRefresh, onSign });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /get new challenge/i }));
    });

    await waitFor(() => {
      expect(politeRegion()).toHaveTextContent(/Requesting a new challenge/i);
    });

    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
    });

    rerender(
      <WalletAuthChallenge
        challenge="refreshed-nonce"
        expiresAt={Date.now() + 5 * 60 * 1000}
        onSign={onSign}
        onRefresh={onRefresh}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(politeRegion()).toHaveTextContent(/new challenge is ready/i);
    });
  });

  it("announces success politely", async () => {
    renderChallenge({ onSign: vi.fn().mockResolvedValue(undefined) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign to continue/i }));
    });

    await waitFor(() => {
      expect(politeRegion()).toHaveTextContent(/Wallet signature accepted/i);
    });
  });
});
