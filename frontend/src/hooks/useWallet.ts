"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from "react";
import * as Sentry from "@sentry/nextjs";
import {
  getWalletState,
  connectWallet,
  type WalletState,
} from "../lib/wallet";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  wallet: WalletState;
  loading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
}

// ─── State machine ────────────────────────────────────────────────────────────

type Action =
  | { type: "LOADING" }
  | { type: "SUCCESS"; payload: WalletState }
  | { type: "ERROR"; payload: string }
  | { type: "RESET" };

interface State {
  wallet: WalletState;
  loading: boolean;
  error: string | null;
}

const initialState: State = {
  wallet: { connected: false, address: null, network: null },
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOADING":
      return { ...state, loading: true, error: null };
    case "SUCCESS":
      return { wallet: action.payload, loading: false, error: null };
    case "ERROR":
      return { ...state, loading: false, error: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

import { createContext as _createContext } from "react";

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}

// ─── Internal hook used by WalletProvider ─────────────────────────────────────

export function useWalletState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    dispatch({ type: "LOADING" });
    try {
      const walletState = await getWalletState();
      if (mountedRef.current)
        dispatch({ type: "SUCCESS", payload: walletState });
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "wallet-hook",
            action: "refresh",
          }
        });
      }
      if (mountedRef.current)
        dispatch({
          type: "ERROR",
          payload: err instanceof Error ? err.message : "Unknown error",
        });
    }
  }, []);

  const connect = useCallback(async () => {
    dispatch({ type: "LOADING" });
    try {
      const walletState = await connectWallet();
      if (mountedRef.current)
        dispatch({ type: "SUCCESS", payload: walletState });
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "wallet-hook",
            action: "connect",
          }
        });
      }
      if (mountedRef.current)
        dispatch({
          type: "ERROR",
          payload: err instanceof Error ? err.message : "Failed to connect",
        });
    }
  }, []);

  // Auto-restore session on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, connect, refresh };
}
