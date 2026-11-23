import { createHash } from "node:crypto";
import type { Response } from "express";
import { logger } from "./logger.js";

/**
 * Structured authentication event log (#1450).
 *
 * Every auth-relevant outcome (login, logout, reset, verification, email change,
 * rejected sessions) emits one `auth_event` line carrying the request's
 * correlation id, so a support ticket quoting the `x-request-id` a client saw
 * can be traced to exactly what the server did.
 *
 * What may be logged is deliberately a closed list. The function takes named
 * fields rather than a free-form object, so a token, password, Authorization
 * header or reset/confirm URL cannot be added by accident:
 *   - `userId`: internal id, never the wallet address
 *   - `email`: logged only as a short SHA-256 hash, never in clear
 *   - `reason`: a short machine code such as `SESSION_REVOKED`
 */

export type AuthEventName =
  | "login"
  | "logout"
  | "session_rejected"
  | "password_reset_requested"
  | "password_reset_confirmed"
  | "email_verification_resent"
  | "email_verified"
  | "email_change_requested"
  | "email_change_confirmed"
  | "wallet_challenge_issued"
  | "wallet_signature_verified";

export type AuthEventOutcome = "success" | "failure";

export interface AuthEventFields {
  userId?: string;
  /** Hashed before logging. */
  email?: string | null;
  /** Machine-readable code, e.g. `SESSION_REVOKED` or `invalid_or_expired_token`. */
  reason?: string;
  sessionsRevoked?: boolean;
}

const REASON_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;

/** Stable, non-reversible handle for correlating events about one address. */
export function hashEmailForLog(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function logAuthEvent(
  res: Pick<Response, "locals">,
  event: AuthEventName,
  outcome: AuthEventOutcome,
  fields: AuthEventFields = {}
): void {
  const entry: Record<string, unknown> = {
    event,
    outcome,
    requestId: res.locals.requestId,
  };
  if (fields.userId) entry.userId = fields.userId;
  if (fields.email) entry.emailHash = hashEmailForLog(fields.email);
  // A reason that is not a plain code could be a message with user input in it.
  if (fields.reason && REASON_PATTERN.test(fields.reason)) entry.reason = fields.reason;
  if (fields.sessionsRevoked !== undefined) entry.sessionsRevoked = fields.sessionsRevoked;

  if (outcome === "failure") {
    logger.warn("auth_event", entry);
  } else {
    logger.info("auth_event", entry);
  }
}
