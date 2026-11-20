/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, no-empty */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Transaction, StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";
import { Controller, useFieldArray, useForm, type SubmitHandler } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";

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
  ApiError,
  getPayoutRecoveryStatus,
  recordPayoutAttempt,
} from "@/lib/api";
import { isOwner, findDuplicateCollaboratorAddressIds, type CollaboratorAddressEntry } from "@/lib/address";
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
import { useAccountScopedCache, useOptionalQueryClient } from "@/hooks/useSplits";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { clearDraft, loadDraft, saveDraft } from "@/lib/form-draft";
import { invalidateAfterMutation } from "@/lib/split-mutations";
import { notify } from "@/lib/notification";
import { WalletError } from "./WalletError";
import { trackSplitLifecycle } from "@/lib/telemetry";
import { SummaryCardSkeleton } from "./Skeleton";
import { TokenSelector } from "./TypeSelector";
import {
  TransactionReceiptView,
  type TransactionReceipt,
} from "./TransactionReceiptView";
import { Input } from "./Input";
import { CreateSplitSchema } from "@/lib/schemas";
import {
  FolderKanban,
  LayoutDashboard,
  PlusCircle,
  Settings,
  SlidersHorizontal,
  Wallet as WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "./ui/button-classes";
import {
  AmountParseError,
  parseTokenAmount,
  previewDistribution,
  stroopsToSafeNumber,
  toBigIntAmount,
} from "@/lib/amounts";

import { DashboardView } from "./dashboard/DashboardView";
import { CreateSplitWizard } from "./create/CreateSplitWizard";
import { ManageSplitView } from "./manage/ManageSplitView";
import { ProjectsList } from "./projects/ProjectsList";
import type { LoadingBarFlags } from "./LoadingBar";
import { UnconfirmedSubmissionNotice } from "./UnconfirmedSubmissionNotice";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import {
  IdempotencyKeyStore,
  isIdempotencyConflict,
  isUnconfirmedSubmission,
  resolveUnconfirmedSubmission,
  type UnconfirmedSubmission,
} from "@/lib/submission-guard";

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
  expiresAt?: string;
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
  expiresAt: "",
});

// Seeded project IDs for Phase 3 Projects list view
const SEEDED_PROJECT_IDS = [
  "afrobeats_001",
  "diaspora_sounds_02",
  "naija_vibes_03",
  "west_african_beats_04",
  "cultural_resonance_05",
];

const TAB_ICONS = {
  dashboard: LayoutDashboard,
  create: PlusCircle,
  manage: SlidersHorizontal,
  projects: FolderKanban,
} as const;

/** Returns a message for an invalid deposit amount, or null when it's valid (#1267). */
export function getDepositAmountError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter an amount to deposit.";
  if (value.startsWith("-")) return "Enter an amount greater than 0.";
  try {
    const stroops = parseTokenAmount(value);
    if (stroops <= 0n) return "Enter an amount greater than 0.";
    stroopsToSafeNumber(stroops);
    return null;
  } catch (error) {
    return error instanceof AmountParseError ? error.message : "Enter a valid amount.";
  }
}

/** Validates a recovery amount, which the admin enters in whole stroops. */
export function getRecoveryAmountError(raw: string, available: string | null): string | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return "Enter a whole number of stroops.";
  const stroops = BigInt(value);
  if (stroops <= 0n) return "Enter an amount greater than 0.";
  if (available !== null && stroops > toBigIntAmount(available)) {
    return "Amount exceeds the unallocated balance.";
  }
  if (stroops > BigInt(Number.MAX_SAFE_INTEGER)) return "Amount is too large to submit in one transaction.";
  return null;
}

