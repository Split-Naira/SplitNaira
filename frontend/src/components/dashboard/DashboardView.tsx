"use client";

import { clsx } from "clsx";
import { sanitizeText } from "@/lib/security";
import type { SplitProject } from "@/lib/stellar";
import type {
  TokenAllowlistState,
  UnallocatedBalanceState,
  AdminStatusState,
} from "@/lib/api";
import type { WalletState } from "@/lib/wallet";
import { SummaryCardSkeleton } from "../Skeleton";

export interface AllowlistActionResult {
  action: "allow" | "disallow";
  token: string;
  txHash: string | null;
}

interface DashboardViewProps {
  wallet: WalletState;
  isContractAdmin: boolean;
  tokenAllowlist: TokenAllowlistState | null;
  isLoadingAllowlist: boolean;
  isUpdatingAllowlist: boolean;
  allowlistTokenInput: string;
  setAllowlistTokenInput: (val: string) => void;
  isValidAllowlistToken: boolean;
  normalizedAllowlistToken: string;
  onSubmitAllowlistAction: (action: "allow" | "disallow") => Promise<void>;
  lastAllowlistTx: AllowlistActionResult | null;
  refreshTokenAllowlist: () => Promise<unknown>;
  isLoadingDashboard: boolean;
  dashboardData: SplitProject[];
  userEarnings: Record<string, string>;
  adminStatus: AdminStatusState | null;
  isLoadingAdminStatus: boolean;
  refreshAdminStatus: () => Promise<unknown>;
  showPauseConfirm: boolean;
  setShowPauseConfirm: (val: boolean) => void;
  showUnpauseConfirm: boolean;
  setShowUnpauseConfirm: (val: boolean) => void;
  isSubmittingPause: boolean;
  lastPauseTxHash: string | null;
  onTogglePause: (action: "pause" | "unpause") => Promise<void>;
  recoveryTokenInput: string;
  setRecoveryTokenInput: (val: string) => void;
  isLoadingUnallocated: boolean;
  unallocatedError: string | null;
  unallocatedBalance: UnallocatedBalanceState | null;
  onInspectUnallocated: () => Promise<void>;
  recoveryToInput: string;
  setRecoveryToInput: (val: string) => void;
  recoveryAmountInput: string;
  setRecoveryAmountInput: (val: string) => void;
  showRecoveryConfirm: boolean;
  setShowRecoveryConfirm: (val: boolean) => void;
  isSubmittingRecovery: boolean;
  onConfirmRecovery: () => Promise<void>;
  lastRecoveryTxHash: string | null;
  setActiveTab: (tab: "dashboard" | "create" | "manage" | "projects") => void;
  setSearchProjectId: (val: string) => void;
  setFetchedProject: (p: SplitProject | null) => void;
}

