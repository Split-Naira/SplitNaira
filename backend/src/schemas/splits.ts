import { z } from "zod";
import { CollaboratorSchema } from "../generated/contract-types.js";
import { Address } from "@stellar/stellar-sdk";

// Security: Safe text validator - prevents XSS by restricting to safe character ranges
// Allows: alphanumeric, spaces, hyphens, underscores, periods, commas, ampersands
const SAFE_TEXT_REGEX = /^[a-zA-Z0-9\s\-_.,'&()]*$/;
const validateSafeText = (value: string) => {
  if (!SAFE_TEXT_REGEX.test(value)) {
    return false;
  }
  // Additional check: ensure no HTML/JS patterns
  const lowerValue = value.toLowerCase();
  const dangerousPatterns = [
    '<script', 'onclick', 'onerror', 'onload', 'javascript:', 'on[a-z]+=',
    'eval(', 'expression(', 'vbscript:', 'data:text/html'
  ];
  return !dangerousPatterns.some(pattern => lowerValue.includes(pattern));
};

// Strict Stellar address validator used across schemas
export const stellarAddressSchema = z
  .string()
  .min(1, "address is required")
  .superRefine((value, ctx) => {
    try {
      Address.fromString(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a valid Stellar address (classic or contract)"
      });
    }
  });

// Safe text field validator - used for titles, types, and aliases
export const safeTextField = z
  .string()
  .refine(validateSafeText, "contains unsafe characters or patterns");

export const collaboratorSchema = CollaboratorSchema.omit({ basis_points: true }).extend({
  address: stellarAddressSchema,
  alias: safeTextField.min(1, "alias is required").max(100, "alias must be at most 100 characters"),
  basisPoints: z
    .number()
    .int("basisPoints must be an integer")
    .positive("basisPoints must be greater than 0")
    .max(10_000, "basisPoints must be <= 10000")
});

export const createSplitSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    projectId: z
      .string()
      .min(1, "projectId is required")
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore"),
    title: safeTextField.min(1, "title is required").max(128, "title must be at most 128 characters"),
    projectType: safeTextField.min(1, "projectType is required").max(32, "projectType must be at most 32 characters"),
    token: stellarAddressSchema.describe("token"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

export const projectIdParamSchema = z
  .string()
  .min(1, "projectId is required")
  .max(32, "projectId must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore");

export const lockProjectSchema = z.object({
  owner: stellarAddressSchema.describe("owner")
});

export const depositSchema = z.object({
  from: stellarAddressSchema.describe("from"),
  amount: z
    .number()
    .positive("amount must be greater than 0")
    .describe("deposit amount in stroops")
});

export const updateMetadataSchema = z.object({
  owner: stellarAddressSchema.describe("owner"),
  title: safeTextField.min(1, "title is required").max(128, "title must be at most 128 characters"),
  projectType: safeTextField.min(1, "projectType is required").max(32, "projectType must be at most 32 characters")
});

export const updateCollaboratorsSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

export const allowlistQuerySchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const listProjectsSchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  type: z.string().optional(),
});

export const distributeSchema = z.object({
  sourceAddress: z.string().min(1, "sourceAddress is required").optional()
});

export const historyQuerySchema = z.object({
  cursor: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const adminTokenSchema = z.object({
  admin: stellarAddressSchema.describe("admin"),
  token: stellarAddressSchema.describe("token")
});

export const pauseDistributionsSchema = z.object({
  admin: stellarAddressSchema.describe("admin")
});

export const isTokenAllowedQuerySchema = z.object({
  token: stellarAddressSchema.describe("token contract address to check")
});

export const unallocatedQuerySchema = z.object({
  token: stellarAddressSchema.describe("token contract address")
});

export const withdrawUnallocatedSchema = z.object({
  admin: stellarAddressSchema.describe("admin"),
  token: stellarAddressSchema.describe("token contract address"),
  to: stellarAddressSchema.describe("destination address"),
  amount: z
    .number()
    .positive("amount must be greater than 0")
    .describe("amount in stroops to recover")
});

// Wave 5: self-service claim schema
export const claimSchema = z.object({
  claimer: stellarAddressSchema.describe("collaborator address performing the claim")
});