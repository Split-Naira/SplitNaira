import { ContractErrors, type ContractErrorCode } from "@/generated/contract-types";

/** Human-readable messages for on-chain SplitError codes (contracts/errors.rs). */
export const CONTRACT_ERROR_MESSAGES: Record<ContractErrorCode, string> = {
  [ContractErrors.ProjectExists]:
    "A project with this ID already exists. Choose a different project ID.",
  [ContractErrors.NotFound]: "Project not found on-chain. It may have been archived or never created.",
  [ContractErrors.Unauthorized]:
    "You are not authorized for this action. Connect the project owner or contract admin wallet.",
  [ContractErrors.InvalidSplit]:
    "Collaborator shares must total exactly 10,000 basis points (100%).",
  [ContractErrors.TooFewCollaborators]: "At least two collaborators are required.",
  [ContractErrors.ZeroShare]: "Each collaborator must have a share greater than zero.",
  [ContractErrors.NoBalance]: "There is no balance available to distribute for this project.",
  [ContractErrors.AlreadyLocked]: "This project is already locked and cannot be changed.",
  [ContractErrors.ProjectLocked]:
    "This project is locked. Unlock is not supported — create a new project instead.",
  [ContractErrors.DuplicateCollaborator]: "Duplicate collaborator addresses are not allowed.",
  [ContractErrors.InvalidAmount]: "Amount must be greater than zero.",
  [ContractErrors.TokenNotAllowed]:
    "This token is not on the contract allowlist. Ask the admin to allow it first.",
  [ContractErrors.AdminNotSet]: "Contract admin is not configured yet.",
  [ContractErrors.ArithmeticOverflow]:
    "An internal balance calculation overflowed. Contact support with the transaction hash.",
  [ContractErrors.InsufficientUnallocated]:
    "Withdrawal exceeds unallocated contract balance for this token.",
  [ContractErrors.DistributionsPaused]:
    "Distributions are paused by the contract admin. Deposits still work; try again after unpause.",
  [ContractErrors.InvalidRecipient]: "Withdrawal recipient must not be the contract itself.",
  [ContractErrors.NotACollaborator]: "Address is not registered as a collaborator on this project.",
  [ContractErrors.TooManyCollaborators]: "Project has exceeded the maximum allowed number of collaborators."
};

const ERROR_CODE_BY_NAME = Object.fromEntries(
  Object.entries(ContractErrors).map(([name, code]) => [name, code])
) as Record<string, ContractErrorCode>;

/**
 * Maps Soroban contract error payloads embedded in RPC/ledger failure strings
 * to operator-friendly messages. Returns null when no known code is detected.
 */
export function parseContractError(raw: string): string | null {
  if (!raw) return null;

  const numeric =
    raw.match(/#(\d{1,2})\b/)?.[1]
    ?? raw.match(/(?:error|code|Error)\s*[:=]?\s*(\d{1,2})\b/i)?.[1]
    ?? raw.match(/\bError\((\d{1,2})\)/)?.[1]
    ?? raw.match(/\bcontract error[:\s]+(\d{1,2})\b/i)?.[1];

  if (numeric) {
    const code = Number(numeric) as ContractErrorCode;
    if (CONTRACT_ERROR_MESSAGES[code]) {
      return CONTRACT_ERROR_MESSAGES[code];
    }
  }

  for (const [name, code] of Object.entries(ERROR_CODE_BY_NAME)) {
    if (raw.includes(name)) {
      return CONTRACT_ERROR_MESSAGES[code];
    }
  }

  return null;
}

/**
 * Prefer a parsed contract error message; otherwise return the original text.
 */
export function formatContractFailure(raw: string, fallback = "Transaction failed on ledger."): string {
  return parseContractError(raw) ?? (raw.trim() || fallback);
}
