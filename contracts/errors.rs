use soroban_sdk::contracterror;

/// All possible errors the SplitNaira contract can return.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SplitError {
    /// Project ID already exists on-chain
    ProjectExists = 1,

    /// Project ID not found
    NotFound = 2,

    /// Caller is not the project owner
    Unauthorized = 3,

    /// Basis points do not sum to exactly 10,000
    InvalidSplit = 4,

    /// Fewer than 2 collaborators provided
    TooFewCollaborators = 5,

    /// A collaborator was assigned 0 basis points
    ZeroShare = 6,

    /// Target project holds no balance to distribute
    NoBalance = 7,

    /// Project is already locked and cannot be modified
    AlreadyLocked = 8,

    /// Project is locked; splits cannot be updated
    ProjectLocked = 9,

    /// Duplicate collaborator address detected in split definition
    DuplicateCollaborator = 10,

    /// Deposit or transfer amount is invalid
    InvalidAmount = 11,

    /// Token is not included in the configured allowlist
    TokenNotAllowed = 12,

    /// Contract admin is not configured yet
    AdminNotSet = 13,

    /// Arithmetic overflow while aggregating balances or basis points
    ArithmeticOverflow = 14,

    /// Requested unallocated withdrawal exceeds available amount
    InsufficientUnallocated = 15,

    /// Distributions are currently paused by admin
    DistributionsPaused = 16,
}
