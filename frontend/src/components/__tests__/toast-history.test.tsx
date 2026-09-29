/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "../toast-provider";
import { TOAST_HISTORY_STORAGE_KEY } from "@/lib/toast-history";

function Probe() {
  const { toast } = useToast();

  return (
    <div>
      <button type="button" onClick={() => toast("Deposit failed: no balance", "error")}>
        raise failure
      </button>
      <button type="button" onClick={() => toast("Deposit confirmed", "success")}>
        raise success
      </button>
      <button
        type="button"
        onClick={() => toast("Wallet disconnected.", "warning", 0)}
      >
        raise warning
      </button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );

const historyTrigger = () =>
  screen.queryByRole("button", { name: /failure history/i });

beforeEach(() => {
  window.localStorage.clear();
});

describe("persistent failure history", () => {
  it("records an error toast and exposes it through the history panel", async () => {
    const user = userEvent.setup();
    renderProvider();

    expect(historyTrigger()).toBeNull();

    await user.click(screen.getByRole("button", { name: "raise failure" }));

    // The toast itself is transient, but the failure survives it.
    expect(historyTrigger()).toHaveTextContent("Failure history (1)");
    expect(
      JSON.parse(
        window.localStorage.getItem(TOAST_HISTORY_STORAGE_KEY) ?? "[]",
      ),
    ).toHaveLength(1);
  });

  it("ignores success and warning toasts", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "raise success" }));
    await user.click(screen.getByRole("button", { name: "raise warning" }));

    expect(historyTrigger()).toBeNull();
    expect(window.localStorage.getItem(TOAST_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("restores the history after a remount, matching a page reload", async () => {
    const user = userEvent.setup();
    const { unmount } = renderProvider();

    await user.click(screen.getByRole("button", { name: "raise failure" }));
    expect(historyTrigger()).toHaveTextContent("Failure history (1)");

    unmount();

    renderProvider();

    await waitFor(() =>
      expect(historyTrigger()).toHaveTextContent("Failure history (1)"),
    );
  });

  it("only loads the persisted history once mounted, so server render stays empty", async () => {
    window.localStorage.setItem(
      TOAST_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "toast-old",
          message: "Earlier failure",
          variant: "error",
          createdAt: 1_700_000_000_000,
        },
      ]),
    );

    renderProvider();

    await waitFor(() =>
      expect(historyTrigger()).toHaveTextContent("Failure history (1)"),
    );
  });

  it("reveals the failure message when expanded and clears it on request", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "raise failure" }));
    await user.click(historyTrigger()!);

    const region = screen.getByRole("region", {
      name: /recent transaction failures/i,
    });
    expect(within(region).getByText("Deposit failed: no balance")).toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: "Clear" }));

    expect(historyTrigger()).toBeNull();
    expect(window.localStorage.getItem(TOAST_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("keeps the trigger collapsed until the user opens it", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "raise failure" }));

    const trigger = historyTrigger()!;
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("region", { name: /recent transaction failures/i }),
    ).toBeNull();

    await user.click(trigger);

    expect(historyTrigger()).toHaveAttribute("aria-expanded", "true");
  });
});
