/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSubmissionGuard } from "./useSubmissionGuard";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSubmissionGuard (#1266)", () => {
  it("runs a task only once when it is triggered again before the first settles", async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    const gate = deferred<string>();
    const task = vi.fn(() => gate.promise);

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      // Same tick, before any re-render: the double-click case.
      first = result.current.run("deposit", task);
      second = result.current.run("deposit", task);
    });

    expect(task).toHaveBeenCalledTimes(1);
    expect(await second).toBeUndefined();
    expect(result.current.isBlocked("deposit")).toBe(true);

    await act(async () => {
      gate.resolve("done");
      expect(await first).toBe("done");
    });
    expect(result.current.isBlocked("deposit")).toBe(false);
  });

  it("does not block a different action", async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    const gate = deferred();
    const other = vi.fn(async () => "ok");

    act(() => {
      void result.current.run("deposit", () => gate.promise);
    });
    await act(async () => {
      expect(await result.current.run("distribute", other)).toBe("ok");
    });
    expect(other).toHaveBeenCalledTimes(1);

    await act(async () => gate.resolve());
  });

  it("restores the action after a definitive failure so the user can retry", async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    const failing = vi.fn(async () => {
      throw new Error("wallet rejected");
    });

    await act(async () => {
      await expect(result.current.run("deposit", failing)).rejects.toThrow(
        "wallet rejected",
      );
    });
    expect(result.current.isBlocked("deposit")).toBe(false);

    const retry = vi.fn(async () => "ok");
    await act(async () => {
      expect(await result.current.run("deposit", retry)).toBe("ok");
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps an unconfirmed action blocked until it is cleared", async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    const task = vi.fn(async () => "ok");

    act(() =>
      result.current.markUnconfirmed("deposit", {
        hash: "HASH",
        submittedAt: 1,
      }),
    );
    expect(result.current.isBlocked("deposit")).toBe(true);
    expect(result.current.unconfirmed).toEqual({
      deposit: { hash: "HASH", submittedAt: 1 },
    });

    await act(async () => {
      expect(await result.current.run("deposit", task)).toBeUndefined();
    });
    expect(task).not.toHaveBeenCalled();

    act(() => result.current.clearUnconfirmed("deposit"));
    expect(result.current.isBlocked("deposit")).toBe(false);
    await act(async () => {
      await result.current.run("deposit", task);
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  // Audit coverage for every payment/split action the UI can submit (#1593).
  // `claim` is included even though the current UI has no claim button: any
  // future claim wiring goes through this same guard, so the guarantee is
  // pinned now rather than discovered as a double-payout later.
  it.each([
    "create",
    "deposit",
    "update_collaborators",
    "lock",
    "distribute",
    "claim",
  ])("allows only one in-flight %s submission", async (action) => {
    const { result } = renderHook(() => useSubmissionGuard());
    const gate = deferred<string>();
    const task = vi.fn(() => gate.promise);

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      first = result.current.run(action, task);
      second = result.current.run(action, task);
    });

    expect(task).toHaveBeenCalledTimes(1);
    expect(result.current.isBlocked(action)).toBe(true);
    expect(await second).toBeUndefined();

    await act(async () => {
      gate.resolve("done");
      expect(await first).toBe("done");
    });
    expect(result.current.isBlocked(action)).toBe(false);
  });

  it("warns before leaving the page only while work is pending", async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    const fireBeforeUnload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(fireBeforeUnload()).toBe(false);

    const gate = deferred();
    act(() => {
      void result.current.run("create", () => gate.promise);
    });
    expect(fireBeforeUnload()).toBe(true);

    await act(async () => gate.resolve());
    expect(fireBeforeUnload()).toBe(false);

    act(() =>
      result.current.markUnconfirmed("create", { hash: "H", submittedAt: 1 }),
    );
    expect(fireBeforeUnload()).toBe(true);
    act(() => result.current.clearUnconfirmed("create"));
    expect(fireBeforeUnload()).toBe(false);
  });
});
