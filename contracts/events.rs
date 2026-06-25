use soroban_sdk::{Address, Env, Symbol};

/// Emitted when a new royalty split project is created.
///
/// Topics:  ["project_created", project_id]
/// Data:    owner address
#[derive(Clone, Debug)]
pub struct ProjectCreated {
    pub project_id: Symbol,
    pub owner: Address,
}

impl ProjectCreated {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "project_created"), self.project_id.clone()),
            self.owner.clone(),
        );
    }
}

/// Emitted when a project's splits are permanently locked.
///
/// Topics:  ["project_locked", project_id]
/// Data:    project_id
#[derive(Clone, Debug)]
pub struct ProjectLocked {
    pub project_id: Symbol,
}

impl ProjectLocked {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "project_locked"), self.project_id.clone()),
            self.project_id.clone(),
        );
    }
}

/// Emitted for each individual payment sent during a distribution.
///
/// Topics:  ["payment_sent", project_id]
/// Data:    (recipient address, amount in stroops)
#[derive(Clone, Debug)]
pub struct PaymentSent {
    pub project_id: Symbol,
    pub recipient: Address,
    pub amount: i128,
}

impl PaymentSent {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "payment_sent"), self.project_id.clone()),
            (self.recipient.clone(), self.amount),
        );
    }
}

/// Emitted once when a full distribution round completes.
///
/// Topics:  ["distribution_complete", project_id]
/// Data:    (round_number, total amount distributed in this round in stroops)
#[derive(Clone, Debug)]
pub struct DistributionComplete {
    pub project_id: Symbol,
    pub round: u32,
    pub total: i128,
}

impl DistributionComplete {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "distribution_complete"),
                self.project_id.clone(),
            ),
            (self.round, self.total),
        );
    }
}

/// Emitted on every successful deposit into a project.
///
/// Topics:  ["deposit_received", project_id]
/// Data:    (from address, amount in stroops, project_balance in stroops)
#[derive(Clone, Debug)]
pub struct DepositReceived {
    pub project_id: Symbol,
    pub from: Address,
    pub amount: i128,
    pub project_balance: i128,
}

impl DepositReceived {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "deposit_received"),
                self.project_id.clone(),
            ),
            (self.from.clone(), self.amount, self.project_balance),
        );
    }
}

/// Emitted when a project's title or type metadata is updated.
///
/// Topics:  ["metadata_updated", project_id]
/// Data:    project_id
#[derive(Clone, Debug)]
pub struct MetadataUpdated {
    pub project_id: Symbol,
}

impl MetadataUpdated {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "metadata_updated"),
                self.project_id.clone(),
            ),
            self.project_id.clone(),
        );
    }
}

/// Emitted when admin withdraws unallocated token balance.
///
/// Topics: ["unallocated_withdrawn", token]
/// Data:   (admin, to, amount, remaining_unallocated)
#[derive(Clone, Debug)]
pub struct UnallocatedWithdrawn {
    pub token: Address,
    pub admin: Address,
    pub to: Address,
    pub amount: i128,
    pub remaining_unallocated: i128,
}

impl UnallocatedWithdrawn {
    pub fn publish(&self, env: &Env) {
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

/// Emitted when a project's ownership is transferred to a new owner.
///
/// Topics:  ["ownership_transferred", project_id]
/// Data:    (previous_owner address, new_owner address)
#[derive(Clone, Debug)]
pub struct OwnershipTransferred {
    pub project_id: Symbol,
    pub previous_owner: Address,
    pub new_owner: Address,
}

impl OwnershipTransferred {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "ownership_transferred"),
                self.project_id.clone(),
            ),
            (self.previous_owner.clone(), self.new_owner.clone()),
        );
    }
}

/// Emitted when a project's collaborators are updated.
///
/// Topics:  ["collaborators_updated", project_id]
/// Data:    project_id
#[derive(Clone, Debug)]
pub struct CollaboratorsUpdated {
    pub project_id: Symbol,
}

impl CollaboratorsUpdated {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "collaborators_updated"),
                self.project_id.clone(),
            ),
            self.project_id.clone(),
        );
    }
}

/// Emitted when distributions are paused by contract admin.
///
/// Topics:  ["distributions_paused", admin]
/// Data:    none
#[derive(Clone, Debug)]
pub struct DistributionsPaused {
    pub admin: Address,
}

impl DistributionsPaused {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "distributions_paused"), self.admin.clone()),
            (),
        );
    }
}

/// Emitted when distributions are unpaused by contract admin.
///
/// Topics:  ["distributions_unpaused", admin]
/// Data:    none
#[derive(Clone, Debug)]
pub struct DistributionsUnpaused {
    pub admin: Address,
}

impl DistributionsUnpaused {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "distributions_unpaused"),
                self.admin.clone(),
            ),
            (),
        );
    }
}

/// Emitted when a collaborator self-service claims their proportional share.
///
/// Topics:  ["collaborator_claimed", project_id]
/// Data:    (claimer address, amount in stroops)
#[derive(Clone, Debug)]
pub struct CollaboratorClaimed {
    pub project_id: Symbol,
    pub claimer: Address,
    pub amount: i128,
    pub distribution_round: u32,
}

impl CollaboratorClaimed {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "collaborator_claimed"), self.project_id.clone()),
            (self.claimer.clone(), self.amount, self.distribution_round),
        );
    }
}

/// Emitted when splits are updated while a project still has undistributed balance.
///
/// Topics:  ["splits_updated_with_pending_balance", project_id]
/// Data:    (pending_balance in stroops)
#[derive(Clone, Debug)]
pub struct SplitsUpdatedWithPendingBalance {
    pub project_id: Symbol,
    pub pending_balance: i128,
}

impl SplitsUpdatedWithPendingBalance {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (
                Symbol::new(env, "splits_updated_with_pending_balance"),
                self.project_id.clone(),
            ),
            self.pending_balance,
        );
    }
}

#[derive(Clone, Debug)]
pub struct TokenAllowed {
    pub token: Address,
    pub admin: Address,
}

impl TokenAllowed {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "token_allowed"), self.token.clone()),
            self.admin.clone(),
        );
    }
}

#[derive(Clone, Debug)]
pub struct TokenDisallowed {
    pub token: Address,
    pub admin: Address,
}

impl TokenDisallowed {
    pub fn publish(&self, env: &Env) {
        env.events().publish(
            (Symbol::new(env, "token_disallowed"), self.token.clone()),
            self.admin.clone(),
        );
    }
}
