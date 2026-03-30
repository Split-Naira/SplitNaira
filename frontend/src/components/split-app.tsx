"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { rpc, Transaction, StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";

import {
  buildCreateSplitXdr,
  buildDepositXdr,
  buildDistributeXdr,
  buildLockProjectXdr,
  getProjectHistory,
  getSplit,
  type ProjectHistoryItem,
} from "@/lib/api";
import { isOwner } from "@/lib/address";
import {
  connectFreighter,
  getFreighterWalletState,
  signWithFreighter,
  type WalletState,
} from "@/lib/freighter";
import { type SplitProject } from "@/lib/stellar";
import { useToast } from "./toast-provider";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

// Use static IDs instead of random UUIDs to avoid hydration mismatches
const getInitialCollaborators = (): CollaboratorInput[] => [
  { id: "collab-1", address: "", alias: "", basisPoints: "5000" },
  { id: "collab-2", address: "", alias: "", basisPoints: "5000" },
];

// Seeded project IDs for Phase 3 Projects list view
const SEEDED_PROJECT_IDS = [
  "afrobeats_001",
  "diaspora_sounds_02",
  "naija_vibes_03",
  "west_african_beats_04",
  "cultural_resonance_05",
];

export function SplitApp() {
  const { showToast } = useToast();

  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    network: null,
  });
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("music");
  const [token, setToken] = useState("");
  const [collaborators, setCollaborators] = useState<CollaboratorInput[]>(getInitialCollaborators());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<SplitProject | null>(
    null,
  );

  const [activeTab, setActiveTab] = useState<"create" | "manage" | "projects">("create");
  const [searchProjectId, setSearchProjectId] = useState("");
  const [fetchedProject, setFetchedProject] = useState<SplitProject | null>(
    null,
  );
  const [isFetchingProject, setIsFetchingProject] = useState(false);
  const [showDistributeModal, setShowDistributeModal] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [history, setHistory] = useState<ProjectHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const lockModalRef = useRef<HTMLDivElement | null>(null);
  const depositModalRef = useRef<HTMLDivElement | null>(null);

  // Phase 3: Projects tab state
  const [projectsList, setProjectsList] = useState<SplitProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoadingProjectsList, setIsLoadingProjectsList] = useState(false);

  const totalBasisPoints = useMemo(
    () =>
      collaborators.reduce((sum, collaborator) => {
        const parsed = Number.parseInt(collaborator.basisPoints, 10);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [collaborators],
  );

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const addresses = new Map<string, string>();
    const duplicates = new Set<string>();

    collaborators.forEach((c) => {
      const addr = c.address.trim();
      if (addr) {
        if (
          !StrKey.isValidEd25519PublicKey(addr) &&
          !StrKey.isValidContract(addr)
        ) {
          errors[c.id] = "Invalid Stellar address (G...) or contract ID (C...)";
        } else {
          if (addresses.has(addr)) {
            duplicates.add(addr);
          } else {
            addresses.set(addr, c.id);
          }
        }
      }
    });

    if (duplicates.size > 0) {
      collaborators.forEach((c) => {
        const addr = c.address.trim();
        if (duplicates.has(addr)) {
          errors[c.id] = "Duplicate address";
        }
      });
    }

    return errors;
  }, [collaborators]);

  const isValid = useMemo(
    () =>
      totalBasisPoints === 10_000 && Object.keys(validationErrors).length === 0,
    [totalBasisPoints, validationErrors],
  );

  useEffect(() => {
    void getFreighterWalletState()
      .then(setWallet)
      .catch(() => {
        setWallet({ connected: false, address: null, network: null });
      });
  }, []);

  async function onConnectWallet() {
    try {
      const state = await connectFreighter();
      setWallet(state);
      showToast("Wallet connected.", "success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wallet connection failed.";
      showToast(message, "error");
    }
  }

  async function onReconnectWallet() {
    try {
      const state = await getFreighterWalletState();
      setWallet(state);
      showToast(
        state.connected ? "Wallet reconnected." : "Wallet not authorized.",
        "info",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wallet refresh failed.";
      showToast(message, "error");
    }
  }

  function onDisconnectWallet() {
    setWallet({ connected: false, address: null, network: null });
    showToast("Wallet disconnected.", "info");
  }

  function updateCollaborator(id: string, patch: Partial<CollaboratorInput>) {
    setCollaborators((prev) =>
      prev.map((collaborator) =>
        collaborator.id === id ? { ...collaborator, ...patch } : collaborator,
      ),
    );
  }

  function addCollaborator() {
    setCollaborators((prev) => [
      ...prev,
      { id: `collab-${Date.now()}-${prev.length}`, address: "", alias: "", basisPoints: "0" },
    ]);
  }

  function removeCollaborator(id: string) {
    setCollaborators((prev) =>
      prev.length <= 2 ? prev : prev.filter((c) => c.id !== id),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.connected || !wallet.address) {
      showToast("Connect Freighter wallet first.", "error");
      return;
    }
    if (!isValid) {
      showToast("Please fix the validation errors.", "error");
      return;
    }
    const collaboratorPayload = collaborators.map((collaborator) => ({
      address: collaborator.address.trim(),
      alias: collaborator.alias.trim(),
      basisPoints: Number.parseInt(collaborator.basisPoints, 10),
    }));
    setIsSubmitting(true);
    setTxHash(null);
    try {
      const buildResponse = await buildCreateSplitXdr({
        owner: wallet.address,
        projectId: projectId.trim(),
        title: title.trim(),
        projectType: projectType.trim(),
        token: token.trim(),
        collaborators: collaboratorPayload,
      });
      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
          "https://soroban-testnet.stellar.org",
        { allowHttp: true },
      );
      const transaction = new Transaction(
        signedTxXdr,
        buildResponse.metadata.networkPassphrase,
      );
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(
          submitResponse.errorResult?.toString() ??
            "Transaction submission failed.",
        );
      }
      setTxHash(submitResponse.hash ?? null);
      showToast("Split project created successfully.", "success");

      // Fetch and store the created project details
      try {
        const projectDetails = await getSplit(projectId.trim());
        setCreatedProject(projectDetails);
      } catch (error) {
        console.error("Failed to fetch created project details:", error);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create split project.";
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fetchHistory(id: string) {
    setIsLoadingHistory(true);
    try {
      const data = await getProjectHistory(id);
      setHistory(data);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  const onFetchProject = async () => {
    if (!searchProjectId.trim()) return;
    setIsFetchingProject(true);
    try {
      const project = await getSplit(searchProjectId.trim());
      setFetchedProject(project);
      await fetchHistory(searchProjectId.trim());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch project.";
      showToast(message, "error");
      setFetchedProject(null);
    } finally {
      setIsFetchingProject(false);
    }
  };

  const onDistribute = async () => {
    if (!fetchedProject || !wallet.address) return;
    setIsSubmitting(true);
    setTxHash(null);
    setShowDistributeModal(false);
    try {
      const { xdr, metadata } = await buildDistributeXdr(
        fetchedProject.projectId,
        wallet.address,
      );
      const signedTxXdr = await signWithFreighter(
        xdr,
        metadata.networkPassphrase,
      );
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
          "https://soroban-testnet.stellar.org",
        { allowHttp: true },
      );
      const transaction = new Transaction(
        signedTxXdr,
        metadata.networkPassphrase,
      );
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(
          submitResponse.errorResult?.toString() ??
            "Transaction distribution failed.",
        );
      }
      setTxHash(submitResponse.hash ?? null);
      showToast("Distribution initiated successfully.", "success");
      await onFetchProject();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Distribution failed.";
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isProjectOwner = useMemo(() => {
    if (!fetchedProject) {
      return false;
    }

    return isOwner(fetchedProject.owner, wallet.address);
  }, [fetchedProject, wallet.address]);

  const canLockProject = Boolean(fetchedProject && !fetchedProject.locked && isProjectOwner);

  useEffect(() => {
    if (!showLockModal) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLocking) {
        setShowLockModal(false);
      }
    };

    const handleTabTrap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !lockModalRef.current) {
        return;
      }

      const focusableElements = lockModalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusableElements = lockModalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusableElements?.[0]?.focus();

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("keydown", handleTabTrap);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", handleTabTrap);
    };
  }, [showLockModal, isLocking]);

  const onLockProject = async () => {
    if (!fetchedProject || !wallet.address) {
      return;
    }

    setIsLocking(true);
    setTxHash(null);
    try {
      const { xdr, metadata } = await buildLockProjectXdr(fetchedProject.projectId, wallet.address);
      const signedTxXdr = await signWithFreighter(xdr, metadata.networkPassphrase);
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Project lock transaction failed.");
      }

      setTxHash(submitResponse.hash ?? null);
      setFetchedProject((prev) => (prev ? { ...prev, locked: true } : prev));
      setShowLockModal(false);
      showToast("Project locked permanently.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to lock project.";
      showToast(message, "error");
    } finally {
      setIsLocking(false);
    }
  };

  useEffect(() => {
    if (!showDepositModal) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDepositing) {
        setShowDepositModal(false);
      }
    };

    const handleTabTrap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !depositModalRef.current) {
        return;
      }

      const focusableElements = depositModalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusableElements = depositModalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusableElements?.[0]?.focus();

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("keydown", handleTabTrap);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", handleTabTrap);
    };
  }, [showDepositModal, isDepositing]);

  const onDeposit = async () => {
    if (!fetchedProject || !wallet.address) {
      return;
    }

    if (!depositAmount || Number.parseFloat(depositAmount) <= 0) {
      showToast("Please enter a valid deposit amount.", "error");
      return;
    }

    setIsDepositing(true);
    setTxHash(null);
    try {
      const amountInStroops = Math.floor(Number.parseFloat(depositAmount) * 10_000_000);
      const { xdr, metadata } = await buildDepositXdr(
        fetchedProject.projectId,
        wallet.address,
        amountInStroops
      );
      const signedTxXdr = await signWithFreighter(xdr, metadata.networkPassphrase);
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Deposit transaction failed.");
      }

      setTxHash(submitResponse.hash ?? null);
      setShowDepositModal(false);
      setDepositAmount("");
      showToast("Deposit successful!", "success");
      // Refresh project details to show updated balance
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed.";
      showToast(message, "error");
    } finally {
      setIsDepositing(false);
    }
  };

  // Phase 3: Fetch projects list from seeded IDs
  const onFetchProjectsList = async () => {
    setIsLoadingProjectsList(true);
    try {
      const projects: SplitProject[] = [];
      for (const projectId of SEEDED_PROJECT_IDS) {
        try {
          const project = await getSplit(projectId);
          projects.push(project);
        } catch (error) {
          console.error(`Failed to fetch project ${projectId}:`, error);
        }
      }
      setProjectsList(projects);
      if (projects.length === 0) {
        showToast("No projects found.", "info");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch projects list.";
      showToast(message, "error");
    } finally {
      setIsLoadingProjectsList(false);
    }
  };

  // Load projects list when switching to Projects tab
  useEffect(() => {
    if (activeTab === "projects" && projectsList.length === 0 && !isLoadingProjectsList) {
      void onFetchProjectsList();
    }
  }, [activeTab]);

  return (
    <main className="min-h-screen px-6 py-12 md:px-12 selection:bg-greenBright/10 selection:text-greenBright">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        {/* Header */}
        <header className="glass-card rounded-[2.5rem] p-8 md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <h1 className="font-display text-4xl tracking-tight text-ink">
                SplitNaira
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted">
                Premium royalty management on the Stellar network.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {!wallet.connected ? (
                <button
                  type="button"
                  onClick={onConnectWallet}
                  className="premium-button rounded-full bg-greenMid px-8 py-3 text-sm font-bold text-white shadow-lg shadow-greenMid/20"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onReconnectWallet}
                    className="premium-button rounded-full border border-white/5 bg-white/5 px-6 py-3 text-sm font-medium backdrop-blur-sm"
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    onClick={onDisconnectWallet}
                    className="premium-button rounded-full border border-white/5 bg-white/5 px-6 py-3 text-sm font-medium backdrop-blur-sm hover:bg-red-500/10 hover:text-red-400"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>

          {wallet.connected && (
            <div className="mt-8 flex flex-wrap gap-8 border-t border-white/5 pt-8 text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-greenBright animate-pulse" />
                <span>Status: Connected</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="opacity-40">Wallet</span>
                <span className="text-ink font-mono">
                  {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-6)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="opacity-40">Network</span>
                <span className="text-ink">{wallet.network}</span>
              </div>
            </div>
          )}
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-1 rounded-full bg-white/5 p-1.5 self-center">
          <button
            onClick={() => setActiveTab("create")}
            className={clsx(
              "rounded-full px-8 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
              activeTab === "create"
                ? "bg-white/10 text-ink shadow-sm"
                : "text-muted hover:text-ink/80",
            )}
          >
            Create Split
          </button>
          <button
            onClick={() => setActiveTab("manage")}
            className={clsx(
              "rounded-full px-8 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
              activeTab === "manage"
                ? "bg-white/10 text-ink shadow-sm"
                : "text-muted hover:text-ink/80",
            )}
          >
            Manage & Distribute
          </button>
          <button
            onClick={() => setActiveTab("projects")}
            className={clsx(
              "rounded-full px-8 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
              activeTab === "projects" ? "bg-white/10 text-ink shadow-sm" : "text-muted hover:text-ink/80"
            )}
          >
            Projects
          </button>
        </div>

        {activeTab === "create" ? (
          <form onSubmit={onSubmit} className="glass-card rounded-[2.5rem] p-8 md:p-10 space-y-12">
            <div className="flex items-center justify-between border-b border-white/5 pb-6">
              <h2 className="font-display text-2xl tracking-tight">
                Project Setup
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Step 01 / 02
              </span>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="projectId"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1"
                >
                  Project Identifier
                </label>
                <input
                  id="projectId"
                  required
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="e.g. dawn_of_nova_01"
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="title"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1"
                >
                  Display Title
                </label>
                <input
                  id="title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Dawn of Nova"
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="token"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1"
                >
                  Asset Token (Stellar ID)
                </label>
                <div className="space-y-2">
                  <input
                    id="token"
                    required
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="G... or C..."
                    className={clsx(
                      "glass-input w-full rounded-2xl px-5 py-4 text-sm",
                      token &&
                        !StrKey.isValidEd25519PublicKey(token) &&
                        !StrKey.isValidContract(token)
                        ? "border-red-500/50 bg-red-500/5"
                        : "",
                    )}
                  />
                  {token &&
                    !StrKey.isValidEd25519PublicKey(token) &&
                    !StrKey.isValidContract(token) && (
                      <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                        Invalid Stellar address format
                      </p>
                    )}
                </div>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="projectType"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1"
                >
                  Media Category
                </label>
                <input
                  id="projectType"
                  required
                  value={projectType}
                  onChange={(event) => setProjectType(event.target.value)}
                  placeholder="e.g. Music, Film"
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                />
              </div>
            </div>

            <div className="mt-12 space-y-8">
              <div className="flex items-center justify-between border-b border-white/5 pb-6">
                <div className="flex items-center gap-4">
                  <h2 className="font-display text-2xl tracking-tight">
                    Recipients
                  </h2>
                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-bold text-muted">
                    {collaborators.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={addCollaborator}
                  className="premium-button flex items-center gap-2 rounded-xl bg-greenMid/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-greenBright transition-all hover:bg-greenMid/20"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  Add Recipient
                </button>
              </div>

              <div className="space-y-4">
                {collaborators.map((collaborator, index) => (
                  <div
                    key={collaborator.id}
                    className="group relative grid gap-6 rounded-3xl border border-white/5 bg-white/2 p-6 transition-all hover:bg-white/4 md:grid-cols-12 md:items-start"
                  >
                    <div className="md:col-span-5 space-y-2">
                      <label
                        htmlFor={`address-${collaborator.id}`}
                        className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                      >
                        Wallet Address
                      </label>
                      <input
                        id={`address-${collaborator.id}`}
                        required
                        value={collaborator.address}
                        onChange={(event) =>
                          updateCollaborator(collaborator.id, {
                            address: event.target.value,
                          })
                        }
                        placeholder={`Recipient #${index + 1}`}
                        className={clsx(
                          "glass-input w-full rounded-xl px-4 py-3 text-sm",
                          validationErrors[collaborator.id]
                            ? "border-red-500/50 bg-red-500/5"
                            : "",
                        )}
                      />
                      {validationErrors[collaborator.id] && (
                        <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                          {validationErrors[collaborator.id]}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-3 space-y-2">
                      <label
                        htmlFor={`alias-${collaborator.id}`}
                        className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                      >
                        Alias
                      </label>
                      <input
                        id={`alias-${collaborator.id}`}
                        required
                        value={collaborator.alias}
                        onChange={(event) =>
                          updateCollaborator(collaborator.id, {
                            alias: event.target.value,
                          })
                        }
                        placeholder="e.g. Lead Vocals"
                        className="glass-input w-full rounded-xl px-4 py-3 text-sm"
                      />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                      <label
                        htmlFor={`bp-${collaborator.id}`}
                        className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                      >
                        Share (BP)
                      </label>
                      <input
                        id={`bp-${collaborator.id}`}
                        required
                        type="number"
                        min={1}
                        max={10_000}
                        value={collaborator.basisPoints}
                        onChange={(event) =>
                          updateCollaborator(collaborator.id, {
                            basisPoints: event.target.value,
                          })
                        }
                        placeholder="5000"
                        className="glass-input w-full rounded-xl px-4 py-3 text-sm"
                      />
                    </div>
                    <div className="md:col-span-1 pt-8 flex justify-center">
                      <button
                        type="button"
                        onClick={() => removeCollaborator(collaborator.id)}
                        className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400 opacity-0 transition-opacity hover:bg-red-500/20 group-hover:opacity-100"
                      >
                        <svg
                          className="h-5 w-5 pointer-events-none"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-end gap-3 px-4 py-6 rounded-3xl bg-white/2 border border-white/5">
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                    Allocation Matrix
                  </span>
                  <div
                    className={clsx(
                      "flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-sm font-bold shadow-inner transition-all",
                      totalBasisPoints === 10_000
                        ? "bg-greenMid/10 text-greenBright"
                        : "bg-red-500/10 text-red-400",
                    )}
                  >
                    {totalBasisPoints.toLocaleString()}{" "}
                    <span className="opacity-40">/</span> 10,000 BP
                  </div>
                </div>
                {totalBasisPoints !== 10_000 && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/80">
                    Total must equal 10,000 basis points
                  </p>
                )}
              </div>
            </div>

            <div className="mt-12 pt-12 border-t border-white/5">
              <button
                type="submit"
                disabled={isSubmitting || !isValid}
                className="premium-button w-full rounded-4xl bg-greenMid py-5 text-sm font-extrabold uppercase tracking-[0.25em] text-white shadow-2xl shadow-greenMid/20 disabled:cursor-not-allowed disabled:opacity-20"
              >
                {isSubmitting ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Initialising Contract...
                  </div>
                ) : (
                  "Create Split Project"
                )}
              </button>
            </div>

            {txHash && (
              <div className="mt-8 rounded-2xl border border-greenBright/20 bg-greenBright/5 p-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-greenBright/10">
                    <svg
                      className="h-6 w-6 text-greenBright"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-greenBright uppercase tracking-widest">
                      Project Created Successfully
                    </h3>
                    <p className="font-mono text-[10px] text-muted break-all opacity-80">
                      Hash: {txHash}
                    </p>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block pt-2 text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white"
                    >
                      View on Explorer →
                    </a>
                  </div>
                </div>
              </div>
            )}

            {createdProject && (
              <div className="mt-8 glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-display text-2xl tracking-tight">
                        {createdProject.title}
                      </h3>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                        {createdProject.projectType}
                      </span>
                      {createdProject.locked && (
                        <span className="rounded-full bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-400 border border-red-500/20">
                          Locked
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted opacity-60 break-all">
                      {createdProject.projectId}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                      Available Funds
                    </p>
                    <p className="text-3xl font-display text-greenBright">
                      {Number(createdProject.balance).toLocaleString()}{" "}
                      <span className="text-sm font-sans opacity-40">
                        Stroops
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid gap-8 md:grid-cols-2">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
                      Collaborators
                    </h4>
                    <div className="space-y-2">
                      {createdProject.collaborators.map((collab, idx) => (
                        <div
                          key={idx}
                          className="flex justify-between items-center rounded-2xl bg-white/2 p-3 text-sm border border-white/5 hover:bg-white/4 transition-colors"
                        >
                          <div className="space-y-0.5">
                            <p className="font-bold text-xs">{collab.alias}</p>
                            <p className="font-mono text-[9px] text-muted opacity-60 truncate max-w-30">
                              {collab.address}
                            </p>
                          </div>
                          <span className="font-mono font-bold text-greenBright/80 text-xs">
                            {(collab.basisPoints / 100).toFixed(2)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
                      Project Metadata
                    </h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center rounded-2xl bg-white/2 p-3 border border-white/5">
                        <span className="text-xs font-bold text-muted">
                          Distribution Round
                        </span>
                        <span className="font-mono font-bold text-sm">
                          {createdProject.distributionRound}
                        </span>
                      </div>
                      <div className="flex justify-between items-center rounded-2xl bg-white/2 p-3 border border-white/5">
                        <span className="text-xs font-bold text-muted">
                          Total Distributed
                        </span>
                        <span className="font-mono font-bold text-sm">
                          {Number(
                            createdProject.totalDistributed,
                          ).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center rounded-2xl bg-white/2 p-3 border border-white/5">
                        <span className="text-xs font-bold text-muted">
                          Status
                        </span>
                        <span
                          className={`font-mono font-bold text-xs ${createdProject.locked ? "text-red-400" : "text-greenBright"}`}
                        >
                          {createdProject.locked ? "Locked" : "Active"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <button
                    onClick={() => {
                      setActiveTab("manage");
                      setSearchProjectId(createdProject.projectId);
                      setFetchedProject(createdProject);
                    }}
                    className="premium-button w-full rounded-2xl bg-white/10 py-4 text-xs font-bold uppercase tracking-widest text-ink border border-white/10 hover:bg-white/20 transition-all"
                  >
                    Manage Project →
                  </button>
                </div>
              </div>
            )}
          </form>
        ) : activeTab === "manage" ? (
          /* Manage Tab Content */
          <div className="space-y-10">
            <div className="glass-card rounded-[2.5rem] p-8 md:p-10">
              <h2 className="font-display text-2xl tracking-tight mb-8">
                Locate Project
              </h2>
              <div className="flex gap-4">
                <input
                  value={searchProjectId}
                  onChange={(e) => setSearchProjectId(e.target.value)}
                  placeholder="Enter Project ID (e.g. afrobeats_001)"
                  className="glass-input flex-1 rounded-2xl px-5 py-4 text-sm"
                />
                <button
                  onClick={onFetchProject}
                  disabled={isFetchingProject || !searchProjectId.trim()}
                  className="premium-button rounded-2xl bg-white px-8 py-4 text-xs font-bold uppercase tracking-widest text-[#0a0a09] disabled:opacity-20"
                >
                  {isFetchingProject ? "Searching..." : "Fetch Stats"}
                </button>
              </div>
            </div>

            {fetchedProject && (
              <div className="glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-3xl tracking-tight">
                        {fetchedProject.title}
                      </h2>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                        {fetchedProject.projectType}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-muted opacity-60 break-all">
                      {fetchedProject.projectId}
                    </p>
                  </div>
                  {fetchedProject.locked ? (
                    <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-amber-200">
                      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <span aria-hidden="true">🔒</span>
                        Split locked - immutable
                      </p>
                    </div>
                  ) : canLockProject ? (
                    <button
                      type="button"
                      onClick={() => setShowLockModal(true)}
                      className="premium-button rounded-2xl border border-red-400/30 bg-red-500/10 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/20"
                    >
                      Lock Project
                    </button>
                  ) : null}
                  <div className="text-right space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                      Available Funds
                    </p>
                    <p className="text-4xl font-display text-greenBright">
                      {Number(fetchedProject.balance).toLocaleString()}{" "}
                      <span className="text-sm font-sans opacity-40">
                        Stroops
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-10 grid gap-10 md:grid-cols-2">
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
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
                        <div
                          key={idx}
                          className="flex justify-between items-center rounded-2xl bg-white/2 p-4 text-sm border border-white/5 hover:bg-white/4 transition-colors"
                        >
                          <div className="space-y-0.5">
                            <p className="font-bold">{collab.alias}</p>
                            <p className="font-mono text-[10px] text-muted opacity-60 truncate max-w-37.5">
                              {collab.address}
                            </p>
                          </div>
                          <span className="font-mono font-bold text-greenBright/80">
                            {(collab.basisPoints / 100).toFixed(2)}%
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-white/5">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted mb-6">
                        Internal Ledgers
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-white/5 bg-white/2 p-4 space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                            Rounds
                          </p>
                          <p className="text-xl font-display">
                            {fetchedProject.distributionRound}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-white/2 p-4 space-y-1 text-right">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                            Total Paid
                          </p>
                          <p className="text-xl font-display">
                            {Number(
                              fetchedProject.totalDistributed,
                            ).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">
                      Transparency History
                    </h3>
                    <div className="relative space-y-4 before:absolute before:left-4.75 before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-white/10 max-h-125 overflow-y-auto pr-2 custom-scrollbar">
                      {isLoadingHistory ? (
                        <div className="flex items-center gap-3 pl-10 text-[10px] font-bold uppercase tracking-widest text-muted">
                          <svg
                            className="h-3 w-3 animate-spin"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                              fill="none"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          Syncing on-chain events...
                        </div>
                      ) : history.length > 0 ? (
                        history.map((item) => (
                          <div key={item.id} className="relative pl-10 group">
                            <div
                              className={clsx(
                                "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0a0a09] transition-all group-hover:border-greenBright/30",
                                item.type === "round"
                                  ? "text-greenBright"
                                  : "text-ink/60",
                              )}
                            >
                              {item.type === "round" ? (
                                <svg
                                  className="h-5 w-5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="h-4 w-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                                  />
                                </svg>
                              )}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold text-ink">
                                  {item.type === "round"
                                    ? `Distribution Round #${item.round}`
                                    : "Recipient Payout"}
                                </p>
                                <span className="text-[10px] font-mono text-muted tabular-nums opacity-60">
                                  {new Date(
                                    item.ledgerCloseTime * 1000,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <p className="text-[10px] font-medium text-muted uppercase tracking-tighter">
                                {item.type === "round" ? (
                                  <>
                                    Total:{" "}
                                    <span className="text-ink">
                                      {Number(item.amount).toLocaleString()}
                                    </span>{" "}
                                    Stroops
                                  </>
                                ) : (
                                  <>
                                    To:{" "}
                                    <span className="text-ink font-mono">
                                      {item.recipient?.slice(0, 8) ?? "Unknown"}...
                                    </span>{" "}
                                    Amount:{" "}
                                    <span className="text-ink">
                                      {Number(item.amount).toLocaleString()}
                                    </span>
                                  </>
                                )}
                              </p>
                              <a
                                href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[9px] font-bold text-greenBright/40 hover:text-greenBright transition-colors uppercase tracking-widest mt-1"
                              >
                                Verify Transaction →
                              </a>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="pl-10 text-[10px] font-bold uppercase tracking-widest text-muted opacity-40 italic">
                          No verified history found for this project
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setShowDepositModal(true)}
                      disabled={!wallet.connected}
                      className="premium-button w-full rounded-2xl bg-goldLight py-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-goldLight/20 disabled:opacity-10 disabled:bg-white"
                    >
                      Deposit Funds
                    </button>
                    {!wallet.connected && (
                      <p className="text-center text-[10px] font-bold text-red-500 uppercase tracking-widest">
                        Connect wallet to deposit
                      </p>
                    )}

                    <button
                      onClick={() => setShowDistributeModal(true)}
                      disabled={
                        Number(fetchedProject.balance) <= 0 || !wallet.connected
                      }
                      className="premium-button w-full rounded-2xl bg-greenBright py-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-greenBright/10 disabled:opacity-10 disabled:bg-white"
                    >
                      Trigger Distribution
                    </button>
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
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Projects Tab Content */
          <div className="space-y-10">
            {/* Projects List View */}
            {selectedProjectId === null ? (
              <div className="space-y-8">
                <div className="glass-card rounded-[2.5rem] p-8 md:p-10">
                  <h2 className="font-display text-2xl tracking-tight mb-2">Available Projects</h2>
                  <p className="text-muted text-sm mb-6">Browse and manage existing split projects</p>
                  <button
                    onClick={onFetchProjectsList}
                    disabled={isLoadingProjectsList}
                    className="premium-button rounded-2xl bg-greenMid px-8 py-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-20"
                  >
                    {isLoadingProjectsList ? (
                      <div className="flex items-center gap-3">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Loading Projects...
                      </div>
                    ) : (
                      "Refresh Projects"
                    )}
                  </button>
                </div>

                {projectsList.length > 0 ? (
                  <div className="grid gap-6 md:grid-cols-2">
                    {projectsList.map((project) => (
                      <button
                        key={project.projectId}
                        onClick={() => {
                          setSelectedProjectId(project.projectId);
                          setFetchedProject(project);
                          void fetchHistory(project.projectId);
                        }}
                        className="glass-card rounded-[2.5rem] p-8 text-left hover:bg-white/5 transition-all animate-in fade-in zoom-in-95 duration-500"
                      >
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="space-y-2 flex-1">
                            <h3 className="font-display text-xl tracking-tight">{project.title}</h3>
                            <p className="font-mono text-[10px] text-muted opacity-60 break-all">{project.projectId}</p>
                          </div>
                          <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                            {project.projectType}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Collaborators</p>
                            <p className="text-2xl font-display">{project.collaborators.length}</p>
                          </div>
                          <div className="text-right space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Available</p>
                            <p className="text-2xl font-display text-greenBright">{Number(project.balance).toLocaleString()}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="glass-card rounded-[2.5rem] p-12 text-center">
                    <p className="text-muted text-sm font-medium">
                      {isLoadingProjectsList ? "Loading projects..." : "No projects loaded yet. Click Refresh Projects to load."}
                    </p>
                  </div>
                )}
              </div>
            ) : fetchedProject ? (
              /* Projects Detail View */
              <div className="space-y-8">
                <button
                  onClick={() => {
                    setSelectedProjectId(null);
                    setFetchedProject(null);
                  }}
                  className="premium-button flex items-center gap-2 rounded-2xl bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-widest text-muted hover:text-ink hover:bg-white/10 transition-all"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Projects
                </button>

                <div className="glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in zoom-in-95 duration-500">
                  <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h2 className="font-display text-3xl tracking-tight">{fetchedProject.title}</h2>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                          {fetchedProject.projectType}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-muted opacity-60 break-all">{fetchedProject.projectId}</p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Available Funds</p>
                      <p className="text-4xl font-display text-greenBright">{Number(fetchedProject.balance).toLocaleString()} <span className="text-sm font-sans opacity-40">Stroops</span></p>
                    </div>
                  </div>

                  <div className="mt-10 grid gap-10 md:grid-cols-2">
                    <div className="space-y-6">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">Distribution Rules</h3>
                      <div className="space-y-3">
                        {fetchedProject.collaborators.map((collab, idx) => (
                          <div key={idx} className="flex justify-between items-center rounded-2xl bg-white/2 p-4 text-sm border border-white/5 hover:bg-white/4 transition-colors">
                            <div className="space-y-0.5">
                              <p className="font-bold">{collab.alias}</p>
                              <p className="font-mono text-[10px] text-muted opacity-60 truncate max-w-[150px]">{collab.address}</p>
                            </div>
                            <span className="font-mono font-bold text-greenBright/80">{(collab.basisPoints / 100).toFixed(2)}%</span>
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
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted border-l-2 border-greenBright pl-4">Transparency History</h3>
                      <div className="relative space-y-4 before:absolute before:left-[19px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-white/10 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {isLoadingHistory ? (
                          <div className="flex items-center gap-3 pl-10 text-[10px] font-bold uppercase tracking-widest text-muted">
                            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Syncing on-chain events...
                          </div>
                        ) : history.length > 0 ? (
                          history.map((item) => (
                            <div key={item.id} className="relative pl-10 group">
                              <div className={clsx(
                                "absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0a0a09] transition-all group-hover:border-greenBright/30",
                                item.type === "round" ? "text-greenBright" : "text-ink/60"
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
                                    {new Date(item.ledgerCloseTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-[10px] font-medium text-muted uppercase tracking-tighter">
                                  {item.type === "round" ? (
                                    <>Total: <span className="text-ink">{Number(item.amount).toLocaleString()}</span> Stroops</>
                                  ) : (
                                    <>To: <span className="text-ink font-mono">{item.recipient?.slice(0, 8) ?? "Unknown"}...</span> Amount: <span className="text-ink">{Number(item.amount).toLocaleString()}</span></>
                                  )}
                                </p>
                                <a
                                  href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[9px] font-bold text-greenBright/40 hover:text-greenBright transition-colors uppercase tracking-widest mt-1"
                                >
                                  Verify Transaction →
                                </a>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="pl-10 text-[10px] font-bold uppercase tracking-widest text-muted opacity-40 italic">
                            No verified history found for this project
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => setShowDistributeModal(true)}
                        disabled={Number(fetchedProject.balance) <= 0 || !wallet.connected}
                        className="premium-button w-full rounded-2xl bg-greenBright py-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-greenBright/10 disabled:opacity-10 disabled:bg-white"
                      >
                        Trigger Distribution
                      </button>
                      {!wallet.connected && <p className="text-center text-[10px] font-bold text-red-500 uppercase tracking-widest">Connect wallet to distribute</p>}
                      {Number(fetchedProject.balance) <= 0 && <p className="text-center text-[10px] font-bold text-muted uppercase tracking-widest">No funds available to distribute</p>}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Distribution Confirmation Modal */}
      {showDistributeModal && fetchedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#0a0a09]/80 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            <h2 className="font-display text-3xl mb-2">Final Confirmation</h2>
            <p className="text-muted text-sm mb-8 leading-relaxed">
              Splitting{" "}
              <span className="text-ink font-bold">
                {Number(fetchedProject.balance).toLocaleString()} stroops
              </span>{" "}
              across{" "}
              <span className="text-ink font-bold">
                {fetchedProject.collaborators.length} collaborators
              </span>{" "}
              for project{" "}
              <span className="text-ink font-bold italic">
                &quot;{fetchedProject.title}&quot;
              </span>
              .
            </p>

            <div className="space-y-3 max-h-75 overflow-y-auto pr-2 custom-scrollbar">
              {fetchedProject.collaborators.map((collab, idx) => {
                const amount = Math.floor(
                  (Number(fetchedProject.balance) * collab.basisPoints) /
                    10_000,
                );
                return (
                  <div
                    key={idx}
                    className="flex justify-between items-center rounded-2xl bg-white/5 p-5 border border-white/5"
                  >
                    <div className="space-y-0.5">
                      <p className="font-bold text-sm">{collab.alias}</p>
                      <p className="text-[10px] text-muted uppercase tracking-widest">
                        {(collab.basisPoints / 100).toFixed(2)}% Share
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg text-greenBright">
                        +{amount.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted uppercase tracking-tighter">
                        Stroops
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-10 flex flex-col gap-4">
              <button
                onClick={onDistribute}
                disabled={isSubmitting}
                className="premium-button w-full rounded-2xl bg-greenBright py-5 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09]"
              >
                {isSubmitting ? "Broadcasting..." : "Execute Payout"}
              </button>
              <button
                onClick={() => setShowDistributeModal(false)}
                disabled={isSubmitting}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:text-ink hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showLockModal && fetchedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a09]/80 p-6 backdrop-blur-xl animate-in fade-in duration-300">
          <div
            ref={lockModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lock-project-title"
            aria-describedby="lock-project-warning"
            className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-10 duration-500"
          >
            <h2 id="lock-project-title" className="font-display text-3xl">
              Lock this project?
            </h2>
            <p className="mt-4 text-sm text-muted leading-relaxed">
              You are about to permanently lock
              {" "}
              <span className="text-ink font-bold italic">&quot;{fetchedProject.title}&quot;</span>.
            </p>

            <div id="lock-project-warning" className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-red-300">Permanent action</p>
              <p className="mt-2 text-sm font-semibold text-red-200">
                This action is permanent and cannot be undone. Once locked, the split configuration can never be changed.
              </p>
            </div>

            <div className="mt-10 flex flex-col gap-4">
              <button
                type="button"
                onClick={onLockProject}
                disabled={isLocking}
                className="premium-button w-full rounded-2xl bg-red-500 py-5 text-xs font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLocking ? "Locking..." : "Lock Project"}
              </button>
              <button
                type="button"
                onClick={() => setShowLockModal(false)}
                disabled={isLocking}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:bg-white/5 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showDepositModal && fetchedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a09]/80 p-6 backdrop-blur-xl animate-in fade-in duration-300">
          <div
            ref={depositModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deposit-title"
            aria-describedby="deposit-description"
            className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-10 duration-500"
          >
            <h2 id="deposit-title" className="font-display text-3xl mb-2">
              Deposit Funds
            </h2>
            <p id="deposit-description" className="text-muted text-sm mb-8 leading-relaxed">
              Contribute funds to project{" "}
              <span className="text-ink font-bold italic">
                &quot;{fetchedProject.title}&quot;
              </span>
              .
            </p>

            <div className="space-y-6">
              <div className="space-y-2">
                <label
                  htmlFor="deposit-amount"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted"
                >
                  Amount (in tokens)
                </label>
                <input
                  id="deposit-amount"
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.0"
                  disabled={isDepositing}
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm disabled:opacity-50"
                />
              </div>

              <div className="rounded-2xl border border-blue-400/40 bg-blue-500/10 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-blue-300">
                  Deposit Summary
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted">Amount to deposit:</span>
                    <span className="text-ink font-bold">
                      {depositAmount || "0"} tokens
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted">Project:</span>
                    <span className="text-ink font-bold">
                      {fetchedProject.projectId}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm pt-2 border-t border-blue-400/20">
                    <span className="text-muted">Current balance:</span>
                    <span className="text-greenBright font-bold">
                      {Number(fetchedProject.balance).toLocaleString()} Stroops
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-col gap-4">
              <button
                type="button"
                onClick={onDeposit}
                disabled={isDepositing || !depositAmount || Number.parseFloat(depositAmount) <= 0}
                className="premium-button w-full rounded-2xl bg-blue-500 py-5 text-xs font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDepositing ? "Processing..." : "Confirm Deposit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDepositModal(false);
                  setDepositAmount("");
                }}
                disabled={isDepositing}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:bg-white/5 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}