"use client";

import { useContext } from "react";
import { clsx } from "clsx";
import { WalletContext } from "../hooks/useWallet";

interface ConnectWalletButtonProps {
  onConnect: () => void;
  className?: string;
}

export function ConnectWalletButton({ onConnect, className }: ConnectWalletButtonProps) {
  const wallet = useContext(WalletContext);
  const loading = wallet?.loading ?? false;

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={loading}
      aria-busy={loading}
      className={clsx(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        "bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed",
        className
      )}
    >
      {loading ? (
        <>
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Connecting...
        </>
      ) : (
        "Connect Wallet"
      )}
    </button>
  );
}
