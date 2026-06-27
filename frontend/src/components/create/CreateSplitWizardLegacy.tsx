"use client";

import { Controller, type Control, type UseFormRegister, type FieldErrors, type FieldArrayWithId } from "react-hook-form";
import { clsx } from "clsx";
import { StrKey } from "@stellar/stellar-sdk";
import type { SplitProject } from "@/lib/stellar";
import type { WalletState } from "@/lib/wallet";
import { TokenSelector } from "../TypeSelector";
import { TransactionReceiptView, type TransactionReceipt } from "../TransactionReceiptView";

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

interface CreateSplitWizardProps {
  wallet: WalletState;
  control: Control<CreateSplitFormValues>;
  register: UseFormRegister<CreateSplitFormValues>;
  handleSubmit: (callback: (data: CreateSplitFormValues) => void) => (e?: React.BaseSyntheticEvent) => Promise<void>;
  onSubmit: (data: CreateSplitFormValues) => void;
  createFormErrors: FieldErrors<CreateSplitFormValues>;
  collaboratorFields: FieldArrayWithId<CreateSplitFormValues, "collaborators", "id">[];
  appendCollaborator: (value: CreateCollaboratorInput) => void;
  removeCollaborator: (index: number) => void;
  collaboratorValidationErrors: Record<string, string>;
  totalBasisPoints: number;
  isValid: boolean;
  sorobanSplitFlowBusy: boolean;
  isSubmitting: boolean;
  receipt: TransactionReceipt | null;
  latestTxHash: string | null;
  createdProject: SplitProject | null;
  setActiveTab: (tab: "dashboard" | "create" | "manage" | "projects") => void;
  setSearchProjectId: (val: string) => void;
  setFetchedProject: (p: SplitProject | null) => void;
}

