"use client";

import * as Sentry from "@sentry/nextjs";
import { rpc, Transaction, type FeeBumpTransaction } from "@stellar/stellar-sdk";

import { formatContractFailure } from "./contract-errors";
import { getEnv } from "./env";

const DEFAULT_POLL_ATTEMPTS = Number(getEnv().NEXT_PUBLIC_TX_POLL_TIMEOUT) || 90;

/** Matches Soroban RPC `getTransaction` status strings (see @stellar/stellar-sdk rpc.Api.GetTransactionStatus). */
const GET_TX = {
  NOT_FOUND: "NOT_FOUND",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED"
} as const;

export function createSorobanRpcServer(): rpc.Server {
  return new rpc.Server(getEnv().NEXT_PUBLIC_SOROBAN_RPC_URL, { allowHttp: true });
}

function submissionErrorMessage(submit: rpc.Api.SendTransactionResponse): string {
  if (submit.status === "ERROR") {
    return submit.errorResult?.toString() ?? "Transaction rejected by the network.";
  }
  if (submit.status === "TRY_AGAIN_LATER") {
    return "The RPC node is busy. Please wait a moment and try again.";
  }
  return `Unexpected submission status: ${submit.status}`;
}

function ledgerFailureMessage(polled: rpc.Api.GetTransactionResponse): string {
  if (polled.status === GET_TX.FAILED && "resultXdr" in polled && polled.resultXdr) {
    try {
      const raw = polled.resultXdr.toString();
      return formatContractFailure(
        raw,
        "Transaction failed on ledger (see explorer for details)."
      );
    } catch {
      /* fall through */
    }
  }
  return "Transaction failed on ledger (see explorer for details).";
}

/**
 * Submits a signed Soroban transaction, then polls until the RPC reports a
 * terminal ledger outcome (success, failure, or poll timeout).
 */
export async function submitSorobanTransactionAndPoll(
  server: rpc.Server,
  transaction: Transaction | FeeBumpTransaction,
  options?: {
    pollAttempts?: number;
    /** Invoked as soon as the RPC accepts the tx (hash known), before polling completes. */
    afterSubmitted?: (hash: string) => void;
  }
): Promise<{ hash: string }> {
  const submit = await server.sendTransaction(transaction);

  if (submit.status === "ERROR" || submit.status === "TRY_AGAIN_LATER") {
    const errorMsg = submissionErrorMessage(submit);
    const err = new Error(errorMsg);
    Sentry.captureException(err, {
      tags: {
        section: "soroban-transaction",
        action: "submit",
        status: submit.status,
      },
      extra: {
        txHash: submit.hash,
        errorResultXdr: submit.errorResult?.toXDR?.() ?? submit.errorResult,
      }
    });
    throw err;
  }

  const hash = submit.hash;
  if (!hash) {
    const err = new Error("Submission did not return a transaction hash.");
    Sentry.captureException(err, {
      tags: {
        section: "soroban-transaction",
        action: "submit",
      }
    });
    throw err;
  }

  options?.afterSubmitted?.(hash);

  const polled = await server.pollTransaction(hash, {
    attempts: options?.pollAttempts ?? DEFAULT_POLL_ATTEMPTS
  });

  if (polled.status === GET_TX.NOT_FOUND) {
    const error = new Error(
      "Transaction was submitted but not confirmed in time. Check the explorer for the latest status."
    );
    error.name = "TimeoutError";
    throw error;
  }

  if (polled.status === GET_TX.FAILED) {
    const errorMsg = ledgerFailureMessage(polled);
    const err = new Error(errorMsg);
    Sentry.captureException(err, {
      tags: {
        section: "soroban-transaction",
        action: "poll",
        status: polled.status,
      },
      extra: {
        txHash: hash,
        resultXdr: polled.resultXdr?.toXDR?.() ?? polled.resultXdr,
      }
    });
    throw err;
  }

  if (polled.status === GET_TX.SUCCESS) {
    return { hash };
  }

  const err = new Error(`Unexpected transaction status: ${String((polled as { status: string }).status)}`);
  Sentry.captureException(err, {
    tags: {
      section: "soroban-transaction",
      action: "poll",
      status: String((polled as { status: string }).status),
    },
    extra: {
      txHash: hash,
    }
  });
  throw err;
}
