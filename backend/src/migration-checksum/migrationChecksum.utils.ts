import { createHash } from "node:crypto";

export function calculateMigrationChecksum(
  content: string,
): string {
  return createHash("sha256")
    .update(content, "utf8")
    .digest("hex");
}