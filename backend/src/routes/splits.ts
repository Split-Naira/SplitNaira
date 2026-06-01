import { Request, Response, NextFunction, Router } from "express";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";

import {
  loadStellarConfig,
  getStellarRpcServer,
  RequestValidationError,
  executeWithRetry,
  invalidateCache,
  invalidateCacheByPrefix,
  getCacheStats,
  READ_CACHE_TTL_MS
} from "../services/stellar.js";

import {
  AppError,
  ErrorCode,
  ErrorType,
  translateSorobanError
} from "../lib/errors.js";

import {
  stellarAddressSchema,
  createSplitSchema,
  projectIdParamSchema,
  lockProjectSchema,
  depositSchema,
  updateMetadataSchema,
  updateCollaboratorsSchema,
  allowlistQuerySchema,
  listProjectsSchema,
  distributeSchema,
  historyQuerySchema,
  adminTokenSchema,
  pauseDistributionsSchema,
  isTokenAllowedQuerySchema,
  unallocatedQuerySchema,
  withdrawUnallocatedSchema,
  claimSchema
} from "../schemas/splits.js";

import {
  buildHistoryTopicFilters,
  decodeRoundHistoryEventValue,
  decodePaymentHistoryEventValue
} from "../services/contract-helpers.js";

import {
  serializeBigInts,
  buildCreateProjectUnsignedXdr,
  simulateReadOnlyContractCall,
  listProjects,
  fetchProjectById,
  buildLockProjectUnsignedXdr,
  buildDepositUnsignedXdr,
  buildUpdateCollaboratorsUnsignedXdr,
  buildUpdateMetadataUnsignedXdr,
  buildPauseDistributionsUnsignedXdr,
  buildUnpauseDistributionsUnsignedXdr,
  buildAllowTokenUnsignedXdr,
  buildDisallowTokenUnsignedXdr,
  buildWithdrawUnallocatedUnsignedXdr,
  buildClaimUnsignedXdr,
  buildUnsignedContractCall
} from "../services/splits.service.js";
import { logger } from "../services/logger.js";

// Re-export all schemas, contract helpers, and services for backwards compatibility
export {
  stellarAddressSchema,
  collaboratorSchema,
  createSplitSchema,
  projectIdParamSchema,
  lockProjectSchema,
  depositSchema,
  updateMetadataSchema,
  updateCollaboratorsSchema,
  allowlistQuerySchema,
  listProjectsSchema,
  distributeSchema,
  historyQuerySchema,
  adminTokenSchema,
  pauseDistributionsSchema,
  isTokenAllowedQuerySchema,
  unallocatedQuerySchema,
  withdrawUnallocatedSchema,
  claimSchema
} from "../schemas/splits.js";

export {
  toCollaboratorScVal,
  buildCreateProjectContractArgs,
  buildUpdateCollaboratorsContractArgs,
  buildLockProjectContractArgs,
  buildDepositContractArgs,
  buildAdminTokenContractArgs,
  parseStellarAddress,
  buildHistoryTopicFilters,
  decodeRoundHistoryEventValue,
  decodePaymentHistoryEventValue
} from "../services/contract-helpers.js";

export {
  serializeBigInts,
  buildUnsignedContractCall,
  buildCreateProjectUnsignedXdr,
  simulateReadOnlyContractCall,
  fetchProjectsFromContract,
  listProjects,
  fetchProjectById,
  buildLockProjectUnsignedXdr,
  buildDepositUnsignedXdr,
  buildUpdateCollaboratorsUnsignedXdr,
  buildUpdateMetadataUnsignedXdr,
  buildPauseDistributionsUnsignedXdr,
  buildUnpauseDistributionsUnsignedXdr,
  buildAllowTokenUnsignedXdr,
  buildDisallowTokenUnsignedXdr,
  buildWithdrawUnallocatedUnsignedXdr,
  buildClaimUnsignedXdr
} from "../services/splits.service.js";

function sendValidationError(
  res: Response,
  requestId: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  return res.status(400).json({
    error: "validation_error",
    message,
    requestId,
    details
  });
}

function sendRpcError(res: Response, requestId: string, message: string, status = 502) {
  return res.status(status).json({
    error: "rpc_error",
    message,
    requestId,
    details: {}
  });
}

