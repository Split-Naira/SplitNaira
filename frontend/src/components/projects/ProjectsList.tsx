"use client";

import { clsx } from "clsx";
import { sanitizeText } from "@/lib/security";
import type { SplitProject } from "@/lib/stellar";
import type { ProjectHistoryItem, AdminStatusState } from "@/lib/api";
import type { WalletState } from "@/lib/wallet";
import { DashboardGridSkeleton, ListSkeleton } from "../Skeleton";
import { TransactionReceiptView, type TransactionReceipt } from "../TransactionReceiptView";

interface ProjectsListProps {
  wallet: WalletState;
  selectedProjectId: string | null;
  setSelectedProjectId: (val: string | null) => void;
  projectsList: SplitProject[];
  onFetchProjectsList: (loadMore?: boolean) => Promise<void>;
  isLoadingProjectsList: boolean;
  projectsListError: string | null;
  isProjectsListStale: boolean;
  hasMoreProjects: boolean;
  fetchedProject: SplitProject | null;
  setFetchedProject: (p: SplitProject | null) => void;
  fetchHistory: (id: string, cursor?: string) => Promise<void>;
  isLoadingHistory: boolean;
  history: ProjectHistoryItem[];
  historyError: string | null;
  isHistoryStale: boolean;
  historyCursor: string | null;
  setShowDistributeModal: (val: boolean) => void;
  adminStatus: AdminStatusState | null;
  receipt: TransactionReceipt | null;
  sorobanSplitFlowBusy: boolean;
  getExplorerUrl: (hash: string, network: string | null) => string;
  getExplorerLabel: (network: string | null) => string;
}

