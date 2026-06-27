import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getDataSource, withTransaction } from "../services/database.js";
import { User } from "../entities/User.js";
import {
  userRegistrationSchema,
  stellarAddressSchema,
  userUpdateSchema,
} from "../schemas/user.schemas.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { logger } from "../services/logger.js";
import { signToken } from "../services/jwt.js";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";

export const usersRouter = Router();

/**
 * @openapi
 * POST /users/register
 * summary: Register a new user
 * description: Creates a user profile linked to a Stellar wallet address.
 * tags: [Users]
 */
usersRouter.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress, email, alias } = userRegistrationSchema.parse(req.body);

    // Get repository without opening a transaction
    const dataSource = getDataSource();
    const userRepository = dataSource.getRepository(User);

    // Lightweight existence check before starting a transaction
    const walletExists = await userRepository.exist({
      where: { walletAddress },
    });

    if (walletExists) {
      return res.status(409).json({
        error: "conflict",
        message: "Wallet address already registered.",
      });
    }

    // Only open a transaction if the wallet does not already exist
    const savedUser = await withTransaction(async (queryRunner) => {
      const userRepository = queryRunner.manager.getRepository(User);

      const newUser = userRepository.create({
        walletAddress,
        email,
        alias,
        role: "user",
        isActive: true,
      });

      return await userRepository.save(newUser);
    });

    logger.info("User registered successfully", {
      userId: savedUser.id,
      walletAddress: savedUser.walletAddress,
    });

    return res.status(201).json({
      id: savedUser.id,
      walletAddress: savedUser.walletAddress,
      email: savedUser.email,
      alias: savedUser.alias,
      role: savedUser.role,
      isActive: savedUser.isActive,
      createdAt: savedUser.createdAt.toISOString(),
      updatedAt: savedUser.updatedAt.toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * POST /users/login
 * summary: Log in by wallet address
 * description: Authenticates a registered user and returns a JWT bearer token.
 * tags: [Users]
 */
usersRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
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
 * @openapi
 * GET /users/me
 * summary: Get authenticated user profile
 * description: Returns the profile of the user identified by the JWT bearer token.
 * tags: [Users]
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
 * @openapi
 * PATCH /users/me
 * summary: Update authenticated user profile
 * description: Updates email or alias for the authenticated user.
 * tags: [Users]
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
 * @openapi
 * GET /users/{walletAddress}
 * summary: Get user by wallet address
 * description: Looks up a public user profile by Stellar wallet address.
 * tags: [Users]
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
