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