export function CreateSplitWizard({
  wallet,
  control,
  register,
  handleSubmit,
  onSubmit,
  createFormErrors,
  collaboratorFields,
  appendCollaborator,
  removeCollaborator,
  collaboratorValidationErrors,
  totalBasisPoints,
  isValid,
  sorobanSplitFlowBusy,
  isSubmitting,
  receipt,
  latestTxHash,
  createdProject,
  setActiveTab,
  setSearchProjectId,
  setFetchedProject,
}: CreateSplitWizardProps) {
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="glass-card rounded-[2.5rem] p-8 md:p-10 space-y-12">
      <div className="flex items-center justify-between border-b border-white/5 pb-6">
        <h2 className="font-display text-2xl tracking-tight">Project Setup</h2>
        <span className="text-[10px] font-bold uppercase text-muted">Step 01 / 02</span>
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
            placeholder="e.g. dawn_of_nova_01"
            className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
            {...register("projectId", { required: "Project identifier is required." })}
          />
          {createFormErrors.projectId && (
            <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
              {createFormErrors.projectId.message}
            </p>
          )}
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
            placeholder="e.g. Dawn of Nova"
            className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
            {...register("title", { required: "Display title is required." })}
          />
          {createFormErrors.title && (
            <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
              {createFormErrors.title.message}
            </p>
          )}
        </div>
        <Controller
          control={control}
          name="token"
          rules={{
            required: "Asset token is required.",
            validate: (value) =>
              StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
                ? true
                : "Enter a valid Stellar token address.",
          }}
          render={({ field }) => (
            <TokenSelector
              value={field.value}
              onChange={field.onChange}
              network={wallet.network ?? null}
              required
            />
          )}
        />
        {createFormErrors.token && (
          <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter md:col-span-2 -mt-4">
            {createFormErrors.token.message}
          </p>
        )}
        <div className="space-y-2">
          <label
            htmlFor="projectType"
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted px-1"
          >
            Media Category
          </label>
          <input
            id="projectType"
            placeholder="e.g. Music, Film"
            className="glass-input w-full rounded-2xl px-5 py-4 text-sm"
            {...register("projectType", { required: "Media category is required." })}
          />
          {createFormErrors.projectType && (
            <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
              {createFormErrors.projectType.message}
            </p>
          )}
        </div>
      </div>

      <div className="mt-12 space-y-8">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <div className="flex items-center gap-4">
            <h2 className="font-display text-2xl tracking-tight">Recipients</h2>
            <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-bold text-muted">
              {collaboratorFields.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => appendCollaborator({ address: "", alias: "", basisPoints: "0" })}
            className="premium-button flex items-center gap-2 rounded-xl bg-greenMid/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-greenBright transition-all hover:bg-greenMid/20"
          >
            + Add Recipient
          </button>
        </div>
        <div className="space-y-4">
          {collaboratorFields.map((field, index) => {
            const addressError =
              createFormErrors.collaborators?.[index]?.address?.message ??
              collaboratorValidationErrors[field.id];
            const aliasError = createFormErrors.collaborators?.[index]?.alias?.message;
            const basisPointsError = createFormErrors.collaborators?.[index]?.basisPoints?.message;

            return (
              <div
                key={field.id}
                className="group relative grid gap-6 rounded-3xl border border-white/5 bg-white/2 p-6 transition-all hover:bg-white/4 md:grid-cols-12 md:items-start"
              >
                <div className="md:col-span-5 space-y-2">
                  <label
                    htmlFor={`address-${field.id}`}
                    className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                  >
                    Wallet Address
                  </label>
                  <input
                    id={`address-${field.id}`}
                    placeholder={`Recipient #${index + 1}`}
                    className={clsx(
                      "glass-input w-full rounded-xl px-4 py-3 text-sm",
                      addressError ? "border-red-500/50 bg-red-500/5" : "",
                    )}
                    {...register(`collaborators.${index}.address`, {
                      required: "Wallet address is required.",
                      validate: (value) =>
                        StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
                          ? true
                          : "Enter a valid Stellar address or contract ID.",
                    })}
                  />
                  {addressError && (
                    <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                      {addressError}
                    </p>
                  )}
                </div>
                <div className="md:col-span-3 space-y-2">
                  <label
                    htmlFor={`alias-${field.id}`}
                    className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                  >
                    Alias
                  </label>
                  <input
                    id={`alias-${field.id}`}
                    placeholder="e.g. Lead Vocals"
                    className={clsx(
                      "glass-input w-full rounded-xl px-4 py-3 text-sm",
                      aliasError ? "border-red-500/50 bg-red-500/5" : "",
                    )}
                    {...register(`collaborators.${index}.alias`, {
                      required: "Alias is required.",
                    })}
                  />
                  {aliasError && (
                    <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                      {aliasError}
                    </p>
                  )}
                </div>
                <div className="md:col-span-3 space-y-2">
                  <label
                    htmlFor={`bp-${field.id}`}
                    className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted/60 px-1"
                  >
                    Share (BP)
                  </label>
                  <input
                    id={`bp-${field.id}`}
                    type="number"
                    min={0}
                    max={10_000}
                    placeholder="5000"
                    className={clsx(
                      "glass-input w-full rounded-xl px-4 py-3 text-sm",
                      basisPointsError ? "border-red-500/50 bg-red-500/5" : "",
                    )}
                    {...register(`collaborators.${index}.basisPoints`, {
                      required: "Share is required.",
                      validate: (value) => {
                        const parsed = Number.parseInt(value, 10);
                        if (!Number.isFinite(parsed) || parsed < 0) return "Share must be a valid number.";
                        if (parsed > 10_000) return "Share cannot exceed 10,000.";
                        return true;
                      },
                    })}
                  />
                  {basisPointsError && (
                    <p className="px-1 text-[10px] font-bold text-red-400 uppercase tracking-tighter">
                      {basisPointsError}
                    </p>
                  )}
                </div>
                <div className="md:col-span-1 pt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => removeCollaborator(index)}
                    disabled={collaboratorFields.length <= 2}
                    className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400 opacity-0 transition-opacity hover:bg-red-500/20 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                  >
                    <svg className="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col items-end gap-3 px-4 py-6 rounded-3xl bg-white/2 border border-white/5">
          <div className="flex items-center gap-4">
            <span className="text-[10px] uppercase text-muted">Allocation Matrix</span>
            <div
              className={clsx(
                "rounded-lg px-4 py-2 font-mono text-sm font-bold",
                totalBasisPoints === 10000
                  ? "bg-greenMid/10 text-greenBright"
                  : "bg-red-500/10 text-red-400",
              )}
            >
              {totalBasisPoints.toLocaleString()} / 10,000 BP
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 pt-12 border-t border-white/5">
        <button
          type="submit"
          disabled={!isValid || sorobanSplitFlowBusy}
          className="premium-button w-full rounded-4xl bg-greenMid py-5 text-sm font-extrabold uppercase tracking-[0.25em] text-white shadow-2xl shadow-greenMid/20 disabled:cursor-not-allowed disabled:opacity-20"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-3">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {receipt?.lifecycle === "confirming" && receipt.action === "create"
                ? "Confirming on ledger…"
                : "Sign in wallet & submit…"}
            </div>
          ) : (
            "Create Split Project"
          )}
        </button>
      </div>
      {receipt && receipt.action === "create" && (
        <TransactionReceiptView receipt={receipt} network={wallet.network ?? null} />
      )}

      {latestTxHash && (
        <p className="px-4 text-[10px] font-mono text-muted break-all opacity-70">
          Last transaction hash: {latestTxHash}
        </p>
      )}

      {createdProject && (
        <div className="mt-8 glass-card rounded-[2.5rem] p-8 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-white/5 pb-8">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h3 className="font-display text-2xl tracking-tight">{createdProject.title}</h3>
                <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
                  {createdProject.projectType}
                </span>
                {createdProject.locked && (
                  <span className="rounded-full bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-400 border border-red-500/20">
                    Locked
                  </span>
                )}
              </div>
              <p className="font-mono text-xs text-muted opacity-60 break-all">{createdProject.projectId}</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Available Funds</p>
              <p className="text-3xl font-display text-greenBright">
                {Number(createdProject.balance).toLocaleString()}{" "}
                <span className="text-sm font-sans opacity-40">Stroops</span>
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
                  <div key={idx} className="flex justify-between items-center rounded-2xl bg-white/2 p-3 text-sm border border-white/5 hover:bg-white/4 transition-colors">
                    <div className="space-y-0.5">
                      <p className="font-bold text-xs">{collab.alias}</p>
                      <p className="font-mono text-[9px] text-muted opacity-60 truncate max-w-30">{collab.address}</p>
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
                  <span className="text-xs font-bold text-muted">Distribution Round</span>
                  <span className="font-mono font-bold text-sm">{createdProject.distributionRound}</span>
                </div>
                <div className="flex justify-between items-center rounded-2xl bg-white/2 p-3 border border-white/5">
                  <span className="text-xs font-bold text-muted">Total Distributed</span>
                  <span className="font-mono font-bold text-sm">
                    {Number(createdProject.totalDistributed).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center rounded-2xl bg-white/2 p-3 border border-white/5">
                  <span className="text-xs font-bold text-muted">Status</span>
                  <span className={`font-mono font-bold text-xs ${createdProject.locked ? "text-red-400" : "text-greenBright"}`}>
                    {createdProject.locked ? "Locked" : "Active"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/5">
            <button
              type="button"
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
  );
}
