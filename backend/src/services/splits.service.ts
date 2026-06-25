import { z } from "zod";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  rpc
} from "@stellar/stellar-sdk";

import {
  loadStellarConfig,
  getStellarRpcServer,
  RequestValidationError,
  executeWithRetry,
  getCached,
  setCached,
  type UnsignedTxResponse
} from "./stellar.js";

import {
  createSplitSchema
} from "../schemas/splits.js";

import {
  buildCreateProjectContractArgs,
  buildUpdateCollaboratorsContractArgs,
  buildLockProjectContractArgs,
  buildDepositContractArgs,
  buildAdminTokenContractArgs,
  parseStellarAddress,
  type LockProjectRequest,
  type DepositRequest,
  type UpdateCollaboratorsRequest,
  type AdminTokenRequest
} from "./contract-helpers.js";

export function serializeBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}

export async function buildUnsignedContractCall(input: {
  sourceAddress: string;
  sourceRoleLabel: string;
  operation: string;
  args: xdr.ScVal[];
}): Promise<UnsignedTxResponse> {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.sourceAddress));
  } catch {
    throw new RequestValidationError(`${input.sourceRoleLabel} account not found on selected network`);
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call(input.operation, ...input.args))
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));

  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.sourceAddress,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: input.operation
    }
  };
}

export async function buildCreateProjectUnsignedXdr(
  input: z.infer<typeof createSplitSchema>
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.owner));
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let args: xdr.ScVal[];
  try {
    args = buildCreateProjectContractArgs(input);
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("create_project", ...args)
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));

  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "create_project"
    }
  };
}

export async function simulateReadOnlyContractCall(
  method: string,
  args: xdr.ScVal[] = []
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(config.simulatorAccount);
  } catch {
    throw new RequestValidationError("simulator account not found on selected network");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const simulated = await server.simulateTransaction(tx);
  return "result" in simulated ? simulated.result?.retval : undefined;
}

export async function fetchProjectsFromContract(start: number, limit: number) {
  const cacheKey = `list_projects:${start}:${limit}`;
  const cached = getCached<unknown[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount));
  } catch {
    throw new RequestValidationError("simulator account not found on selected network");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("list_projects", xdr.ScVal.scvU32(start), xdr.ScVal.scvU32(limit))
    )
    .setTimeout(300)
    .build();

  const simulated = await executeWithRetry(() => server.simulateTransaction(tx));
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return [];
  }

  const result = scValToNative(retval) as unknown[];
  setCached(cacheKey, result);
  return result;
}

export async function listProjects(
  start: number,
  limit: number,
  search?: string,
  type?: string,
) {
  if (!search && !type) {
    return fetchProjectsFromContract(start, limit);
  }

  const maxFetch = 1000;
  const allProjects = await fetchProjectsFromContract(0, maxFetch);

  let filtered: unknown[] = allProjects;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((p) => {
      const row = p as Record<string, unknown>;
      return (
        String(row.title ?? "").toLowerCase().includes(q) ||
        String(row.projectId ?? "").toLowerCase().includes(q)
      );
    });
  }
  if (type) {
    const t = type.toLowerCase();
    filtered = filtered.filter((p) => {
      const row = p as Record<string, unknown>;
      return String(row.projectType ?? "").toLowerCase() === t;
    });
  }

  return filtered.slice(start, start + limit);
}

