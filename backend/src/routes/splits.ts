import { Router } from "express";
import { z } from "zod";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
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

async function fetchProjectById(projectId: string) {
  const config = loadStellarConfig();
  const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });
  const contract = new Contract(config.contractId);

  const simulationTx = new TransactionBuilder(new Account("GBRPYHIL2C4YVYC3Q4W4A6FTZVJ35UEDPKBQ6F4NNDM44YXV2RDJX2KE", "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call("get_project", nativeToScVal(projectId, { type: "symbol" })))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(simulationTx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(simulation.error);
  }

  const projectRaw = simulation.result?.retval ? scValToNative(simulation.result.retval) : null;
  if (!projectRaw) {
    return null;
  }

  const project = projectRaw as {
    project_id: string;
    title: string;
    project_type: string;
    token: string;
    owner: string;
    collaborators: Array<{ address: string; alias: string; basis_points: number }>;
    locked: boolean;
    total_distributed: string | number | bigint;
    distribution_round: number;
  };

  return {
    projectId: project.project_id,
    title: project.title,
    projectType: project.project_type,
    token: project.token,
    owner: project.owner,
    collaborators: project.collaborators.map((collaborator) => ({
      address: collaborator.address,
      alias: collaborator.alias,
      basisPoints: collaborator.basis_points
    })),
    locked: project.locked,
    totalDistributed: String(project.total_distributed),
    distributionRound: project.distribution_round
  };
}

splitsRouter.get("/:projectId", async (req, res, next) => {
  try {
    const projectId = req.params.projectId?.trim();
    if (!projectId) {
      return res.status(400).json({
        error: "validation_error",
        message: "projectId is required"
      });
    }

    const project = await fetchProjectById(projectId);
    if (!project) {
      return res.status(404).json({
        error: "not_found",
        message: `Split project ${projectId} not found.`
      });
    }

    return res.status(200).json(project);
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSplitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid request payload.",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await buildCreateProjectUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validation_error",
          message: error.message
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});