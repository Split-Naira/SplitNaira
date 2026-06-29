import type { Request, Response, NextFunction } from "express";
import { projectIdParamSchema, lockProjectSchema, depositSchema, listProjectsSchema } from "../schemas/splits.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { serializeBigInts, listProjects, fetchProjectById, buildLockProjectUnsignedXdr, buildDepositUnsignedXdr, encodeCursor, decodeCursor, simulateReadOnlyContractCall } from "../services/splits.service.js";
import { scValToNative } from "@stellar/stellar-sdk";
import { logger } from "../services/logger.js";

export class SplitsController {
  async listProjects(req: Request, res: Response, next: NextFunction) {
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

      let { start, limit, search, type, cursor } = parsed.data;

      if (cursor) {
        start = decodeCursor(cursor);
      }

      const projects = await listProjects(start, limit, search, type);

      const total = await simulateReadOnlyContractCall("get_project_count");
      const totalCount = total ? Number(scValToNative(total)) : 0;

      const nextCursor = start + projects.length < totalCount
        ? encodeCursor(start + limit)
        : null;

      return res.status(200).json(
        serializeBigInts({
          projects,
          total: totalCount,
          nextCursor,
        })
      );
    } catch (error) { return next(error); }
  }

  async getProject(req: Request, res: Response, next: NextFunction) {
    try {
      const projectId = projectIdParamSchema.parse(req.params.projectId);
      const project = await fetchProjectById(projectId);
      if (!project) throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, `Project ${projectId} not found.`);
      return res.status(200).json(serializeBigInts(project));
    } catch (error) { return next(error); }
  }

  async lockProject(req: Request, res: Response, next: NextFunction) {
    try {
      const projectId = projectIdParamSchema.parse(req.params.projectId);
      const body = lockProjectSchema.parse(req.body);
      const result = await buildLockProjectUnsignedXdr({ projectId, owner: body.owner });
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  }

  async deposit(req: Request, res: Response, next: NextFunction) {
    try {
      const projectId = projectIdParamSchema.parse(req.params.projectId);
      const body = depositSchema.parse(req.body);
      const result = await buildDepositUnsignedXdr({ projectId, from: body.from, amount: body.amount });
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  }
}
