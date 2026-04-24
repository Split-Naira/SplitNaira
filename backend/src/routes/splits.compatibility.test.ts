import { describe, expect, it } from "vitest";
import { Address, Keypair, StrKey, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";

import {
  buildAdminTokenContractArgs,
  buildCreateProjectContractArgs,
  buildHistoryTopicFilters,
  buildUpdateCollaboratorsContractArgs,
  decodePaymentHistoryEventValue,
  decodeRoundHistoryEventValue,
  stellarAddressSchema,
  toCollaboratorScVal
} from "./splits.js";

function makeContractAddress(): string {
  return StrKey.encodeContract(Buffer.alloc(32, 7));
}

describe("backend-contract compatibility", () => {
  it("encodes create_project args with contract-compatible ScVal layout", () => {
    const owner = Keypair.random().publicKey();
    const token = makeContractAddress();
    const collaboratorA = Keypair.random().publicKey();
    const collaboratorB = Keypair.random().publicKey();

    const args = buildCreateProjectContractArgs({
      owner,
      projectId: "compat_create",
      title: "Compatibility Create",
      projectType: "music",
      token,
      collaborators: [
        { address: collaboratorA, alias: "A", basisPoints: 6000 },
        { address: collaboratorB, alias: "B", basisPoints: 4000 }
      ]
    });

    expect(args).toHaveLength(6);
    expect(scValToNative(args[1])).toBe("compat_create");
    expect(scValToNative(args[2])).toBe("Compatibility Create");
    expect(scValToNative(args[3])).toBe("music");

    const encodedCollaborators = scValToNative(args[5]) as Array<Record<string, unknown>>;
    expect(encodedCollaborators).toHaveLength(2);
    expect(encodedCollaborators[0]).toMatchObject({
      alias: "A",
      basis_points: 6000
    });
  });

  it("encodes update_collaborators args with symbol project id and collaborator vector", () => {
    const owner = Keypair.random().publicKey();
    const collaboratorA = Keypair.random().publicKey();
    const collaboratorB = Keypair.random().publicKey();

    const args = buildUpdateCollaboratorsContractArgs({
      projectId: "compat_update",
      owner,
      collaborators: [
        { address: collaboratorA, alias: "A", basisPoints: 5000 },
        { address: collaboratorB, alias: "B", basisPoints: 5000 }
      ]
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[0])).toBe("compat_update");

    const encodedCollaborators = scValToNative(args[2]) as Array<Record<string, unknown>>;
    expect(encodedCollaborators).toHaveLength(2);
    expect(encodedCollaborators[1]).toMatchObject({
      alias: "B",
      basis_points: 5000
    });
  });

  it("encodes admin allow/disallow address args as valid Address ScVal values", () => {
    const admin = Keypair.random().publicKey();
    const token = makeContractAddress();

    const args = buildAdminTokenContractArgs({ admin, token });
    expect(args).toHaveLength(2);

    // Ensure both values round-trip through Address encoding/decoding.
    expect(Address.fromScVal(args[0]).toString()).toBe(admin);
    expect(Address.fromScVal(args[1]).toString()).toBe(token);
  });

  it("encodes history topics and decodes round/payment event payloads", () => {
    const topics = buildHistoryTopicFilters("compat_history");
    expect(topics.roundTopic).toBe(
      nativeToScVal("distribution_complete", { type: "symbol" }).toXDR("base64")
    );
    expect(topics.paymentTopic).toBe(
      nativeToScVal("payment_sent", { type: "symbol" }).toXDR("base64")
    );
    expect(topics.topicProjectId).toBe(
      nativeToScVal("compat_history", { type: "symbol" }).toXDR("base64")
    );

    const roundDecoded = decodeRoundHistoryEventValue(nativeToScVal([2, BigInt(1234)]));
    expect(roundDecoded).toEqual({ round: 2, amount: "1234" });

    const recipient = Keypair.random().publicKey();
    const paymentDecoded = decodePaymentHistoryEventValue(
      nativeToScVal([recipient, BigInt(2500)])
    );
    expect(paymentDecoded).toEqual({ recipient, amount: "2500" });
  });

  it("validates classic and contract addresses while rejecting malformed values", () => {
    const classicAddress = Keypair.random().publicKey();
    const contractAddress = makeContractAddress();

    expect(stellarAddressSchema.safeParse(classicAddress).success).toBe(true);
    expect(stellarAddressSchema.safeParse(contractAddress).success).toBe(true);
    expect(stellarAddressSchema.safeParse("not-an-address").success).toBe(false);
    expect(stellarAddressSchema.safeParse(" ").success).toBe(false);
  });

  it("produces collaborator map entries contract can parse with expected keys", () => {
    const collaborator = {
      address: Keypair.random().publicKey(),
      alias: "Alias",
      basisPoints: 7777
    };

    const encoded = toCollaboratorScVal(collaborator);
    const decoded = scValToNative(encoded) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      alias: "Alias",
      basis_points: 7777
    });
    expect(typeof decoded.address).toBe("string");
  });
});
