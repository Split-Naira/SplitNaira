"use client";

import { clsx } from "clsx";
import { sanitizeText } from "@/lib/security";
import type { SplitProject } from "@/lib/stellar";
import type { ProjectHistoryItem, AdminStatusState } from "@/lib/api";
import type { WalletState } from "@/lib/wallet";
import { Input } from "../Input";
import { ListSkeleton, ProjectDetailSkeleton } from "../Skeleton";
import { TransactionReceiptView, type TransactionReceipt } from "../TransactionReceiptView";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

interface ManageSplitViewProps {
  wallet: WalletState;
  searchProjectId: string;
  setSearchProjectId: (val: string) => void;
  onFetchProject: () => Promise<void>;
  isFetchingProject: boolean;
  fetchedProject: SplitProject | null;
  isProjectOwner: boolean;
  setIsEditingMetadata: (val: boolean) => void;
  setEditTitle: (val: string) => void;
  setEditProjectType: (val: string) => void;
  setEditCollaborators: (val: CollaboratorInput[]) => void;
  setIsEditingCollaborators: (val: boolean) => void;
  canLockProject: boolean;
  setShowLockModal: (val: boolean) => void;
  sorobanSplitFlowBusy: boolean;
  history: ProjectHistoryItem[];
  fetchHistory: (id: string, cursor?: string) => Promise<void>;
  isLoadingHistory: boolean;
  historyError: string | null;
  isHistoryStale: boolean;
  historyCursor: string | null;
  projectFetchError: string | null;
  isProjectStale: boolean;
  setShowDistributeModal: (val: boolean) => void;
  adminStatus: AdminStatusState | null;
  receipt: TransactionReceipt | null;
  getExplorerUrl: (hash: string, network: string | null) => string;
}

