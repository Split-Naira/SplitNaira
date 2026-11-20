/**
 * Issue #1494: submission flows never treat a malformed or unknown RPC
 * status as success, and a malformed response after the transaction may
 * have reached the network is reported as unconfirmed (so the UI keeps the
 * action blocked instead of inviting a second payment).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Networks, Operation, TransactionBuilder, type rpc } from "@stellar/stellar-sdk";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), init: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { sendSorobanTransaction, submitSorobanTransactionAndPoll } from "./soroban-transaction";
import { RpcResponseValidationError } from "./stellar-rpc-validation";
import { isUnconfirmedSubmission } from "./submission-guard";

const HASH = "ab".repeat(32);
// Fixed, valid public key: Keypair.random() does not work under jsdom.
const SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function signedTransaction() {
  return new TransactionBuilder(new Account(SOURCE, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(30)
    .build();
}

function server(send: unknown, poll?: unknown) {
  return {
    sendTransaction: vi.fn().mockResolvedValue(send),
    pollTransaction: vi.fn().mockResolvedValue(poll),
  } as unknown as rpc.Server & {
    sendTransaction: ReturnType<typeof vi.fn>;
    pollTransaction: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendSorobanTransaction", () => {
  it.each(["PENDING", "DUPLICATE"])("resolves with the hash for an accepted %s submission", async (status) => {
    await expect(sendSorobanTransaction(server({ status, hash: HASH }), signedTransaction())).resolves.toEqual({
      hash: HASH,
    });
  });

  it("throws for ERROR", async () => {
    await expect(
      sendSorobanTransaction(server({ status: "ERROR", hash: HASH, errorResult: "tx_bad_seq" }), signedTransaction()),
    ).rejects.toThrow("tx_bad_seq");
  });

  it("throws for TRY_AGAIN_LATER instead of reporting success", async () => {
    await expect(
      sendSorobanTransaction(server({ status: "TRY_AGAIN_LATER", hash: HASH }), signedTransaction()),
    ).rejects.toThrow(/busy/);
  });

  it.each([
    ["a missing status", { hash: HASH }],
    ["an unknown status", { status: "SUCCESS", hash: HASH }],
    ["a PENDING response without a hash", { status: "PENDING" }],
    ["a PENDING response with a malformed hash", { status: "PENDING", hash: "HASH_1" }],
    ["an empty response", undefined],
  ])("throws a typed validation error for %s", async (_label, response) => {
    await expect(sendSorobanTransaction(server(response), signedTransaction())).rejects.toBeInstanceOf(
      RpcResponseValidationError,
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(RpcResponseValidationError),
      expect.objectContaining({ tags: expect.objectContaining({ method: "sendTransaction" }) }),
    );
  });
});

describe("submitSorobanTransactionAndPoll", () => {
  it("resolves on a validated SUCCESS", async () => {
    const afterSubmitted = vi.fn();
    const rpcServer = server({ status: "PENDING", hash: HASH }, { status: "SUCCESS", txHash: HASH });

    await expect(submitSorobanTransactionAndPoll(rpcServer, signedTransaction(), { afterSubmitted })).resolves.toEqual({
      hash: HASH,
    });
    expect(afterSubmitted).toHaveBeenCalledWith(HASH);
  });

  it("waits for durable submission metadata to be recorded before polling", async () => {
    const order: string[] = [];
    const rpcServer = server({ status: "PENDING", hash: HASH }, { status: "SUCCESS", txHash: HASH });
    rpcServer.pollTransaction.mockImplementation(async () => {
      order.push("poll");
      return { status: "SUCCESS", txHash: HASH };
    });

    await submitSorobanTransactionAndPoll(rpcServer, signedTransaction(), {
      afterSubmitted: async () => {
        await Promise.resolve();
        order.push("persist");
      },
    });

    expect(order).toEqual(["persist", "poll"]);
  });

  it.each([
    ["a lowercase status", { status: "success" }],
    ["an unknown status", { status: "CONFIRMED" }],
    ["a missing status", {}],
    ["no response", undefined],
  ])("reports %s from polling as unconfirmed, never as success", async (_label, polled) => {
    const afterSubmitted = vi.fn();
    const rpcServer = server({ status: "PENDING", hash: HASH }, polled);

    const error = await submitSorobanTransactionAndPoll(rpcServer, signedTransaction(), { afterSubmitted }).catch(
      (e: unknown) => e,
    );

    expect(isUnconfirmedSubmission(error)).toBe(true);
    expect(afterSubmitted).toHaveBeenCalledWith(HASH);
  });

  it("treats a validation error raised while polling as unconfirmed", async () => {
    const rpcServer = server({ status: "PENDING", hash: HASH });
    rpcServer.pollTransaction.mockRejectedValue(new RpcResponseValidationError("getTransaction", []));

    const error = await submitSorobanTransactionAndPoll(rpcServer, signedTransaction()).catch((e: unknown) => e);

    expect(isUnconfirmedSubmission(error)).toBe(true);
  });

  it("keeps a malformed send response blocked under the locally computed transaction hash", async () => {
    const afterSubmitted = vi.fn();
    const transaction = signedTransaction();
    const rpcServer = server({ status: "PENDING" });

    const error = await submitSorobanTransactionAndPoll(rpcServer, transaction, { afterSubmitted }).catch(
      (e: unknown) => e,
    );

    expect(isUnconfirmedSubmission(error)).toBe(true);
    expect(afterSubmitted).toHaveBeenCalledWith(transaction.hash().toString("hex"));
    expect(rpcServer.pollTransaction).not.toHaveBeenCalled();
  });

  it("does not poll or report success when the send response is malformed and no hash can be derived", async () => {
    const afterSubmitted = vi.fn();
    const rpcServer = server({ status: "WHATEVER" });

    await expect(
      submitSorobanTransactionAndPoll(rpcServer, {} as never, { afterSubmitted }),
    ).rejects.toBeInstanceOf(RpcResponseValidationError);
    expect(afterSubmitted).not.toHaveBeenCalled();
    expect(rpcServer.pollTransaction).not.toHaveBeenCalled();
  });

  it("treats a send network error as unconfirmed when the transaction hash is known", async () => {
    const rpcServer = server(undefined);
    rpcServer.sendTransaction.mockRejectedValue(new Error("Network Error"));

    const afterSubmitted = vi.fn();
    const transaction = signedTransaction();
    const error = await submitSorobanTransactionAndPoll(
      rpcServer,
      transaction,
      { afterSubmitted },
    ).catch((caught: unknown) => caught);

    expect(isUnconfirmedSubmission(error)).toBe(true);
    expect(afterSubmitted).toHaveBeenCalledWith(
      transaction.hash().toString("hex"),
    );
  });
});
