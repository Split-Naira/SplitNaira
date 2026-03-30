"use client";

import { useEffect, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";

import { getTokensByNetwork, getTokenDisplayName, type TokenInfo } from "@/lib/token-constants";

interface TokenSelectorProps {
  value: string;
  onChange: (token: string) => void;
  network: string | null;
  disabled?: boolean;
  required?: boolean;
}

export function TokenSelector({
  value,
  onChange,
  network,
  disabled = false,
  required = false
}: TokenSelectorProps) {
  const [availableTokens, setAvailableTokens] = useState<TokenInfo[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customToken, setCustomToken] = useState("");
  const isValidAddress =
    !customToken ||
    StrKey.isValidEd25519PublicKey(customToken) ||
    StrKey.isValidContract(customToken);

  useEffect(() => {
    const tokens = getTokensByNetwork(network);
    setAvailableTokens(tokens);

    // If current value is not in the list, show custom input
    if (value && !tokens.some((t) => t.id === value)) {
      setShowCustom(true);
      setCustomToken(value);
    } else {
      setShowCustom(false);
      setCustomToken("");
    }
  }, [network, value]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    if (selectedValue === "custom") {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      setCustomToken("");
      onChange(selectedValue);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomToken(val);
    if (val && isValidAddress) {
      onChange(val);
    }
  };

  const handleUseCustom = () => {
    if (customToken && isValidAddress) {
      onChange(customToken);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1">
        Asset Token (Stellar ID)
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>

      {!showCustom ? (
        <div className="space-y-2">
          <select
            value={value}
            onChange={handleSelectChange}
            disabled={disabled || availableTokens.length === 0}
            className="glass-input w-full rounded-2xl px-5 py-4 text-sm cursor-pointer"
          >
            <option value="">
              {availableTokens.length === 0
                ? "No tokens available for this network"
                : "Select a token..."}
            </option>
            {availableTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name} {token.code ? `(${token.code})` : ""}
              </option>
            ))}
            <option value="custom">Custom Token Address...</option>
          </select>

          {value && (
            <div className="flex items-start justify-between rounded-2xl bg-white/2 p-4 border border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
                  Selected Token
                </p>
                <p className="text-sm font-mono text-ink break-all">
                  {getTokenDisplayName(value)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustom(true);
                  setCustomToken(value);
                }}
                className="ml-4 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-greenBright hover:text-greenMid transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <input
              type="text"
              value={customToken}
              onChange={handleCustomChange}
              placeholder="G... or C... (contract address)"
              className={clsx(
                "glass-input w-full rounded-2xl px-5 py-4 text-sm",
                customToken && !isValidAddress
                  ? "border-red-500/50 bg-red-500/5"
                  : ""
              )}
            />
            {customToken && !isValidAddress && (
              <p className="mt-2 px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                Invalid Stellar address format
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUseCustom}
              disabled={!customToken || !isValidAddress}
              className="flex-1 rounded-xl bg-greenMid/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-greenBright transition-all hover:bg-greenMid/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use This Token
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustom(false);
                setCustomToken("");
                onChange("");
              }}
              className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted transition-all hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted opacity-60">
        {network
          ? `Showing tokens for ${network}`
          : "Connect wallet to see available tokens"}
      </div>
    </div>
  );
}
