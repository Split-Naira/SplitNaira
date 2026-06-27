use soroban_sdk::contracterror;

/// Errors returned by the SplitNaira smart contract.
///
/// ## Important
/// Error codes are part of the contract's public interface.
/// Once deployed, **do not modify existing numeric values**.
/// New errors should always be appended to preserve backward compatibility.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
#[repr(u32)]
pub enum SplitError {
    // ---------------------------------------------------------------------
    // Project Errors
    // ---------------------------------------------------------------------

    /// A project with the specified ID already exists.
    ProjectExists = 1,

    /// The requested project could not be found.
    NotFound = 2,

    /// The project is permanently locked.
    AlreadyLocked = 8,

    /// The project is locked and cannot be modified.
    ProjectLocked = 9,

    // ---------------------------------------------------------------------
    // Authorization Errors
    // ---------------------------------------------------------------------

    /// Caller is not authorized to perform this action.
    Unauthorized = 3,

    /// Address is not a registered collaborator.
    NotACollaborator = 18,

    // ---------------------------------------------------------------------
    // Validation Errors
    // ---------------------------------------------------------------------

    /// Collaborator basis points must total exactly 10,000.
    InvalidSplit = 4,

    /// At least two collaborators are required.
    TooFewCollaborators = 5,

    /// Collaborator share cannot be zero.
    ZeroShare = 6,

    /// Duplicate collaborator address detected.
    DuplicateCollaborator = 10,

    /// Deposit or transfer amount is invalid.
    InvalidAmount = 11,

    /// Recipient address is invalid.
    ///
    /// Prevents sending funds to the contract itself.
    InvalidRecipient = 17,

    /// Maximum collaborator limit exceeded.
    TooManyCollaborators = 19,

    // ---------------------------------------------------------------------
    // Token & Balance Errors
    // ---------------------------------------------------------------------

    /// Project has no balance available for distribution.
    NoBalance = 7,

    /// Token is not included in the configured allowlist.
    TokenNotAllowed = 12,

    /// Requested withdrawal exceeds available unallocated funds.
    InsufficientUnallocated = 15,

    // ---------------------------------------------------------------------
    // Administrative Errors
    // ---------------------------------------------------------------------

    /// Contract administrator has not been configured.
    AdminNotSet = 13,

    /// Distributions have been paused by the administrator.
    DistributionsPaused = 16,

    // ---------------------------------------------------------------------
    // Arithmetic Errors
    // ---------------------------------------------------------------------

    /// Cached accounted balance exceeds the contract's actual token balance
    AccountingDiscrepancy = 20,

    /// Admin-supplied capacity limit is outside the permitted range.
    InvalidMaxCollaborators = 21,

    /// An arithmetic operation overflowed.
    ///
    /// Code `14` matches the value already published in the README error-code
    /// table; the variant was referenced in `lib.rs` but had never been declared.
    ArithmeticOverflow = 14,
}

impl SplitError {
    /// Returns the numeric error code exposed by the contract.
    #[inline]
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// Returns whether retrying the operation could succeed without
    /// changing the contract state.
    #[inline]
    pub const fn is_retryable(self) -> bool {
        matches!(
            self,
            SplitError::NoBalance
                | SplitError::DistributionsPaused
                | SplitError::InsufficientUnallocated
        )
    }
}