export async function fetchProjectById(projectId: string) {
  const cacheKey = `project:${projectId}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount));
  } catch {
    throw new RequestValidationError("simulator account not found on selected network");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call("get_project", nativeToScVal(projectId, { type: "symbol" })))
    .setTimeout(300)
    .build();

  const simulated = await executeWithRetry(() => server.simulateTransaction(tx));
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return null;
  }

  const project = scValToNative(retval) as unknown;
  const result = project ?? null;
  if (result !== null) {
    setCached(cacheKey, result);
  }
  return result;
}

export async function buildLockProjectUnsignedXdr(input: LockProjectRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.owner));
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let args: xdr.ScVal[];
  try {
    args = buildLockProjectContractArgs(input);
  } catch {
    throw new RequestValidationError("owner address must be a valid Stellar address");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("lock_project", ...args)
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "lock_project"
    }
  };
}

export async function buildDepositUnsignedXdr(input: DepositRequest) {
  const project = await fetchProjectById(input.projectId);
  if (!project) {
    throw new RequestValidationError("Project not found");
  }
  const projectRecord = project as Record<string, unknown>;
  if (projectRecord.token !== input.token) {
    throw new RequestValidationError("Token address does not match project token address");
  }

  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.from));
  } catch {
    throw new RequestValidationError("from account not found on selected network");
  }

  let args: xdr.ScVal[];
  try {
    args = buildDepositContractArgs(input);
  } catch {
    throw new RequestValidationError("from address must be a valid Stellar address");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("deposit", ...args)
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.from,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "deposit"
    }
  };
}

export async function buildUpdateCollaboratorsUnsignedXdr(
  input: UpdateCollaboratorsRequest
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.owner));
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let args: xdr.ScVal[];
  try {
    args = buildUpdateCollaboratorsContractArgs(input);
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("update_collaborators", ...args)
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "update_collaborators"
    }
  };
}

export async function buildUpdateMetadataUnsignedXdr(input: {
  projectId: string;
  owner: string;
  title: string;
  projectType: string;
}) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.owner));
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let ownerAddress: Address;
  try {
    ownerAddress = Address.fromString(input.owner);
  } catch {
    throw new RequestValidationError("owner address must be a valid Stellar address");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "update_project_metadata",
        nativeToScVal(input.projectId, { type: "symbol" }),
        ownerAddress.toScVal(),
        nativeToScVal(input.title),
        nativeToScVal(input.projectType)
      )
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "update_project_metadata"
    }
  };
}

export interface PauseDistributionsRequest {
  admin: string;
}

export async function buildPauseDistributionsUnsignedXdr(input: PauseDistributionsRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.admin));
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  const adminAddress = Address.fromString(input.admin);
  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call("pause_distributions", adminAddress.toScVal()))
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.admin,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "pause_distributions"
    }
  };
}

export async function buildUnpauseDistributionsUnsignedXdr(input: PauseDistributionsRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.admin));
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  const adminAddress = Address.fromString(input.admin);
  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call("unpause_distributions", adminAddress.toScVal()))
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.admin,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "unpause_distributions"
    }
  };
}

export async function buildAllowTokenUnsignedXdr(
  input: AdminTokenRequest
): Promise<UnsignedTxResponse> {
  parseStellarAddress(input.admin, "admin address");
  parseStellarAddress(input.token, "token address");
  const args = buildAdminTokenContractArgs(input);

  return buildUnsignedContractCall({
    sourceAddress: input.admin,
    sourceRoleLabel: "admin",
    operation: "allow_token",
    args
  });
}

export async function buildDisallowTokenUnsignedXdr(
  input: AdminTokenRequest
): Promise<UnsignedTxResponse> {
  parseStellarAddress(input.admin, "admin address");
  parseStellarAddress(input.token, "token address");
  const args = buildAdminTokenContractArgs(input);

  return buildUnsignedContractCall({
    sourceAddress: input.admin,
    sourceRoleLabel: "admin",
    operation: "disallow_token",
    args
  });
}

export interface WithdrawUnallocatedRequest {
  admin: string;
  token: string;
  to: string;
  amount: number;
}

export async function buildWithdrawUnallocatedUnsignedXdr(input: WithdrawUnallocatedRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.admin));
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  const adminAddress = Address.fromString(input.admin);
  const tokenAddress = Address.fromString(input.token);
  const toAddress = Address.fromString(input.to);

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "withdraw_unallocated",
        adminAddress.toScVal(),
        tokenAddress.toScVal(),
        toAddress.toScVal(),
        nativeToScVal(input.amount, { type: "i128" })
      )
    )
    .setTimeout(300)
    .build();

  const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.admin,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "withdraw_unallocated",
      auditContext: {
        token: input.token,
        destination: input.to,
        amount: input.amount,
        initiatedAt: new Date().toISOString()
      }
    }
  };
}

// ============================================================
// Wave 5: self-service claim
// ============================================================

export interface ClaimRequest {
  projectId: string;
  claimer: string;
}

/**
 * Builds an unsigned XDR transaction for the `claim` contract function.
 *
 * The `claim` function is the pull-based counterpart to `distribute`:
 * a collaborator calls it to withdraw their proportional share of the
 * current project balance at their own cadence.
 */
export async function buildClaimUnsignedXdr(input: ClaimRequest) {
  const { parseStellarAddress } = await import("./contract-helpers.js");
  parseStellarAddress(input.claimer, "claimer address");

  return buildUnsignedContractCall({
    sourceAddress: input.claimer,
    sourceRoleLabel: "claimer",
    operation: "claim",
    args: [
      nativeToScVal(input.projectId, { type: "symbol" }),
      Address.fromString(input.claimer).toScVal()
    ]
  });
}