export function SplitApp({
  onLoadingFlagsChange,
  isWriteDisabled = false,
}: {
  onLoadingFlagsChange?: (flags: LoadingBarFlags) => void;
  /**
   * True when the backend is reporting maintenance mode (#934). Gates the
   * "Execute Payout" distribution action as a demonstrative write-action
   * lock — read-only flows (viewing projects, history, etc.) stay open.
   */
  isWriteDisabled?: boolean;
} = {}) {
  const { wallet, connect, refresh, loading: isWalletLoading, error: walletError } = useWallet();
  const tWizardValidation = useTranslations("SplitApp.wizard.validation");
  const locale = useLocale();

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
    // The wizard decides where focus goes after a failed submit: to the
    // error summary when there are several errors (#1267).
    shouldFocusError: false,
  });

  // Account-scoped React Query data never outlives the wallet it belongs to.
  const queryClient = useOptionalQueryClient();
  useAccountScopedCache(wallet.address);
  const walletAddressRef = useRef(wallet.address);
  walletAddressRef.current = wallet.address;
  const connectionStatus = useConnectionStatus();

  // Create-form drafts are stored per account (see lib/form-draft.ts).
  // connect (null -> A): keep what was typed and adopt it under A.
  // switch (A -> B) or disconnect: load B's draft or start clean, so one
  // account's input is never shown to, or saved under, another account.
  const draftAccountRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = draftAccountRef.current;
    const next = wallet.address;
    draftAccountRef.current = next;
    if (prev === undefined) {
      const draft = loadDraft("create", next);
      if (draft) reset({ ...getInitialCreateFormValues(), ...draft });
      return;
    }
    if (prev === next) return;
    if (prev === null && next) {
      clearDraft("create", null);
      return;
    }
    const draft = loadDraft("create", next);
    reset(draft ? { ...getInitialCreateFormValues(), ...draft } : getInitialCreateFormValues());
  }, [wallet.address, reset]);

  useEffect(() => {
    const subscription = watch((values) => saveDraft("create", walletAddressRef.current, values));
    return () => subscription.unsubscribe();
  }, [watch]);

  const refreshDependentViews = (
    action: Parameters<typeof invalidateAfterMutation>[1],
    ctx: Parameters<typeof invalidateAfterMutation>[2],
  ) => void invalidateAfterMutation(queryClient, action, ctx, walletAddressRef.current);
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
  const [createRetryError, setCreateRetryError] = useState<string | null>(null);
  const [lastCreatePayload, setLastCreatePayload] = useState<CreateSplitFormValues | null>(null);
  const latestTxHash = txHash ?? receipt?.hash ?? null;
  // Duplicate-submission protection (#1266): synchronous single-flight lock
  // per action, plus one idempotency key per logical create attempt.
  const submissionGuard = useSubmissionGuard();
  const createKeyStoreRef = useRef(new IdempotencyKeyStore());
  const [checkingUnconfirmed, setCheckingUnconfirmed] = useState<string | null>(null);

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
  const [depositAttempted, setDepositAttempted] = useState(false);
  const depositAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [isDepositing, setIsDepositing] = useState(false);
  const [history, setHistory] = useState<ProjectHistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryStale, setIsHistoryStale] = useState(false);
  const lockModalRef = useRef<HTMLDivElement | null>(null);
  const depositModalRef = useRef<HTMLDivElement | null>(null);

  const [projectsList, setProjectsList] = useState<SplitProject[]>([]);
  const [projectsListLoaded, setProjectsListLoaded] = useState(false);
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
    const validEntries: CollaboratorAddressEntry[] = [];

    collaboratorFields.forEach((field, index) => {
      const collaborator = watchedCollaborators[index];
      if (!collaborator) return;

      const addr = collaborator.address.trim();
      if (!addr) return;

      if (!StrKey.isValidEd25519PublicKey(addr) && !StrKey.isValidContract(addr)) {
        errors[field.id] = tWizardValidation("invalidAddressGeneral");
      } else {
        validEntries.push({ id: field.id, address: addr });
      }
    });

    const duplicateIds = findDuplicateCollaboratorAddressIds(validEntries);
    duplicateIds.forEach((id) => {
      errors[id] = tWizardValidation("duplicateAddress");
    });

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
    if (await connect()) {
      notify.success("Wallet connected.");
    } else {
      notify.error("Wallet connection failed.");
    }
  }

  async function onReconnectWallet() {
    if (await refresh()) {
      notify.info(wallet.connected ? "Wallet reconnected." : "Wallet not authorized.");
    } else {
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

  /**
   * Signs and submits a built transaction, resolving only once the ledger
   * confirms it. A submission whose outcome is unknown keeps `action`
   * blocked (see blockIfUnconfirmed) so it cannot be sent twice.
   */
  async function signSubmitAndConfirm(
    action: string,
    built: { xdr: string; metadata: { networkPassphrase: string } },
    onSubmitted?: (hash: string) => void,
  ): Promise<string> {
    const signedTxXdr = await signWithWallet(built.xdr, built.metadata.networkPassphrase);
    const transaction = new Transaction(signedTxXdr, built.metadata.networkPassphrase);
    let submitted: UnconfirmedSubmission | null = null;
    try {
      const { hash } = await submitSorobanTransactionAndPoll(createSorobanRpcServer(), transaction, {
        afterSubmitted: (hash) => {
          submitted = { hash, submittedAt: Date.now() };
          onSubmitted?.(hash);
        },
      });
      return hash;
    } catch (error) {
      blockIfUnconfirmed(action, error, submitted);
      throw error;
    }
  }

  const onConfirmRecovery = () => submissionGuard.run("recovery", runRecovery);

  async function runRecovery() {
    if (!wallet.address || !unallocatedBalance) return;
    const destination = recoveryToInput.trim();
    const amountError = getRecoveryAmountError(recoveryAmountInput, unallocatedBalance.unallocated);
    if (!destination || amountError) {
      notify.error(amountError ?? "Destination address is required.");
      return;
    }
    setIsSubmittingRecovery(true);
    try {
      const buildResponse = await buildWithdrawUnallocatedXdr({
        admin: wallet.address,
        token: unallocatedBalance.token,
        to: destination,
        amount: Number(recoveryAmountInput.trim()),
      });
      const hash = await signSubmitAndConfirm("recovery", buildResponse, setLastRecoveryTxHash);
      setShowRecoveryConfirm(false);
      notify.success("Recovery confirmed on ledger.");
      // Refreshing the balance clears the last hash; restore it afterwards.
      await onInspectUnallocated();
      setLastRecoveryTxHash(hash);
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

  const onUpdateMetadata = () => submissionGuard.run("update_metadata", runUpdateMetadata);

  async function runUpdateMetadata() {
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
    const telemetry = trackSplitLifecycle("update_metadata", { projectId });
    try {
      const buildResponse = await buildUpdateMetadataXdr(
        projectId,
        wallet.address,
        nextTitle,
        nextProjectType,
      );
      await signSubmitAndConfirm("update_metadata", buildResponse, telemetry.submitted);
      telemetry.succeeded();
      notify.success("Project metadata updated successfully.");
      refreshDependentViews("update_metadata", { projectId: projectId, account: wallet.address });
    } catch (error) {
      telemetry.failed(error);
      patchProjectInAllViews(projectId, previousSnapshot);
      setIsEditingMetadata(true);
      notify.error(error instanceof Error ? error.message : "Failed to update metadata.");
    } finally {
      setIsUpdatingMetadata(false);
    }
  }

  const onUpdateCollaborators = () =>
    submissionGuard.run("update_collaborators", runUpdateCollaborators);

  async function runUpdateCollaborators() {
    if (!fetchedProject || !wallet.address) return;
    const result = CreateSplitSchema.shape.collaborators.safeParse(editCollaborators);
    if (!result.success) {
      notify.error("Please fix collaborator validation errors.");
      return;
    }
    setIsUpdatingCollaborators(true);
    const telemetry = trackSplitLifecycle("update_collaborators", {
      projectId: fetchedProject.projectId,
      props: { collaboratorCount: editCollaborators.length },
    });
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
      await signSubmitAndConfirm("update_collaborators", buildResponse, telemetry.submitted);
      telemetry.succeeded();
      notify.success("Collaborators updated successfully.");
      refreshDependentViews("update_collaborators", { projectId: fetchedProject.projectId, account: wallet.address });
      setIsEditingCollaborators(false);
      await onFetchProject();
    } catch (error) {
      telemetry.failed(error);
      notify.error(
        error instanceof Error ? error.message : "Failed to update collaborators.",
      );
    } finally {
      setIsUpdatingCollaborators(false);
    }
  }

  function _onWizardReset() {
    clearDraft("create", wallet.address);
    setCreateStep(1);
    reset(getInitialCreateFormValues());
    setTxHash(null);
    setReceipt(null);
    setCreatedProject(null);
    setCreateRetryError(null);
    setLastCreatePayload(null);
  }

  function onRetryCreateSubmission() {
    if (!lastCreatePayload) return;
    void onSubmit(lastCreatePayload);
  }

  /**
   * If a transaction reached the network but its outcome is unknown, keep the
   * action blocked instead of letting a retry submit it again (#1266).
   */
  function blockIfUnconfirmed(action: string, error: unknown, submitted: UnconfirmedSubmission | null) {
    if (submitted && isUnconfirmedSubmission(error)) {
      submissionGuard.markUnconfirmed(action, submitted);
    }
  }

  async function onCheckUnconfirmed(action: string) {
    const submission = submissionGuard.unconfirmed[action];
    if (!submission || checkingUnconfirmed) return;
    setCheckingUnconfirmed(action);
    try {
      let outcome: Awaited<ReturnType<typeof resolveUnconfirmedSubmission>>;
      if (action === "distribute") {
        try {
          const recovery = await getPayoutRecoveryStatus(submission.hash);
          outcome =
            recovery.status === "completed"
              ? "succeeded"
              : recovery.status === "failed"
                ? "failed"
                : "pending";
        } catch (error) {
          if (!(error instanceof ApiError) || !error.isNotFound) throw error;
          outcome = await resolveUnconfirmedSubmission(createSorobanRpcServer(), submission);
        }
      } else {
        outcome = await resolveUnconfirmedSubmission(createSorobanRpcServer(), submission);
      }
      if (outcome === "pending") {
        notify.info("Still waiting for the network. Check again in a moment.");
        return;
      }
      submissionGuard.clearUnconfirmed(action);
      setReceipt((prev) =>
        prev?.hash === submission.hash
          ? outcome === "succeeded"
            ? { ...prev, lifecycle: "success" }
            : { ...prev, lifecycle: "failed", failureReason: outcome === "expired" ? "Transaction expired without confirming." : "Transaction failed on ledger." }
          : prev,
      );
      if (outcome === "succeeded") {
        notify.success("Transaction confirmed.");
        if (fetchedProject) await onFetchProject();
      } else if (outcome === "failed") {
        notify.error("The transaction failed on ledger. You can try again.");
      } else {
        notify.info("The transaction expired without confirming. You can try again.");
      }
    } catch (error) {
      console.error("Failed to check transaction recovery status:", error);
      notify.error("Could not verify the transaction status. Keep the action blocked and try again.");
    } finally {
      setCheckingUnconfirmed(null);
    }
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

  const onSubmit: SubmitHandler<CreateSplitFormValues> = (data) =>
    submissionGuard.run("create", () => runCreate(data));

  const runCreate = async (data: CreateSplitFormValues) => {
    if (connectionStatus === "offline") {
      notify.error("You're offline. Your input is saved; submit again when you're back online.");
      return;
    }
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
    setCreateRetryError(null);
    setLastCreatePayload({
      ...data,
      collaborators: data.collaborators.map((c) => ({ ...c })),
    });
    setTxHash(null);
    setReceipt(null);
    const telemetry = trackSplitLifecycle("create", {
      projectId: data.projectId.trim(),
      props: { collaboratorCount: collaboratorPayload.length },
    });
    let submitted: UnconfirmedSubmission | null = null;
    try {
      const createPayload = {
        owner: wallet.address,
        projectId: data.projectId.trim(),
        title: data.title.trim(),
        projectType: data.projectType.trim(),
        token: data.token.trim(),
        collaborators: collaboratorPayload,
        expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : undefined,
      };
      // Same payload, same key: a retry after a build/sign failure gets the
      // backend's cached response instead of a second build.
      const buildResponse = await buildCreateSplitXdr(createPayload, {
        idempotencyKey: createKeyStoreRef.current.keyFor(createPayload),
      });
      const signedTxXdr = await signWithWallet(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase,
      );
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          submitted = { hash, submittedAt: Date.now() };
          // The built XDR's sequence number is now spent, so any later
          // attempt must build a fresh transaction under a new key.
          createKeyStoreRef.current.reset();
          telemetry.submitted(hash);
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

      telemetry.succeeded();
      setReceipt((prev) =>
        prev?.action === "create" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      notify.success("Split project created successfully.");
      clearDraft("create", wallet.address);
      refreshDependentViews("create", { projectId: data.projectId.trim(), account: wallet.address });
      setCreateRetryError(null);

      try {
        const projectDetails = await getSplit(data.projectId.trim());
        setCreatedProject(projectDetails);
        setCreateStep(4);
      } catch (error) {
        console.error("Failed to fetch created project details:", error);
        setCreateStep(4);
      }
    } catch (error) {
      telemetry.failed(error);
      if (isIdempotencyConflict(error)) createKeyStoreRef.current.reset();
      blockIfUnconfirmed("create", error, submitted);
      const message =
        error instanceof Error ? error.message : "Failed to create split project.";
      setCreateRetryError(message);
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

  const onDistribute = () => submissionGuard.run("distribute", runDistribute);

  const runDistribute = async () => {
    const sourceAccount = wallet.address;
    if (!fetchedProject || !sourceAccount) return;
    setIsSubmitting(true);
    setShowDistributeModal(false);
    const telemetry = trackSplitLifecycle("distribute", {
      projectId: fetchedProject.projectId,
      props: { round: fetchedProject.distributionRound + 1 },
    });
    let submitted: UnconfirmedSubmission | null = null;
    try {
      const { xdr, metadata } = await buildDistributeXdr(fetchedProject.projectId, sourceAccount);
      const signedTxXdr = await signWithWallet(xdr, metadata.networkPassphrase);
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);

      const { hash } = await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: async (hash) => {
          submitted = { hash, submittedAt: Date.now() };
          try {
            await recordPayoutAttempt({
              txHash: hash,
              projectId: fetchedProject.projectId,
              sourceAccount,
            });
          } catch (error) {
            console.error("Failed to persist payout recovery metadata:", error);
            notify.error(
              "The payout was submitted, but its recovery record could not be saved. Do not retry until its status is confirmed.",
            );
          }
          telemetry.submitted(hash);
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
      try {
        await getPayoutRecoveryStatus(hash);
      } catch (error) {
        console.error("Failed to reconcile confirmed payout recovery metadata:", error);
        notify.error("Payout confirmed, but its recovery record could not be updated.");
      }

      telemetry.succeeded();
      setReceipt((prev) =>
        prev?.action === "distribute" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      notify.success("Distribution completed successfully.");
      refreshDependentViews("distribute", { projectId: fetchedProject.projectId, account: sourceAccount });
      await onFetchProject();
    } catch (error) {
      let recoveryStatus: Awaited<ReturnType<typeof getPayoutRecoveryStatus>> | null = null;
      if (submitted) {
        try {
          recoveryStatus = await getPayoutRecoveryStatus(submitted.hash);
        } catch (recoveryError) {
          console.error("Failed to reconcile payout after submission error:", recoveryError);
        }
      }
      if (recoveryStatus?.status === "completed") {
        telemetry.succeeded();
        setReceipt((prev) =>
          prev?.action === "distribute" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
        );
        notify.success("Payout confirmed.");
        refreshDependentViews("distribute", { projectId: fetchedProject.projectId, account: sourceAccount });
        await onFetchProject();
        return;
      }
      telemetry.failed(error);
      if (recoveryStatus?.status !== "failed") {
        blockIfUnconfirmed("distribute", error, submitted);
      }
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

  const onLockProject = () => submissionGuard.run("lock", runLockProject);

  const runLockProject = async () => {
    if (!fetchedProject || !wallet.address) return;
    setIsLocking(true);
    const telemetry = trackSplitLifecycle("lock", { projectId: fetchedProject.projectId });
    let submitted: UnconfirmedSubmission | null = null;
    try {
      const { xdr, metadata } = await buildLockProjectXdr(fetchedProject.projectId, wallet.address);
      const signedTxXdr = await signWithWallet(xdr, metadata.networkPassphrase);
      const server = createSorobanRpcServer();
      const transaction = new Transaction(signedTxXdr, metadata.networkPassphrase);

      await submitSorobanTransactionAndPoll(server, transaction, {
        afterSubmitted: (hash) => {
          submitted = { hash, submittedAt: Date.now() };
          telemetry.submitted(hash);
          setTxHash(hash);
          setReceipt({
            hash,
            lifecycle: "confirming",
            action: "lock",
            projectId: fetchedProject.projectId,
          });
        },
      });

      telemetry.succeeded();
      setReceipt((prev) =>
        prev?.action === "lock" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      setFetchedProject((prev) => (prev ? { ...prev, locked: true } : prev));
      setShowLockModal(false);
      notify.success("Project locked permanently.");
      refreshDependentViews("lock", { projectId: fetchedProject.projectId, account: wallet.address });
    } catch (error) {
      telemetry.failed(error);
      blockIfUnconfirmed("lock", error, submitted);
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

  const onDeposit = () => submissionGuard.run("deposit", runDeposit);

  // Deposit amount validation (#1267). Shown once the user submits, or as
  // soon as a non-empty value is invalid.
  const depositAmountError = getDepositAmountError(depositAmount);
  const showDepositAmountError = Boolean(depositAmountError) && (depositAttempted || depositAmount.trim() !== "");

  const onConfirmDeposit = () => {
    if (depositAmountError) {
      setDepositAttempted(true);
      depositAmountInputRef.current?.focus();
      return;
    }
    void onDeposit();
  };

  const closeDepositModal = () => {
    setShowDepositModal(false);
    setDepositAmount("");
    setDepositAttempted(false);
  };

  const runDeposit = async () => {
    if (!fetchedProject || !wallet.address || !depositAmount) return;
    setIsDepositing(true);
    const telemetry = trackSplitLifecycle("deposit", { projectId: fetchedProject.projectId });
    let submitted: UnconfirmedSubmission | null = null;
    try {
      const amountInStroops = stroopsToSafeNumber(parseTokenAmount(depositAmount));
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
          submitted = { hash, submittedAt: Date.now() };
          telemetry.submitted(hash);
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

      telemetry.succeeded();
      setReceipt((prev) =>
        prev?.action === "deposit" && prev.hash ? { ...prev, lifecycle: "success" } : prev,
      );
      closeDepositModal();
      notify.success("Deposit successful!");
      refreshDependentViews("deposit", { projectId: fetchedProject.projectId, account: wallet.address });
      await onFetchProject();
    } catch (error) {
      telemetry.failed(error);
      blockIfUnconfirmed("deposit", error, submitted);
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
    if (isLoadingProjectsList) return;
    if (!loadMore && projectsList.length > 0) return;

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
      setProjectsListLoaded(true);
    }
  }, [isLoadingProjectsList, projectsList.length, projectsStart, listProjects]);

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

  const onTogglePause = (action: "pause" | "unpause") =>
    submissionGuard.run("toggle_pause", () => runTogglePause(action));

  const runTogglePause = async (action: "pause" | "unpause") => {
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

      await signSubmitAndConfirm("toggle_pause", buildResponse, setLastPauseTxHash);
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

  const onSubmitAllowlistAction = (action: "allow" | "disallow") =>
    submissionGuard.run("allowlist", () => runAllowlistAction(action));

  const runAllowlistAction = async (action: "allow" | "disallow") => {
    if (!wallet.address || !isContractAdmin || !isValidAllowlistToken) return;
    setIsUpdatingAllowlist(true);
    try {
      const buildResponse =
        action === "allow"
          ? await buildAllowTokenXdr(wallet.address, normalizedAllowlistToken)
          : await buildDisallowTokenXdr(wallet.address, normalizedAllowlistToken);
      const txHash = await signSubmitAndConfirm("allowlist", buildResponse);
      setLastAllowlistTx({
        action,
        token: normalizedAllowlistToken,
        txHash,
      });
      setAllowlistTokenInput("");
      notify.success("Allowlist updated.");
      await refreshTokenAllowlist();
    } catch (error) {
      notify.error(error instanceof Error ? `Failed to update allowlist: ${error.message}` : "Failed to update allowlist.");
    } finally {
      setIsUpdatingAllowlist(false);
    }
  };

  useEffect(() => {
    onLoadingFlagsChange?.({
      isLoadingDashboard,
      isLoadingProjectsList,
      isFetchingProject,
    });

    return () => {
      onLoadingFlagsChange?.({
        isLoadingDashboard: false,
        isLoadingProjectsList: false,
        isFetchingProject: false,
      });
    };
  }, [
    isLoadingDashboard,
    isLoadingProjectsList,
    isFetchingProject,
    onLoadingFlagsChange,
  ]);

  // Reload dashboard data when wallet account switches
  useEffect(() => {
    if (activeTab === "dashboard") {
      void onFetchDashboardData();
    }
  }, [wallet.address]);

  useEffect(() => {
    if (activeTab === "projects") {
      if (projectsList.length === 0 && !isLoadingProjectsList) {
        void onFetchProjectsList();
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
    projectsList.length,
  ]);

  useEffect(() => {
    if (!showLockModal && !showDepositModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowLockModal(false);
        setShowDepositModal(false);
        setDepositAttempted(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showLockModal, showDepositModal]);

  return (
    <main className="min-h-screen px-4 pb-16 pt-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        {/* Header Section */}
        <header className="rounded-[var(--radius-card)] border border-line bg-surface-raised p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="SplitNaira home">
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-surface"
                >
                  S
                </span>
                <h1 className="font-display text-xl font-semibold tracking-tight text-ink">SplitNaira</h1>
              </Link>
              <p className="hidden text-sm text-muted md:block">
                Premium royalty management on Stellar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/${locale}/dashboard/settings`}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-muted hover:bg-surface-overlay hover:text-ink"
              >
                <Settings aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Settings</span>
              </Link>
              {!wallet.connected ? (
                <button
                  type="button"
                  onClick={onConnectWallet}
                  aria-label="Connect a wallet"
                  aria-busy={isWalletLoading}
                  disabled={isWalletLoading}
                  className={buttonClasses("primary", "md", "font-semibold disabled:opacity-60")}
                >
                  <WalletIcon aria-hidden="true" className="h-4 w-4" />
                  Connect Wallet
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onConnectWallet}
                    aria-label="Switch to a different wallet"
                    aria-busy={isWalletLoading}
                    disabled={isWalletLoading}
                    className={buttonClasses("secondary", "md")}
                  >
                    Switch Wallet
                  </button>
                  <button
                    type="button"
                    onClick={onReconnectWallet}
                    aria-label="Refresh wallet connection"
                    aria-busy={isWalletLoading}
                    disabled={isWalletLoading}
                    className={buttonClasses("secondary", "md")}
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    onClick={onDisconnectWallet}
                    aria-label="Disconnect wallet using the wallet extension or app"
                    className={buttonClasses("ghost", "md", "hover:text-danger")}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
          <WalletError error={walletError} />
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {isWalletLoading
              ? wallet.connected
                ? "Refreshing wallet connection."
                : "Connecting to wallet."
              : ""}
          </p>
          {wallet.connected && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-xs text-muted">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
                <span role="status" aria-live="polite">Status: Connected</span>
              </div>
              <div className="flex items-center gap-2">
                <dt>Wallet</dt>
                <dd className="font-mono text-ink">
                  {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-6)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>Network</dt>
                <dd className="text-ink">{wallet.network ?? "Unknown"}</dd>
              </div>
            </dl>
          )}
        </header>

        {/* Navigation Tabs */}
        <nav aria-label="Workspace" className="custom-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface-raised p-1">
            {(["dashboard", "create", "manage", "projects"] as const).map((tab) => {
              const Icon = TAB_ICONS[tab];
              return (
                <li key={tab}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    aria-current={activeTab === tab ? "page" : undefined}
                    className={clsx(
                      "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      activeTab === tab
                        ? "bg-surface-overlay text-ink shadow-sm"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {tab === "manage" ? "Manage & Distribute" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <UnconfirmedSubmissionNotice
          submissions={submissionGuard.unconfirmed}
          checkingAction={checkingUnconfirmed}
          onCheck={(action) => void onCheckUnconfirmed(action)}
        />

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
            getExplorerUrl={getExplorerUrl}
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
            sorobanSplitFlowBusy={sorobanSplitFlowBusy || submissionGuard.isBlocked("create")}
            isSubmitting={isSubmitting}
            receipt={receipt}
            latestTxHash={latestTxHash}
            createdProject={createdProject}
            createRetryError={createRetryError}
            onRetryCreateSubmission={onRetryCreateSubmission}
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
            setShowDepositModal={setShowDepositModal}
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
              {(previewDistribution(toBigIntAmount(fetchedProject.balance), fetchedProject.collaborators) ?? []).map((collab, idx) => {
                const amount = collab.amount;
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
                disabled={sorobanSplitFlowBusy || isWriteDisabled || submissionGuard.isBlocked("distribute")}
                aria-busy={submissionGuard.inFlight.has("distribute")}
                className="premium-button w-full rounded-2xl bg-greenBright py-5 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09]"
              >
                {isSubmitting
                  ? receipt?.lifecycle === "confirming" && receipt.action === "distribute"
                    ? "Confirming on ledger…"
                    : "Signing & submitting…"
                  : "Execute Payout"}
              </button>
              {isWriteDisabled && (
                <p className="text-center text-[10px] font-bold uppercase tracking-widest text-red-400">
                  Unavailable during maintenance
                </p>
              )}
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
                disabled={sorobanSplitFlowBusy || submissionGuard.isBlocked("lock")}
                aria-busy={submissionGuard.inFlight.has("lock")}
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
                  ref={depositAmountInputRef}
                  id="deposit-amount"
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.0"
                  disabled={isDepositing}
                  aria-invalid={showDepositAmountError}
                  aria-describedby={showDepositAmountError ? "deposit-amount-error" : undefined}
                  className="glass-input w-full rounded-2xl px-5 py-4 text-sm disabled:opacity-50"
                />
                {showDepositAmountError && (
                  <p id="deposit-amount-error" className="text-xs font-medium text-red-400">
                    {depositAmountError}
                  </p>
                )}
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
                onClick={onConfirmDeposit}
                disabled={sorobanSplitFlowBusy || submissionGuard.isBlocked("deposit")}
                // Focusable while the amount is invalid, so pressing it can
                // explain why (#1267); truly disabled while busy (#1266).
                aria-disabled={Boolean(depositAmountError) || sorobanSplitFlowBusy || submissionGuard.isBlocked("deposit")}
                aria-busy={submissionGuard.inFlight.has("deposit")}
                className="premium-button w-full rounded-2xl bg-blue-500 py-5 text-xs font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                {isDepositing
                  ? receipt?.lifecycle === "confirming" && receipt.action === "deposit"
                    ? "Confirming on ledger…"
                    : "Signing & submitting…"
                  : "Confirm Deposit"}
              </button>
              <button
                type="button"
                onClick={closeDepositModal}
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
