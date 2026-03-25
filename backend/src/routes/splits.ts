import { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr
} from "@stellar/stellar-sdk";

import { loadStellarConfig, RequestValidationError } from "../services/stellar.js";

export const splitsRouter = Router();

const collaboratorSchema = z.object({
  address: z.string().min(1, "address is required"),
  alias: z.string().min(1, "alias is required").max(64),
  basisPoints: z
    .number()
    .int("basisPoints must be an integer")
    .positive("basisPoints must be greater than 0")
    .max(10_000, "basisPoints must be <= 10000")
});

const createSplitSchema = z
  .object({
    owner: z.string().min(1, "owner is required"),
    projectId: z
      .string()
      .min(1, "projectId is required")
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore"),
    title: z.string().min(1, "title is required").max(128),
    projectType: z.string().min(1, "projectType is required").max(32),
    token: z.string().min(1, "token is required"),
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

const projectIdParamSchema = z
  .string()
  .min(1, "projectId is required")
  .max(32, "projectId must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore");

const lockProjectSchema = z.object({
  owner: z.string().min(1, "owner is required")
});

const updateCollaboratorsSchema = z
  .object({
    owner: z.string().min(1, "owner is required"),
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

function toCollaboratorScVal(collaborator: z.infer<typeof collaboratorSchema>) {
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

async function buildCreateProjectUnsignedXdr(
  input: z.infer<typeof createSplitSchema>
) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.owner);
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let ownerAddress: Address;
  let tokenAddress: Address;
  try {
    ownerAddress = Address.fromString(input.owner);
    tokenAddress = Address.fromString(input.token);
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  let collaboratorScVals: xdr.ScVal[];
  try {
    collaboratorScVals = input.collaborators.map((collaborator) =>
      toCollaboratorScVal(collaborator)
    );
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "create_project",
        ownerAddress.toScVal(),
        nativeToScVal(input.projectId, { type: "symbol" }),
        nativeToScVal(input.title),
        nativeToScVal(input.projectType),
        tokenAddress.toScVal(),
        xdr.ScVal.scvVec(collaboratorScVals)
      )
    )
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);

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

const listProjectsSchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

splitsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const parsed = listProjectsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten(),
        requestId
      });
    }

    try {
      const projects = await listProjects(parsed.data.start, parsed.data.limit);
      return res.status(200).json(projects);
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

splitsRouter.get("/:projectId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const projectId = req.params.projectId?.trim();
    if (!projectId) {
      return res.status(400).json({
        error: "validation_error",
        message: "projectId is required",
        requestId
      });
    }

    const project = await fetchProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        error: "not_found",
        message: `Split project ${projectId} not found.`,
        requestId
      });
    }

    return res.status(200).json(project);
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/lock", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;

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

const distributeSchema = z.object({
  sourceAddress: z.string().min(1, "sourceAddress is required").optional()
});

splitsRouter.post("/:projectId/distribute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.projectId?.trim();
    if (!projectId) {
      return res.status(400).json({
        error: "validation_error",
        message: "projectId is required"
      });
    }

    const parsed = distributeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten()
      });
    }

    const config = loadStellarConfig();
    const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

    let sourceAccount;
    const sourceAddress = parsed.data?.sourceAddress || config.simulatorAccount;
    try {
      sourceAccount = await server.getAccount(sourceAddress);
    } catch {
      return res.status(400).json({
        error: "validation_error",
        message: "source account not found on selected network"
      });
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

    const preparedTx = await server.prepareTransaction(tx);

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