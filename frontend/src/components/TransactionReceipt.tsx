import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock, Copy, RefreshCw, ExternalLink } from 'lucide-react';

type TxStatus = 'pending' | 'success' | 'failed' | 'expired';

interface TransactionReceiptProps {
  status: TxStatus;
  isStale: boolean;
  txHash?: string;
  errorMessage?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
  /** Full explorer URL for the transaction. Null/absent renders no link. */
  explorerUrl?: string | null;
}

export const TransactionReceipt: React.FC<TransactionReceiptProps> = ({
  status,
  isStale,
  txHash,
  errorMessage,
  onRetry,
  onRefresh,
  // No default: a hardcoded testnet base linked mainnet transactions to an
  // explorer that has never seen them (#1311). Absent means render no link.
  explorerUrl,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyHash = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-md bg-[#191A1D] border border-[#2D2F36] rounded-xl p-6 text-white font-sans space-y-5">
      {/* Status Header & Icon */}
      <div className="flex items-center gap-3">
        {status === 'success' && (
          <CheckCircle2 className="w-8 h-8 text-green-500" aria-hidden="true" />
        )}
        {status === 'pending' && !isStale && (
          <RefreshCw className="w-8 h-8 text-yellow-500 animate-spin" aria-hidden="true" />
        )}
        {status === 'pending' && isStale && (
          <Clock className="w-8 h-8 text-amber-500 animate-pulse" aria-hidden="true" />
        )}
        {status === 'failed' && (
          <XCircle className="w-8 h-8 text-red-500" aria-hidden="true" />
        )}
        {status === 'expired' && (
          <AlertTriangle className="w-8 h-8 text-orange-500" aria-hidden="true" />
        )}

        <div>
          <h3 className="text-lg font-semibold">
            {status === 'success' && 'Transaction Confirmed'}
            {status === 'pending' && !isStale && 'Processing Transaction...'}
            {status === 'pending' && isStale && 'Taking Longer Than Expected'}
            {status === 'failed' && 'Transaction Failed'}
            {status === 'expired' && 'Transaction Expired'}
          </h3>
          <p className="text-xs text-gray-400">
            {status === 'pending' && isStale
              ? 'The network is congested. You can refresh the status or retry.'
              : status === 'failed'
              ? errorMessage || 'Your transaction was rejected by the network.'
              : status === 'expired'
              ? 'The signature deadline passed before submission.'
              : 'Status updated from Stellar network.'}
          </p>
        </div>
      </div>

      {/* Transaction Hash Section */}
      {txHash && (
        <div className="bg-[#111214] p-3 rounded-lg border border-[#26282E] flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-xs text-gray-500 block">Transaction Hash</span>
            <span className="text-xs font-mono text-gray-300 break-all block">{txHash}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyHash}
              className="p-1.5 hover:bg-[#26282E] rounded text-gray-400 hover:text-white transition-colors"
              aria-label={copied ? "Transaction hash copied" : "Copy transaction hash"}
            >
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 hover:bg-[#26282E] rounded text-gray-400 hover:text-white transition-colors"
                aria-label="View on Stellar Explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : null}
          </div>
        </div>
      )}

      {/* Recovery Actions */}
      <div className="flex items-center gap-3 pt-2">
        {status === 'pending' && isStale && (
          <>
            <button
              type="button"
              onClick={onRefresh}
              className="flex-1 bg-[#26282E] hover:bg-[#32353D] text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              Refresh Status
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="flex-1 bg-[#F9BC07] hover:bg-[#e0a800] text-black py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              Retry Submission
            </button>
          </>
        )}

        {(status === 'failed' || status === 'expired') && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full bg-[#F9BC07] hover:bg-[#e0a800] text-black py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors"
          >
            Retry Transaction
          </button>
        )}
      </div>
    </div>
  );
};