export const splitsRouter = Router();

function logPaymentsAdminAction(
  res: Response,
  action: string,
  details: Record<string, unknown>
) {
  logger.info("Payments admin action prepared", {
    action,
    requestId: res.locals.requestId,
    ...details
  });
}

splitsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const { start, limit, search, type } = parsed.data;
    const projects = await listProjects(start, limit, search, type);
    return res.status(200).json(serializeBigInts(projects));
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId", async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const project = await fetchProjectById(projectId);
    if (!project) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `Split project ${projectId} not found.`
      );
    }

    return res.status(200).json(serializeBigInts(project));
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/lock", async (req: Request, res: Response, next: NextFunction) => {
  try {
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
        { message: "Check owner address." },
        parsedBody.error.flatten()
      );
    }

    const result = await buildLockProjectUnsignedXdr({
      projectId,
      owner: parsedBody.data.owner
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
    }
    return next(error);
  }
});

splitsRouter.get("/admin/allowlist", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = allowlistQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    const { start, limit } = parsed.data;

    try {
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

      return res.status(200).json(
        serializeBigInts({ admin: adminValue, count: countValue, tokens: tokensValue })
      );
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
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

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = depositSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", {
        params: parsedParams.success ? null : parsedParams.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      });
    }

    try {
      const result = await buildDepositUnsignedXdr({
        projectId: parsedParams.data,
        from: parsedBody.data.from,
        amount: parsedBody.data.amount
      });
      // Evict cached project state; balance will change after submission
      invalidateCache(`project:${parsedParams.data}`);
      invalidateCacheByPrefix("list_projects:");
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", {
        params: parsedParams.success ? null : parsedParams.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
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
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", {
        params: parsedParams.success ? null : parsedParams.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
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
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildCreateProjectUnsignedXdr(parsed.data);
      // Invalidate list cache so newly created project appears immediately
      invalidateCacheByPrefix("list_projects:");
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/distribute", async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const parsedBody = distributeSchema.safeParse(req.body);
    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check the distribution request body." },
        parsedBody.error.flatten()
      );
    }

    const config = loadStellarConfig();
    const sourceAddress = parsedBody.data.sourceAddress || config.simulatorAccount;

    try {
      const result = await buildUnsignedContractCall({
        sourceAddress,
        sourceRoleLabel: "source",
        operation: "distribute",
        args: [nativeToScVal(projectId, { type: "symbol" })]
      });

      // Evict cached project data; distribution round and balance will change
      invalidateCache(`project:${projectId}`);
      invalidateCacheByPrefix("list_projects:");

      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(
          ErrorType.ACCOUNT_STATE,
          ErrorCode.ACCOUNT_NOT_FOUND,
          error.message,
          { message: "The account used to trigger distribution must exist and be funded.", action: "Check Source Wallet" }
        );
      }
      throw translateSorobanError(error);
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId/claimable/:address", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedProjectId = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedAddress = stellarAddressSchema.safeParse(req.params.address);

    if (!parsedProjectId.success || !parsedAddress.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", {
        params: {
          projectId: parsedProjectId.success ? null : parsedProjectId.error.flatten(),
          address: parsedAddress.success ? null : parsedAddress.error.flatten()
        }
      });
    }

    const projectId = parsedProjectId.data;
    const address = parsedAddress.data;
    const config = loadStellarConfig();
    const server = getStellarRpcServer();

    let sourceAccount;
    try {
      sourceAccount = await executeWithRetry(() => server.getAccount(config.simulatorAccount));
    } catch {
      return sendRpcError(res, requestId, "RPC operation failed.");
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

      simulated = await executeWithRetry(() => server.simulateTransaction(tx));
    } catch (error) {
      throw translateSorobanError(error);
    }

    const retval = "result" in simulated ? simulated.result?.retval : undefined;
    if (!retval) {
      return sendRpcError(res, requestId, "RPC operation failed.");
    }

    return res.status(200).json({
      projectId,
      address,
      claimable: serializeBigInts(scValToNative(retval))
    });
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/allow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildAllowTokenUnsignedXdr(parsed.data);
      logPaymentsAdminAction(res, "allow_token", {
        admin: parsed.data.admin,
        token: parsed.data.token
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildDisallowTokenUnsignedXdr(parsed.data);
      logPaymentsAdminAction(res, "disallow_token", {
        admin: parsed.data.admin,
        token: parsed.data.token
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildPauseDistributionsUnsignedXdr(parsed.data);
      logPaymentsAdminAction(res, "pause_distributions", {
        admin: parsed.data.admin
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
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
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildUnpauseDistributionsUnsignedXdr(parsed.data);
      logPaymentsAdminAction(res, "unpause_distributions", {
        admin: parsed.data.admin
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
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
      items: serializeBigInts(events),
      nextCursor
    });
  } catch (error) {
    return next(error);
  }
});

// ============================================================
// Issue #152: Admin contract-state read routes
// ============================================================

splitsRouter.get("/admin/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    try {
      const [adminRetval, pausedRetval] = await Promise.all([
        simulateReadOnlyContractCall("get_admin"),
        simulateReadOnlyContractCall("is_distributions_paused")
      ]);

      const admin = adminRetval ? String(scValToNative(adminRetval)) : null;
      const isPaused = pausedRetval ? Boolean(scValToNative(pausedRetval)) : false;

      return res.status(200).json({ admin, isPaused });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({ error: "validation_error", message: error.message, requestId, details: {} });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/admin/is-token-allowed", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = isTokenAllowedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }
    const { token } = parsed.data;

    try {
      const retval = await simulateReadOnlyContractCall("is_token_allowed", [
        Address.fromString(token).toScVal()
      ]);
      const isAllowed = retval ? Boolean(scValToNative(retval)) : false;
      return res.status(200).json({ token, isAllowed });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({ error: "validation_error", message: error.message, requestId, details: {} });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/admin/token-count", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    try {
      const retval = await simulateReadOnlyContractCall("get_allowed_token_count");
      const count = retval ? Number(scValToNative(retval)) : 0;
      return res.status(200).json({ count });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({ error: "validation_error", message: error.message, requestId, details: {} });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

// ============================================================
// Issue #166: Unallocated token recovery routes
// ============================================================

splitsRouter.get("/admin/unallocated", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = unallocatedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }
    const { token } = parsed.data;

    try {
      const retval = await simulateReadOnlyContractCall("get_unallocated_balance", [
        Address.fromString(token).toScVal()
      ]);
      const unallocated = retval ? String(scValToNative(retval)) : "0";
      return res.status(200).json({ token, unallocated });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({ error: "validation_error", message: error.message, requestId, details: {} });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/withdraw-unallocated", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = withdrawUnallocatedSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", parsed.error.flatten());
    }

    try {
      const result = await buildWithdrawUnallocatedUnsignedXdr(parsed.data);
      logPaymentsAdminAction(res, "withdraw_unallocated", {
        admin: parsed.data.admin,
        token: parsed.data.token,
        to: parsed.data.to,
        amount: parsed.data.amount
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({ error: "validation_error", message: error.message, requestId, details: {} });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});


// ============================================================
// Wave 5: self-service claim endpoint
// ============================================================

splitsRouter.post("/:projectId/claim", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const parsedParams = projectIdParamSchema.safeParse(req.params.projectId);
    const parsedBody = claimSchema.safeParse(req.body);

    if (!parsedParams.success || !parsedBody.success) {
      return sendValidationError(res, requestId, "Invalid request payload.", {
        params: parsedParams.success ? null : parsedParams.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      });
    }

    try {
      const result = await buildClaimUnsignedXdr({
        projectId: parsedParams.data,
        claimer: parsedBody.data.claimer
      });
      // Evict cached project state; balance will change after submission
      invalidateCache(`project:${parsedParams.data}`);
      invalidateCacheByPrefix("list_projects:");
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return sendValidationError(res, requestId, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});
// ============================================================
// Cache diagnostics (non-sensitive internal endpoint)
// ============================================================

splitsRouter.get("/admin/cache-stats", (_req: Request, res: Response) => {
  res.status(200).json({ ...getCacheStats(), ttlMs: READ_CACHE_TTL_MS });
});
