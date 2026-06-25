import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

export function signToken(walletAddress: string): string {
  return jwt.sign({ walletAddress }, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): { walletAddress: string } | null {
  try {
    return jwt.verify(token, SECRET) as { walletAddress: string };
  } catch {
    return null;
  }
}
