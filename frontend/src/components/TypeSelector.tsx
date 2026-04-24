"use client";

import { useMemo, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";

import { getTokensByNetwork, getTokenDisplayName } from "@/lib/token-constants";

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
  const availableTokens = useMemo(() => getTokensByNetwork(network), [network]);
  const [forceShowCustom, setForceShowCustom] = useState(false);
  const [customToken, setCustomToken] = useState("");
  const valueInAvailableTokens = availableTokens.some((t) => t.id === value);
  const showCustom = forceShowCustom || Boolean(value && !valueInAvailableTokens);
  const customTokenValue = forceShowCustom ? customToken : value;
  const isValidAddress =
    !customTokenValue ||
    StrKey.isValidEd25519PublicKey(customTokenValue) ||
    StrKey.isValidContract(customTokenValue);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    if (selectedValue === "custom") {
      setForceShowCustom(true);
      setCustomToken(value);
    } else {
      setForceShowCustom(false);
      setCustomToken("");
      onChange(selectedValue);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForceShowCustom(true);
    setCustomToken(val);
    if (val && isValidAddress) {
      onChange(val);
    }
  };

  const handleUseCustom = () => {
    if (customTokenValue && isValidAddress) {
      onChange(customTokenValue);
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
                  setForceShowCustom(true);
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
              value={customTokenValue}
              onChange={handleCustomChange}
              placeholder="G... or C... (contract address)"
              className={clsx(
                "glass-input w-full rounded-2xl px-5 py-4 text-sm",
                customTokenValue && !isValidAddress
                  ? "border-red-500/50 bg-red-500/5"
                  : ""
              )}
            />
            {customTokenValue && !isValidAddress && (
              <p className="mt-2 px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                Invalid Stellar address format
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUseCustom}
              disabled={!customTokenValue || !isValidAddress}
              className="flex-1 rounded-xl bg-greenMid/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-greenBright transition-all hover:bg-greenMid/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use This Token
            </button>
            <button
              type="button"
              onClick={() => {
                setForceShowCustom(false);
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
