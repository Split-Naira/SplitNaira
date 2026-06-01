#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Map, String, Symbol, Vec,
};

/// Number of project IDs stored per bucket to avoid loading the entire index
/// into memory during paginated reads.
const PROJECT_ID_BUCKET_SIZE: u32 = 100;

mod errors;
mod events;
use events::{
    CollaboratorsUpdated, DepositReceived, DistributionComplete, MetadataUpdated,
    OwnershipTransferred, PaymentSent, ProjectCreated, ProjectLocked, UnallocatedWithdrawn,
    DepositReceived, DistributionComplete, MetadataUpdated, OwnershipTransferred, PaymentSent,
    ProjectCreated, ProjectLocked, UnallocatedWithdrawn, CollaboratorsUpdated,
};
#[cfg(test)]
mod tests;

use errors::SplitError;

// Keep active projects alive by extending persistent TTL whenever they are
// created, mutated, distributed, or read.
const PROJECT_TTL_THRESHOLD_LEDGERS: u32 = 50_000;
const PROJECT_TTL_BUMP_LEDGERS: u32 = 100_000;

// ============================================================
//  DATA TYPES
// ============================================================

/// Represents a single collaborator in a royalty split.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Collaborator {
    /// Stellar wallet address of the collaborator
    pub address: Address,
    /// Human-readable alias (e.g. "Burna B.")
    pub alias: String,
    /// Percentage share in basis points (e.g. 5000 = 50.00%)
    /// Using basis points avoids floating point entirely.
    pub basis_points: u32,
}

/// Full metadata for a royalty split project.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SplitProject {
    /// Unique project identifier
    pub project_id: Symbol,
    /// Human-readable project title
    pub title: String,
    /// Project type: "music", "film", "art", "podcast", "book", "other"
    pub project_type: String,
    /// Token contract address (XLM or USDC)
    pub token: Address,
    /// The project creator / admin address
    pub owner: Address,
    /// All collaborators and their splits
    pub collaborators: Vec<Collaborator>,
    /// Whether the split is locked (immutable after locking)
    pub locked: bool,
    /// Total funds distributed so far (in token stroops)
    pub total_distributed: i128,
    /// Number of successful distribution rounds completed
    pub distribution_round: u32,
}

// ============================================================
//  STORAGE KEYS
// ============================================================

#[contracttype]
pub enum DataKey {
    /// Stores SplitProject by project_id
    Project(Symbol),
    /// Tracks available project-specific funds that can be distributed
    ProjectBalance(Symbol),
    /// Tracks how much each address has claimed per project
    Claimed(Symbol, Address),
    /// Total project count (for enumeration)
    ProjectCount,
    /// Stores all project IDs in order for enumeration
    ProjectIds,
    /// Bucketed project ID index for memory-efficient pagination.
    /// Each bucket holds up to PROJECT_ID_BUCKET_SIZE IDs.
    ProjectIdsBucket(u32),
    /// Total number of buckets in the ProjectIdsBucket index.
    ProjectIdsBucketCount,
    /// Contract admin for global allowlist management
    Admin,
    /// Number of allowlisted token contract addresses
    AllowedTokenCount,
    /// Ordered list of allowlisted token contract addresses
    AllowedTokenList,
    /// Allowlisted token contract address marker
    AllowedToken(Address),
    /// Global flag to pause all distributions (emergency stop)
    DistributionsPaused,
}

/// Returned by `get_claimable`: how much a collaborator has received and the
/// last distribution round the project has completed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ClaimableInfo {
    /// Total amount claimed (paid out) to this collaborator across all rounds
    pub claimed: i128,
    /// Number of distribution rounds completed for this project
    pub distribution_round: u32,
}

// ============================================================
//  CONTRACT
// ============================================================

#[contract]
pub struct SplitNairaContract;

#[contractimpl]
impl SplitNairaContract {
    // ----------------------------------------------------------
    // ADMIN + TOKEN ALLOWLIST
    // ----------------------------------------------------------

