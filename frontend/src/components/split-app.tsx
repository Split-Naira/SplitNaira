/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, no-empty */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { rpc, Transaction, StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";
import { Controller, useFieldArray, useForm, type SubmitHandler } from "react-hook-form";

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
  listProjects,
  type ProjectHistoryItem,
  getTokenAllowlist,
  type TokenAllowlistState,
  getUnallocatedBalance,
  buildWithdrawUnallocatedXdr,
  type UnallocatedBalanceState,
  getAdminStatus,
  buildPauseDistributionsXdr,
  buildUnpauseDistributionsXdr,
  type AdminStatusState,
} from "@/lib/api";
import { isOwner } from "@/lib/address";
import {
  createSorobanRpcServer,
  signWithWallet,
  submitSorobanTransactionAndPoll,
} from "@/lib/wallet";
import {
  type SplitProject,
  getExplorerUrl,
  getExplorerLabel,
} from "@/lib/stellar";
import { useWallet } from "@/hooks/useWallet";
import { notify } from "@/lib/notification";
import { SummaryCardSkeleton } from "./Skeleton";
import { TokenSelector } from "./TypeSelector";
import {
  TransactionReceiptView,
  type TransactionReceipt,
} from "./TransactionReceiptView";
import { Input } from "./Input";
import { CreateSplitSchema } from "@/lib/schemas";

import { DashboardView } from "./dashboard/DashboardView";
import { CreateSplitWizard } from "./create/CreateSplitWizard";
import { ManageSplitView } from "./manage/ManageSplitView";
import { ProjectsList } from "./projects/ProjectsList";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

interface CreateCollaboratorInput {
  address: string;
  alias: string;
  basisPoints: string;
}

interface CreateSplitFormValues {
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: CreateCollaboratorInput[];
}

interface AllowlistActionResult {
  action: "allow" | "disallow";
  token: string;
  txHash: string | null;
}

// Use static IDs instead of random UUIDs to avoid hydration mismatches
const getInitialCreateCollaborators = (): CreateCollaboratorInput[] => [
  { address: "", alias: "", basisPoints: "5000" },
  { address: "", alias: "", basisPoints: "5000" },
];


const getInitialCreateFormValues = (): CreateSplitFormValues => ({
  projectId: "",
  title: "",
  projectType: "music",
  token: "",
  collaborators: getInitialCreateCollaborators(),
});

// Seeded project IDs for Phase 3 Projects list view
const SEEDED_PROJECT_IDS = [
  "afrobeats_001",
  "diaspora_sounds_02",
  "naija_vibes_03",
  "west_african_beats_04",
  "cultural_resonance_05",
];

