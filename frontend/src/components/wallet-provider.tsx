"use client";

import { useEffect, type ReactNode } from "react";
import { WalletContext, useWalletState } from "../hooks/useWallet";
import { useNetworkGuard } from "../hooks/useNetworkGuard";
import { useToast } from "./toast-provider";

/**
 * Provides wallet state to the component tree AND fires a toast whenever a
 * network mismatch is detected (or clears it when resolved).
 *
 * Wrap your app layout with:
 *   <ToastProvider>
 *     <WalletProvider>
 *       {children}
 *     </WalletProvider>
 *   </ToastProvider>
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const walletState = useWalletState();
  const guard = useNetworkGuard(walletState.wallet);
  const { toast } = useToast();

  // Fire a sticky toast once when a mismatch is first detected
  useEffect(() => {
    if (guard.mismatch) {
      toast(guard.message, "error", 0 /* sticky — user must dismiss */);
    }
  }, [guard.message, guard.mismatch, toast]);

  return (
    <WalletContext.Provider
      value={{
        wallet: walletState.wallet,
        loading: walletState.loading,
        error: walletState.error,
        connect: walletState.connect,
        refresh: walletState.refresh,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