    /// Sets or rotates the contract admin.
    ///
    /// If admin is not set yet, `admin` must authorize this call.
    /// If admin is already set, the current admin must authorize this call.
    pub fn set_admin(env: Env, admin: Address) -> Result<(), SplitError> {
        if let Some(current_admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
        {
            current_admin.require_auth();
        } else {
            admin.require_auth();
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Pauses all distributions (emergency stop). Only contract admin can call.
    pub fn pause_distributions(env: Env, admin: Address) -> Result<(), SplitError> {
        Self::require_contract_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::DistributionsPaused, &true);
        Ok(())
    }

    /// Unpauses distributions. Only contract admin can call.
    pub fn unpause_distributions(env: Env, admin: Address) -> Result<(), SplitError> {
        Self::require_contract_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::DistributionsPaused, &false);
        Ok(())
    }

    /// Adds a token contract address to the allowlist.
    pub fn allow_token(env: Env, admin: Address, token: Address) -> Result<(), SplitError> {
        Self::require_contract_admin(&env, &admin)?;

        let key = DataKey::AllowedToken(token.clone());
        let is_already_allowed = env.storage().persistent().has(&key);
        if !is_already_allowed {
            env.storage().persistent().set(&key, &true);

            let mut allowed_tokens: Vec<Address> = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokenList)
                .unwrap_or(Vec::new(&env));
            allowed_tokens.push_back(token);
            env.storage()
                .persistent()
                .set(&DataKey::AllowedTokenList, &allowed_tokens);

            let count: u32 = env
                .storage()
                .persistent()
                .get::<DataKey, u32>(&DataKey::AllowedTokenCount)
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::AllowedTokenCount, &count.saturating_add(1));
        }

