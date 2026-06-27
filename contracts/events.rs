use soroban_sdk::{Address, Env, Symbol};

// ---------------------------------------------------------------------------
// Publishable trait — gives every event a uniform interface and allows
// callers to hold a `&dyn Publishable` without knowing the concrete type.
// ---------------------------------------------------------------------------

pub trait Publishable {
    fn publish(&self, env: &Env);
}

// ---------------------------------------------------------------------------
// ProjectCreated
// ---------------------------------------------------------------------------

/// Emitted when a new royalty-split project is created.
///
/// | Field       | Topic position | Data position |
/// |-------------|----------------|---------------|
/// | `project_id`| topic[1]       | —             |
/// | `owner`     | —              | data          |
///
/// **Topics:** `["project_created", project_id]`  
/// **Data:** `owner`
#[derive(Clone, Debug)]
pub struct ProjectCreated {
    pub project_id: Symbol,
    pub owner: Address,
}

impl ProjectCreated {
    #[must_use]
    pub fn new(project_id: Symbol, owner: Address) -> Self {
        Self { project_id, owner }
    }
}

impl Publishable for ProjectCreated {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "project_created"), self.project_id.clone()),
            self.owner.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// ProjectLocked
// ---------------------------------------------------------------------------

/// Emitted when a project's splits are permanently locked.
///
/// **Topics:** `["project_locked", project_id]`  
/// **Data:** `project_id`
#[derive(Clone, Debug)]
pub struct ProjectLocked {
    pub project_id: Symbol,
}

impl ProjectLocked {
    #[must_use]
    pub fn new(project_id: Symbol) -> Self {
        Self { project_id }
    }
}

impl Publishable for ProjectLocked {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "project_locked"), self.project_id.clone()),
            self.project_id.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// PaymentSent
// ---------------------------------------------------------------------------

/// Emitted for each individual payment sent during a distribution round.
///
/// **Topics:** `["payment_sent", project_id]`  
/// **Data:** `(recipient, amount_in_stroops)`
#[derive(Clone, Debug)]
pub struct PaymentSent {
    pub project_id: Symbol,
    pub recipient: Address,
    /// Payment amount in stroops; must be > 0.
    pub amount: i128,
}

impl PaymentSent {
    /// # Panics
    /// Panics in debug builds if `amount` is not positive.
    #[must_use]
    pub fn new(project_id: Symbol, recipient: Address, amount: i128) -> Self {
        debug_assert!(amount > 0, "PaymentSent: amount must be positive");
        Self { project_id, recipient, amount }
    }
}

impl Publishable for PaymentSent {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "payment_sent"), self.project_id.clone()),
            (self.recipient.clone(), self.amount),
        );
    }
}

// ---------------------------------------------------------------------------
// DistributionComplete
// ---------------------------------------------------------------------------

/// Emitted once when a full distribution round completes.
///
/// **Topics:** `["distribution_complete", project_id]`  
/// **Data:** `(round_number, total_distributed_in_stroops)`
#[derive(Clone, Debug)]
pub struct DistributionComplete {
    pub project_id: Symbol,
    /// Round counter (1-based).
    pub round: u32,
    /// Total amount distributed in this round, in stroops; must be ≥ 0.
    pub total: i128,
}

impl DistributionComplete {
    /// # Panics
    /// Panics in debug builds if `round` is 0 or `total` is negative.
    #[must_use]
    pub fn new(project_id: Symbol, round: u32, total: i128) -> Self {
        debug_assert!(round > 0, "DistributionComplete: round is 1-based");
        debug_assert!(total >= 0, "DistributionComplete: total must be non-negative");
        Self { project_id, round, total }
    }
}

impl Publishable for DistributionComplete {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "distribution_complete"),
                self.project_id.clone(),
            ),
            (self.round, self.total),
        );
    }
}

// ---------------------------------------------------------------------------
// DepositReceived
// ---------------------------------------------------------------------------

/// Emitted on every successful deposit into a project.
///
/// **Topics:** `["deposit_received", project_id]`  
/// **Data:** `(from, amount_in_stroops, project_balance_in_stroops)`
#[derive(Clone, Debug)]
pub struct DepositReceived {
    pub project_id: Symbol,
    pub from: Address,
    /// Deposited amount in stroops; must be > 0.
    pub amount: i128,
    /// Running project balance after this deposit, in stroops; must be ≥ 0.
    pub project_balance: i128,
}

impl DepositReceived {
    /// # Panics
    /// Panics in debug builds if `amount` ≤ 0 or `project_balance` < 0.
    #[must_use]
    pub fn new(
        project_id: Symbol,
        from: Address,
        amount: i128,
        project_balance: i128,
    ) -> Self {
        debug_assert!(amount > 0, "DepositReceived: amount must be positive");
        debug_assert!(
            project_balance >= 0,
            "DepositReceived: project_balance must be non-negative"
        );
        Self { project_id, from, amount, project_balance }
    }
}

impl Publishable for DepositReceived {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "deposit_received"),
                self.project_id.clone(),
            ),
            (self.from.clone(), self.amount, self.project_balance),
        );
    }
}

