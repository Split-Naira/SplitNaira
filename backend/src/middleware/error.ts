import type { NextFunction, Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: "not_found",
    message: "Route not found.",
    requestId: res.locals.requestId
  });
}

const SPLIT_ERRORS: Record<number, { status: number; code: string; message: string }> = {
  1: { status: 409, code: "project_exists", message: "Project ID already exists on-chain" },
  2: { status: 404, code: "not_found", message: "Project ID not found" },
  3: { status: 403, code: "unauthorized", message: "Caller is not the project owner" },
  4: { status: 400, code: "invalid_split", message: "Basis points do not sum to exactly 10,000" },
  5: { status: 400, code: "too_few_collaborators", message: "Fewer than 2 collaborators provided" },
  6: { status: 400, code: "zero_share", message: "A collaborator was assigned 0 basis points" },
  7: { status: 400, code: "no_balance", message: "Target project holds no balance to distribute" },
  8: { status: 400, code: "already_locked", message: "Project is already locked and cannot be modified" },
  9: { status: 400, code: "project_locked", message: "Project is locked; splits cannot be updated" },
  10: { status: 400, code: "duplicate_collaborator", message: "Duplicate collaborator address detected in split definition" },
  11: { status: 400, code: "invalid_amount", message: "Deposit or transfer amount is invalid" },
  12: { status: 400, code: "token_not_allowed", message: "Token is not included in the configured allowlist" },
  13: { status: 400, code: "admin_not_set", message: "Contract admin is not configured yet" },
};

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = res.locals.requestId;
  console.error({ requestId, err });

  // Attempt to parse Soroban contract error, usually looks like: "Error(Contract, #1)"
  const contractErrorMatch = err.message?.match(/Error\(Contract, #(\d+)\)/);
  if (contractErrorMatch) {
    const errorCode = parseInt(contractErrorMatch[1], 10);
    const mappedError = SPLIT_ERRORS[errorCode];

    if (mappedError) {
      return res.status(mappedError.status).json({
        error: mappedError.code,
        message: mappedError.message,
        details: err.message,
        requestId,
      });
    }
  }

  // Fallback to generic 500 but maintain structured response
  res.status(500).json({
    error: "internal_error",
    message: "Unexpected server error.",
    requestId,
  });
}
