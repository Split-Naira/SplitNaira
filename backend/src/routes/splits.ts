import { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";

import { 
  loadStellarConfig, 
  getStellarRpcServer, 
  RequestValidationError,
  executeWithRetry
} from "../services/stellar.js";

import { 
  AppError, 
  ErrorCode, 
  ErrorType, 
  translateSorobanError 
} from "../lib/errors.js";

export const splitsRouter = Router();

// Strict Stellar address validator used across schemas
export const stellarAddressSchema = z
  .string()
  .min(1, "address is required")
  .superRefine((value, ctx) => {
    try {
      Address.fromString(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a valid Stellar address (classic or contract)"
      });
    }
  });

export const collaboratorSchema = z.object({
  address: stellarAddressSchema,
  alias: z.string().min(1, "alias is required").max(64),
  basisPoints: z
    .number()
    .int("basisPoints must be an integer")
    .positive("basisPoints must be greater than 0")
    .max(10_000, "basisPoints must be <= 10000")
});

export const createSplitSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    projectId: z
      .string()
      .min(1, "projectId is required")
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore"),
    title: z.string().min(1, "title is required").max(128),
    projectType: z.string().min(1, "projectType is required").max(32),
    token: stellarAddressSchema.describe("token"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

export const projectIdParamSchema = z
  .string()
  .min(1, "projectId is required")
  .max(32, "projectId must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore");

export const lockProjectSchema = z.object({
  owner: stellarAddressSchema.describe("owner")
});

export const depositSchema = z.object({
  from: stellarAddressSchema.describe("from"),
  amount: z
    .number()
    .positive("amount must be greater than 0")
    .describe("deposit amount in stroops")
});

export const updateMetadataSchema = z.object({
  owner: stellarAddressSchema.describe("owner"),
  title: z.string().min(1, "title is required").max(128),
  projectType: z.string().min(1, "projectType is required").max(32)
});

export const updateCollaboratorsSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

const adminTokenSchema = z.object({
const adminTokenActionSchema = z.object({
  admin: stellarAddressSchema.describe("admin"),
  token: stellarAddressSchema.describe("token")
});

function toCollaboratorScVal(collaborator: z.infer<typeof collaboratorSchema>) {
const allowlistQuerySchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export function toCollaboratorScVal(collaborator: z.infer<typeof collaboratorSchema>) {
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

async function buildCreateProjectUnsignedXdr(
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

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
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

type AdminTokenActionRequest = z.infer<typeof adminTokenActionSchema>;

async function buildAdminTokenActionUnsignedXdr(
  input: AdminTokenActionRequest,
  operation: "allow_token" | "disallow_token"
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.admin);
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  let adminAddress: Address;
  let tokenAddress: Address;
  try {
    adminAddress = Address.fromString(input.admin);
    tokenAddress = Address.fromString(input.token);
  } catch {
    throw new RequestValidationError("admin and token must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call(operation, adminAddress.toScVal(), tokenAddress.toScVal()))
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.admin,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation
    }
  };
}

async function simulateReadOnlyContractCall(
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

async function listProjects(start: number, limit: number) {
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

  let simulated;
  try {
    simulated = await server.simulateTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  const simulated = await executeWithRetry(() => server.simulateTransaction(tx));
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return [];
  }

  return scValToNative(retval) as unknown[];
}

async function fetchProjectById(projectId: string) {
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

  let simulated;
  try {
    simulated = await server.simulateTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  const simulated = await executeWithRetry(() => server.simulateTransaction(tx));
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return null;
  }

  const project = scValToNative(retval) as unknown;
  return project ?? null;
}

interface LockProjectRequest {
  projectId: string;
  owner: string;
}

async function buildLockProjectUnsignedXdr(input: LockProjectRequest) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

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

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
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

interface DepositRequest {
  projectId: string;
  from: string;
  amount: number;
}

async function buildDepositUnsignedXdr(input: DepositRequest) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

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

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
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

interface UpdateCollaboratorsRequest {
  projectId: string;
  owner: string;
  collaborators: Array<z.infer<typeof collaboratorSchema>>;
}

async function buildUpdateCollaboratorsUnsignedXdr(
  input: UpdateCollaboratorsRequest
) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

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

async function buildUpdateMetadataUnsignedXdr(input: {
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

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
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

export const listProjectsSchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

splitsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const parsed = listProjectsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const projects = await listProjects(parsed.data.start, parsed.data.limit);
    return res.status(200).json(projects);
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;
    const parsedProjectId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedProjectId.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsedProjectId.error.flatten(),
        requestId
      });
    }
    const projectId = parsedProjectId.data;

    const project = await fetchProjectById(projectId);
    if (!project) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `Split project ${projectId} not found.`
      );
    }

    return res.status(200).json(project);
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/lock", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = lockProjectSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check owner address." }
      );
splitsRouter.get("/admin/allowlist", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = allowlistQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid query parameters.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    const { start, limit } = parsed.data;

    try {
      const result = await buildLockProjectUnsignedXdr({
        projectId: projectId,
        owner: parsedBody.data.owner
      const [adminRetval, countRetval, tokensRetval] = await Promise.all([
        simulateReadOnlyContractCall("get_admin"),
        simulateReadOnlyContractCall("get_allowed_token_count"),
        simulateReadOnlyContractCall("get_allowed_tokens", [
          xdr.ScVal.scvU32(start),
          xdr.ScVal.scvU32(limit)
        ])
      ]);

      const adminValue = adminRetval ? scValToNative(adminRetval) : null;
      const countValue = countRetval ? scValToNative(countRetval) : 0;
      const tokensValue = tokensRetval ? scValToNative(tokensRetval) : [];

      return res.status(200).json({
        admin: typeof adminValue === "string" ? adminValue : null,
        allowedTokenCount: Number(countValue ?? 0),
        tokens: Array.isArray(tokensValue) ? tokensValue.map(String) : [],
        start,
        limit
      });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/deposit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = depositSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check deposit details." }
      );
    }

    try {
      const result = await buildDepositUnsignedXdr({
        projectId: projectId,
        from: parsedBody.data.from,
        amount: parsedBody.data.amount
      });
splitsRouter.post("/admin/allow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = adminTokenActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildAdminTokenActionUnsignedXdr(parsed.data, "allow_token");
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.put("/:projectId/collaborators", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = updateCollaboratorsSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check collaborator list." }
      );
    }

    try {
      const result = await buildUpdateCollaboratorsUnsignedXdr({
        projectId: projectId,
        owner: parsedBody.data.owner,
        collaborators: parsedBody.data.collaborators
      });
splitsRouter.post("/admin/disallow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = adminTokenActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildAdminTokenActionUnsignedXdr(parsed.data, "disallow_token");
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/lock", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = createSplitSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check the provided project details." }
      );

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = lockProjectSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        },
        requestId
      });
    }

    try {
      const result = await buildLockProjectUnsignedXdr({
        projectId: parsedParams.data,
        owner: parsedBody.data.owner
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/deposit", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = depositSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        },
        requestId
      });
    }

    try {
      const result = await buildDepositUnsignedXdr({
        projectId: parsedParams.data,
        from: parsedBody.data.from,
        amount: parsedBody.data.amount
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.patch("/:projectId/metadata", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = updateMetadataSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        },
        requestId
      });
    }

    try {
      const result = await buildUpdateMetadataUnsignedXdr({
        projectId: parsedParams.data,
        owner: parsedBody.data.owner,
        title: parsedBody.data.title,
        projectType: parsedBody.data.projectType
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.put("/:projectId/collaborators", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = updateCollaboratorsSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        },
        requestId
      });
    }

    try {
      const result = await buildUpdateCollaboratorsUnsignedXdr({
        projectId: parsedParams.data,
        owner: parsedBody.data.owner,
        collaborators: parsedBody.data.collaborators
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = createSplitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildCreateProjectUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

export const distributeSchema = z.object({
  sourceAddress: z.string().min(1, "sourceAddress is required").optional()
});

splitsRouter.post("/:projectId/distribute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const projectIdRaw = req.params.projectId;
    const projectId = typeof projectIdRaw === "string" ? projectIdRaw.trim() : "";
    if (!projectId) {
      return res.status(400).json({
        error: "validation_error",
        message: "projectId is required",
        requestId
      });
    }
    const projectId = parsedId.data;

    const parsed = distributeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "Invalid request payload.",
        { message: "Check the distribution request body." }
      );
    }

    const config = loadStellarConfig();
    const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

    let sourceAccount;
    const sourceAddress = parsed.data?.sourceAddress || config.simulatorAccount;
    try {
      sourceAccount = await executeWithRetry(() => server.getAccount(sourceAddress));
    } catch {
      throw new AppError(
        ErrorType.ACCOUNT_STATE,
        ErrorCode.ACCOUNT_NOT_FOUND,
        "Source account not found on selected network",
        { message: "The account used to trigger distribution must exist and be funded.", action: "Check Source Wallet" }
      );
    }
    
    let preparedTx;
    try {
      const contract = new Contract(config.contractId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase
      })
        .addOperation(
          contract.call("distribute", nativeToScVal(projectId, { type: "symbol" }))
        )
        .setTimeout(300)
        .build();

      preparedTx = await server.prepareTransaction(tx);
    } catch (error) {
      throw translateSorobanError(error);
    }
    const contract = new Contract(config.contractId);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(
        contract.call("distribute", nativeToScVal(projectId, { type: "symbol" }))
      )
      .setTimeout(300)
      .build();

    const preparedTx = await executeWithRetry(() => server.prepareTransaction(tx));

    return res.status(200).json({
      xdr: preparedTx.toXDR(),
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: sourceAddress,
        operation: "distribute"
      }
    });
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId/claimable/:address", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;
    const { address } = req.params;

    if (!address) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "address is required"
      );
    const { projectId: projectIdRaw, address: addressRaw } = req.params;
    const parsedProjectId = projectIdParamSchema.safeParse(
      typeof projectIdRaw === "string" ? projectIdRaw.trim() : projectIdRaw
    );
    const parsedAddress = stellarAddressSchema.safeParse(
      typeof addressRaw === "string" ? addressRaw.trim() : addressRaw
    );

    if (!parsedProjectId.success || !parsedAddress.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: {
          params: {
            projectId: parsedProjectId.success ? null : parsedProjectId.error.flatten(),
            address: parsedAddress.success ? null : parsedAddress.error.flatten()
          }
        },
        requestId
      });
    }

    const projectId = parsedProjectId.data;
    const address = parsedAddress.data;

    const config = loadStellarConfig();
    const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

    let sourceAccount;
    try {
      sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount));
    } catch {
      throw new AppError(
        ErrorType.ACCOUNT_STATE,
        ErrorCode.ACCOUNT_NOT_FOUND,
        "Simulator account not found",
        { message: "The backend simulator account is not configured correctly." }
      );
    }

    let simulated;
    try {
      const contract = new Contract(config.contractId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase
      })
        .addOperation(
          contract.call(
            "get_claimable",
            nativeToScVal(projectId, { type: "symbol" }),
            Address.fromString(address).toScVal()
          )
        )
        .setTimeout(300)
        .build();

      simulated = await server.simulateTransaction(tx);
    } catch (error) {
      throw translateSorobanError(error);
    }
    const simulated = await executeWithRetry(() => server.simulateTransaction(tx));
    const retval = "result" in simulated ? simulated.result?.retval : undefined;
    if (!retval) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        "Claimable info not found"
      );
    }

    return res.status(200).json(scValToNative(retval));
  } catch (error) {
    return next(error);
  }
});