// ---------------------------------------------------------------------------
// MetadataUpdated
// ---------------------------------------------------------------------------

/// Emitted when a project's title or type metadata is updated.
///
/// **Topics:** `["metadata_updated", project_id]`  
/// **Data:** `project_id`
#[derive(Clone, Debug)]
pub struct MetadataUpdated {
    pub project_id: Symbol,
}

impl MetadataUpdated {
    #[must_use]
    pub fn new(project_id: Symbol) -> Self {
        Self { project_id }
    }
}

impl Publishable for MetadataUpdated {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "metadata_updated"),
                self.project_id.clone(),
            ),
            self.project_id.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// UnallocatedWithdrawn
// ---------------------------------------------------------------------------

/// Emitted when the admin withdraws the unallocated token balance.
///
/// **Topics:** `["unallocated_withdrawn", token]`  
/// **Data:** `(admin, to, amount_in_stroops, remaining_unallocated_in_stroops)`
#[derive(Clone, Debug)]
pub struct UnallocatedWithdrawn {
    pub token: Address,
    pub admin: Address,
    pub to: Address,
    /// Amount withdrawn in stroops; must be > 0.
    pub amount: i128,
    /// Remaining unallocated balance in stroops; must be ≥ 0.
    pub remaining_unallocated: i128,
}

impl UnallocatedWithdrawn {
    /// # Panics
    /// Panics in debug builds if `amount` ≤ 0 or `remaining_unallocated` < 0.
    #[must_use]
    pub fn new(
        token: Address,
        admin: Address,
        to: Address,
        amount: i128,
        remaining_unallocated: i128,
    ) -> Self {
        debug_assert!(amount > 0, "UnallocatedWithdrawn: amount must be positive");
        debug_assert!(
            remaining_unallocated >= 0,
            "UnallocatedWithdrawn: remaining_unallocated must be non-negative"
        );
        Self { token, admin, to, amount, remaining_unallocated }
    }
}

impl Publishable for UnallocatedWithdrawn {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "unallocated_withdrawn"),
                self.token.clone(),
            ),
            (
                self.admin.clone(),
                self.to.clone(),
                self.amount,
                self.remaining_unallocated,
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// OwnershipTransferred
// ---------------------------------------------------------------------------

/// Emitted when a project's ownership is transferred to a new owner.
///
/// **Topics:** `["ownership_transferred", project_id]`  
/// **Data:** `(previous_owner, new_owner)`
#[derive(Clone, Debug)]
pub struct OwnershipTransferred {
    pub project_id: Symbol,
    pub previous_owner: Address,
    pub new_owner: Address,
}

impl OwnershipTransferred {
    #[must_use]
    pub fn new(project_id: Symbol, previous_owner: Address, new_owner: Address) -> Self {
        Self { project_id, previous_owner, new_owner }
    }
}

impl Publishable for OwnershipTransferred {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "ownership_transferred"),
                self.project_id.clone(),
            ),
            (self.previous_owner.clone(), self.new_owner.clone()),
        );
    }
}

// ---------------------------------------------------------------------------
// CollaboratorsUpdated
// ---------------------------------------------------------------------------

/// Emitted when a project's collaborator list is updated.
///
/// **Topics:** `["collaborators_updated", project_id]`  
/// **Data:** `project_id`
#[derive(Clone, Debug)]
pub struct CollaboratorsUpdated {
    pub project_id: Symbol,
}

impl CollaboratorsUpdated {
    #[must_use]
    pub fn new(project_id: Symbol) -> Self {
        Self { project_id }
    }
}

impl Publishable for CollaboratorsUpdated {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "collaborators_updated"),
                self.project_id.clone(),
            ),
            self.project_id.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// DistributionsPaused / DistributionsUnpaused
// ---------------------------------------------------------------------------

/// Emitted when distributions are paused by the contract admin.
///
/// **Topics:** `["distributions_paused", admin]`  
/// **Data:** `()`
#[derive(Clone, Debug)]
pub struct DistributionsPaused {
    pub admin: Address,
}

impl DistributionsPaused {
    #[must_use]
    pub fn new(admin: Address) -> Self {
        Self { admin }
    }
}

impl Publishable for DistributionsPaused {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "distributions_paused"), self.admin.clone()),
            (),
        );
    }
}

/// Emitted when distributions are unpaused by the contract admin.
///
/// **Topics:** `["distributions_unpaused", admin]`  
/// **Data:** `()`
#[derive(Clone, Debug)]
pub struct DistributionsUnpaused {
    pub admin: Address,
}

impl DistributionsUnpaused {
    #[must_use]
    pub fn new(admin: Address) -> Self {
        Self { admin }
    }
}

impl Publishable for DistributionsUnpaused {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "distributions_unpaused"),
                self.admin.clone(),
            ),
            (),
        );
    }
}

// ---------------------------------------------------------------------------
// CollaboratorClaimed
// ---------------------------------------------------------------------------

