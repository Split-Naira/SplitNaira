import { MemoryStore } from "express-rate-limit";

export function createTestRateLimiterStore() {
  return new MemoryStore();
}