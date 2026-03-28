use soroban_sdk::{contractevent, Address, Env, Event, Symbol, Val, Vec};

/// Emitted when a new royalty split project is created.
///
/// Topics:  ["project_created", project_id]
/// Data:    owner address
#[derive(Clone, Debug)]
pub struct ProjectCreated {
    pub project_id: Symbol,
    pub owner: Address,
}

impl Event for ProjectCreated {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "project_created").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        self.owner.clone().into_val(env)
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

impl Event for ProjectLocked {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "project_locked").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        self.project_id.clone().into_val(env)
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

impl Event for PaymentSent {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "payment_sent").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        (self.recipient.clone(), self.amount).into_val(env)
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

impl Event for DistributionComplete {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "distribution_complete").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        (self.round, self.total).into_val(env)
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

impl Event for DepositReceived {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "deposit_received").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        (self.from.clone(), self.amount, self.project_balance).into_val(env)
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

impl Event for MetadataUpdated {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "metadata_updated").into_val(env),
            self.project_id.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        self.project_id.clone().into_val(env)
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

impl Event for UnallocatedWithdrawn {
    fn topics(&self, env: &Env) -> Vec<Val> {
        vec![
            env,
            Symbol::new(env, "unallocated_withdrawn").into_val(env),
            self.token.clone().into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> Val {
        (self.admin.clone(), self.to.clone(), self.amount, self.remaining_unallocated).into_val(env)
    }
}
