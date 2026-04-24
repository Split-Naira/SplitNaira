"use client";

import { useCallback } from "react";
import { useWallet } from "./useWallet";
import { useNetworkGuard } from "./useNetworkGuard";
import { useToast } from "../components/toast-provider";

/**
 * Returns a wrapper that guards any async wallet action behind a network check.
 *
 * If the network is mismatched the action is blocked and a toast is shown.
 * If the wallet is not connected the action is also blocked.
 *
 * @example
 * const guard = useNetworkAction();
 *
 * const handleSubmit = guard(async () => {
 *   await signAndSubmitTx(xdr);
 * });
 */
export function useNetworkAction() {
  const { wallet } = useWallet();
  const networkGuard = useNetworkGuard(wallet);
  const { toast } = useToast();

  const guard = useCallback(
    <T>(action: () => Promise<T>) =>
      async (): Promise<T | undefined> => {
        if (!wallet.connected) {
          toast("Please connect your Freighter wallet first.", "warning");
          return undefined;
        }

        if (networkGuard.mismatch) {
          toast(networkGuard.message, "error", 0);
          return undefined;
        }

        return action();
      },
    [wallet.connected, networkGuard.mismatch, networkGuard.message, toast],
  );

  return guard;
}
