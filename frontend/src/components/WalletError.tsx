"use client";

interface WalletErrorProps {
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "no_freighter": "Freighter wallet not found. Please install the Freighter extension to continue.",
  "user_declined": "Transaction was declined. Please approve the request in your Freighter wallet.",
  "network_mismatch": "Wrong network selected. Please switch to Stellar Mainnet in Freighter.",
  "insufficient_funds": "Insufficient balance to complete this transaction.",
  "connection_failed": "Unable to connect to wallet. Please refresh and try again.",
};

export function WalletError({ error }: WalletErrorProps) {
  if (!error) return null;

  const message = ERROR_MESSAGES[error] ?? "An unexpected wallet error occurred. Please try again.";

  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
      <strong className="font-semibold">Wallet Error: </strong>
      {message}
    </div>
  );
}