const adminTokenSchema = z.object({
  admin: stellarAddressSchema.describe("admin"),
  token: stellarAddressSchema.describe("token")
});

interface AdminTokenRequest {
  admin: string;
  token: string;
}

const pauseDistributionsSchema = z.object({
  admin: stellarAddressSchema.describe("admin")
});

interface PauseDistributionsRequest {
  admin: string;
}

async function buildPauseDistributionsUnsignedXdr(input: PauseDistributionsRequest) {
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

async function buildUnpauseDistributionsUnsignedXdr(input: PauseDistributionsRequest) {
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

async function buildAllowTokenUnsignedXdr(input: AdminTokenRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.admin));
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  const args = buildAdminTokenContractArgs(input);

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("allow_token", ...args)
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
      operation: "allow_token"
    }
  };
}

async function buildDisallowTokenUnsignedXdr(input: AdminTokenRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await executeWithRetry(() => server.getAccount(input.admin));
  } catch {
    throw new RequestValidationError("admin account not found on selected network");
  }

  const args = buildAdminTokenContractArgs(input);

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("disallow_token", ...args)
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
      operation: "disallow_token"
    }
  };
}

splitsRouter.post("/admin/allow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildAllowTokenUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/disallow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildDisallowTokenUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/pause-distributions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = pauseDistributionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildPauseDistributionsUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/unpause-distributions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = pauseDistributionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const result = await buildUnpauseDistributionsUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message,
          requestId
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

export const historyQuerySchema = z.object({
  cursor: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

function toEventTopic(value: string) {
  const scVal = nativeToScVal(value, { type: "symbol" });
  return typeof scVal === "object" && scVal !== null && "toXDR" in scVal
    ? scVal.toXDR("base64")
    : scVal;
}

splitsRouter.get("/:projectId/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedQuery = historyQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "Invalid query parameters.",
        { message: "Check cursor and limit parameters." }
      );
    }
    const { cursor, limit } = parsedQuery.data;

    const config = loadStellarConfig();
    const server = getStellarRpcServer();

    const { topicProjectId, roundTopic, paymentTopic } = buildHistoryTopicFilters(projectId);

    const roundEventResponse = await executeWithRetry(() => server.getEvents({
      cursor,
      filters: [
        {
          type: "contract",
          contractIds: [config.contractId],
          topics: [[roundTopic], [topicProjectId]]
        }
      ],
      limit
    }));

    const paymentEventResponse = await executeWithRetry(() => server.getEvents({
      cursor,
      filters: [
        {
          type: "contract",
          contractIds: [config.contractId],
          topics: [[paymentTopic], [topicProjectId]]
        }
      ],
      limit
    }));

    const events = [
      ...roundEventResponse.events.map((e) => {
        const decoded = decodeRoundHistoryEventValue(e.value);
        return {
          type: "round",
          round: decoded.round,
          amount: decoded.amount,
          txHash: e.txHash,
          ledgerCloseTime: e.ledgerClosedAt,
          id: e.id
        };
      }),
      ...paymentEventResponse.events.map((e) => {
        const decoded = decodePaymentHistoryEventValue(e.value);
        return {
          type: "payment",
          recipient: decoded.recipient,
          amount: decoded.amount,
          txHash: e.txHash,
          ledgerCloseTime: e.ledgerClosedAt,
          id: e.id
        };
      })
    ].sort((a, b) => b.ledgerCloseTime.localeCompare(a.ledgerCloseTime));

    // Prefer the server-provided pagination cursor when available
    const nextCursor =
      // soroban-rpc getEvents commonly returns `cursor` for pagination
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((roundEventResponse as any)?.cursor as string | undefined) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((paymentEventResponse as any)?.cursor as string | undefined) ||
      null;

    return res.status(200).json({
      items: events,
      nextCursor
    });
  } catch (error) {
    return next(error);
  }
});

async function buildAdminTokenXdr(
  operation: "allow_token" | "disallow_token",
  input: z.infer<typeof adminTokenSchema>
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let adminAccount;
  try {
    adminAccount = await server.getAccount(input.admin);
  } catch {
    throw new AppError(
      ErrorType.VALIDATION,
      ErrorCode.VALIDATION_ERROR,
      "admin account not found on selected network"
    );
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        operation,
        new Address(input.admin).toScVal(),
        new Address(input.token).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

splitsRouter.post("/admin/allow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const xdr = await buildAdminTokenXdr("allow_token", parsed.data);
    const config = loadStellarConfig();

    return res.status(200).json({
      xdr,
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: parsed.data.admin,
        operation: "allow_token"
      }
    });
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/disallow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const xdr = await buildAdminTokenXdr("disallow_token", parsed.data);
    const config = loadStellarConfig();

    return res.status(200).json({
      xdr,
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: parsed.data.admin,
        operation: "disallow_token"
      }
    });
  } catch (error) {
    return next(error);
  }
});