export function SplitApp() {
  const { wallet, connect, refresh } = useWallet();

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors: createFormErrors, isValid: isCreateFormValid },
  } = useForm<CreateSplitFormValues>({
    defaultValues: getInitialCreateFormValues(),
    mode: "onChange",
  });
  const {
    fields: collaboratorFields,
    append: appendCollaborator,
    remove: removeCollaborator,
  } = useFieldArray({
    control,
    name: "collaborators",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [createdProject, setCreatedProject] = useState<SplitProject | null>(null);
  const latestTxHash = txHash ?? receipt?.hash ?? null;

  const [activeTab, setActiveTab] = useState<"dashboard" | "create" | "manage" | "projects">("dashboard");
  const [createStep, setCreateStep] = useState(1);
  const [searchProjectId, setSearchProjectId] = useState("");
  const [fetchedProject, setFetchedProject] = useState<SplitProject | null>(null);
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

  const [projectsList, setProjectsList] = useState<SplitProject[]>([]);
  // Tracks whether the Projects tab has performed its initial load. A ref (not
  // state) so re-visiting the tab does not re-trigger the auto-load effect,
  // while still distinguishing first load from a re-visit.
  const projectsLoadedRef = useRef(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoadingProjectsList, setIsLoadingProjectsList] = useState(false);
  const [projectsStart, setProjectsStart] = useState(0);
  const [hasMoreProjects, setHasMoreProjects] = useState(true);
  const PROJECTS_LIMIT = 10;
  const [projectsListError, setProjectsListError] = useState<string | null>(null);
  const [isProjectsListStale, setIsProjectsListStale] = useState(false);
  const [projectFetchError, setProjectFetchError] = useState<string | null>(null);
  const [isProjectStale, setIsProjectStale] = useState(false);

  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editProjectType, setEditProjectType] = useState("music");
  const [isUpdatingMetadata, setIsUpdatingMetadata] = useState(false);

  const [isEditingCollaborators, setIsEditingCollaborators] = useState(false);
  const [editCollaborators, setEditCollaborators] = useState<CollaboratorInput[]>([]);
  const [isUpdatingCollaborators, setIsUpdatingCollaborators] = useState(false);

  const [dashboardData, setDashboardData] = useState<SplitProject[]>([]);
  const [userEarnings, setUserEarnings] = useState<Record<string, string>>({});
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [dashboardListLoaded, setDashboardListLoaded] = useState(false);
  const [tokenAllowlist, setTokenAllowlist] = useState<TokenAllowlistState | null>(null);
  const [allowlistTokenInput, setAllowlistTokenInput] = useState("");
  const [isLoadingAllowlist, setIsLoadingAllowlist] = useState(true);
  const [isUpdatingAllowlist, setIsUpdatingAllowlist] = useState(false);
  const [lastAllowlistTx, setLastAllowlistTx] = useState<AllowlistActionResult | null>(null);

  const [recoveryTokenInput, setRecoveryTokenInput] = useState("");
  const [recoveryToInput, setRecoveryToInput] = useState("");
  const [recoveryAmountInput, setRecoveryAmountInput] = useState("");
  const [unallocatedBalance, setUnallocatedBalance] = useState<UnallocatedBalanceState | null>(null);
  const [isLoadingUnallocated, setIsLoadingUnallocated] = useState(false);
  const [unallocatedError, setUnallocatedError] = useState<string | null>(null);
  const [showRecoveryConfirm, setShowRecoveryConfirm] = useState(false);
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false);
  const [lastRecoveryTxHash, setLastRecoveryTxHash] = useState<string | null>(null);

  // Issue #165: Distribution pause/unpause control plane state
  const [adminStatus, setAdminStatus] = useState<AdminStatusState | null>(null);
  const [isLoadingAdminStatus, setIsLoadingAdminStatus] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showUnpauseConfirm, setShowUnpauseConfirm] = useState(false);
  const [isSubmittingPause, setIsSubmittingPause] = useState(false);
  const [lastPauseTxHash, setLastPauseTxHash] = useState<string | null>(null);

  const watchedCollaborators = watch("collaborators");
  const createProjectId = watch("projectId");
  const createTitle = watch("title");
  const createProjectType = watch("projectType");
  const createToken = watch("token");

  const totalBasisPoints = useMemo(
    () =>
      watchedCollaborators.reduce((sum, collaborator) => {
        const parsed = Number.parseInt(collaborator.basisPoints, 10);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [watchedCollaborators],
  );

  const collaboratorValidationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const addresses = new Map<string, string>();
    const duplicates = new Set<string>();

    collaboratorFields.forEach((field, index) => {
      const collaborator = watchedCollaborators[index];
      if (!collaborator) return;

      const addr = collaborator.address.trim();
      if (addr) {
        if (!StrKey.isValidEd25519PublicKey(addr) && !StrKey.isValidContract(addr)) {
          errors[field.id] = "Invalid Stellar address (G...) or contract ID (C...)";
        } else if (addresses.has(addr)) {
          duplicates.add(addr);
        } else {
          addresses.set(addr, field.id);
        }
      }
    });

    if (duplicates.size > 0) {
      collaboratorFields.forEach((field, index) => {
        const addr = watchedCollaborators[index]?.address.trim();
        if (addr && duplicates.has(addr)) {
          errors[field.id] = "Duplicate address";
        }
      });
    }

    return errors;
  }, [collaboratorFields, watchedCollaborators]);

  const isValid = useMemo(
    () =>
      isCreateFormValid &&
      totalBasisPoints === 10_000 &&
      Object.keys(collaboratorValidationErrors).length === 0 &&
      collaboratorFields.length >= 2,
    [collaboratorValidationErrors, collaboratorFields.length, isCreateFormValid, totalBasisPoints],
  );

  // Step validation
  const isStep1Valid = useMemo(
    () =>
      Boolean(createProjectId.trim()) &&
      Boolean(createTitle.trim()) &&
      Boolean(createProjectType.trim()) &&
      Boolean(createToken.trim()) &&
      (StrKey.isValidEd25519PublicKey(createToken) || StrKey.isValidContract(createToken)),
    [createProjectId, createProjectType, createTitle, createToken],
  );

  const isStep2Valid = useMemo(
    () =>
      totalBasisPoints === 10_000 &&
      Object.keys(collaboratorValidationErrors).length === 0 &&
      collaboratorFields.length >= 2,
    [collaboratorFields.length, collaboratorValidationErrors, totalBasisPoints],
  );

  const normalizedAllowlistToken = allowlistTokenInput.trim();
  const isValidAllowlistToken = useMemo(
    () =>
      normalizedAllowlistToken.length > 0 &&
      (StrKey.isValidEd25519PublicKey(normalizedAllowlistToken) ||
        StrKey.isValidContract(normalizedAllowlistToken)),
    [normalizedAllowlistToken],
  );

  const isContractAdmin = tokenAllowlist?.admin
    ? isOwner(tokenAllowlist.admin, wallet.address)
    : false;

  const sorobanSplitFlowBusy = isSubmitting || isLocking || isDepositing;

  useEffect(() => {
    let cancelled = false;
    getTokenAllowlist()
      .then((state) => {
        if (!cancelled) setTokenAllowlist(state);
      })
      .catch((error) => {
        console.error("Failed to fetch token allowlist:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAllowlist(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAdminStatus()
      .then((status) => {
        if (!cancelled) setAdminStatus(status);
      })
      .catch((error) => {
        console.error("Failed to fetch admin status:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAdminStatus(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function onConnectWallet() {
    try {
      await connect();
      notify.success("Wallet connected.");
    } catch (error) {
      notify.error("Wallet connection failed.");
    }
  }

  async function onReconnectWallet() {
    try {
      await refresh();
      notify.info(wallet.connected ? "Wallet reconnected." : "Wallet not authorized.");
    } catch (error) {
      notify.error("Wallet refresh failed.");
    }
  }

  function onDisconnectWallet() {
    notify.info(
      "Disconnect from your wallet via the extension or app to revoke access.",
    );
  }

  async function onInspectUnallocated() {
    if (!recoveryTokenInput.trim()) {
      notify.error("Token address is required.");
      return;
    }
    setIsLoadingUnallocated(true);
    setUnallocatedError(null);
    setUnallocatedBalance(null);
    setShowRecoveryConfirm(false);
    setLastRecoveryTxHash(null);
    try {
      const data = await getUnallocatedBalance(recoveryTokenInput.trim());
      setUnallocatedBalance(data);
    } catch (error) {
      setUnallocatedError(
        error instanceof Error ? error.message : "Failed to fetch unallocated balance.",
      );
    } finally {
      setIsLoadingUnallocated(false);
    }
  }

  async function onConfirmRecovery() {
    if (!wallet.address || !unallocatedBalance) return;
    const amount = Number(recoveryAmountInput.trim());
    if (!recoveryToInput.trim() || !Number.isFinite(amount) || amount <= 0) {
      notify.error("Destination address and a valid positive amount are required.");
      return;
    }
    setIsSubmittingRecovery(true);
    try {
      const buildResponse = await buildWithdrawUnallocatedXdr({
        admin: wallet.address,
        token: unallocatedBalance.token,
        to: recoveryToInput.trim(),
        amount,
      });
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR")
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      setLastRecoveryTxHash(submitResponse.hash ?? null);
      setShowRecoveryConfirm(false);
      notify.success("Recovery transaction submitted successfully.");
      await onInspectUnallocated();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Recovery transaction failed.");
    } finally {
      setIsSubmittingRecovery(false);
    }
  }

  function patchProjectInAllViews(projectId: string, patch: Partial<SplitProject>) {
    setFetchedProject((prev) => (prev?.projectId === projectId ? { ...prev, ...patch } : prev));
    setProjectsList((prev) =>
      prev.map((p) => (p.projectId === projectId ? { ...p, ...patch } : p)),
    );
    setDashboardData((prev) =>
      prev.map((p) => (p.projectId === projectId ? { ...p, ...patch } : p)),
    );
  }

  async function onUpdateMetadata() {
    if (!fetchedProject || !wallet.address) return;
    if (!editTitle.trim()) {
      notify.error("Title is required.");
      return;
    }
    const projectId = fetchedProject.projectId;
    const previousSnapshot = {
      title: fetchedProject.title,
      projectType: fetchedProject.projectType,
    };
    const nextTitle = editTitle.trim();
    const nextProjectType = editProjectType.trim();
    setIsUpdatingMetadata(true);
    patchProjectInAllViews(projectId, {
      title: nextTitle,
      projectType: nextProjectType,
    });
    setIsEditingMetadata(false);
    try {
      const buildResponse = await buildUpdateMetadataXdr(
        projectId,
        wallet.address,
        nextTitle,
        nextProjectType,
      );
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR")
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      notify.success("Project metadata updated successfully.");
      void onFetchProject();
    } catch (error) {
      patchProjectInAllViews(projectId, previousSnapshot);
      setIsEditingMetadata(true);
      notify.error(error instanceof Error ? error.message : "Failed to update metadata.");
    } finally {
      setIsUpdatingMetadata(false);
    }
  }

  async function onUpdateCollaborators() {
    if (!fetchedProject || !wallet.address) return;
    const result = CreateSplitSchema.shape.collaborators.safeParse(editCollaborators);
    if (!result.success) {
      notify.error("Please fix collaborator validation errors.");
      return;
    }
    setIsUpdatingCollaborators(true);
    try {
      const buildResponse = await buildUpdateCollaboratorsXdr(
        fetchedProject.projectId,
        wallet.address,
        editCollaborators.map((c) => ({
          address: c.address.trim(),
          alias: c.alias.trim(),
          basisPoints: Number.parseInt(c.basisPoints, 10),
        })),
      );
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR")
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      notify.success("Collaborators updated successfully.");
      setIsEditingCollaborators(false);
      await onFetchProject();
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : "Failed to update collaborators.",
      );
    } finally {
      setIsUpdatingCollaborators(false);
    }
  }

  function _onWizardReset() {
    setCreateStep(1);
    reset(getInitialCreateFormValues());
    setTxHash(null);
    setReceipt(null);
    setCreatedProject(null);
  }

  function updateEditCollaborator(id: string, patch: Partial<CollaboratorInput>) {
    setEditCollaborators((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function addEditCollaborator() {
    setEditCollaborators((prev) => [
      ...prev,
      {
        id: `edit-collab-${Date.now()}-${prev.length}`,
        address: "",
        alias: "",
        basisPoints: "0",
      },
    ]);
  }

  function removeEditCollaborator(id: string) {
    setEditCollaborators((prev) =>
      prev.length <= 2 ? prev : prev.filter((c) => c.id !== id),
    );
  }

  const onSubmit: SubmitHandler<CreateSplitFormValues> = async (data) => {
    if (!wallet.connected || !wallet.address) {
      notify.error("Connect your wallet first.");
      return;
    }
    const collaboratorPayload = data.collaborators.map((collaborator) => ({
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
        projectId: data.projectId.trim(),
        title: data.title.trim(),
        projectType: data.projectType.trim(),
        token: data.token.trim(),
        collaborators: collaboratorPayload,
      });
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          setTxHash(hash);
          setReceipt({
            hash,
            lifecycle: "confirming",
            action: "create",
            projectId: data.projectId.trim(),
            title: data.title.trim(),
          });
        },
      });

      setReceipt((prev) =>
        prev?.action === "create" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      notify.success("Split project created successfully.");

      try {
        const projectDetails = await getSplit(data.projectId.trim());
        setCreatedProject(projectDetails);
        setCreateStep(4);
      } catch (error) {
        console.error("Failed to fetch created project details:", error);
        setCreateStep(4);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create split project.";
      setReceipt((prev) =>
        prev?.lifecycle === "confirming" && prev.action === "create"
          ? { ...prev, lifecycle: "failed", failureReason: message }
          : prev,
      );
      notify.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  async function fetchHistory(id: string, cursor?: string) {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const data = await getProjectHistory(id, cursor);
      if (cursor) setHistory((prev) => [...prev, ...data.items]);
      else setHistory(data.items);
      setHistoryCursor(data.nextCursor);
      setIsHistoryStale(false);
    } catch (error) {
      setHistoryError("Failed to fetch history.");
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
      setProjectFetchError("Failed to fetch project.");
      setIsProjectStale(Boolean(fetchedProject));
    } finally {
      setIsFetchingProject(false);
    }
  };

  const onDistribute = async () => {
    if (!fetchedProject || !wallet.address) return;
    setIsSubmitting(true);
    setShowDistributeModal(false);
    try {
      const { xdr, metadata } = await buildDistributeXdr(fetchedProject.projectId, wallet.address);
      const signedTxXdr = await signWithWallet(xdr, metadata.networkPassphrase);
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          setTxHash(hash);
          setReceipt({
            hash,
            lifecycle: "confirming",
            action: "distribute",
            projectId: fetchedProject.projectId,
            round: fetchedProject.distributionRound + 1,
          });
        },
      });

      setReceipt((prev) =>
        prev?.action === "distribute" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      notify.success("Distribution completed successfully.");
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Distribution failed.";
      setReceipt((prev) =>
        prev?.lifecycle === "confirming" && prev.action === "distribute"
          ? { ...prev, lifecycle: "failed", failureReason: message }
          : prev,
      );
      notify.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isProjectOwner = useMemo(() => {
    if (!fetchedProject || !wallet.address) return false;
    return isOwner(fetchedProject.owner, wallet.address);
  }, [fetchedProject, wallet.address]);

  const canLockProject = useMemo(() => {
    return Boolean(fetchedProject && !fetchedProject.locked && isProjectOwner);
  }, [fetchedProject, isProjectOwner]);

  const onLockProject = async () => {
    if (!fetchedProject || !wallet.address) return;
    setIsLocking(true);
    try {
      const { xdr, metadata } = await buildLockProjectXdr(fetchedProject.projectId, wallet.address);
      const signedTxXdr = await signWithWallet(xdr, metadata.networkPassphrase);
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          setTxHash(hash);
          setReceipt({
            hash,
            lifecycle: "confirming",
            action: "lock",
            projectId: fetchedProject.projectId,
          });
        },
      });

      setReceipt((prev) =>
        prev?.action === "lock" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      setFetchedProject((prev) => (prev ? { ...prev, locked: true } : prev));
      setShowLockModal(false);
      notify.success("Project locked permanently.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to lock project.";
      setReceipt((prev) =>
        prev?.lifecycle === "confirming" && prev.action === "lock"
          ? { ...prev, lifecycle: "failed", failureReason: message }
          : prev,
      );
      notify.error(message);
    } finally {
      setIsLocking(false);
    }
  };

  const onDeposit = async () => {
    if (!fetchedProject || !wallet.address || !depositAmount) return;
    setIsDepositing(true);
    try {
      const amountInStroops = Math.floor(Number.parseFloat(depositAmount) * 10_000_000);
      const { xdr, metadata } = await buildDepositXdr(
        fetchedProject.projectId,
        wallet.address,
        amountInStroops,
      );
      const signedTxXdr = await signWithWallet(xdr, metadata.networkPassphrase);
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          setTxHash(hash);
          setReceipt({
            hash,
            lifecycle: "confirming",
            action: "deposit",
            projectId: fetchedProject.projectId,
            amount: depositAmount,
          });
        },
      });

      setReceipt((prev) =>
        prev?.action === "deposit" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      setShowDepositModal(false);
      setDepositAmount("");
      notify.success("Deposit successful!");
      await onFetchProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed.";
      setReceipt((prev) =>
        prev?.lifecycle === "confirming" && prev.action === "deposit"
          ? { ...prev, lifecycle: "failed", failureReason: message }
          : prev,
      );
      notify.error(message);
    } finally {
      setIsDepositing(false);
    }
  };

  // Phase 3: Fetch projects list from backend with pagination
  const onFetchProjectsList = useCallback(async (loadMore = false) => {
    // Only guard against concurrent fetches. The previous
    // `if (!loadMore && projectsList.length > 0) return;` guard silently
    // swallowed forced reloads (e.g. the Refresh button, or returning to the
    // tab after creating a project elsewhere) — a non-loadMore call must
    // always be allowed to refetch fresh contract state.
    if (isLoadingProjectsList) return;

    setIsLoadingProjectsList(true);
    setProjectsListError(null);
    try {
      const start = loadMore ? projectsStart : 0;
      const projects = await listProjects({ start, limit: PROJECTS_LIMIT });
      
      if (loadMore) {
        setProjectsList(prev => [...prev, ...projects]);
      } else {
        setProjectsList(projects);
        setProjectsStart(0);
      }
      
      const newStart = start + projects.length;
      setProjectsStart(newStart);
      setHasMoreProjects(projects.length === PROJECTS_LIMIT);
      
      if (projects.length === 0 && !loadMore) {
        notify.info("No projects found.");
      }
    } catch (error) {
      setProjectsListError("Failed to fetch projects list.");
    } finally {
      setIsLoadingProjectsList(false);
      projectsLoadedRef.current = true;
    }
    // `listProjects` is a stable module-level import (not state), so it is
    // intentionally excluded from the dependency array.
  }, [isLoadingProjectsList, projectsStart]);

  const onFetchDashboardData = useCallback(async () => {
    setIsLoadingDashboard(true);
    try {
      const projects = await getAllSplits();
      setDashboardData(projects);
      if (wallet.connected && wallet.address) {
        const earnings: Record<string, string> = {};
        await Promise.all(
          projects
            .filter(
              (p) =>
                p.collaborators.some((c) => c.address === wallet.address) ||
                p.owner === wallet.address,
            )
            .map(async (p) => {
              try {
                const info = await getClaimable(p.projectId, wallet.address!);
                earnings[p.projectId] = String(info.claimed);
              } catch (e) {}
            }),
        );
        setUserEarnings(earnings);
      }
    } catch (error) {
      notify.error("Failed to load dashboard.");
    } finally {
      setIsLoadingDashboard(false);
      setDashboardListLoaded(true);
    }
  }, [wallet.connected, wallet.address]);

  const refreshTokenAllowlist = async () => {
    setIsLoadingAllowlist(true);
    try {
      const state = await getTokenAllowlist();
      setTokenAllowlist(state);
      return state;
    } catch (error) {
      notify.error("Failed to refresh allowlist.");
      return null;
    } finally {
      setIsLoadingAllowlist(false);
    }
  };

  const refreshAdminStatus = async () => {
    setIsLoadingAdminStatus(true);
    try {
      const status = await getAdminStatus();
      setAdminStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh admin status.";
      notify.error(message);
      return null;
    } finally {
      setIsLoadingAdminStatus(false);
    }
  };

  const onTogglePause = async (action: "pause" | "unpause") => {
    if (!wallet.address || !isContractAdmin) {
      notify.error("Only the contract admin can pause or unpause distributions.");
      return;
    }
    setIsSubmittingPause(true);
    setLastPauseTxHash(null);
    try {
      const buildResponse =
        action === "pause"
          ? await buildPauseDistributionsXdr(wallet.address)
          : await buildUnpauseDistributionsXdr(wallet.address);

      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true },
      );
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction failed.");
      }
      setLastPauseTxHash(submitResponse.hash ?? null);
      setShowPauseConfirm(false);
      setShowUnpauseConfirm(false);
      notify.success(action === "pause" ? "Distributions paused." : "Distributions resumed.");
      await refreshAdminStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction failed.";
      notify.error(message);
    } finally {
      setIsSubmittingPause(false);
    }
  };

  const onSubmitAllowlistAction = async (action: "allow" | "disallow") => {
    if (!wallet.address || !isContractAdmin || !isValidAllowlistToken) return;
    setIsUpdatingAllowlist(true);
    try {
      const buildResponse =
        action === "allow"
          ? await buildAllowTokenXdr(wallet.address, normalizedAllowlistToken)
          : await buildDisallowTokenXdr(wallet.address, normalizedAllowlistToken);
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);
      if (submitResponse.status === "ERROR") throw new Error("Allowlist action failed.");
      setLastAllowlistTx({
        action,
        token: normalizedAllowlistToken,
        txHash: submitResponse.hash ?? null,
      });
      setAllowlistTokenInput("");
      notify.success("Allowlist updated.");
      await refreshTokenAllowlist();
    } catch (error) {
      notify.error("Failed to update allowlist.");
    } finally {
      setIsUpdatingAllowlist(false);
    }
  };

  useEffect(() => {
    if (activeTab === "projects") {
      // Fetch fresh data on the first visit to the Projects tab. Subsequent
      // re-visits don't auto-refetch (use the Refresh button); the ref keeps
      // this decision independent of the current list length.
      if (!projectsLoadedRef.current && !isLoadingProjectsList) {
        void onFetchProjectsList(false);
      }
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
  ]);

  useEffect(() => {
    if (!showLockModal && !showDepositModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowLockModal(false);
        setShowDepositModal(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showLockModal, showDepositModal]);

  return (
    <main className="min-h-screen px-6 py-12 md:px-12 selection:bg-greenBright/10 selection:text-greenBright">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        {/* Header Section */}
        <header className="glass-card rounded-[2.5rem] p-8 md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <h1 className="font-display text-4xl tracking-tight text-ink">SplitNaira</h1>
              <p className="max-w-md text-sm leading-relaxed text-muted">
                Premium royalty management on Stellar.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {!wallet.connected ? (
                <button
                  type="button"
                  onClick={onConnectWallet}
                  className="premium-button rounded-full bg-greenMid px-8 py-3 text-sm font-bold text-white shadow-lg"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onConnectWallet}
                    className="premium-button rounded-full border bg-white/5 px-6 py-3 text-sm"
                  >
                    Switch Wallet
                  </button>
                  <button
                    type="button"
                    onClick={onReconnectWallet}
                    className="premium-button rounded-full border bg-white/5 px-6 py-3 text-sm"
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    onClick={onDisconnectWallet}
                    className="premium-button rounded-full border bg-white/5 px-6 py-3 text-sm hover:text-red-400"
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

        {/* Navigation Tabs */}
        <nav className="flex gap-1 rounded-full bg-white/5 p-1.5 self-center">
          {["dashboard", "create", "manage", "projects"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={clsx(
                "rounded-full px-8 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === tab
                  ? "bg-white/10 text-ink shadow-sm"
                  : "text-muted hover:text-ink/80",
              )}
            >
              {tab === "manage" ? "Manage & Distribute" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {/* Content Tabs */}
        {activeTab === "dashboard" ? (
          <DashboardView
            wallet={wallet}
            isContractAdmin={isContractAdmin}
            tokenAllowlist={tokenAllowlist}
            isLoadingAllowlist={isLoadingAllowlist}
            isUpdatingAllowlist={isUpdatingAllowlist}
            allowlistTokenInput={allowlistTokenInput}
            setAllowlistTokenInput={setAllowlistTokenInput}
            isValidAllowlistToken={isValidAllowlistToken}
            normalizedAllowlistToken={normalizedAllowlistToken}
            onSubmitAllowlistAction={onSubmitAllowlistAction}
            lastAllowlistTx={lastAllowlistTx}
            refreshTokenAllowlist={refreshTokenAllowlist}
            isLoadingDashboard={isLoadingDashboard}
            dashboardData={dashboardData}
            userEarnings={userEarnings}
            adminStatus={adminStatus}
            isLoadingAdminStatus={isLoadingAdminStatus}
            refreshAdminStatus={refreshAdminStatus}
            showPauseConfirm={showPauseConfirm}
            setShowPauseConfirm={setShowPauseConfirm}
            showUnpauseConfirm={showUnpauseConfirm}
            setShowUnpauseConfirm={setShowUnpauseConfirm}
            isSubmittingPause={isSubmittingPause}
            lastPauseTxHash={lastPauseTxHash}
            onTogglePause={onTogglePause}
            recoveryTokenInput={recoveryTokenInput}
            setRecoveryTokenInput={setRecoveryTokenInput}
            isLoadingUnallocated={isLoadingUnallocated}
            unallocatedError={unallocatedError}
            unallocatedBalance={unallocatedBalance}
            onInspectUnallocated={onInspectUnallocated}
            recoveryToInput={recoveryToInput}
            setRecoveryToInput={setRecoveryToInput}
            recoveryAmountInput={recoveryAmountInput}
            setRecoveryAmountInput={setRecoveryAmountInput}
            showRecoveryConfirm={showRecoveryConfirm}
            setShowRecoveryConfirm={setShowRecoveryConfirm}
            isSubmittingRecovery={isSubmittingRecovery}
            onConfirmRecovery={onConfirmRecovery}
            lastRecoveryTxHash={lastRecoveryTxHash}
            setActiveTab={setActiveTab}
            setSearchProjectId={setSearchProjectId}
            setFetchedProject={setFetchedProject}
          />
        ) : activeTab === "create" ? (
          <CreateSplitWizard
            wallet={wallet}
            control={control}
            register={register}
            handleSubmit={handleSubmit}
            onSubmit={onSubmit}
            createFormErrors={createFormErrors}
            collaboratorFields={collaboratorFields}
            appendCollaborator={appendCollaborator}
            removeCollaborator={removeCollaborator}
            collaboratorValidationErrors={collaboratorValidationErrors}
            totalBasisPoints={totalBasisPoints}
            isValid={isValid}
            sorobanSplitFlowBusy={sorobanSplitFlowBusy}
            isSubmitting={isSubmitting}
            receipt={receipt}
            latestTxHash={latestTxHash}
            createdProject={createdProject}
            setActiveTab={setActiveTab}
            setSearchProjectId={setSearchProjectId}
            setFetchedProject={setFetchedProject}
          />
        ) : activeTab === "manage" ? (
          <ManageSplitView
            wallet={wallet}
            searchProjectId={searchProjectId}
            setSearchProjectId={setSearchProjectId}
            onFetchProject={onFetchProject}
            isFetchingProject={isFetchingProject}
            fetchedProject={fetchedProject}
            isProjectOwner={isProjectOwner}
            setIsEditingMetadata={setIsEditingMetadata}
            setEditTitle={setEditTitle}
            setEditProjectType={setEditProjectType}
            setEditCollaborators={setEditCollaborators}
            setIsEditingCollaborators={setIsEditingCollaborators}
            canLockProject={canLockProject}
            setShowLockModal={setShowLockModal}
            sorobanSplitFlowBusy={sorobanSplitFlowBusy}
            history={history}
            fetchHistory={fetchHistory}
            isLoadingHistory={isLoadingHistory}
            historyError={historyError}
            isHistoryStale={isHistoryStale}
            historyCursor={historyCursor}
            projectFetchError={projectFetchError}
            isProjectStale={isProjectStale}
            setShowDistributeModal={setShowDistributeModal}
            adminStatus={adminStatus}
            receipt={receipt}
            getExplorerUrl={getExplorerUrl}
          />
        ) : (
          <ProjectsList
            wallet={wallet}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            projectsList={projectsList}
            onFetchProjectsList={onFetchProjectsList}
            isLoadingProjectsList={isLoadingProjectsList}
            projectsListError={projectsListError}
            isProjectsListStale={isProjectsListStale}
            hasMoreProjects={hasMoreProjects}
            fetchedProject={fetchedProject}
            setFetchedProject={setFetchedProject}
            fetchHistory={fetchHistory}
            isLoadingHistory={isLoadingHistory}
            history={history}
            historyError={historyError}
            isHistoryStale={isHistoryStale}
            historyCursor={historyCursor}
            setShowDistributeModal={setShowDistributeModal}
            sorobanSplitFlowBusy={sorobanSplitFlowBusy}
            adminStatus={adminStatus}
            receipt={receipt}
            getExplorerUrl={getExplorerUrl}
            getExplorerLabel={getExplorerLabel}
          />
        )}
      </div>

      {/* Distribution Confirmation Modal */}
      {showDistributeModal && fetchedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#0a0a09]/80 backdrop-blur-xl animate-in fade-in">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl">
            <h2 className="font-display text-3xl mb-2">Final Confirmation</h2>
            <p className="text-muted text-sm mb-8 leading-relaxed">
              Splitting{" "}
              <span className="text-ink font-bold">
                {Number(fetchedProject.balance).toLocaleString()} stroops
              </span>{" "}
              across{" "}
              <span className="text-ink font-bold">
                {fetchedProject.collaborators.length} collaborators
              </span>
              .
            </p>
            <div className="space-y-3 max-h-75 overflow-y-auto pr-2 custom-scrollbar">
              {fetchedProject.collaborators.map((collab, idx) => {
                const amount = Math.floor(
                  (Number(fetchedProject.balance) * collab.basisPoints) / 10_000,
                );
                return (
                  <div key={idx} className="flex justify-between items-center rounded-2xl bg-white/5 p-5 border border-white/5">
                    <div className="space-y-0.5">
                      <p className="font-bold text-sm">{collab.alias}</p>
                      <p className="text-[10px] text-muted uppercase tracking-widest">
                        {(collab.basisPoints / 100).toFixed(2)}% Share
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg text-greenBright">+{amount.toLocaleString()}</p>
                      <p className="text-[10px] text-muted uppercase tracking-tighter">Stroops</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-10 flex flex-col gap-4">
              <button
                onClick={onDistribute}
                disabled={sorobanSplitFlowBusy}
                className="premium-button w-full rounded-2xl bg-greenBright py-5 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09]"
              >
                {isSubmitting
                  ? receipt?.lifecycle === "confirming" && receipt.action === "distribute"
                    ? "Confirming on ledger…"
                    : "Signing & submitting…"
                  : "Execute Payout"}
              </button>
              <button
                onClick={() => setShowDistributeModal(false)}
                disabled={sorobanSplitFlowBusy}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:text-ink hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Edit Modal */}
      {isEditingMetadata && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 animate-in zoom-in-95 duration-200">
            <h2 className="font-display text-2xl mb-8">Edit Project Metadata</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="edit-project-title" className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  Project Title
                </label>
                <input
                  id="edit-project-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="edit-project-type" className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  Category
                </label>
                <input
                  id="edit-project-type"
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

      {/* Lock Modal */}
      {showLockModal && fetchedProject && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a09]/80 p-6 backdrop-blur-xl">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl">
            <h2 className="font-display text-3xl">Lock project?</h2>
            <div className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">Permanent action</p>
              <p className="mt-2 text-sm font-semibold text-red-200">
                This action is permanent and cannot be undone. Once locked, the split configuration can never be changed.
              </p>
            </div>
            <div className="mt-10 flex flex-col gap-4">
              <button
                onClick={onLockProject}
                disabled={sorobanSplitFlowBusy}
                className="premium-button w-full rounded-2xl bg-red-500 py-5 text-xs font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLocking
                  ? receipt?.lifecycle === "confirming" && receipt.action === "lock"
                    ? "Confirming on ledger…"
                    : "Signing & locking…"
                  : "Lock Project"}
              </button>
              <button
                onClick={() => setShowLockModal(false)}
                disabled={sorobanSplitFlowBusy}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:bg-white/5 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Modal */}
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
            <h2 id="deposit-title" className="font-display text-3xl mb-2">Deposit Funds</h2>
            <p id="deposit-description" className="text-muted text-sm mb-8 leading-relaxed">
              Contribute funds to project{" "}
              <span className="text-ink font-bold italic">&quot;{fetchedProject.title}&quot;</span>.
            </p>
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="deposit-amount" className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
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
                <p className="text-xs font-bold uppercase tracking-widest text-blue-300">Deposit Summary</p>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted">Amount to deposit:</span>
                    <span className="text-ink font-bold">{depositAmount || "0"} tokens</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted">Project:</span>
                    <span className="text-ink font-bold">{fetchedProject.projectId}</span>
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
                disabled={sorobanSplitFlowBusy || !depositAmount || Number.parseFloat(depositAmount) <= 0}
                className="premium-button w-full rounded-2xl bg-blue-500 py-5 text-xs font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDepositing
                  ? receipt?.lifecycle === "confirming" && receipt.action === "deposit"
                    ? "Confirming on ledger…"
                    : "Signing & submitting…"
                  : "Confirm Deposit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDepositModal(false);
                  setDepositAmount("");
                }}
                disabled={sorobanSplitFlowBusy}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:bg-white/5 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause confirmation modal */}
      {showPauseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a09]/80 p-6 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300">
            <h2 className="font-display text-3xl text-amber-400">Pause distributions?</h2>
            <p className="mt-4 text-sm text-muted leading-relaxed">
              This will immediately block all distribution calls across every project until you explicitly resume. No funds will be lost — only payouts are halted.
            </p>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-300">
              This action requires your admin wallet signature.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => { void onTogglePause("pause"); }}
                disabled={isSubmittingPause}
                className="premium-button w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 py-5 text-xs font-black uppercase tracking-[0.3em] text-amber-300 disabled:opacity-40"
              >
                {isSubmittingPause ? "Signing & submitting..." : "Confirm Pause"}
              </button>
              <button
                type="button"
                onClick={() => setShowPauseConfirm(false)}
                disabled={isSubmittingPause}
                className="premium-button w-full rounded-2xl border border-white/10 py-5 text-xs font-bold uppercase tracking-[0.2em] text-muted hover:bg-white/5 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unpause confirmation modal */}
      {showUnpauseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a09]/80 p-6 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300">
            <h2 className="font-display text-3xl text-greenBright">Resume distributions?</h2>
            <p className="mt-4 text-sm text-muted leading-relaxed">
              This will re-enable distribution calls for all projects. Confirm that the emergency condition has been resolved before proceeding.
            </p>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-greenBright/70">
              This action requires your admin wallet signature.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => { void onTogglePause("unpause"); }}
                disabled={isSubmittingPause}
                className="premium-button w-full rounded-2xl bg-greenBright py-5 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] disabled:opacity-40"
              >
                {isSubmittingPause ? "Signing & submitting..." : "Confirm Resume"}
              </button>
              <button
                type="button"
                onClick={() => setShowUnpauseConfirm(false)}
                disabled={isSubmittingPause}
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

