"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { rpc, Transaction, StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";

import {
  buildAllowTokenXdr,
  buildCreateSplitXdr,
  buildDisallowTokenXdr,
  buildDepositXdr,
  buildDistributeXdr,
  buildLockProjectXdr,
  buildUpdateMetadataXdr,
  buildUpdateCollaboratorsXdr,
  getAllSplits,
  getClaimable,
  getProjectHistory,
  getSplit,
  type ProjectHistoryItem,
  getTokenAllowlist,
  type TokenAllowlistState,
} from "@/lib/api";
import { isOwner } from "@/lib/address";
import {
  signWithFreighter,
} from "@/lib/freighter";
import { type SplitProject, getExplorerUrl, getExplorerLabel } from "@/lib/stellar";
import { useWallet } from "@/hooks/useWallet";
import { notify } from "@/lib/notification";
import { TokenSelector } from "./TypeSelector";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

interface AllowlistActionResult {
  action: "allow" | "disallow";
  token: string;
  txHash: string | null;
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

interface TransactionReceipt {
  hash: string;
  action: "create" | "deposit" | "distribute" | "lock";
  projectId: string;
  title?: string;
  amount?: string;
  round?: number;
}

export function SplitApp() {
  const { wallet, connect, refresh } = useWallet();

  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("music");
  const [token, setToken] = useState("");
  const [collaborators, setCollaborators] = useState<CollaboratorInput[]>(getInitialCollaborators());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [createdProject, setCreatedProject] = useState<SplitProject | null>(
    null,
  );

  const [activeTab, setActiveTab] = useState<"dashboard" | "create" | "manage" | "projects">("dashboard");
  const [createStep, setCreateStep] = useState(1); // 1: Project, 2: Collaborators, 3: Review, 4: Submit
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
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryStale, setIsHistoryStale] = useState(false);
  const lockModalRef = useRef<HTMLDivElement | null>(null);
  const depositModalRef = useRef<HTMLDivElement | null>(null);

