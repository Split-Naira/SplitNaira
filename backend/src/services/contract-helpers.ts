import { z } from "zod";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { collaboratorSchema, createSplitSchema } from "../schemas/splits.js";
import { RequestValidationError } from "./stellar.js";

export interface UpdateCollaboratorsRequest {
  projectId: string;
  owner: string;
  collaborators: Array<z.infer<typeof collaboratorSchema>>;
}

export interface LockProjectRequest {
  projectId: string;
  owner: string;
}

export interface DepositRequest {
  projectId: string;
  from: string;
  amount: number;
  token: string;
}

export interface AdminTokenRequest {
  admin: string;
  token: string;
}

export function toCollaboratorScVal(collaborator: z.infer<typeof collaboratorSchema>) {
  // The 100-character limit aligns with the on-chain constant (CON-025)
  // to prevent silent truncation or XDR encoding errors.
  if (collaborator.alias.length > 100) {
    throw new Error("Alias too long");
  }

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal("address", { type: "symbol" }),
      val: Address.fromString(collaborator.address).toScVal()
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal("alias", { type: "symbol" }),
      val: nativeToScVal(collaborator.alias)
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal("basis_points", { type: "symbol" }),
      val: xdr.ScVal.scvU32(collaborator.basisPoints)
    })
  ]);
}

export function buildCreateProjectContractArgs(
  input: z.infer<typeof createSplitSchema>
): xdr.ScVal[] {
  const ownerAddress = Address.fromString(input.owner);
  const tokenAddress = Address.fromString(input.token);
  const collaboratorScVals = input.collaborators.map((collaborator) =>
    toCollaboratorScVal(collaborator)
  );

  return [
    ownerAddress.toScVal(),
    nativeToScVal(input.projectId, { type: "symbol" }),
    nativeToScVal(input.title),
    nativeToScVal(input.projectType),
    tokenAddress.toScVal(),
    xdr.ScVal.scvVec(collaboratorScVals)
  ];
}

export function buildUpdateCollaboratorsContractArgs(
  input: UpdateCollaboratorsRequest
): xdr.ScVal[] {
  const ownerAddress = Address.fromString(input.owner);
  const collaboratorScVals = input.collaborators.map((collaborator) =>
    toCollaboratorScVal(collaborator)
  );

  return [
    nativeToScVal(input.projectId, { type: "symbol" }),
    ownerAddress.toScVal(),
    xdr.ScVal.scvVec(collaboratorScVals)
  ];
}

export function buildLockProjectContractArgs(input: LockProjectRequest): xdr.ScVal[] {
  const ownerAddress = Address.fromString(input.owner);
  return [
    nativeToScVal(input.projectId, { type: "symbol" }),
    ownerAddress.toScVal()
  ];
}

export function buildDepositContractArgs(input: DepositRequest): xdr.ScVal[] {
  const fromAddress = Address.fromString(input.from);
  return [
    nativeToScVal(input.projectId, { type: "symbol" }),
    fromAddress.toScVal(),
    nativeToScVal(input.amount, { type: "i128" })
  ];
}

export function buildAdminTokenContractArgs(input: AdminTokenRequest): xdr.ScVal[] {
  const adminAddress = Address.fromString(input.admin);
  const tokenAddress = Address.fromString(input.token);
  return [adminAddress.toScVal(), tokenAddress.toScVal()];
}

export function parseStellarAddress(address: string, label: string): Address {
  try {
    return Address.fromString(address);
  } catch {
    throw new RequestValidationError(`${label} must be a valid Stellar address`);
  }
}

export function buildHistoryTopicFilters(projectId: string) {
  const encodeSymbolTopic = (value: string) => {
    const scVal = nativeToScVal(value, { type: "symbol" }) as unknown as {
      toXDR?: (format: "base64") => string;
    };
    if (typeof scVal?.toXDR === "function") {
      return scVal.toXDR("base64");
    }
    return String(value);
  };

  const topicProjectId = encodeSymbolTopic(projectId);
  const roundTopic = encodeSymbolTopic("distribution_complete");
  const paymentTopic = encodeSymbolTopic("payment_sent");
  return { topicProjectId, roundTopic, paymentTopic };
}

export function decodeRoundHistoryEventValue(value: xdr.ScVal) {
  const data = scValToNative(value) as [number | bigint, string | number | bigint];
  return {
    round: Number(data[0]),
    amount: String(data[1])
  };
}

export function decodePaymentHistoryEventValue(value: xdr.ScVal) {
  const data = scValToNative(value) as [string, string | number | bigint];
  return {
    recipient: data[0],
    amount: String(data[1])
  };
}
