import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/jwt.js";

export function authJwtMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized", message: "Missing or invalid token." });
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "unauthorized", message: "Token expired or invalid." });
  }

  (req as any).user = { walletAddress: payload.walletAddress };
  next();
}