export function DashboardView({
  wallet,
  isContractAdmin,
  tokenAllowlist,
  isLoadingAllowlist,
  isUpdatingAllowlist,
  allowlistTokenInput,
  setAllowlistTokenInput,
  isValidAllowlistToken,
  normalizedAllowlistToken,
  onSubmitAllowlistAction,
  lastAllowlistTx,
  refreshTokenAllowlist,
  isLoadingDashboard,
  dashboardData,
  userEarnings,
  adminStatus,
  isLoadingAdminStatus,
  refreshAdminStatus,
  showPauseConfirm,
  setShowPauseConfirm,
  showUnpauseConfirm,
  setShowUnpauseConfirm,
  isSubmittingPause,
  lastPauseTxHash,
  onTogglePause,
  recoveryTokenInput,
  setRecoveryTokenInput,
  isLoadingUnallocated,
  unallocatedError,
  unallocatedBalance,
  onInspectUnallocated,
  recoveryToInput,
  setRecoveryToInput,
  recoveryAmountInput,
  setRecoveryAmountInput,
  showRecoveryConfirm,
  setShowRecoveryConfirm,
  isSubmittingRecovery,
  onConfirmRecovery,
  lastRecoveryTxHash,
}: DashboardViewProps) {
  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      <div className="grid gap-6 md:grid-cols-3">
        {isLoadingDashboard ? (
          Array(3)
            .fill(0)
            .map((_, i) => <SummaryCardSkeleton key={i} />)
        ) : (
          <>
            <div className="glass-card rounded-3xl p-8 border-l-4 border-greenBright">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                Total Managed
              </p>
              <p className="text-3xl font-display">
                {dashboardData.length}{" "}
                <span className="text-sm font-sans text-muted">Projects</span>
              </p>
            </div>
            <div className="glass-card rounded-3xl p-8 border-l-4 border-goldLight">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                Platform Treasury
              </p>
              <p className="text-3xl font-display text-greenBright">
                {dashboardData
                  .reduce((s, p) => s + Number(p.balance), 0)
                  .toLocaleString()}{" "}
                <span className="text-sm font-sans text-muted">Stroops</span>
              </p>
            </div>
            <div className="glass-card rounded-3xl p-8 border-l-4 border-white/20">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                Lifetime Payouts
              </p>
              <p className="text-3xl font-display">
                {dashboardData
                  .reduce((s, p) => s + Number(p.totalDistributed), 0)
                  .toLocaleString()}
              </p>
            </div>
          </>
        )}
      </div>

      {wallet.connected && isContractAdmin && tokenAllowlist && (
        <div className="glass-card rounded-[2.5rem] p-8 md:p-10 border border-greenBright/10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-greenBright/80">
                Admin Control Plane
              </p>
              <h2 className="font-display text-2xl tracking-tight">Admin Token Allowlist</h2>
              <p className="max-w-2xl text-sm text-muted">
                Inspect the live allowlist and submit contract-backed allow or disallow actions from the connected admin wallet.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void refreshTokenAllowlist(); }}
              disabled={isLoadingAllowlist || isUpdatingAllowlist}
              className="premium-button rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
            >
              {isLoadingAllowlist ? "Refreshing..." : "Refresh State"}
            </button>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/5 bg-white/2 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Contract Admin</p>
              <p className="mt-3 break-all font-mono text-xs text-ink">{tokenAllowlist.admin}</p>
            </div>
            <div className="rounded-3xl border border-white/5 bg-white/2 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Allowlist Mode</p>
              <p className="mt-3 text-2xl font-display text-greenBright">
                {tokenAllowlist.allowedTokenCount > 0 ? "Active" : "Open"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {tokenAllowlist.allowedTokenCount > 0
                  ? "New splits are restricted to the listed token addresses."
                  : "No tokens are listed, so any token address can be used."}
              </p>
            </div>
            <div className="rounded-3xl border border-white/5 bg-white/2 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Listed Tokens</p>
              <p className="mt-3 text-2xl font-display">{tokenAllowlist.allowedTokenCount}</p>
              <p className="mt-1 text-xs text-muted">
                Current page contains {tokenAllowlist.tokens.length} token address{tokenAllowlist.tokens.length === 1 ? "" : "es"}.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-[2rem] border border-white/5 bg-white/2 p-6">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="space-y-2">
                <label
                  htmlFor="allowlist-token-input"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted"
                >
                  Token Contract Address
                </label>
                <input
                  id="allowlist-token-input"
                  value={allowlistTokenInput}
                  onChange={(event) => setAllowlistTokenInput(event.target.value)}
                  placeholder="Enter token address to allow or disallow"
                  disabled={isUpdatingAllowlist}
                  className={clsx(
                    "glass-input w-full rounded-2xl px-5 py-4 text-sm",
                    normalizedAllowlistToken && !isValidAllowlistToken
                      ? "border-red-500/50 bg-red-500/5"
                      : "",
                  )}
                />
                {normalizedAllowlistToken && !isValidAllowlistToken && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">
                    Enter a valid Stellar account or contract address.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { void onSubmitAllowlistAction("allow"); }}
                disabled={isUpdatingAllowlist || !isValidAllowlistToken}
                className="premium-button self-end rounded-2xl bg-greenBright px-6 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#0a0a09] disabled:opacity-30"
              >
                {isUpdatingAllowlist ? "Submitting..." : "Allow Token"}
              </button>
              <button
                type="button"
                onClick={() => { void onSubmitAllowlistAction("disallow"); }}
                disabled={isUpdatingAllowlist || !isValidAllowlistToken}
                className="premium-button self-end rounded-2xl border border-red-400/30 bg-red-500/10 px-6 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-red-300 disabled:opacity-30"
              >
                {isUpdatingAllowlist ? "Submitting..." : "Disallow Token"}
              </button>
            </div>
          </div>

          {lastAllowlistTx && (
            <div className="mt-6 rounded-2xl border border-greenBright/20 bg-greenBright/5 p-5">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-greenBright/10">
                  <svg className="h-5 w-5 text-greenBright" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-greenBright">
                    {lastAllowlistTx.action === "allow" ? "Allowlist updated" : "Allowlist removal confirmed"}
                  </h3>
                  <p className="text-sm text-muted">
                    {lastAllowlistTx.action === "allow" ? "Allowed" : "Disallowed"} token{" "}
                    <span className="font-mono text-ink">{lastAllowlistTx.token}</span>.
                  </p>
                  {lastAllowlistTx.txHash && (
                    <>
                      <p className="font-mono text-[10px] text-muted break-all opacity-80">
                        Tx: {lastAllowlistTx.txHash}
                      </p>
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${lastAllowlistTx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block pt-1 text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white"
                      >
                        View on Explorer →
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
                Current Allowed Tokens
              </h3>
              <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted">
                {tokenAllowlist.allowedTokenCount} total
              </span>
            </div>
            {tokenAllowlist.tokens.length > 0 ? (
              <div className="space-y-3">
                {tokenAllowlist.tokens.map((allowedToken) => (
                  <div key={allowedToken} className="rounded-2xl border border-white/5 bg-white/2 px-5 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-greenBright/70">Allowed Token</p>
                    <p className="mt-2 break-all font-mono text-xs text-ink">{allowedToken}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/2 px-5 py-6 text-sm text-muted">
                No token addresses are allowlisted yet. The contract currently accepts any token address for new splits.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Emergency / Unallocated recovery console */}
      {wallet.connected && isContractAdmin && (
        <div className="glass-card rounded-[2.5rem] p-8 md:p-10 border border-goldLight/10">
          <div className="space-y-1 mb-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-goldLight/80">
              Admin — Recovery Console
            </p>
            <h2 className="font-display text-2xl tracking-tight">Unallocated Token Recovery</h2>
            <p className="max-w-2xl text-sm text-muted">
              Inspect and safely recover tokens that were sent directly to the contract address
              outside of any tracked project balance. This action never touches project-accounted funds.
            </p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Recovery Token Address</span>
              <input
                type="text"
                value={recoveryTokenInput}
                onChange={(e) => setRecoveryTokenInput(e.target.value)}
                placeholder="C..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-ink placeholder:text-muted/40 focus:outline-none focus:ring-2 focus:ring-goldLight/30"
              />
            </label>
            <button
              type="button"
              onClick={onInspectUnallocated}
              disabled={isLoadingUnallocated || !recoveryTokenInput.trim()}
              className="rounded-xl border border-goldLight/30 bg-goldLight/10 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-goldLight transition-all hover:bg-goldLight/20 disabled:opacity-40"
            >
              {isLoadingUnallocated ? "Inspecting…" : "Inspect Unallocated Balance"}
            </button>

            {unallocatedError && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {unallocatedError}
              </p>
            )}

            {unallocatedBalance && (
              <div className="rounded-2xl border border-goldLight/20 bg-goldLight/5 p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-goldLight/80">Recoverable Balance</p>
                    <p className="font-mono text-2xl font-bold text-goldLight">
                      {Number(unallocatedBalance.unallocated).toLocaleString()}{" "}
                      <span className="text-sm font-sans text-muted">Stroops</span>
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Token</p>
                    <p className="font-mono text-[11px] text-muted break-all max-w-[200px]">{unallocatedBalance.token}</p>
                  </div>
                </div>

                {Number(unallocatedBalance.unallocated) > 0 && !showRecoveryConfirm && (
                  <div className="space-y-3 pt-2 border-t border-white/5">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Destination Address</span>
                      <input
                        type="text"
                        value={recoveryToInput}
                        onChange={(e) => setRecoveryToInput(e.target.value)}
                        placeholder="G... or C..."
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-ink placeholder:text-muted/40 focus:outline-none focus:ring-2 focus:ring-goldLight/30"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Amount (Stroops)</span>
                      <input
                        type="number"
                        min={1}
                        max={Number(unallocatedBalance.unallocated)}
                        value={recoveryAmountInput}
                        onChange={(e) => setRecoveryAmountInput(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-ink placeholder:text-muted/40 focus:outline-none focus:ring-2 focus:ring-goldLight/30"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (!recoveryToInput.trim() || !recoveryAmountInput || Number(recoveryAmountInput) <= 0) {
                          return;
                        }
                        setShowRecoveryConfirm(true);
                      }}
                      className="rounded-xl bg-goldLight/20 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-goldLight transition-all hover:bg-goldLight/30"
                    >
                      Review Recovery
                    </button>
                  </div>
                )}

                {showRecoveryConfirm && (
                  <div className="space-y-4 rounded-2xl border border-goldLight/30 bg-black/30 p-6 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-goldLight">
                      Confirm Recovery — Review Before Submitting
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      <dt className="text-muted">Token</dt>
                      <dd className="font-mono text-[11px] break-all">{unallocatedBalance.token}</dd>
                      <dt className="text-muted">Destination</dt>
                      <dd className="font-mono text-[11px] break-all">{recoveryToInput}</dd>
                      <dt className="text-muted">Amount</dt>
                      <dd className="font-mono font-bold text-goldLight">{Number(recoveryAmountInput).toLocaleString()} Stroops</dd>
                      <dt className="text-muted">Remaining After</dt>
                      <dd className="font-mono">
                        {(Number(unallocatedBalance.unallocated) - Number(recoveryAmountInput)).toLocaleString()} Stroops
                      </dd>
                    </dl>
                    <p className="text-[11px] text-muted/70 italic">
                      This action only withdraws the unallocated surplus. Project-accounted balances are never touched.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={onConfirmRecovery}
                        disabled={isSubmittingRecovery}
                        className="rounded-xl bg-goldLight/30 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-goldLight transition-all hover:bg-goldLight/40 disabled:opacity-40"
                      >
                        {isSubmittingRecovery ? "Submitting…" : "Confirm & Submit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRecoveryConfirm(false)}
                        className="rounded-xl border border-white/10 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-muted transition-all hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {lastRecoveryTxHash && (
              <div className="rounded-2xl border border-greenBright/20 bg-greenBright/5 p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-greenBright mb-2">Recovery Submitted</p>
                <p className="font-mono text-[11px] text-muted break-all">Tx: {lastRecoveryTxHash}</p>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${lastRecoveryTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white"
                >
                  View on Explorer →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Issue #165: Distribution Pause Control Plane */}
      {wallet.connected && isContractAdmin && (
        <div className="glass-card rounded-[2.5rem] p-8 md:p-10 border border-red-500/10">
          <div className="flex flex-wrap items-start justify-between gap-6 mb-8">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400/80">
                Admin — Emergency Controls
              </p>
              <h2 className="font-display text-2xl tracking-tight">Distribution Pause Control</h2>
              <p className="max-w-2xl text-sm text-muted">
                Pause or resume all distributions across every project. This is a global emergency stop — use with care.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void refreshAdminStatus(); }}
              disabled={isLoadingAdminStatus}
              className="premium-button rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
            >
              {isLoadingAdminStatus ? "Refreshing..." : "Refresh State"}
            </button>
          </div>

          <div
            className="rounded-3xl border p-6 mb-6 flex items-center justify-between gap-4"
            style={{ borderColor: adminStatus?.isPaused ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.05)" }}
          >
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Current State</p>
              {adminStatus ? (
                <p className={`text-2xl font-display ${adminStatus.isPaused ? "text-amber-400" : "text-greenBright"}`}>
                  {adminStatus.isPaused ? "⏸ Paused" : "▶ Active"}
                </p>
              ) : (
                <p className="text-sm text-muted italic">Loading…</p>
              )}
              <p className="text-xs text-muted">
                {adminStatus?.isPaused
                  ? "All distribution calls will be rejected by the contract."
                  : "Distributions are running normally."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {!adminStatus?.isPaused ? (
              <button
                type="button"
                onClick={() => setShowPauseConfirm(true)}
                disabled={isSubmittingPause || isLoadingAdminStatus}
                className="premium-button rounded-2xl border border-amber-400/30 bg-amber-400/10 px-6 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-amber-300 disabled:opacity-30"
              >
                Pause Distributions
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowUnpauseConfirm(true)}
                disabled={isSubmittingPause || isLoadingAdminStatus}
                className="premium-button rounded-2xl bg-greenBright px-6 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#0a0a09] disabled:opacity-30"
              >
                Resume Distributions
              </button>
            )}
          </div>

          {lastPauseTxHash && (
            <div className="mt-6 rounded-2xl border border-greenBright/20 bg-greenBright/5 p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-greenBright mb-2">Transaction Submitted</p>
              <p className="font-mono text-[11px] text-muted break-all">Tx: {lastPauseTxHash}</p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${lastPauseTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white"
              >
                View on Explorer →
              </a>
            </div>
          )}
        </div>
      )}

      {/* User Earnings Section */}
      {wallet.connected && (
        <div className="glass-card rounded-[2.5rem] p-8 md:p-10 bg-greenMid/5 border-greenBright/10">
          <div className="flex items-center justify-between mb-8">
            <div className="space-y-1">
              <h2 className="font-display text-2xl tracking-tight">Your Cumulative Earnings</h2>
              <p className="text-sm text-muted">Aggregate revenue share across all active contracts.</p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-display text-greenBright">
                {Object.values(userEarnings).reduce((sum, val) => sum + Number(val), 0).toLocaleString()}
                <span className="text-sm font-sans opacity-40 ml-2">Stroops</span>
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dashboardData
              .filter((p) => p.collaborators.some((c) => c.address === wallet.address))
              .map((p) => (
                <div key={p.projectId} className="bg-white/5 rounded-2xl p-5 border border-white/5 flex justify-between items-center">
                  <div className="space-y-1">
                    <p className="font-bold text-xs truncate max-w-[120px]">{sanitizeText(p.title)}</p>
                    <p className="text-[9px] text-muted uppercase tracking-widest">
                      {(p.collaborators.find((c) => c.address === wallet.address)?.basisPoints ?? 0) / 100}% Share
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold text-greenBright/80">
                    +{Number(userEarnings[p.projectId] || 0).toLocaleString()}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Performance Rollups */}
      <div className="glass-card rounded-[2.5rem] p-8 md:p-10">
        <h2 className="font-display text-2xl tracking-tight mb-8">Project Performance Rollups</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted border-b border-white/5">
                <th className="pb-4 pl-4">Project</th>
                <th className="pb-4">Category</th>
                <th className="pb-4 text-right">Balance</th>
                <th className="pb-4 text-right">Distributed</th>
                <th className="pb-4 text-right pr-4">Rounds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {dashboardData.map((p) => (
                <tr key={p.projectId} className="group hover:bg-white/2 transition-colors">
                  <td className="py-4 pl-4">
                    <p className="font-bold text-sm">{sanitizeText(p.title)}</p>
                    <p className="text-[9px] font-mono text-muted">{p.projectId}</p>
                  </td>
                  <td className="py-4">
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase">{sanitizeText(p.projectType)}</span>
                  </td>
                  <td className="py-4 text-right font-mono text-xs text-greenBright/80">
                    {Number(p.balance).toLocaleString()}
                  </td>
                  <td className="py-4 text-right font-mono text-xs">
                    {Number(p.totalDistributed).toLocaleString()}
                  </td>
                  <td className="py-4 text-right font-mono text-xs pr-4">
                    {p.distributionRound}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
