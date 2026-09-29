use soroban_sdk::contracterror;

/// Errors returned by the SplitNaira smart contract.
///
/// # Error Code Stability
///
/// Error codes are part of the contract's public interface. Once deployed,
/// existing numeric values must never be changed or reused.
///
/// When adding a new error:
/// - Assign it a new numeric code.
/// - Preserve all existing numeric values.
/// - Do not reuse codes from removed errors.
/// - Keep the new error at the end of the enum to preserve compatibility.
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

    /// The project has already been permanently locked.
    AlreadyLocked = 8,

    /// The project is locked and cannot be modified.
    ProjectLocked = 9,

    // ---------------------------------------------------------------------
    // Authorization Errors
    // ---------------------------------------------------------------------

    /// The caller is not authorized to perform the requested action.
    Unauthorized = 3,

    /// The address is not a registered collaborator on the project.
    NotACollaborator = 18,

    // ---------------------------------------------------------------------
    // Validation Errors
    // ---------------------------------------------------------------------

    /// Collaborator basis points must total exactly 10,000.
    InvalidSplit = 4,

    /// At least two collaborators are required.
    TooFewCollaborators = 5,

    /// A collaborator cannot have a zero share.
    ZeroShare = 6,

    /// A duplicate collaborator address was provided.
    DuplicateCollaborator = 10,

    /// The specified deposit or transfer amount is invalid.
    InvalidAmount = 11,

    /// The recipient address is invalid.
    ///
    /// This prevents funds from being sent to the contract itself.
    InvalidRecipient = 17,

    /// The maximum number of collaborators has been exceeded.
    TooManyCollaborators = 19,

    // ---------------------------------------------------------------------
    // Token & Balance Errors
    // ---------------------------------------------------------------------

    /// The project has no balance available for distribution.
    NoBalance = 7,

    /// The token is not included in the configured allowlist.
    TokenNotAllowed = 12,

    /// The requested withdrawal exceeds the available unallocated funds.
    InsufficientUnallocated = 15,

    // ---------------------------------------------------------------------
    // Administrative Errors
    // ---------------------------------------------------------------------

    /// The contract administrator has not been configured.
    AdminNotSet = 13,

    /// Distribution operations are currently paused by the administrator.
    DistributionsPaused = 16,

    // ---------------------------------------------------------------------
    // Arithmetic & Accounting Errors
    // ---------------------------------------------------------------------

    /// The cached accounted balance exceeds the contract's actual
    /// token balance.
    AccountingDiscrepancy = 20,

    /// The administrator-supplied collaborator capacity is outside the
    /// permitted range.
    InvalidMaxCollaborators = 21,

    /// An arithmetic operation overflowed.
    ///
    /// Error code `14` is intentionally preserved because it is already
    /// part of the contract's public error-code interface.
    ArithmeticOverflow = 14,
}

impl SplitError {
    /// Returns the stable numeric error code exposed by the contract.
    ///
    /// Error codes are part of the public contract interface and must not
    /// change after deployment.
    #[inline]
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// Returns whether the operation may succeed after the relevant
    /// contract state changes.
    ///
    /// This does not mean that immediately retrying the same operation
    /// will succeed:
    ///
    /// - `NoBalance` requires additional project funds.
    /// - `DistributionsPaused` requires distributions to be resumed.
    /// - `InsufficientUnallocated` requires additional unallocated funds.
    #[inline]
    pub const fn is_retryable(self) -> bool {
        matches!(
            self,
            Self::NoBalance
                | Self::DistributionsPaused
                | Self::InsufficientUnallocated
        )
    }
}