export function ProjectsList({
  wallet,
  selectedProjectId,
  setSelectedProjectId,
  projectsList,
  onFetchProjectsList,
  isLoadingProjectsList,
  projectsListError,
  isProjectsListStale,
  hasMoreProjects,
  fetchedProject,
  setFetchedProject,
  fetchHistory,
  isLoadingHistory,
  history,
  historyError,
  isHistoryStale,
  historyCursor,
  setShowDistributeModal,
  sorobanSplitFlowBusy,
  adminStatus,
  receipt,
  getExplorerUrl,
  getExplorerLabel,
}: ProjectsListProps) {
  return (
    <div className="space-y-10">
      {selectedProjectId === null ? (
        <div className="space-y-8">
          <div className="glass-card rounded-[2.5rem] p-8 md:p-10">
            <h2 className="font-display text-2xl tracking-tight mb-2">Available Projects</h2>
            <button
              type="button"
              onClick={() => void onFetchProjectsList(false)}
              disabled={isLoadingProjectsList}
              aria-label="Refresh projects"
              title="Refresh projects"
              className="premium-button inline-flex items-center gap-2 rounded-2xl bg-greenMid px-8 py-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-20"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={clsx("h-4 w-4", isLoadingProjectsList && "animate-spin")}
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {isLoadingProjectsList ? "Refreshing…" : "Refresh Projects"}
            </button>
            {projectsListError && (
              <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">
                  Failed to refresh projects: {projectsListError}
                </p>
                {isProjectsListStale && (
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-300">
                    Showing stale project list data.
                  </p>
                )}
              </div>
            )}
          </div>
          {isLoadingProjectsList && projectsList.length === 0 ? (
            <DashboardGridSkeleton count={4} />
          ) : projectsList.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 animate-in fade-in">
              {projectsList.map((p) => (
                <button
                  key={p.projectId}
                  onClick={() => {
                    setSelectedProjectId(p.projectId);
                    setFetchedProject(p);
                    fetchHistory(p.projectId);
                  }}
                  className="glass-card rounded-[2.5rem] p-8 text-left hover:bg-white/5 transition-all"
                >
                  <h3 className="font-display text-xl mb-1">{sanitizeText(p.title)}</h3>
                  <p className="font-mono text-[10px] text-muted mb-4">{p.projectId}</p>
                  <div className="flex justify-between border-t border-white/5 pt-4">
                    <span className="text-xl font-display text-greenBright">
                      {Number(p.balance).toLocaleString()}
                    </span>
                    <span className="text-[10px] uppercase text-muted">Available</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="glass-card rounded-[2.5rem] p-12 text-center">
              <p className="text-muted text-sm font-medium">
                {projectsListError
                  ? "Could not load projects. Retry refresh."
                  : "No projects found. Click Refresh Projects to load."}
              </p>
            </div>
          )}

          {/* Load more — visible when backend signals more pages exist (#380) */}
          {projectsList.length > 0 && (
            <div className="flex flex-col items-center gap-3">
              {hasMoreProjects ? (
                <button
                  onClick={() => void onFetchProjectsList(true)}
                  disabled={isLoadingProjectsList}
                  className="premium-button rounded-2xl bg-white/5 border border-white/10 px-10 py-4 text-xs font-bold uppercase tracking-widest text-muted hover:text-ink hover:bg-white/10 transition-all disabled:opacity-30"
                >
                  {isLoadingProjectsList ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Loading…
                    </span>
                  ) : (
                    "Load More ↓"
                  )}
                </button>
              ) : (
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted opacity-40">
                  All projects loaded
                </p>
              )}
            </div>
          )}
        </div>
      ) : fetchedProject ? (
        <div className="space-y-8">
          <button
            onClick={() => {
              setSelectedProjectId(null);
              setFetchedProject(null);
            }}
            className="premium-button flex items-center gap-2 rounded-2xl bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-widest text-muted hover:text-ink hover:bg-white/10 transition-all"
          >
            Back to Projects
          </button>

          <div className="glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-3xl tracking-tight">{sanitizeText(fetchedProject.title)}</h2>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                    {sanitizeText(fetchedProject.projectType)}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted opacity-60 break-all">{fetchedProject.projectId}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Available Funds</p>
                <p className="text-4xl font-display text-greenBright">
                  {Number(fetchedProject.balance).toLocaleString()}{" "}
                  <span className="text-sm font-sans opacity-40">Stroops</span>
                </p>
              </div>
            </div>

            <div className="mt-10 grid gap-10 md:grid-cols-2">
              <div className="space-y-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
                  Distribution Rules
                </h3>
                <div className="space-y-3">
                  {fetchedProject.collaborators.map((collab, idx) => (
                    <div key={idx} className="flex justify-between items-center rounded-2xl bg-white/2 p-4 text-sm border border-white/5 hover:bg-white/4 transition-colors">
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

                <div className="pt-6 border-t border-white/5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted mb-6">Internal Ledgers</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-white/5 bg-white/2 p-4 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Rounds</p>
                      <p className="text-xl font-display">{fetchedProject.distributionRound}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/2 p-4 space-y-1 text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Total Paid</p>
                      <p className="text-xl font-display">{Number(fetchedProject.totalDistributed).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
                  Transparency History
                </h3>
                <div className="relative space-y-4 before:absolute before:left-[19px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-white/10 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {isLoadingHistory ? (
                    <ListSkeleton count={4} />
                  ) : history.length > 0 ? (
                    history.map((item) => (
                      <div key={item.id} className="relative pl-10 group">
                        <div className={clsx(
                          "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0a0a09] transition-all group-hover:border-greenBright/30",
                          item.type === "round" ? "text-greenBright" : "text-ink/60",
                        )}>
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
                              {item.type === "round" ? `Distribution Round #${item.round}` : "Recipient Payout"}
                            </p>
                            <span className="text-[10px] font-mono text-muted tabular-nums opacity-60">
                              {new Date(item.ledgerCloseTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-[10px] font-medium text-muted uppercase tracking-tighter">
                            {item.type === "round" ? (
                              <>Total: <span className="text-ink">{Number(item.amount).toLocaleString()}</span> Stroops</>
                            ) : (
                              <>To: <span className="text-ink font-mono">{item.recipient?.slice(0, 8) ?? "Unknown"}...</span> Amount: <span className="text-ink">{Number(item.amount).toLocaleString()}</span></>
                            )}
                          </div>
                          <a
                            href={getExplorerUrl(item.txHash, wallet.network)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] font-bold text-greenBright/40 hover:text-greenBright transition-colors uppercase tracking-widest mt-1"
                          >
                            Verify on {getExplorerLabel(wallet.network)} →
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
                  className="premium-button w-full rounded-2xl bg-greenBright py-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-greenBright/10 disabled:opacity-10 disabled:bg-white"
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
                  <TransactionReceiptView
                    receipt={receipt}
                    network={wallet.network ?? null}
                    explorerUrl={getExplorerUrl(receipt.hash, wallet.network ?? null)}
                    explorerLabel={getExplorerLabel(wallet.network ?? null)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