/// Emitted when a collaborator self-service claims their proportional share.
///
/// **Topics:** `["collaborator_claimed", project_id]`  
/// **Data:** `(claimer, amount_in_stroops, distribution_round)`
#[derive(Clone, Debug)]
pub struct CollaboratorClaimed {
    pub project_id: Symbol,
    pub claimer: Address,
    /// Claimed amount in stroops; must be > 0.
    pub amount: i128,
    /// 1-based distribution round in which the claim was made.
    pub distribution_round: u32,
}

impl CollaboratorClaimed {
    /// # Panics
    /// Panics in debug builds if `amount` ≤ 0 or `distribution_round` is 0.
    #[must_use]
    pub fn new(
        project_id: Symbol,
        claimer: Address,
        amount: i128,
        distribution_round: u32,
    ) -> Self {
        debug_assert!(amount > 0, "CollaboratorClaimed: amount must be positive");
        debug_assert!(
            distribution_round > 0,
            "CollaboratorClaimed: distribution_round is 1-based"
        );
        Self { project_id, claimer, amount, distribution_round }
    }
}

impl Publishable for CollaboratorClaimed {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "collaborator_claimed"),
                self.project_id.clone(),
            ),
            (self.claimer.clone(), self.amount, self.distribution_round),
        );
    }
}

// ---------------------------------------------------------------------------
// SplitsUpdatedWithPendingBalance
// ---------------------------------------------------------------------------

/// Emitted when splits are updated while a project still carries an
/// undistributed balance.
///
/// > **⚠ Warning for indexers:** the split percentages that apply to the
/// > `pending_balance` are the *new* splits, not the ones in effect when
/// > the funds arrived.
///
/// **Topics:** `["splits_updated_with_pending_balance", project_id]`  
/// **Data:** `pending_balance_in_stroops`
#[derive(Clone, Debug)]
pub struct SplitsUpdatedWithPendingBalance {
    pub project_id: Symbol,
    /// Undistributed balance at the time of the split update, in stroops; must be > 0.
    pub pending_balance: i128,
}

impl SplitsUpdatedWithPendingBalance {
    /// # Panics
    /// Panics in debug builds if `pending_balance` ≤ 0 (no point emitting
    /// this event when the balance is zero).
    #[must_use]
    pub fn new(project_id: Symbol, pending_balance: i128) -> Self {
        debug_assert!(
            pending_balance > 0,
            "SplitsUpdatedWithPendingBalance: pending_balance must be positive"
        );
        Self { project_id, pending_balance }
    }
}

impl Publishable for SplitsUpdatedWithPendingBalance {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (
                // Soroban Symbols are capped at 32 chars; keep this <= 32.
                Symbol::new(env, "splits_updated_pending_balance"),
                self.project_id.clone(),
            ),
            self.pending_balance,
        );
    }
}

// ---------------------------------------------------------------------------
// TokenAllowed / TokenDisallowed
// ---------------------------------------------------------------------------

/// Emitted when the admin adds a token to the contract's allow-list.
///
/// **Topics:** `["token_allowed", token]`  
/// **Data:** `admin`
#[derive(Clone, Debug)]
pub struct TokenAllowed {
    pub token: Address,
    pub admin: Address,
}

impl TokenAllowed {
    #[must_use]
    pub fn new(token: Address, admin: Address) -> Self {
        Self { token, admin }
    }
}

impl Publishable for TokenAllowed {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "token_allowed"), self.token.clone()),
            self.admin.clone(),
        );
    }
}

/// Emitted when the admin removes a token from the contract's allow-list.
///
/// **Topics:** `["token_disallowed", token]`  
/// **Data:** `admin`
#[derive(Clone, Debug)]
pub struct TokenDisallowed {
    pub token: Address,
    pub admin: Address,
}

impl TokenDisallowed {
    #[must_use]
    pub fn new(token: Address, admin: Address) -> Self {
        Self { token, admin }
    }
}

impl Publishable for TokenDisallowed {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "token_disallowed"), self.token.clone()),
            self.admin.clone(),
        );
    }
}

/// Emitted when cached accounted balance exceeds the contract token balance.
#[derive(Clone, Debug)]
pub struct AccountingDiscrepancy {
    pub token: Address,
    pub contract_balance: i128,
    pub accounted_balance: i128,
}

impl AccountingDiscrepancy {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "accounting_discrepancy"), self.token.clone()),
            (self.contract_balance, self.accounted_balance),
        );
    }
}

// ---------------------------------------------------------------------------
// MaxCollaboratorsUpdated
// ---------------------------------------------------------------------------

/// Emitted when the admin reconfigures the per-project collaborator cap.
///
/// **Topics:** `["max_collaborators_set", admin]`
/// **Data:** `value` (the new cap)
#[derive(Clone, Debug)]
pub struct MaxCollaboratorsUpdated {
    pub admin: Address,
    pub value: u32,
}

impl Publishable for MaxCollaboratorsUpdated {
    fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "max_collaborators_set"), self.admin.clone()),
            self.value,
        );
    }
}
