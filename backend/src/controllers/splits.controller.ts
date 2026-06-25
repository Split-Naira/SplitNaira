import type { Request, Response, NextFunction } from "express";
import { projectIdParamSchema, lockProjectSchema, depositSchema } from "../schemas/splits.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { serializeBigInts, listProjects, fetchProjectById, buildLockProjectUnsignedXdr, buildDepositUnsignedXdr } from "../services/splits.service.js";
import { logger } from "../services/logger.js";

export class SplitsController {
  async listProjects(req: Request, res: Response, next: NextFunction) {
    try {
      const projects = await listProjects(0, 100);
      return res.status(200).json(serializeBigInts(projects));
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