  // Phase 3: Projects tab state
  const [projectsList, setProjectsList] = useState<SplitProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoadingProjectsList, setIsLoadingProjectsList] = useState(false);
  const [projectsListError, setProjectsListError] = useState<string | null>(null);
  const [isProjectsListStale, setIsProjectsListStale] = useState(false);
  const [projectFetchError, setProjectFetchError] = useState<string | null>(null);
  const [isProjectStale, setIsProjectStale] = useState(false);

  // Metadata editing state
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editProjectType, setEditProjectType] = useState("music");
  const [isUpdatingMetadata, setIsUpdatingMetadata] = useState(false);

  // Collaborator editing state
  const [isEditingCollaborators, setIsEditingCollaborators] = useState(false);
  const [editCollaborators, setEditCollaborators] = useState<CollaboratorInput[]>([]);
  const [isUpdatingCollaborators, setIsUpdatingCollaborators] = useState(false);

  async function onUpdateCollaborators() {
    if (!fetchedProject || !wallet.address) return;

    // Use the same validation logic as create flow
    const totalBP = editCollaborators.reduce((sum, c) => {
      const parsed = Number.parseInt(c.basisPoints, 10);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);

    if (totalBP !== 10_000) {
      notify.error("Total basis points must equal 10,000.");
      return;
    }

    const errors: Record<string, string> = {};
    const addresses = new Map<string, string>();
    const duplicates = new Set<string>();

    editCollaborators.forEach((c) => {
      const addr = c.address.trim();
      if (addr) {
        if (!StrKey.isValidEd25519PublicKey(addr) && !StrKey.isValidContract(addr)) {
          errors[c.id] = "Invalid address";
        } else if (addresses.has(addr)) {
          duplicates.add(addr);
        } else {
          addresses.set(addr, c.id);
        }
      } else {
        errors[c.id] = "Address is required";
      }
    });

    if (duplicates.size > 0 || Object.keys(errors).length > 0 || editCollaborators.length < 2) {
      notify.error("Please fix collaborator validation errors.");
      return;
    }

    setIsUpdatingCollaborators(true);
    try {
      const buildResponse = await buildUpdateCollaboratorsXdr(
        fetchedProject.projectId,
        wallet.address,
        editCollaborators.map(c => ({
          address: c.address.trim(),
          alias: c.alias.trim(),
          basisPoints: Number.parseInt(c.basisPoints, 10)
        }))
      );

      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase
      );

      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(
        signedTxXdr,
        buildResponse.metadata.networkPassphrase
      );
      const submitResponse = await server.sendTransaction(transaction);

      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      }

      notify.success("Collaborators updated successfully.");
      setIsEditingCollaborators(false);
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update collaborators.";
      notify.error(message);
    } finally {
      setIsUpdatingCollaborators(false);
    }
  }

  // Earnings Dashboard state
  const [dashboardData, setDashboardData] = useState<SplitProject[]>([]);
  const [userEarnings, setUserEarnings] = useState<Record<string, string>>({});
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [tokenAllowlist, setTokenAllowlist] = useState<TokenAllowlistState | null>(null);
  const [allowlistTokenInput, setAllowlistTokenInput] = useState("");
  const [isLoadingAllowlist, setIsLoadingAllowlist] = useState(true);
  const [isUpdatingAllowlist, setIsUpdatingAllowlist] = useState(false);
  const [lastAllowlistTx, setLastAllowlistTx] = useState<AllowlistActionResult | null>(null);

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

  const editCollaboratorsValidationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const addresses = new Map<string, string>();
    const duplicates = new Set<string>();

    editCollaborators.forEach((c) => {
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
      editCollaborators.forEach((c) => {
        const addr = c.address.trim();
        if (duplicates.has(addr)) {
          errors[c.id] = "Duplicate address";
        }
      });
    }

    return errors;
  }, [editCollaborators]);

  const editCollaboratorsTotalBasisPoints = useMemo(
    () =>
      editCollaborators.reduce((sum, c) => {
        const parsed = Number.parseInt(c.basisPoints, 10);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [editCollaborators]
  );

  const isEditCollaboratorsValid = useMemo(
    () =>
      editCollaboratorsTotalBasisPoints === 10_000 &&
      Object.keys(editCollaboratorsValidationErrors).length === 0 &&
      editCollaborators.length >= 2,
    [editCollaboratorsTotalBasisPoints, editCollaboratorsValidationErrors, editCollaborators.length]
  );

  // Step validation
  const isStep1Valid = useMemo(
    () =>
      projectId.trim() &&
      title.trim() &&
      token.trim() &&
      projectType.trim() &&
      (StrKey.isValidEd25519PublicKey(token) || StrKey.isValidContract(token)),
    [projectId, title, token, projectType]
  );

  const isStep2Valid = useMemo(
    () => totalBasisPoints === 10_000 && Object.keys(validationErrors).length === 0 && collaborators.length >= 2,
    [totalBasisPoints, validationErrors, collaborators.length]
  );

  const normalizedAllowlistToken = allowlistTokenInput.trim();
  const isValidAllowlistToken = useMemo(
    () =>
      normalizedAllowlistToken.length > 0 &&
      (StrKey.isValidEd25519PublicKey(normalizedAllowlistToken) ||
        StrKey.isValidContract(normalizedAllowlistToken)),
    [normalizedAllowlistToken]
  );

  const isContractAdmin = tokenAllowlist?.admin
    ? isOwner(tokenAllowlist.admin, wallet.address)
    : false;

  // Note: wallet state and synchronization is now handled by the root WalletProvider and useWallet hook.

  useEffect(() => {
    let cancelled = false;

    void getTokenAllowlist()
      .then((state) => {
        if (!cancelled) {
          setTokenAllowlist(state);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch token allowlist:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingAllowlist(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function onConnectWallet() {
    try {
      await connect();
      notify.success("Wallet connected.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wallet connection failed.";
      notify.error(message);
    }
  }

  async function onReconnectWallet() {
    try {
      await refresh();
      notify.info(wallet.connected ? "Wallet reconnected." : "Wallet not authorized.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wallet refresh failed.";
      notify.error(message);
    }
  }

  function onDisconnectWallet() {
    // Note: useWallet doesn't have a disconnect method yet as Freighter doesn't support it well,
    // but we can refresh to get current state or just notify.
    notify.info("Freighter does not support programmatic disconnect. Use the extension to revoke access.");
  }

  async function onUpdateMetadata() {
    if (!fetchedProject || !wallet.address) return;
    if (!editTitle.trim()) {
      notify.error("Title is required.");
      return;
    }

    setIsUpdatingMetadata(true);
    try {
      const buildResponse = await buildUpdateMetadataXdr(
        fetchedProject.projectId,
        wallet.address,
        editTitle.trim(),
        editProjectType.trim()
      );

      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase
      );

      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(
        signedTxXdr,
        buildResponse.metadata.networkPassphrase
      );
      const submitResponse = await server.sendTransaction(transaction);

      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      }

      notify.success("Project metadata updated successfully.");
      setIsEditingMetadata(false);
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update metadata.";
      notify.error(message);
    } finally {
      setIsUpdatingMetadata(false);
    }
  }

  function _onWizardNext() {
    if (createStep === 1 && isStep1Valid) {
      setCreateStep(2);
    } else if (createStep === 2 && isStep2Valid) {
      setCreateStep(3);
    } else if (createStep === 3) {
      setCreateStep(4);
    }
  }

  function _onWizardBack() {
    if (createStep > 1) {
      setCreateStep(createStep - 1);
    }
  }

  function _onWizardReset() {
    setCreateStep(1);
    setProjectId("");
    setTitle("");
    setProjectType("music");
    setToken("");
    setCollaborators(getInitialCollaborators());
    setTxHash(null);
    setReceipt(null);
    setCreatedProject(null);
  }

  function TransactionReceiptView({ receipt, network }: { receipt: TransactionReceipt; network: string | null }) {
    const explorerUrl = getExplorerUrl(receipt.hash, network);
    const explorerLabel = getExplorerLabel(network);

    const actionConfig = {
      create: {
        title: "Project Created Successfully",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        ),
        summary: `Project "${receipt.title}" initialized.`,
      },
      deposit: {
        title: "Deposit Successful",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        ),
        summary: `Deposited ${receipt.amount} tokens to ${receipt.projectId}.`,
      },
      distribute: {
        title: "Distribution Successful",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        ),
        summary: `Round #${receipt.round} completed for ${receipt.projectId}.`,
      },
      lock: {
        title: "Project Locked Permanently",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        ),
        summary: `Configuration for ${receipt.projectId} is now immutable.`,
      },
    }[receipt.action];

    return (
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
              {actionConfig.icon}
            </svg>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-greenBright uppercase tracking-widest">
              {actionConfig.title}
            </h3>
            <p className="text-[11px] text-muted-foreground font-medium italic opacity-90">
              {actionConfig.summary}
            </p>
            <div className="pt-2 space-y-1">
              <p className="font-mono text-[9px] text-muted break-all opacity-60">
                Tx: {receipt.hash}
              </p>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white transition-colors"
              >
                Verify on {explorerLabel}
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
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

  function updateEditCollaborator(id: string, patch: Partial<CollaboratorInput>) {
    setEditCollaborators((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function addEditCollaborator() {
    setEditCollaborators((prev) => [
      ...prev,
      { id: `edit-collab-${Date.now()}-${prev.length}`, address: "", alias: "", basisPoints: "0" },
    ]);
  }

  function removeEditCollaborator(id: string) {
    setEditCollaborators((prev) =>
      prev.length <= 2 ? prev : prev.filter((c) => c.id !== id)
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet.connected || !wallet.address) {
      notify.error("Connect Freighter wallet first.");
      return;
    }
    if (!isValid) {
      notify.error("Please fix the validation errors.");
      return;
    }
    const collaboratorPayload = collaborators.map((collaborator) => ({
      address: collaborator.address.trim(),
      alias: collaborator.alias.trim(),
      basisPoints: Number.parseInt(collaborator.basisPoints, 10),
    }));
    setIsSubmitting(true);
    setTxHash(null);
    setReceipt(null);
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
      if (submitResponse.hash) {
        setReceipt({
          hash: submitResponse.hash,
          action: "create",
          projectId: projectId.trim(),
          title: title.trim(),
        });
      }
      notify.success("Split project created successfully.");

      // Fetch and store the created project details
      try {
        const projectDetails = await getSplit(projectId.trim());
        setCreatedProject(projectDetails);
        // Advance to success step
        setCreateStep(4);
      } catch (error) {
        console.error("Failed to fetch created project details:", error);
        setCreateStep(4);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create split project.";
      notify.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fetchHistory(id: string, cursor?: string) {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const data = await getProjectHistory(id, cursor);
      if (cursor) {
        setHistory((prev) => [...prev, ...data.items]);
      } else {
        setHistory(data.items);
      }
      setHistoryCursor(data.nextCursor);
      setIsHistoryStale(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch history.";
      setHistoryError(message);
      setIsHistoryStale(history.length > 0);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  const onFetchProject = async () => {
    if (!searchProjectId.trim()) return;
    setIsFetchingProject(true);
    setProjectFetchError(null);
    try {
      const project = await getSplit(searchProjectId.trim());
      setFetchedProject(project);
      setIsEditingCollaborators(false);
      setIsProjectStale(false);
      await fetchHistory(searchProjectId.trim());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch project.";
      setProjectFetchError(message);
      setIsProjectStale(Boolean(fetchedProject));
      if (!fetchedProject) {
        setFetchedProject(null);
      }
    } finally {
      setIsFetchingProject(false);
    }
  };

  const onDistribute = async () => {
    if (!fetchedProject || !wallet.address) return;
    setIsSubmitting(true);
    setTxHash(null);
    setReceipt(null);
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
      if (submitResponse.hash) {
        setReceipt({
          hash: submitResponse.hash,
          action: "distribute",
          projectId: fetchedProject.projectId,
          round: fetchedProject.distributionRound + 1,
        });
      }
      notify.success("Distribution initiated successfully.");
      await onFetchProject();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Distribution failed.";
      notify.error(message);
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
    setReceipt(null);
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
      if (submitResponse.hash) {
        setReceipt({
          hash: submitResponse.hash,
          action: "lock",
          projectId: fetchedProject.projectId,
        });
      }
      setFetchedProject((prev) => (prev ? { ...prev, locked: true } : prev));
      setShowLockModal(false);
      notify.success("Project locked permanently.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to lock project.";
      notify.error(message);
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
      notify.error("Please enter a valid deposit amount.");
      return;
    }

    setIsDepositing(true);
    setTxHash(null);
    setReceipt(null);
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
      if (submitResponse.hash) {
        setReceipt({
          hash: submitResponse.hash,
          action: "deposit",
          projectId: fetchedProject.projectId,
          amount: depositAmount,
        });
      }
      setShowDepositModal(false);
      setDepositAmount("");
      notify.success("Deposit successful!");
      // Refresh project details to show updated balance
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed.";
      notify.error(message);
    } finally {
      setIsDepositing(false);
    }
  };

  // Phase 3: Fetch projects list from seeded IDs
  const onFetchProjectsList = useCallback(async () => {
    setIsLoadingProjectsList(true);
    setProjectsListError(null);
    try {
      const projects: SplitProject[] = [];
      let failedFetches = 0;
      for (const projectId of SEEDED_PROJECT_IDS) {
        try {
          const project = await getSplit(projectId);
          projects.push(project);
        } catch (error) {
          failedFetches += 1;
          console.error(`Failed to fetch project ${projectId}:`, error);
        }
      }
      setIsProjectsListStale(false);
      setProjectsList(projects);
      if (failedFetches > 0) {
        const message = `${failedFetches} project request${failedFetches > 1 ? "s" : ""} failed during refresh.`;
        setProjectsListError(message);
        setIsProjectsListStale(projects.length > 0);
      }
      if (projects.length === 0) {
        notify.info("No projects found.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch projects list.";
      setProjectsListError(message);
      setIsProjectsListStale(projectsList.length > 0);
    } finally {
      setIsLoadingProjectsList(false);
    }
  }, [projectsList.length]);

  const onFetchDashboardData = async () => {
    setIsLoadingDashboard(true);
    try {
      const projects = await getAllSplits();
      setDashboardData(projects);

      if (wallet.connected && wallet.address) {
        const earnings: Record<string, string> = {};
        // Fetch user earnings for each project non-blocking
        await Promise.all(
          projects
            .filter(p => p.collaborators.some(c => c.address === wallet.address) || p.owner === wallet.address)
            .map(async (p) => {
              try {
                const info = await getClaimable(p.projectId, wallet.address!);
                earnings[p.projectId] = String(info.claimed);
              } catch (e) {
                console.error(`Failed to fetch earnings for ${p.projectId}`, e);
              }
            })
        );
        setUserEarnings(earnings);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load dashboard.";
      notify.error(message);
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  const refreshTokenAllowlist = async () => {
    setIsLoadingAllowlist(true);
    try {
      const state = await getTokenAllowlist();
      setTokenAllowlist(state);
      return state;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to refresh token allowlist.";
      notify.error(message);
      return null;
    } finally {
      setIsLoadingAllowlist(false);
    }
  };

  const onSubmitAllowlistAction = async (action: "allow" | "disallow") => {
    if (!wallet.address || !isContractAdmin) {
      notify.error("Only the configured contract admin can manage the allowlist.");
      return;
    }

    if (!isValidAllowlistToken) {
      notify.error("Enter a valid Stellar account or contract address.");
      return;
    }

    setIsUpdatingAllowlist(true);
    setLastAllowlistTx(null);
    try {
      const buildResponse =
        action === "allow"
          ? await buildAllowTokenXdr(wallet.address, normalizedAllowlistToken)
          : await buildDisallowTokenXdr(wallet.address, normalizedAllowlistToken);
      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase
      );
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(
        signedTxXdr,
        buildResponse.metadata.networkPassphrase
      );
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(
          submitResponse.errorResult?.toString() ??
            "Token allowlist transaction failed."
        );
      }

      setLastAllowlistTx({
        action,
        token: normalizedAllowlistToken,
        txHash: submitResponse.hash ?? null
      });
      setAllowlistTokenInput("");
      notify.success(
        action === "allow"
          ? "Token added to the allowlist."
          : "Token removed from the allowlist."
      );
      await refreshTokenAllowlist();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update token allowlist.";
      notify.error(message);
    } finally {
      setIsUpdatingAllowlist(false);
    }
  };

  // Load projects list when switching to Projects tab
  useEffect(() => {
    if (activeTab === "projects" && projectsList.length === 0 && !isLoadingProjectsList) {
      void onFetchProjectsList();
    } else if (activeTab === "dashboard" && dashboardData.length === 0 && !isLoadingDashboard) {
      void onFetchDashboardData();
    }
  }, [
    activeTab,
    dashboardData.length,
    isLoadingDashboard,
    isLoadingProjectsList,
    onFetchDashboardData,
    onFetchProjectsList,
    projectsList.length
  ]);

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
            onClick={() => setActiveTab("dashboard")}
            className={clsx(
              "rounded-full px-8 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
              activeTab === "dashboard"
                ? "bg-white/10 text-ink shadow-sm"
                : "text-muted hover:text-ink/80",
            )}
          >
            Dashboard
          </button>
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

        {activeTab === "dashboard" ? (
          <div className="space-y-10 animate-in fade-in duration-700">
            {/* Summary Cards */}
            <div className="grid gap-6 md:grid-cols-3">
              <div className="glass-card rounded-3xl p-8 border-l-4 border-greenBright">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">Total Managed</p>
                <p className="text-3xl font-display">{dashboardData.length} <span className="text-sm font-sans text-muted">Projects</span></p>
              </div>
              <div className="glass-card rounded-3xl p-8 border-l-4 border-goldLight">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">Platform Treasury</p>
                <p className="text-3xl font-display text-greenBright">
                  {dashboardData.reduce((sum, p) => sum + Number(p.balance), 0).toLocaleString()}
                  <span className="text-sm font-sans text-muted ml-2">Stroops</span>
                </p>
              </div>
              <div className="glass-card rounded-3xl p-8 border-l-4 border-white/20">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">Lifetime Payouts</p>
                <p className="text-3xl font-display">
                  {dashboardData.reduce((sum, p) => sum + Number(p.totalDistributed), 0).toLocaleString()}
                </p>
              </div>
            </div>

            {wallet.connected && isContractAdmin && tokenAllowlist && (
              <div className="glass-card rounded-[2.5rem] p-8 md:p-10 border border-greenBright/10">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-greenBright/80">
                      Admin Control Plane
                    </p>
                    <h2 className="font-display text-2xl tracking-tight">
                      Admin Token Allowlist
                    </h2>
                    <p className="max-w-2xl text-sm text-muted">
                      Inspect the live allowlist and submit contract-backed allow or disallow actions from the connected admin wallet.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshTokenAllowlist();
                    }}
                    disabled={isLoadingAllowlist || isUpdatingAllowlist}
                    className="premium-button rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
                  >
                    {isLoadingAllowlist ? "Refreshing..." : "Refresh State"}
                  </button>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <div className="rounded-3xl border border-white/5 bg-white/2 p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                      Contract Admin
                    </p>
                    <p className="mt-3 break-all font-mono text-xs text-ink">
                      {tokenAllowlist.admin}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-white/5 bg-white/2 p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                      Allowlist Mode
                    </p>
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                      Listed Tokens
                    </p>
                    <p className="mt-3 text-2xl font-display">
                      {tokenAllowlist.allowedTokenCount}
                    </p>
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
                            : ""
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
                      onClick={() => {
                        void onSubmitAllowlistAction("allow");
                      }}
                      disabled={isUpdatingAllowlist || !isValidAllowlistToken}
                      className="premium-button self-end rounded-2xl bg-greenBright px-6 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#0a0a09] disabled:opacity-30"
                    >
                      {isUpdatingAllowlist ? "Submitting..." : "Allow Token"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onSubmitAllowlistAction("disallow");
                      }}
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
                        <div
                          key={allowedToken}
                          className="rounded-2xl border border-white/5 bg-white/2 px-5 py-4"
                        >
                          <p className="text-[10px] font-bold uppercase tracking-widest text-greenBright/70">
                            Allowed Token
                          </p>
                          <p className="mt-2 break-all font-mono text-xs text-ink">
                            {allowedToken}
                          </p>
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
                    .filter(p => p.collaborators.some(c => c.address === wallet.address))
                    .map(p => (
                      <div key={p.projectId} className="bg-white/5 rounded-2xl p-5 border border-white/5 flex justify-between items-center">
                        <div className="space-y-1">
                          <p className="font-bold text-xs truncate max-w-[120px]">{p.title}</p>
                          <p className="text-[9px] text-muted uppercase tracking-widest">
                            {(p.collaborators.find(c => c.address === wallet.address)?.basisPoints ?? 0) / 100}% Share
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
                          <p className="font-bold text-sm">{p.title}</p>
                          <p className="text-[9px] font-mono text-muted">{p.projectId}</p>
                        </td>
                        <td className="py-4">
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase">{p.projectType}</span>
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
        ) : activeTab === "create" ? (
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
              <TokenSelector
                value={token}
                onChange={setToken}
                network={wallet.network}
                required
              />
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

            {receipt && receipt.action === "create" && (
              <TransactionReceiptView receipt={receipt} network={wallet.network} />
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
                              setEditCollaborators(fetchedProject.collaborators.map((c, i) => ({
                                id: `edit-collab-${i}`,
                                address: c.address,
                                alias: c.alias,
                                basisPoints: String(c.basisPoints)
                              })));
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
                          className="premium-button rounded-2xl border border-red-400/30 bg-red-500/10 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/20"
                        >
                          Lock Project
                        </button>
                      )}
                    </div>
                  )}
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
                      {isEditingCollaborators ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between pb-2 border-b border-white/5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Editor Mode</p>
                            <button
                              type="button"
                              onClick={addEditCollaborator}
                              className="text-[10px] font-bold uppercase tracking-widest text-greenBright hover:text-white transition-colors"
                            >
                              + Add Recipient
                            </button>
                          </div>

                          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {editCollaborators.map((c, index) => (
                              <div key={c.id} className="bg-white/2 rounded-2xl p-4 border border-white/5 space-y-4 group">
                                <div className="flex justify-between items-start">
                                  <span className="text-[9px] font-bold text-muted uppercase">Recipient #{index + 1}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeEditCollaborator(c.id)}
                                    className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-300"
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                  </button>
                                </div>
                                <div className="space-y-3">
                                  <input
                                    value={c.address}
                                    onChange={(e) => updateEditCollaborator(c.id, { address: e.target.value })}
                                    placeholder="Wallet Address"
                                    className={clsx(
                                      "glass-input w-full rounded-xl px-4 py-2 text-xs",
                                      editCollaboratorsValidationErrors[c.id] ? "border-red-500/50 bg-red-500/5" : ""
                                    )}
                                  />
                                  {editCollaboratorsValidationErrors[c.id] && (
                                    <p className="text-[9px] font-bold text-red-400 uppercase tracking-tighter pl-1">{editCollaboratorsValidationErrors[c.id]}</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-3">
                                    <input
                                      value={c.alias}
                                      onChange={(e) => updateEditCollaborator(c.id, { alias: e.target.value })}
                                      placeholder="Alias"
                                      className="glass-input w-full rounded-xl px-4 py-2 text-xs"
                                    />
                                    <div className="relative">
                                      <input
                                        type="number"
                                        value={c.basisPoints}
                                        onChange={(e) => updateEditCollaborator(c.id, { basisPoints: e.target.value })}
                                        placeholder="BP"
                                        className="glass-input w-full rounded-xl px-4 py-2 text-xs pr-8"
                                      />
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-muted opacity-40">BP</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="pt-4 border-t border-white/5 space-y-4">
                            <div className="flex justify-between items-center bg-white/2 rounded-xl p-3 border border-white/5">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Total BP</span>
                              <span className={clsx(
                                "font-mono font-bold text-xs",
                                editCollaboratorsTotalBasisPoints === 10_000 ? "text-greenBright" : "text-red-400"
                              )}>
                                {editCollaboratorsTotalBasisPoints.toLocaleString()} / 10,000
                              </span>
                            </div>

                            <div className="flex gap-3">
                              <button
                                onClick={onUpdateCollaborators}
                                disabled={isUpdatingCollaborators || !isEditCollaboratorsValid}
                                className="flex-1 premium-button rounded-xl bg-greenMid py-3 text-[10px] font-bold uppercase tracking-widest text-white shadow-lg shadow-greenMid/20 disabled:opacity-20"
                              >
                                {isUpdatingCollaborators ? "Saving..." : "Save Changes"}
                              </button>
                              <button
                                onClick={() => setIsEditingCollaborators(false)}
                                className="flex-1 premium-button rounded-xl border border-white/10 bg-white/5 py-3 text-[10px] font-bold uppercase tracking-widest text-ink transition hover:bg-white/10"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        fetchedProject.collaborators.map((collab, idx) => (
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
                        ))
                      )}
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

                    {receipt && (receipt.action === "distribute" || receipt.action === "lock" || receipt.action === "deposit") && (
                      <TransactionReceiptView receipt={receipt} network={wallet.network} />
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
                      {isLoadingProjectsList
                        ? "Loading projects..."
                        : projectsListError
                          ? "Could not load projects. Retry refresh."
                          : "No projects loaded yet. Click Refresh Projects to load."}
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
                        disabled={Number(fetchedProject.balance) <= 0 || !wallet.connected}
                        className="premium-button w-full rounded-2xl bg-greenBright py-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-greenBright/10 disabled:opacity-10 disabled:bg-white"
                      >
                        Trigger Distribution
                      </button>
                      {!wallet.connected && <p className="text-center text-[10px] font-bold text-red-500 uppercase tracking-widest">Connect wallet to distribute</p>}
                      {Number(fetchedProject.balance) <= 0 && <p className="text-center text-[10px] font-bold text-muted uppercase tracking-widest">No funds available to distribute</p>}

                      {receipt && (receipt.action === "distribute" || receipt.action === "lock" || receipt.action === "deposit") && (
                        <TransactionReceiptView receipt={receipt} network={wallet.network} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

        {/* Metadata Edit Modal */}
        {isEditingMetadata && (
          <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
            <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 animate-in zoom-in-95 duration-200">
              <h2 className="font-display text-2xl mb-8">Edit Project Metadata</h2>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Project Title</label>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Category</label>
                  <input
                    value={editProjectType}
                    onChange={(e) => setEditProjectType(e.target.value)}
                    className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setIsEditingMetadata(false)}
                    className="flex-1 rounded-2xl border border-white/10 px-6 py-4 text-xs font-bold uppercase tracking-widest hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onUpdateMetadata}
                    disabled={isUpdatingMetadata || !editTitle.trim()}
                    className="flex-1 premium-button rounded-2xl bg-white px-6 py-4 text-xs font-bold uppercase tracking-widest text-[#0a0a09] disabled:opacity-50"
                  >
                    {isUpdatingMetadata ? "Updating..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
