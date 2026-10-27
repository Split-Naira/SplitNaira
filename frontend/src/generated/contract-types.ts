// Auto-generated from contract interface artifact
// Do not edit manually - regenerate with: npm run generate:contract-types

// Contract Types

export interface Collaborator {
  /** Stellar wallet address of the collaborator */
  address: string;
  /** Human-readable alias (e.g. "Burna B.") */
  alias: string;
  /** Percentage share in basis points (e.g. 5000 = 50.00%) Using basis points avoids floating point entirely. */
  basis_points: number;
}


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


export interface ClaimableInfo {
  /** Total amount claimed (paid out) to this collaborator across all rounds */
  claimed: string;
  /** Push-based `distribute` rounds only (not `claim`). */
  distribution_round: number;
  /** Most recent `claim` payout amount for this collaborator. */
  last_claim_amount: string;
}


export interface ProjectSummary {
  /** Unique project identifier */
  project_id: string;
  /** Human-readable title */
  title: string;
  /** Project owner */
  owner: string;
  /** Whether collaborator configuration is immutable */
  locked: boolean;
  /** Number of completed distributions */
  distribution_round: number;
}

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

export type Set_max_collaboratorsArgs = {
  admin: string;
  value: number;
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

export type List_project_summariesArgs = {
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

export type Migrate_flat_to_bucketsArgs = {
  admin: string;
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

export interface ProjectCreatedEvent {
  project_id: string;
  owner: string;
}

export interface ProjectLockedEvent {
  project_id: string;
}

export interface PaymentSentEvent {
  project_id: string;
  recipient: string;
  amount: string;
}

export interface DistributionCompleteEvent {
  project_id: string;
  round: number;
  total: string;
}

export interface DepositReceivedEvent {
  project_id: string;
  from: string;
  amount: string;
  project_balance: string;
}

export interface MetadataUpdatedEvent {
  project_id: string;
}

export interface UnallocatedWithdrawnEvent {
  token: string;
  admin: string;
  to: string;
  amount: string;
  remaining_unallocated: string;
}

export interface OwnershipTransferredEvent {
  project_id: string;
  previous_owner: string;
  new_owner: string;
}

export interface CollaboratorsUpdatedEvent {
  project_id: string;
}

export interface DistributionsPausedEvent {
  admin: string;
}

export interface DistributionsUnpausedEvent {
  admin: string;
}

export interface CollaboratorClaimedEvent {
  project_id: string;
  claimer: string;
  amount: string;
  distribution_round: number;
}

export interface SplitsUpdatedWithPendingBalanceEvent {
  project_id: string;
  pending_balance: string;
}

export interface TokenAllowedEvent {
  token: string;
  admin: string;
}

export interface TokenDisallowedEvent {
  token: string;
  admin: string;
}

export interface Accounting_discrepancyEvent {
  token: string;
  contract_balance: string;
  accounted_balance: string;
}

// Error Types

export const ContractErrors = {
  ProjectExists: 1,
  NotFound: 2,
  AlreadyLocked: 8,
  ProjectLocked: 9,
  Unauthorized: 3,
  NotACollaborator: 18,
  InvalidSplit: 4,
  TooFewCollaborators: 5,
  ZeroShare: 6,
  DuplicateCollaborator: 10,
  InvalidAmount: 11,
  InvalidRecipient: 17,
  TooManyCollaborators: 19,
  NoBalance: 7,
  TokenNotAllowed: 12,
  InsufficientUnallocated: 15,
  AdminNotSet: 13,
  DistributionsPaused: 16,
  AccountingDiscrepancy: 20,
  InvalidMaxCollaborators: 21,
  ArithmeticOverflow: 14,
  AlreadyClaimed: 22,
} as const;

export type ContractErrorCode = typeof ContractErrors[keyof typeof ContractErrors];
