import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getDataSource, withTransaction } from "../services/database.js";
import { User } from "../entities/User.js";
import { userRegistrationSchema, stellarAddressSchema } from "../schemas/user.schemas.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { logger } from "../services/logger.js";
import { signToken } from "../services/jwt.js";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";

export const usersRouter = Router();

/**
 * POST /users/register
 * Register a new user with wallet address
 * Transaction-safe: Automatically rolled back on error
 */
usersRouter.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const { walletAddress, email, alias } = userRegistrationSchema.parse(req.body);

    // Execute user registration within transaction
    const savedUser = await withTransaction(async (queryRunner) => {
      const userRepository = queryRunner.manager.getRepository(User);

      // Check if user already exists
      const existingUser = await userRepository.findOne({
        where: { walletAddress }
      });

      if (existingUser) {
        throw new AppError(
          ErrorType.VALIDATION,
          ErrorCode.VALIDATION_ERROR,
          "User with this wallet address already exists.",
          undefined,
          { walletAddress }
        );
      }

      // Create new user
      const newUser = userRepository.create({
        walletAddress,
        email,
        alias,
        role: "user",
        isActive: true
      });

      // Save to database within transaction
      return await userRepository.save(newUser);
    });

    logger.info("User registered successfully", {
      userId: savedUser.id,
      walletAddress: savedUser.walletAddress,
      requestId
    });

    // Return user data (excluding sensitive fields if any)
    return res.status(201).json({
      id: savedUser.id,
      walletAddress: savedUser.walletAddress,
      email: savedUser.email,
      alias: savedUser.alias,
      role: savedUser.role,
      isActive: savedUser.isActive,
      createdAt: savedUser.createdAt.toISOString(),
      updatedAt: savedUser.updatedAt.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /users/login
 * Log in a user by wallet address
 */
usersRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const loginSchema = z.object({
      walletAddress: stellarAddressSchema
    });

    const { walletAddress } = loginSchema.parse(req.body);
    const dataSource = getDataSource();
    const userRepository = dataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress }
    });

    if (!user) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `User with wallet address ${walletAddress} not found.`
      );
    }

    logger.info("User logged in successfully", {
      userId: user.id,
      walletAddress: user.walletAddress,
      requestId
    });

    return res.status(200).json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      alias: user.alias,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      token: signToken(user.walletAddress)
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /users/me
 * Get the authenticated user's profile
 */
usersRouter.get("/me", authJwtMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress } = (req as any).user;
    const userRepository = getDataSource().getRepository(User);
    const user = await userRepository.findOne({ where: { walletAddress } });
    if (!user) {
      throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, "User not found.");
    }
    return res.status(200).json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      alias: user.alias,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /users/me
 * Update the authenticated user's profile
 */
usersRouter.patch("/me", authJwtMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress } = (req as Request & { user: { walletAddress: string } }).user;
    const updateSchema = z.object({
      email: z.string().email("Invalid email format").optional(),
      alias: z.string().min(1, "Alias is required").max(64, "Alias must be at most 64 characters").optional()
    });

    const updates = updateSchema.parse(req.body);
    const savedUser = await withTransaction(async (queryRunner) => {
      const userRepository = queryRunner.manager.getRepository(User);
      const user = await userRepository.findOne({ where: { walletAddress } });
      if (!user) {
        throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, "User not found.");
      }

      if (updates.email !== undefined) user.email = updates.email;
      if (updates.alias !== undefined) user.alias = updates.alias;

      return await userRepository.save(user);
    });

    return res.status(200).json({
      id: savedUser.id,
      walletAddress: savedUser.walletAddress,
      email: savedUser.email,
      alias: savedUser.alias,
      role: savedUser.role,
      isActive: savedUser.isActive,
      createdAt: savedUser.createdAt.toISOString(),
      updatedAt: savedUser.updatedAt.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /users/:walletAddress
 * Get user by wallet address
 */
usersRouter.get("/:walletAddress", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress } = req.params;

    const dataSource = getDataSource();
    const userRepository = dataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: userRegistrationSchema.shape.walletAddress.parse(walletAddress) }
    });

    if (!user) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `User with wallet address ${walletAddress} not found.`
      );
    }

    return res.status(200).json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      alias: user.alias,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});