        Ok(())
    }

    /// Removes a token contract address from the allowlist.
    pub fn disallow_token(env: Env, admin: Address, token: Address) -> Result<(), SplitError> {
        Self::require_contract_admin(&env, &admin)?;

        let key = DataKey::AllowedToken(token.clone());
        let was_allowed = env.storage().persistent().has(&key);
        if was_allowed {
            env.storage().persistent().remove(&key);

            let allowed_tokens: Vec<Address> = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokenList)
                .unwrap_or(Vec::new(&env));
            let mut filtered_tokens = Vec::new(&env);
            for allowed_token in allowed_tokens.iter() {
                if allowed_token != token {
                    filtered_tokens.push_back(allowed_token);
                }
            }
            env.storage()
                .persistent()
                .set(&DataKey::AllowedTokenList, &filtered_tokens);

            let count: u32 = env
                .storage()
                .persistent()
                .get::<DataKey, u32>(&DataKey::AllowedTokenCount)
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::AllowedTokenCount, &count.saturating_sub(1));
        }

        Ok(())
    }

    // ----------------------------------------------------------
    // CREATE PROJECT
    // ----------------------------------------------------------

    /// Creates a new royalty split project on-chain.
    ///
    /// # Arguments
    /// * `env`           - Soroban environment
    /// * `owner`         - Project owner / admin address
    /// * `project_id`    - Unique Symbol identifier for the project
    /// * `title`         - Human-readable project title
    /// * `project_type`  - Category string ("music", "film", etc.)
    /// * `token`         - Address of the Stellar token contract (XLM / USDC)
    /// * `collaborators` - Vec of Collaborator structs with addresses + basis points
    ///
    /// # Errors
    /// * `SplitError::InvalidSplit`      - if basis points don't sum to 10000
    /// * `SplitError::TooFewCollaborators` - if fewer than 2 collaborators provided
    /// * `SplitError::ProjectExists`     - if project_id already exists
    /// * `SplitError::TokenNotAllowed`   - if allowlist is active and token is not allowed
    pub fn create_project(
        env: Env,
        owner: Address,
        project_id: Symbol,
        title: String,
        project_type: String,
        token: Address,
        collaborators: Vec<Collaborator>,
    ) -> Result<(), SplitError> {
        owner.require_auth();

        // Guard: project must not already exist
        if Self::has_project(&env, &project_id) {
            return Err(SplitError::ProjectExists);
        }

        Self::validate_token_allowlist(&env, &token)?;
        Self::validate_collaborators(&env, &collaborators)?;

        let project = SplitProject {
            project_id: project_id.clone(),
            title,
            project_type,
            token,
            owner: owner.clone(),
            collaborators,
            locked: false,
            total_distributed: 0,
            distribution_round: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        env.storage()
            .persistent()
            .set(&DataKey::ProjectBalance(project_id.clone()), &0i128);
        Self::bump_project_ttl(&env, &project_id);

        // Increment global project count
        let count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::ProjectCount)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::ProjectCount, &(count + 1));

        // Add project_id to the index for enumeration
        let mut project_ids: Vec<Symbol> = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIds)
            .unwrap_or(Vec::new(&env));
        project_ids.push_back(project_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ProjectIds, &project_ids);

        // Append to bucketed index for memory-efficient pagination
        let bucket_count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::ProjectIdsBucketCount)
            .unwrap_or(0);
        let total_ids = project_ids.len();
        let target_bucket = (total_ids - 1) / PROJECT_ID_BUCKET_SIZE;
        if target_bucket >= bucket_count {
            let mut new_bucket = Vec::new(&env);
            new_bucket.push_back(project_id.clone());
            env.storage()
                .persistent()
                .set(&DataKey::ProjectIdsBucket(target_bucket), &new_bucket);
            env.storage()
                .persistent()
                .set(&DataKey::ProjectIdsBucketCount, &(bucket_count + 1));
        } else {
            let mut bucket: Vec<Symbol> = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIdsBucket(target_bucket))
                .unwrap_or(Vec::new(&env));
            bucket.push_back(project_id.clone());
            env.storage()
                .persistent()
                .set(&DataKey::ProjectIdsBucket(target_bucket), &bucket);
        }

        // Emit creation event
        ProjectCreated {
            project_id: project_id.clone(),
            owner: owner.clone(),
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // UPDATE COLLABORATORS
    // ----------------------------------------------------------

    /// Updates collaborator addresses and basis point splits for an existing project.
    /// Only the project owner can update, and only while the project is unlocked.
    pub fn update_collaborators(
        env: Env,
        project_id: Symbol,
        owner: Address,
        collaborators: Vec<Collaborator>,
    ) -> Result<(), SplitError> {
        let mut project = Self::get_project_or_err(&env, &project_id)?;

        if project.owner != owner {
            return Err(SplitError::Unauthorized);
        }
        owner.require_auth();

        if project.locked {
            return Err(SplitError::ProjectLocked);
        }

        Self::validate_collaborators(&env, &collaborators)?;

        project.collaborators = collaborators;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        Self::bump_project_ttl(&env, &project.project_id);

        CollaboratorsUpdated {
            project_id: project_id.clone(),
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // LOCK PROJECT
    // ----------------------------------------------------------

    /// Locks a project so splits can no longer be modified.
    /// Only the project owner can lock it.
    ///
    /// Once locked, the split percentages are permanently immutable.
    ///
    /// # Errors
    /// * `SplitError::NotFound`       - if project doesn't exist
    /// * `SplitError::Unauthorized`   - if caller is not the owner
    /// * `SplitError::AlreadyLocked`  - if project is already locked
    pub fn lock_project(env: Env, project_id: Symbol, owner: Address) -> Result<(), SplitError> {
        let mut project = Self::get_project_or_err(&env, &project_id)?;

        if project.owner != owner {
            return Err(SplitError::Unauthorized);
        }
        owner.require_auth();

        if project.locked {
            return Err(SplitError::AlreadyLocked);
        }

        project.locked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        Self::bump_project_ttl(&env, &project_id);

        ProjectLocked {
            project_id: project_id.clone(),
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // DEPOSIT
    // ----------------------------------------------------------

    /// Deposits project funds into this contract and credits the target project's
    /// internal distributable balance.
    pub fn deposit(
        env: Env,
        project_id: Symbol,
        from: Address,
        amount: i128,
    ) -> Result<(), SplitError> {
        if amount <= 0 {
            return Err(SplitError::InvalidAmount);
        }

        let project = Self::get_project_or_err(&env, &project_id)?;
        from.require_auth();

        let token_client = token::Client::new(&env, &project.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&from, &contract_address, &amount);

        let prev_balance: i128 = env
            .storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::ProjectBalance(project_id.clone()))
            .unwrap_or(0);

        let new_balance = prev_balance + amount;
        env.storage()
            .persistent()
            .set(&DataKey::ProjectBalance(project_id.clone()), &new_balance);
        Self::bump_project_ttl(&env, &project_id);

        DepositReceived {
            project_id: project_id.clone(),
            from: from.clone(),
            amount,
            project_balance: new_balance,
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // DISTRIBUTE
    // ----------------------------------------------------------

    /// Distributes the target project's internal balance to all
    /// collaborators according to their basis point shares.
    ///
    /// Compatibility-sensitive invariants:
    /// - `distribution_round` increments exactly once per successful call
    /// - `total_distributed` increases by the exact amount paid out
    /// - the final collaborator receives any integer-division remainder so
    ///   the full project balance is accounted for every round
    ///
    /// Anyone can call distribute — the math is trustless.
    ///
    /// # Arguments
    /// * `env`        - Soroban environment
    /// * `project_id` - The project to distribute for
    ///
    /// # Errors
    /// * `SplitError::NotFound`   - if project doesn't exist
    /// * `SplitError::NoBalance`  - if contract has zero balance
    pub fn distribute(env: Env, project_id: Symbol) -> Result<(), SplitError> {
        // Check if distributions are paused before touching project state.
        let paused: bool = env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::DistributionsPaused)
            .unwrap_or(false);
        if paused {
            return Err(SplitError::DistributionsPaused);
        }

        let mut project = Self::get_project_or_err(&env, &project_id)?;

        // Read project-scoped distributable balance.
        let balance: i128 = env
            .storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::ProjectBalance(project_id.clone()))
            .unwrap_or(0);
        if balance <= 0 {
            return Err(SplitError::NoBalance);
        }

        let token_client = token::Client::new(&env, &project.token);
        let contract_address = env.current_contract_address();

        let mut total_sent: i128 = 0;
        let last_index = project.collaborators.len() - 1;

        for (i, collab) in project.collaborators.iter().enumerate() {
            // Calculate share using basis points
            // For last collaborator, send remainder to avoid dust from rounding
            let amount = if i == last_index as usize {
                balance - total_sent
            } else {
                (balance * collab.basis_points as i128) / 10_000
            };

            if amount > 0 {
                token_client.transfer(&contract_address, &collab.address, &amount);

                // Update claimed ledger
                let prev_claimed: i128 = env
                    .storage()
                    .persistent()
                    .get::<DataKey, i128>(&DataKey::Claimed(
                        project_id.clone(),
                        collab.address.clone(),
                    ))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::Claimed(project_id.clone(), collab.address.clone()),
                    &(prev_claimed + amount),
                );
                Self::bump_claimed_ttl(&env, &project_id, &collab.address);

                total_sent += amount;

                PaymentSent {
                    project_id: project_id.clone(),
                    recipient: collab.address.clone(),
                    amount,
                }
                .publish(&env);
            }
        }

        let remaining_balance = balance - total_sent;
        env.storage().persistent().set(
            &DataKey::ProjectBalance(project_id.clone()),
            &remaining_balance,
        );

        project.total_distributed += total_sent;
        project.distribution_round += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        Self::bump_project_ttl(&env, &project_id);

        DistributionComplete {
            project_id: project_id.clone(),
            round: project.distribution_round,
            total: total_sent,
        }
        .publish(&env);

        Ok(())
    }

    /// Distributes balances for multiple projects in a single transaction.
    ///
    /// Handles partial failures (such as empty balance or project not found)
    /// gracefully by skipping them and continuing to the next.
    ///
    /// # Arguments
    /// * `env`         - Soroban environment
    /// * `project_ids` - Vector of project IDs to distribute
    pub fn batch_distribute(env: Env, project_ids: Vec<Symbol>) -> Result<(), SplitError> {
        let paused: bool = env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::DistributionsPaused)
            .unwrap_or(false);
        if paused {
            return Err(SplitError::DistributionsPaused);
        }

        for project_id in project_ids.iter() {
            match Self::distribute(env.clone(), project_id) {
                Ok(_) => {}
                Err(SplitError::DistributionsPaused) => return Err(SplitError::DistributionsPaused),
                Err(_) => {
                    // Gracefully skip other errors
                }
            }
        }

        Ok(())
    }

    // ----------------------------------------------------------
    // READ-ONLY QUERIES
    // ----------------------------------------------------------

    /// Returns the full SplitProject struct for a given project ID.
    pub fn get_project(env: Env, project_id: Symbol) -> Option<SplitProject> {
        let project = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id.clone()));
        if project.is_some() {
            Self::bump_project_ttl(&env, &project_id);
        }
        project
    }

    /// Returns true if the project key exists in persistent storage.
    pub fn project_exists(env: Env, project_id: Symbol) -> bool {
        Self::has_project(&env, &project_id)
    }

    /// Returns how much a specific address has been paid for a project.
    pub fn get_claimed(env: Env, project_id: Symbol, address: Address) -> i128 {
        if Self::has_project(&env, &project_id) {
            Self::bump_project_ttl(&env, &project_id);
            Self::bump_claimed_ttl(&env, &project_id, &address);
        }
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::Claimed(project_id, address))
            .unwrap_or(0)
    }

    /// Explicit, permissionless storage maintenance endpoint.
    ///
    /// Operators can call this for inactive-but-important projects to keep
    /// project state and collaborator claimed ledgers alive over long periods.
    pub fn refresh_project_storage(env: Env, project_id: Symbol) -> Result<(), SplitError> {
        Self::get_project_or_err(&env, &project_id)?;
        Ok(())
    }

    /// Returns the total number of projects created on this contract.
    pub fn get_project_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::ProjectCount)
            .unwrap_or(0)
    }

    /// Returns a list of projects with pagination.
    /// Does not bump TTL to avoid excessive storage writes during listing.
    ///
    /// Compatibility-sensitive invariant: results must stay aligned with
    /// `get_project_ids(start, limit)` and preserve creation order even after
    /// metadata edits, locking, deposits, or distributions.
    ///
    /// # Arguments
    /// * `start` - Starting index (0-based)
    /// * `limit` - Maximum number of projects to return
    ///
    /// # Returns
    /// Vector of SplitProject structs
    pub fn list_projects(env: Env, start: u32, limit: u32) -> Vec<SplitProject> {
        let ids = Self::get_project_ids_from_buckets(&env, start, limit);
        let mut result = Vec::new(&env);
        for project_id in ids.iter() {
            if let Some(project) = env
                .storage()
                .persistent()
                .get::<DataKey, SplitProject>(&DataKey::Project(project_id))
            {
                result.push_back(project);
            }
        }
        result
    }

    /// Returns the project-scoped distributable balance.
    pub fn get_balance(env: Env, project_id: Symbol) -> Result<i128, SplitError> {
        Self::get_project_or_err(&env, &project_id)?;
        Ok(env
            .storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::ProjectBalance(project_id))
            .unwrap_or(0))
    }

    /// Returns contract token balance not accounted for in any project balance.
    ///
    /// `unallocated = token_balance(contract) - sum(project_balances_for_token)`
    pub fn get_unallocated_balance(env: Env, token: Address) -> Result<i128, SplitError> {
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let contract_token_balance = token_client.balance(&contract_address);

        let accounted = Self::sum_project_balances_for_token(&env, &token)?;
        Ok(contract_token_balance - accounted)
    }

    /// Admin-only recovery for direct token transfers into the contract address.
    ///
    /// This method can only withdraw the currently unallocated portion for the
    /// specified token and never touches any project-accounted balance.
    pub fn withdraw_unallocated(
        env: Env,
        admin: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), SplitError> {
        Self::require_contract_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(SplitError::InvalidAmount);
        }

        // Security hardening (Wave 5 / issue #401): prevent accidental self-transfer
        // that would lock funds inside the contract indefinitely.
        if to == env.current_contract_address() {
            return Err(SplitError::InvalidRecipient);
        }

        let available = Self::get_unallocated_balance(env.clone(), token.clone())?;
        if amount > available {
            return Err(SplitError::InsufficientUnallocated);
        }

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&contract_address, &to, &amount);

        let remaining = available - amount;
        UnallocatedWithdrawn {
            token: token.clone(),
            admin: admin.clone(),
            to: to.clone(),
            amount,
            remaining_unallocated: remaining,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns true if a token is currently allowlisted.
    pub fn is_token_allowed(env: Env, token: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::AllowedToken(token))
    }
    /// Returns true if distributions are currently paused.
    pub fn is_distributions_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::DistributionsPaused)
            .unwrap_or(false)
    }
    /// Returns the number of allowlisted token addresses.
    pub fn get_allowed_token_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::AllowedTokenCount)
            .unwrap_or(0)
    }

    /// Returns a paginated list of allowlisted token addresses.
    pub fn get_allowed_tokens(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let allowed_tokens: Vec<Address> = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokenList)
            .unwrap_or(Vec::new(&env));

        let total = allowed_tokens.len();
        if start >= total {
            return Vec::new(&env);
        }

        let end = (start + limit).min(total);
        let mut result = Vec::new(&env);
        for i in start..end {
            if let Some(token) = allowed_tokens.get(i) {
                result.push_back(token);
            }
        }

        result
    }

    /// Returns the configured contract admin, if set.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
    }

    /// Returns a paginated list of project IDs (Symbols) in creation order.
    /// Does not bump TTL to avoid excessive storage writes during listing.
    ///
    /// Compatibility-sensitive invariant: this index is append-only in
    /// creation order for the lifetime of the contract.
    ///
    /// # Arguments
    /// * `start` - Zero-based index of the first project to return
    /// * `limit` - Maximum number of IDs to return
    ///
    /// Returns an empty Vec when `start` is beyond the total project count.
    pub fn get_project_ids(env: Env, start: u32, limit: u32) -> Vec<Symbol> {
        Self::get_project_ids_from_buckets(&env, start, limit)
    }

    /// Returns how much a collaborator has been paid across all distribution
    /// rounds for a given project, plus the number of completed rounds.
    ///
    /// # Errors
    /// * `SplitError::NotFound` - if the project does not exist
    pub fn get_claimable(
        env: Env,
        project_id: Symbol,
        collaborator: Address,
    ) -> Result<ClaimableInfo, SplitError> {
        let project = Self::get_project_or_err(&env, &project_id)?;
        Self::bump_claimed_ttl(&env, &project_id, &collaborator);
        let claimed = env
            .storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::Claimed(project_id, collaborator))
            .unwrap_or(0);
        Ok(ClaimableInfo {
            claimed,
            distribution_round: project.distribution_round,
        })
    }

    /// Updates the `title` and `project_type` of an existing project.
    ///
    /// Only the project owner can call this, and only while the project is
    /// unlocked. Only these metadata fields are mutable; ownership, token,
    /// collaborator splits, lock state, and payout accounting must remain
    /// unchanged. Emits a `metadata_updated` event on success.
    ///
    /// # Errors
    /// * `SplitError::NotFound`     - if the project does not exist
    /// * `SplitError::Unauthorized` - if caller is not the owner
    /// * `SplitError::ProjectLocked` - if the project is locked
    pub fn update_project_metadata(
        env: Env,
        project_id: Symbol,
        owner: Address,
        title: String,
        project_type: String,
    ) -> Result<(), SplitError> {
        let mut project = Self::get_project_or_err(&env, &project_id)?;

        if project.owner != owner {
            return Err(SplitError::Unauthorized);
        }
        owner.require_auth();

        if project.locked {
            return Err(SplitError::ProjectLocked);
        }

        project.title = title;
        project.project_type = project_type;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        Self::bump_project_ttl(&env, &project_id);

        MetadataUpdated {
            project_id: project_id.clone(),
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // TRANSFER OWNERSHIP
    // ----------------------------------------------------------

    /// Transfers ownership of a project to a new address.
    ///
    /// Only the current owner can call this. Works on both locked and unlocked
    /// projects — ownership transfer does not depend on lock state. The new
    /// owner gains all owner-gated capabilities (update metadata, update
    /// collaborators on unlocked projects, lock, transfer again).
    ///
    /// # Errors
    /// * `SplitError::NotFound`     - if the project does not exist
    /// * `SplitError::Unauthorized` - if caller is not the current owner
    pub fn transfer_project_ownership(
        env: Env,
        project_id: Symbol,
        current_owner: Address,
        new_owner: Address,
    ) -> Result<(), SplitError> {
        let mut project = Self::get_project_or_err(&env, &project_id)?;

        if project.owner != current_owner {
            return Err(SplitError::Unauthorized);
        }
        current_owner.require_auth();

        let previous_owner = project.owner.clone();
        project.owner = new_owner.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        Self::bump_project_ttl(&env, &project_id);

        OwnershipTransferred {
            project_id: project_id.clone(),
            previous_owner,
            new_owner,
        }
        .publish(&env);

        Ok(())
    }

    // ----------------------------------------------------------
    // INTERNAL HELPERS
    // ----------------------------------------------------------

    fn get_project_or_err(env: &Env, project_id: &Symbol) -> Result<SplitProject, SplitError> {
        let project = env
            .storage()
            .persistent()
            .get::<DataKey, SplitProject>(&DataKey::Project(project_id.clone()))
            .ok_or(SplitError::NotFound)?;
        Self::bump_project_ttl(env, project_id);
        Ok(project)
    }

    /// Performs a cheap key existence check without loading project data.
    fn has_project(env: &Env, project_id: &Symbol) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Project(project_id.clone()))
    }

    /// Extends TTL for the core project entries so active projects don't expire.
    /// This is called on hot paths (read/write/distribute/create).
    fn bump_project_ttl(env: &Env, project_id: &Symbol) {
        let project_key = DataKey::Project(project_id.clone());
        let balance_key = DataKey::ProjectBalance(project_id.clone());
        env.storage().persistent().extend_ttl(
            &project_key,
            PROJECT_TTL_THRESHOLD_LEDGERS,
            PROJECT_TTL_BUMP_LEDGERS,
        );
        env.storage().persistent().extend_ttl(
            &balance_key,
            PROJECT_TTL_THRESHOLD_LEDGERS,
            PROJECT_TTL_BUMP_LEDGERS,
        );
    }

    /// Extends TTL for collaborator-level claimed ledger when the key exists.
    fn bump_claimed_ttl(env: &Env, project_id: &Symbol, collaborator: &Address) {
        let claimed_key = DataKey::Claimed(project_id.clone(), collaborator.clone());
        if env.storage().persistent().has(&claimed_key) {
            env.storage().persistent().extend_ttl(
                &claimed_key,
                PROJECT_TTL_THRESHOLD_LEDGERS,
                PROJECT_TTL_BUMP_LEDGERS,
            );
        }
    }

    fn require_contract_admin(env: &Env, admin: &Address) -> Result<(), SplitError> {
        let current_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .ok_or(SplitError::AdminNotSet)?;

        if current_admin != admin.clone() {
            return Err(SplitError::Unauthorized);
        }

        admin.require_auth();
        Ok(())
    }

    fn validate_token_allowlist(env: &Env, token: &Address) -> Result<(), SplitError> {
        let allowed_token_count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::AllowedTokenCount)
            .unwrap_or(0);

        if allowed_token_count == 0 {
            return Ok(());
        }

        let is_allowed = env
            .storage()
            .persistent()
            .has(&DataKey::AllowedToken(token.clone()));
        if !is_allowed {
            return Err(SplitError::TokenNotAllowed);
        }

        Ok(())
    }

    fn validate_collaborators(
        env: &Env,
        collaborators: &Vec<Collaborator>,
    ) -> Result<(), SplitError> {
        if collaborators.len() < 2 {
            return Err(SplitError::TooFewCollaborators);
        }

        let mut total_bp: u32 = 0;
        let mut seen: Map<Address, bool> = Map::new(env);

        for collab in collaborators.iter() {
            if collab.basis_points == 0 {
                return Err(SplitError::ZeroShare);
            }
            total_bp = total_bp
                .checked_add(collab.basis_points)
                .ok_or(SplitError::ArithmeticOverflow)?;

            if seen.contains_key(collab.address.clone()) {
                return Err(SplitError::DuplicateCollaborator);
            }
            seen.set(collab.address.clone(), true);
        }

        if total_bp != 10_000 {
            return Err(SplitError::InvalidSplit);
        }

        Ok(())
    }

    /// Reads project IDs from the bucketed index for the requested range.
    /// Falls back to the flat ProjectIds Vec if bucketed index is empty.
    fn get_project_ids_from_buckets(env: &Env, start: u32, limit: u32) -> Vec<Symbol> {
        let bucket_count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::ProjectIdsBucketCount)
            .unwrap_or(0);

        if bucket_count > 0 {
            let mut ids = Vec::new(env);
            let mut idx = start;
            let end = start.saturating_add(limit);
            while idx < end {
                let bucket = idx / PROJECT_ID_BUCKET_SIZE;
                if bucket >= bucket_count {
                    break;
                }
                let offset = idx % PROJECT_ID_BUCKET_SIZE;
                let bucket_data: Vec<Symbol> = env
                    .storage()
                    .persistent()
                    .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIdsBucket(bucket))
                    .unwrap_or(Vec::new(env));
                let remaining_in_bucket = bucket_data.len().saturating_sub(offset as u32);
                if remaining_in_bucket == 0 {
                    let next_bucket_idx = (bucket + 1) * PROJECT_ID_BUCKET_SIZE;
                    if next_bucket_idx <= idx {
                        break;
                    }
                    idx = next_bucket_idx;
                    continue;
                }
                let needed = end.saturating_sub(idx);
                let take = remaining_in_bucket.min(needed);
                for i in 0..take {
                    if let Some(id) = bucket_data.get(offset + i) {
                        ids.push_back(id);
                    }
                }
                idx += take;
            }
            ids
        } else {
            env.storage()
                .persistent()
                .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIds)
                .unwrap_or(Vec::new(env))
        }
    }

    /// Loads all project IDs by iterating buckets. Falls back to flat Vec.
    fn get_all_project_ids(env: &Env) -> Vec<Symbol> {
        let bucket_count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::ProjectIdsBucketCount)
            .unwrap_or(0);
        if bucket_count > 0 {
            let mut all = Vec::new(env);
            for i in 0..bucket_count {
                let bucket: Vec<Symbol> = env
                    .storage()
                    .persistent()
                    .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIdsBucket(i))
                    .unwrap_or(Vec::new(env));
                for id in bucket.iter() {
                    all.push_back(id);
                }
            }
            all
        } else {
            env.storage()
                .persistent()
                .get::<DataKey, Vec<Symbol>>(&DataKey::ProjectIds)
                .unwrap_or(Vec::new(env))
        }
    }

    fn sum_project_balances_for_token(env: &Env, token: &Address) -> Result<i128, SplitError> {
        let project_ids = Self::get_all_project_ids(env);

        let mut total: i128 = 0;
        for project_id in project_ids.iter() {
            if let Some(project) = env
                .storage()
                .persistent()
                .get::<DataKey, SplitProject>(&DataKey::Project(project_id.clone()))
            {
                if project.token == token.clone() {
                    let project_balance = env
                        .storage()
                        .persistent()
                        .get::<DataKey, i128>(&DataKey::ProjectBalance(project_id))
                        .unwrap_or(0);
                    total = total
                        .checked_add(project_balance)
                        .ok_or(SplitError::ArithmeticOverflow)?;
                }
            }
        }

        Ok(total)
    }
}
