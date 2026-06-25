// Auto-generated from contract interface artifact
// Do not edit manually - regenerate with: npm run generate:contract-types

import { z } from "zod";

// Contract Types

export interface Collaborator {
  /** Stellar wallet address of the collaborator */
  address: string;
  /** Human-readable alias (e.g. "Burna B.") */
  alias: string;
  /** Percentage share in basis points (e.g. 5000 = 50.00%) Using basis points avoids floating point entirely. */
  basis_points: number;
}

export const CollaboratorSchema = z.object({
  address: z.string().describe("Stellar wallet address of the collaborator"),
  alias: z.string().describe("Human-readable alias (e.g. \"Burna B.\")"),
  basis_points: z.number().describe("Percentage share in basis points (e.g. 5000 = 50.00%) Using basis points avoids floating point entirely.")
});


export interface SplitProject {
  /** Unique project identifier */
  project_id: string;
  /** Human-readable project title */
  title: string;
  /** Project type: "music", "film", "art", "podcast", "book", "other" */
  project_type: string;
  /** Token contract address (XLM or USDC) */
  token: string;
  /** The project creator / admin address */
  owner: string;
  /** All collaborators and their splits */
  collaborators: Array<Collaborator>;
  /** Whether the split is locked (immutable after locking) */
  locked: boolean;
  /** Total funds distributed so far (in token stroops) */
  total_distributed: string;
  /** Number of successful distribution rounds completed */
  distribution_round: number;
}

export const SplitProjectSchema = z.object({
  project_id: z.string().describe("Unique project identifier"),
  title: z.string().describe("Human-readable project title"),
  project_type: z.string().describe("Project type: \"music\", \"film\", \"art\", \"podcast\", \"book\", \"other\""),
  token: z.string().describe("Token contract address (XLM or USDC)"),
  owner: z.string().describe("The project creator / admin address"),
  collaborators: z.array(z.string()).describe("All collaborators and their splits"),
  locked: z.boolean().describe("Whether the split is locked (immutable after locking)"),
  total_distributed: z.string().describe("Total funds distributed so far (in token stroops)"),
  distribution_round: z.number().describe("Number of successful distribution rounds completed")
});


export interface ClaimableInfo {
  /** Total amount claimed (paid out) to this collaborator across all rounds */
  claimed: string;
  /** Number of distribution rounds completed for this project */
  distribution_round: number;
}

export const ClaimableInfoSchema = z.object({
  claimed: z.string().describe("Total amount claimed (paid out) to this collaborator across all rounds"),
  distribution_round: z.number().describe("Number of distribution rounds completed for this project")
});

// Method Argument Types

export type Set_adminArgs = {
  admin: string;
};

export type Pause_distributionsArgs = {
  admin: string;
};

export type Unpause_distributionsArgs = {
  admin: string;
};

export type Allow_tokenArgs = {
  admin: string;
  token: string;
};

export type Disallow_tokenArgs = {
  admin: string;
  token: string;
};

export type Create_projectArgs = {
  owner: string;
  project_id: string;
  title: string;
  project_type: string;
  token: string;
  collaborators: Array<Collaborator>;
};

export type Update_collaboratorsArgs = {
  project_id: string;
  owner: string;
  collaborators: Array<Collaborator>;
};

export type Lock_projectArgs = {
  project_id: string;
  owner: string;
};

export type DepositArgs = {
  project_id: string;
  from: string;
  amount: string;
};

export type DistributeArgs = {
  project_id: string;
};

export type Batch_distributeArgs = {
  project_ids: Array<string>;
};

export type ClaimArgs = {
  project_id: string;
  claimer: string;
};

export type Get_projectArgs = {
  project_id: string;
};

export type Project_existsArgs = {
  project_id: string;
};

export type Get_claimedArgs = {
  project_id: string;
  address: string;
};

export type Refresh_project_storageArgs = {
  project_id: string;
};

export type List_projectsArgs = {
  start: number;
  limit: number;
};

export type Get_balanceArgs = {
  project_id: string;
};

export type Get_unallocated_balanceArgs = {
  token: string;
};

export type Withdraw_unallocatedArgs = {
  admin: string;
  token: string;
  to: string;
  amount: string;
};

export type Is_token_allowedArgs = {
  token: string;
};

export type Get_allowed_tokensArgs = {
  start: number;
  limit: number;
};

export type Get_project_idsArgs = {
  start: number;
  limit: number;
};

export type Get_claimableArgs = {
  project_id: string;
  collaborator: string;
};

export type Update_project_metadataArgs = {
  project_id: string;
  owner: string;
  title: string;
  project_type: string;
};

export type Transfer_project_ownershipArgs = {
  project_id: string;
  current_owner: string;
  new_owner: string;
};

// Event Types

export interface Project_createdEvent {
  project_id: string;
  owner: string;
}

export interface Project_lockedEvent {
  project_id: string;
}

export interface Payment_sentEvent {
  project_id: string;
  recipient: string;
  amount: string;
}

export interface Distribution_completeEvent {
  project_id: string;
  round: number;
  total: string;
}

export interface Deposit_receivedEvent {
  project_id: string;
  from: string;
  amount: string;
  project_balance: string;
}

export interface Metadata_updatedEvent {
  project_id: string;
}

export interface Unallocated_withdrawnEvent {
  token: string;
  admin: string;
  to: string;
  amount: string;
  remaining_unallocated: string;
}

export interface Ownership_transferredEvent {
  project_id: string;
  previous_owner: string;
  new_owner: string;
}

export interface Collaborators_updatedEvent {
  project_id: string;
}

export interface Distributions_pausedEvent {
  admin: string;
}

export interface Distributions_unpausedEvent {
  admin: string;
}

export interface Collaborator_claimedEvent {
  project_id: string;
  claimer: string;
  amount: string;
}

export interface Splits_updated_with_pending_balanceEvent {
  project_id: string;
  pending_balance: string;
}

// Error Types

export const ContractErrors = {
  ProjectExists: 1,
  NotFound: 2,
  Unauthorized: 3,
  InvalidSplit: 4,
  TooFewCollaborators: 5,
  ZeroShare: 6,
  NoBalance: 7,
  AlreadyLocked: 8,
  ProjectLocked: 9,
  DuplicateCollaborator: 10,
  InvalidAmount: 11,
  TokenNotAllowed: 12,
  AdminNotSet: 13,
  ArithmeticOverflow: 14,
  InsufficientUnallocated: 15,
  DistributionsPaused: 16,
  InvalidRecipient: 17,
  NotACollaborator: 18,
  TooManyCollaborators: 19,
} as const;

export type ContractErrorCode = typeof ContractErrors[keyof typeof ContractErrors];
