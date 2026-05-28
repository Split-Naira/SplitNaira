import { Address } from "@stellar/stellar-sdk";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";

/** Header carrying the requester's verified Stellar address. */
export const STELLAR_ADDRESS_HEADER = "x-stellar-address";

export interface ProjectAccessTarget {
  owner: string;
  collaborators: string[];
}

export type StellarAddressHeaderResult =
  | { ok: true; address: string }
  | { ok: false; error: AppError };

/**
 * Validates a raw `X-Stellar-Address` header value.
 * Returns a normalized address or an AppError suitable for the error handler.
 */
export function parseStellarAddressHeader(
  raw: string | string[] | undefined,
): StellarAddressHeaderResult {
  const addressStr = typeof raw === "string" ? raw.trim() : "";

  if (!addressStr) {
    return {
      ok: false,
      error: new AppError(
        ErrorType.AUTH,
        ErrorCode.UNAUTHORIZED,
        `Missing required header: ${STELLAR_ADDRESS_HEADER}. Include your Stellar public key.`,
      ),
    };
  }

  try {
    Address.fromString(addressStr);
  } catch {
    return {
      ok: false,
      error: new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        `Invalid Stellar address in ${STELLAR_ADDRESS_HEADER} header.`,
      ),
    };
  }

  return { ok: true, address: addressStr };
}

/**
 * Returns true when the requester is the project owner or a listed collaborator.
 */
export function canAccessProject(
  requester: string,
  target: ProjectAccessTarget,
): boolean {
  return (
    target.owner === requester || target.collaborators.includes(requester)
  );
}

/** Standard 401 when a wallet is authenticated but not allowed on the project. */
export function createUnauthorizedProjectAccessError(): AppError {
  return new AppError(
    ErrorType.AUTH,
    ErrorCode.UNAUTHORIZED,
    "You are not authorized to access this project.",
  );
}
