import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

// Stellar address validator
export const stellarAddressSchema = z
  .string()
  .min(1, "wallet address is required")
  .refine((val) => StrKey.isValidEd25519PublicKey(val), {
    message: "Must be a valid Stellar account ID (G…)",
  });

// User registration schema
export const userRegistrationSchema = z.object({
  walletAddress: stellarAddressSchema,
  email: z.string().email("Invalid email format").optional(),
  alias: z.string().min(1, "Alias is required").max(64, "Alias must be at most 64 characters").optional(),
});


// User response schema
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  walletAddress: z.string(),
  email: z.string().optional(),
  alias: z.string().optional(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userUpdateSchema = z.object({
  email: userRegistrationSchema.shape.email,
  alias: userRegistrationSchema.shape.alias,
}).strict();

export type UserUpdate = z.infer<typeof userUpdateSchema>;

export type UserRegistration = z.infer<typeof userRegistrationSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
