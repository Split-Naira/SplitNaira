"use client";

import * as Sentry from "@sentry/nextjs";
import { rpc, Transaction, type FeeBumpTransaction } from "@stellar/stellar-sdk";

import { classifySimulationFailure, formatContractFailure } from "./contract-errors";
import { getEnv } from "./env";
import {
  RpcResponseValidationError,
  installRpcResponseValidation,
  parseGetTransactionResponse,
  parseSendTransactionResponse,
} from "./stellar-rpc-validation";

const DEFAULT_POLL_ATTEMPTS = Number(getEnv().NEXT_PUBLIC_TX_POLL_TIMEOUT) || 90;

/** Matches Soroban RPC `getTransaction` status strings (see @stellar/stellar-sdk rpc.Api.GetTransactionStatus). */
const GET_TX = {
  NOT_FOUND: "NOT_FOUND",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED"
} as const;

export function createSorobanRpcServer(): rpc.Server {
  const server = new rpc.Server(getEnv().NEXT_PUBLIC_SOROBAN_RPC_URL, { allowHttp: true });
  // Issue #1494: validate every JSON-RPC response before the SDK parses it.
  installRpcResponseValidation(server);
  return server;
}

function submissionErrorMessage(submit: rpc.Api.SendTransactionResponse): string {
  if (submit.status === "ERROR") {
    // Issue #1495: map the raw `errorResult` to a stable category so callers can
    // branch on it, and show the user what to do rather than a host protocol
    // string like `HostError: Error(Contract, #1)`.
    const classified = classifySimulationFailure(submit.errorResult?.toString() ?? null);
    if (classified.category === "unknown") {
      // Unmapped: the original text is more useful than the generic message,
      // and it is what the pre-existing behaviour showed.
      return submit.errorResult?.toString() ?? "Transaction rejected by the network.";
    }
    return `${classified.message} (${classified.diagnostic})`;
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

/** Reports a malformed RPC response without its payload: method and field paths only. */
function reportInvalidRpcResponse(error: RpcResponseValidationError, action: string, txHash?: string): void {
  Sentry.captureException(error, {
    tags: {
      section: "soroban-transaction",
      action,
      method: error.method,
    },
    extra: {
      txHash,
      fields: error.issues.map((issue) => issue.path),
    },
  });
}

/**
 * The transaction may have reached the network but its outcome is unknown.
 * Named `TimeoutError` so `isUnconfirmedSubmission` keeps the action blocked
 * until the outcome is resolved, exactly as for a poll timeout.
 */
function unconfirmedSubmissionError(cause: unknown): Error {
  const error = new Error(
    "Transaction was submitted but its status could not be verified. Check the explorer for the latest status.",
    { cause }
  );
  error.name = "TimeoutError";
  return error;
}

function localTransactionHash(transaction: Transaction | FeeBumpTransaction): string | null {
  try {
    return typeof transaction?.hash === "function" ? transaction.hash().toString("hex") : null;
  } catch {
    return null;
  }
}

/**
 * Throws unless the RPC accepted the submission (`PENDING` or `DUPLICATE`
 * with a valid hash). A rejected (`ERROR`) or deferred (`TRY_AGAIN_LATER`)
 * submission is never treated as success.
 */
function assertSubmissionAccepted(
  submit: rpc.Api.SendTransactionResponse
): asserts submit is rpc.Api.SendTransactionResponse & { status: "PENDING" | "DUPLICATE" } {
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
}

/**
 * Submits a signed Soroban transaction without waiting for the ledger
 * outcome. Resolves only when the RPC accepted it; throws on rejection,
 * `TRY_AGAIN_LATER`, or a malformed response (`RpcResponseValidationError`).
 */
export async function sendSorobanTransaction(
  server: rpc.Server,
  transaction: Transaction | FeeBumpTransaction
): Promise<{ hash: string }> {
  let submit: rpc.Api.SendTransactionResponse;
  try {
    submit = await server.sendTransaction(transaction);
    parseSendTransactionResponse(submit);
  } catch (error) {
    if (error instanceof RpcResponseValidationError) {
      reportInvalidRpcResponse(error, "submit", localTransactionHash(transaction) ?? undefined);
    }
    throw error;
  }
  assertSubmissionAccepted(submit);
  return { hash: submit.hash };
}

/**
 * Submits a signed Soroban transaction, then polls until the RPC reports a
 * terminal ledger outcome (success, failure, or poll timeout).
 *
 * Issue #1494: a malformed RPC response after the transaction may have
 * reached the network is reported as an unconfirmed submission (see
 * `unconfirmedSubmissionError`), never as success and never as a plain
 * failure that would invite a second payment.
 */
export async function submitSorobanTransactionAndPoll(
  server: rpc.Server,
  transaction: Transaction | FeeBumpTransaction,
  options?: {
    pollAttempts?: number;
    /** Invoked as soon as the RPC accepts the tx (hash known), before polling completes. */
    afterSubmitted?: (hash: string) => void | Promise<void>;
  }
): Promise<{ hash: string }> {
  let submit: rpc.Api.SendTransactionResponse;
  try {
    submit = await server.sendTransaction(transaction);
    parseSendTransactionResponse(submit);
  } catch (error) {
    const localHash = localTransactionHash(transaction);
    if (error instanceof RpcResponseValidationError) {
      reportInvalidRpcResponse(error, "submit", localHash ?? undefined);
    }
    if (!localHash) throw error;
    // The RPC may have accepted it: track it by its own hash so the caller
    // keeps the action blocked until the outcome is known.
    await options?.afterSubmitted?.(localHash);
    throw unconfirmedSubmissionError(error);
  }

  assertSubmissionAccepted(submit);
  const hash = submit.hash;

  await options?.afterSubmitted?.(hash);

  let polled: rpc.Api.GetTransactionResponse;
  try {
    polled = await server.pollTransaction(hash, {
      attempts: options?.pollAttempts ?? DEFAULT_POLL_ATTEMPTS
    });
    parseGetTransactionResponse(polled);
  } catch (error) {
    if (error instanceof RpcResponseValidationError) {
      reportInvalidRpcResponse(error, "poll", hash);
    }
    throw unconfirmedSubmissionError(error);
  }

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

  // Unreachable: the status was validated above. Kept so an unexpected
  // status can never fall through to success.
  throw unconfirmedSubmissionError(new Error("Unknown transaction status"));
}