export function ManageSplitView({
  wallet,
  searchProjectId,
  setSearchProjectId,
  onFetchProject,
  isFetchingProject,
  fetchedProject,
  isProjectOwner,
  setIsEditingMetadata,
  setEditTitle,
  setEditProjectType,
  setEditCollaborators,
  setIsEditingCollaborators,
  canLockProject,
  setShowLockModal,
  sorobanSplitFlowBusy,
  history,
  fetchHistory,
  isLoadingHistory,
  historyError,
  isHistoryStale,
  historyCursor,
  projectFetchError,
  isProjectStale,
  setShowDistributeModal,
  adminStatus,
  receipt,
  getExplorerUrl,
}: ManageSplitViewProps) {
  return (
    <div className="space-y-10">
      <div className="glass-card rounded-[2.5rem] p-8 md:p-10">
        <h2 className="font-display text-2xl tracking-tight mb-8">Locate Project</h2>
        <div className="flex gap-4">
          <Input
            value={searchProjectId}
            onChange={(e) => setSearchProjectId(e.target.value)}
            placeholder="Enter Project ID"
            className="flex-1 rounded-2xl"
          />
          <button
            onClick={onFetchProject}
            disabled={isFetchingProject || !searchProjectId.trim()}
            className="premium-button rounded-2xl bg-white px-8 text-[#0a0a09] font-bold"
          >
            {isFetchingProject ? "Searching..." : "Fetch Stats"}
          </button>
        </div>
        {projectFetchError && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">
              Failed to refresh project: {projectFetchError}
            </p>
            {fetchedProject && isProjectStale && (
              <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-300">
                Showing stale project data.
              </p>
            )}
          </div>
        )}
      </div>

      {isFetchingProject && !fetchedProject ? (
        <ProjectDetailSkeleton />
      ) : fetchedProject && (
        <div className="glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in zoom-in-95 duration-500">
          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl">{sanitizeText(fetchedProject.title)}</h2>
                <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold text-muted border border-white/5">
                  {sanitizeText(fetchedProject.projectType)}
                </span>
              </div>
              <p className="font-mono text-xs text-muted opacity-60 break-all">{fetchedProject.projectId}</p>
            </div>
            {fetchedProject.locked ? (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-amber-200">
                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                  <span aria-hidden="true">🔒</span>
                  Split locked - immutable
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {isProjectOwner && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditTitle(fetchedProject.title);
                        setEditProjectType(fetchedProject.projectType);
                        setIsEditingMetadata(true);
                      }}
                      className="premium-button rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-ink transition hover:bg-white/10"
                    >
                      Edit Metadata
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditCollaborators(
                          fetchedProject.collaborators.map((c, i) => ({
                            id: `edit-collab-${i}`,
                            address: c.address,
                            alias: c.alias,
                            basisPoints: String(c.basisPoints),
                          })),
                        );
                        setIsEditingCollaborators(true);
                      }}
                      className="premium-button rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-ink transition hover:bg-white/10"
                    >
                      Edit Collaborators
                    </button>
                  </>
                )}
                {canLockProject && (
                  <button
                    type="button"
                    onClick={() => setShowLockModal(true)}
                    disabled={sorobanSplitFlowBusy}
                    className="premium-button rounded-2xl border border-red-400/30 bg-red-500/10 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Lock Project
                  </button>
                )}
              </div>
            )}
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase text-muted">Available Funds</p>
              <p className="text-4xl font-display text-greenBright">
                {Number(fetchedProject.balance).toLocaleString()}{" "}
                <span className="text-sm opacity-40">Stroops</span>
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase text-muted border-l-2 border-greenBright pl-4">
                  Distribution Rules
                </h3>
                {fetchedProject.locked && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    Locked state active: split configuration is immutable.
                  </p>
                )}
              </div>
              <div className="space-y-3">
                {fetchedProject.collaborators.map((collab, idx) => (
                  <div key={idx} className="flex justify-between items-center rounded-2xl bg-white/2 p-4 text-sm border border-white/5">
                    <div className="space-y-0.5">
                      <p className="font-bold">{sanitizeText(collab.alias)}</p>
                      <p className="font-mono text-[10px] text-muted opacity-60 truncate max-w-[150px]">{collab.address}</p>
                    </div>
                    <span className="font-mono font-bold text-greenBright/80">
                      {(collab.basisPoints / 100).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-xs font-bold uppercase text-muted border-l-2 border-greenBright pl-4">
                Transparency History
              </h3>
              <div className="relative space-y-4 before:absolute before:left-[19px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-white/10 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {isLoadingHistory ? (
                  <ListSkeleton count={4} />
                ) : history.length > 0 ? (
                  history.map((item) => (
                    <div key={item.id} className="relative pl-10 group">
                      <div
                        className={clsx(
                          "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0a0a09] transition-all group-hover:border-greenBright/30",
                          item.type === "round" ? "text-greenBright" : "text-ink/60",
                        )}
                      >
                        {item.type === "round" ? (
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-ink">
                            {item.type === "round" ? `Round #${item.round}` : "Payout"}
                          </p>
                        </div>
                        <p className="text-[10px] text-muted">
                          <span className="text-ink">{Number(item.amount).toLocaleString()}</span> Stroops
                        </p>
                        <a
                          href={getExplorerUrl(item.txHash, wallet.network)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-bold text-greenBright/40 hover:text-greenBright uppercase"
                        >
                          Verify →
                        </a>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="pl-10 text-[10px] font-bold uppercase tracking-widest text-muted opacity-40 italic">
                    {historyError ? "History unavailable. Retry to refresh." : "No verified history found for this project"}
                  </div>
                )}

                {historyError && (
                  <div className="pl-10">
                    <button
                      onClick={() => fetchedProject && fetchHistory(fetchedProject.projectId)}
                      disabled={isLoadingHistory}
                      className="text-[10px] font-bold uppercase tracking-widest text-red-300 hover:text-red-200 disabled:opacity-50"
                    >
                      Retry History
                    </button>
                    {isHistoryStale && (
                      <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-300">
                        Showing stale history data.
                      </p>
                    )}
                  </div>
                )}

                {historyCursor && (
                  <div className="mt-4 mb-8 flex justify-center">
                    <button
                      onClick={() => fetchedProject && fetchHistory(fetchedProject.projectId, historyCursor)}
                      disabled={isLoadingHistory}
                      className="text-[10px] font-bold uppercase tracking-[0.2em] text-greenBright hover:text-white transition-colors disabled:opacity-50"
                    >
                      {isLoadingHistory ? "Loading..." : "Load More History ↓"}
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowDistributeModal(true)}
                disabled={
                  Number(fetchedProject.balance) <= 0 ||
                  !wallet.connected ||
                  sorobanSplitFlowBusy
                }
                className="premium-button w-full rounded-2xl bg-greenBright py-6 text-xs font-black uppercase text-[#0a0a09] shadow-xl"
              >
                Trigger Distribution
              </button>
              {adminStatus?.isPaused && (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    ⚠ Distributions are paused by the contract admin
                  </p>
                </div>
              )}
              {!wallet.connected && (
                <p className="text-center text-[10px] font-bold text-red-500 uppercase tracking-widest">
                  Connect wallet to distribute
                </p>
              )}
              {Number(fetchedProject.balance) <= 0 && (
                <p className="text-center text-[10px] font-bold text-muted uppercase tracking-widest">
                  No funds available to distribute
                </p>
              )}
              {receipt && (receipt.action === "distribute" || receipt.action === "lock" || receipt.action === "deposit") && (
                <TransactionReceiptView receipt={receipt} network={wallet.network ?? null} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
