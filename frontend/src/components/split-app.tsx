"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { rpc, Transaction } from "@stellar/stellar-sdk";

import { buildCreateSplitXdr, getSplit } from "@/lib/api";
import { connectFreighter, getFreighterWalletState, signWithFreighter, type WalletState } from "@/lib/freighter";
import { useToast } from "./toast-provider";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

const initialCollaborators: CollaboratorInput[] = [
  { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "5000" },
  { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "5000" }
];

export function SplitApp() {
  const { showToast } = useToast();

  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    network: null
  });
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("music");
  const [token, setToken] = useState("");
  const [collaborators, setCollaborators] = useState<CollaboratorInput[]>(initialCollaborators);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const totalBasisPoints = useMemo(
    () =>
      collaborators.reduce((sum, collaborator) => {
        const parsed = Number.parseInt(collaborator.basisPoints, 10);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [collaborators]
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
      const message = error instanceof Error ? error.message : "Wallet connection failed.";
      showToast(message, "error");
    }
  }

  async function onReconnectWallet() {
    try {
      const state = await getFreighterWalletState();
      setWallet(state);
      showToast(state.connected ? "Wallet reconnected." : "Wallet not authorized.", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet refresh failed.";
      showToast(message, "error");
    }
  }

  function onDisconnectWallet() {
    setWallet({ connected: false, address: null, network: null });
    showToast("Wallet disconnected in app. Reconnect to continue.", "info");
  }

  function updateCollaborator(id: string, patch: Partial<CollaboratorInput>) {
    setCollaborators((prev) =>
      prev.map((collaborator) =>
        collaborator.id === id ? { ...collaborator, ...patch } : collaborator
      )
    );
  }

  function addCollaborator() {
    setCollaborators((prev) => [
      ...prev,
      { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "0" }
    ]);
  }

  function removeCollaborator(id: string) {
    setCollaborators((prev) => (prev.length <= 2 ? prev : prev.filter((c) => c.id !== id)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wallet.connected || !wallet.address) {
      showToast("Connect Freighter wallet first.", "error");
      return;
    }

    const collaboratorPayload = collaborators.map((collaborator) => ({
      address: collaborator.address.trim(),
      alias: collaborator.alias.trim(),
      basisPoints: Number.parseInt(collaborator.basisPoints, 10)
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
        collaborators: collaboratorPayload
      });

      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase
      );

      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);

      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResultXdr ?? "Transaction submission failed.");
      }

      setTxHash(submitResponse.hash ?? null);
      showToast("Split project created successfully.", "success");

      await getSplit(projectId.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create split project.";
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-greenDeep">SplitNaira</h1>
              <p className="text-sm text-black/70">
                Connect Freighter and create a split project on Soroban.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onConnectWallet}
                className="rounded-full bg-greenDeep px-4 py-2 text-sm font-semibold text-white"
              >
                Connect wallet
              </button>
              <button
                type="button"
                onClick={onReconnectWallet}
                className="rounded-full border border-black/20 bg-white px-4 py-2 text-sm"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={onDisconnectWallet}
                className="rounded-full border border-black/20 bg-white px-4 py-2 text-sm"
              >
                Disconnect
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-black/70">
            <div>
              Status:{" "}
              <span className={wallet.connected ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
                {wallet.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div>Address: {wallet.address ?? "-"}</div>
            <div>Network: {wallet.network ?? "-"}</div>
          </div>
        </header>

        <form onSubmit={onSubmit} className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-soft">
          <h2 className="font-display text-2xl text-greenDeep">Create split</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <input
              required
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="Project ID (e.g. afrobeats_001)"
              className="rounded-xl border border-black/15 px-3 py-2 text-sm"
            />
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project title"
              className="rounded-xl border border-black/15 px-3 py-2 text-sm"
            />
            <input
              required
              value={projectType}
              onChange={(event) => setProjectType(event.target.value)}
              placeholder="Project type"
              className="rounded-xl border border-black/15 px-3 py-2 text-sm"
            />
            <input
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Token contract address"
              className="rounded-xl border border-black/15 px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Collaborators</h3>
              <button
                type="button"
                onClick={addCollaborator}
                className="rounded-full border border-black/20 bg-white px-3 py-1 text-xs"
              >
                Add collaborator
              </button>
            </div>
            {collaborators.map((collaborator, index) => (
              <div key={collaborator.id} className="grid gap-2 rounded-xl border border-black/10 p-3 md:grid-cols-12">
                <input
                  required
                  value={collaborator.address}
                  onChange={(event) => updateCollaborator(collaborator.id, { address: event.target.value })}
                  placeholder={`Address #${index + 1}`}
                  className="rounded-lg border border-black/15 px-3 py-2 text-sm md:col-span-5"
                />
                <input
                  required
                  value={collaborator.alias}
                  onChange={(event) => updateCollaborator(collaborator.id, { alias: event.target.value })}
                  placeholder="Alias"
                  className="rounded-lg border border-black/15 px-3 py-2 text-sm md:col-span-3"
                />
                <input
                  required
                  type="number"
                  min={1}
                  max={10_000}
                  value={collaborator.basisPoints}
                  onChange={(event) => updateCollaborator(collaborator.id, { basisPoints: event.target.value })}
                  placeholder="Basis points"
                  className="rounded-lg border border-black/15 px-3 py-2 text-sm md:col-span-3"
                />
                <button
                  type="button"
                  onClick={() => removeCollaborator(collaborator.id)}
                  className="rounded-lg border border-black/20 bg-white px-2 py-2 text-xs md:col-span-1"
                >
                  Remove
                </button>
              </div>
            ))}
            <p className={`text-xs ${totalBasisPoints === 10_000 ? "text-green-700" : "text-red-700"}`}>
              Total basis points: {totalBasisPoints} / 10000
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || totalBasisPoints !== 10_000}
            className="mt-6 rounded-full bg-greenDeep px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create split on testnet"}
          </button>

          {txHash ? (
            <p className="mt-4 text-sm text-green-800">
              Success. Transaction hash: <span className="font-mono">{txHash}</span>
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
