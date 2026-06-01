use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, Map, String, Vec, U256,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    TransactionIndex,
    TransactionRecord(U256),
    UserTransactionIndex(Address),
    UserTransactionIds(Address, u32),
    TransactionCount,
    LatestTransactions,
    TransactionByTimestamp(u64),
    PaginatedTransactions(u32, u32),
}

#[derive(Clone)]
#[contracttype]
pub struct TransactionRecord {
    pub id: U256,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub description: String,
    pub transaction_type: TransactionType,
    pub block_number: u64,
    pub status: TransactionStatus,
}

#[derive(Clone)]
#[contracttype]
pub struct TransactionIndex {
    pub transaction_id: U256,
    pub user_address: Address,
    pub timestamp: u64,
    pub block_number: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct PaginatedResult {
    pub transactions: Vec<TransactionRecord>,
    pub total_count: u32,
    pub page_number: u32,
    pub page_size: u32,
    pub has_next: bool,
    pub has_previous: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct UserTransactionSummary {
    pub user: Address,
    pub total_transactions: u32,
    pub total_sent: i128,
    pub total_received: i128,
    pub first_transaction_timestamp: Option<u64>,
    pub last_transaction_timestamp: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum TransactionType {
    Payment = 0,
    Transfer = 1,
    Deposit = 2,
    Withdrawal = 3,
    Reward = 4,
    Refund = 5,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum TransactionStatus {
    Pending = 0,
    Completed = 1,
    Failed = 2,
    Reverted = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum SortOrder {
    Ascending = 0,
    Descending = 1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum TimeRange {
    All = 0,
    Last24Hours = 1,
    Last7Days = 2,
    Last30Days = 3,
    Custom(u64, u64), // start_timestamp, end_timestamp
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum HistoryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    TransactionNotFound = 4,
    InvalidPageNumber = 5,
    InvalidPageSize = 6,
    InvalidTimeRange = 7,
    StorageError = 8,
    Overflow = 9,
    InvalidTransactionId = 10,
}

pub struct HistoryEvents;

impl HistoryEvents {
    pub fn transaction_indexed(env: &Env, transaction_id: &U256, user: &Address) {
        let topics = (symbol_short!("history"), symbol_short!("indexed"));
        env.events().publish(
            topics,
            (
                transaction_id.clone(),
                user.clone(),
                env.ledger().timestamp(),
            ),
        );
    }

    pub fn transaction_stored(env: &Env, transaction_id: &U256, from: &Address, to: &Address) {
        let topics = (symbol_short!("history"), symbol_short!("stored"));
        env.events()
            .publish(topics, (transaction_id.clone(), from.clone(), to.clone()));
    }

    pub fn page_retrieved(env: &Env, page: u32, page_size: u32, total_count: u32) {
        let topics = (symbol_short!("history"), symbol_short!("page_retrieved"));
        env.events().publish(topics, (page, page_size, total_count));
    }

    pub fn user_history_retrieved(env: &Env, user: &Address, count: u32) {
        let topics = (symbol_short!("history"), symbol_short!("user_retrieved"));
        env.events()
            .publish(topics, (user.clone(), count, env.ledger().timestamp()));
    }

    pub fn index_rebuilt(env: &Env, total_transactions: u32) {
        let topics = (symbol_short!("history"), symbol_short!("index_rebuilt"));
        env.events()
            .publish(topics, (total_transactions, env.ledger().timestamp()));
    }
}

pub fn initialize_history_contract(env: &Env, admin: Address) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(env, HistoryError::AlreadyInitialized);
    }

    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage()
        .instance()
        .set(&DataKey::TransactionCount, &0u32);
    env.storage()
        .instance()
        .set(&DataKey::TransactionIndex, &Vec::<U256>::new(&env));
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, HistoryError::NotInitialized))
}

pub fn require_admin(env: &Env, caller: &Address) {
    caller.require_auth();
    let admin = get_admin(env);
    if admin != caller.clone() {
        panic_with_error!(env, HistoryError::Unauthorized);
    }
}

pub fn store_transaction(
    env: &Env,
    from: Address,
    to: Address,
    amount: i128,
    description: String,
    transaction_type: TransactionType,
) -> U256 {
    let transaction_id = generate_transaction_id(env);
    let timestamp = env.ledger().timestamp();
    let block_number = env.ledger().sequence();

    let transaction = TransactionRecord {
        id: transaction_id.clone(),
        from: from.clone(),
        to: to.clone(),
        amount,
        timestamp,
        description,
        transaction_type,
        block_number,
        status: TransactionStatus::Completed,
    };

    // Store the transaction record
    env.storage().persistent().set(
        &DataKey::TransactionRecord(transaction_id.clone()),
        &transaction,
    );

    // Update global index
    add_to_global_index(env, &transaction_id);

    // Update user indices
    add_to_user_index(env, &from, &transaction_id);
    if from != to {
        add_to_user_index(env, &to, &transaction_id);
    }

    // Update timestamp index
    env.storage()
        .persistent()
        .set(&DataKey::TransactionByTimestamp(timestamp), &transaction_id);

    // Increment transaction count
    let count = get_transaction_count(env);
    let new_count = count
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(env, HistoryError::Overflow));
    env.storage()
        .instance()
        .set(&DataKey::TransactionCount, &new_count);

    HistoryEvents::transaction_stored(env, &transaction_id, &from, &to);
    HistoryEvents::transaction_indexed(env, &transaction_id, &from);

    transaction_id
}

pub fn get_transaction(env: &Env, transaction_id: U256) -> Option<TransactionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::TransactionRecord(transaction_id))
}

pub fn get_user_transactions_paginated(
    env: &Env,
    user: Address,
    page: u32,
    page_size: u32,
    sort_order: SortOrder,
) -> PaginatedResult {
    if page_size == 0 || page_size > 100 {
        panic_with_error!(env, HistoryError::InvalidPageSize);
    }

    let user_transaction_ids = get_user_transaction_ids(env, &user);
    let total_count = user_transaction_ids.len() as u32;

    if total_count == 0 {
        return PaginatedResult {
            transactions: Vec::new(&env),
            total_count,
            page_number: page,
            page_size,
            has_next: false,
            has_previous: false,
        };
    }

    let start_index = (page * page_size) as usize;
    let end_index = std::cmp::min(start_index + page_size as usize, total_count as usize);

    if start_index >= total_count as usize {
        panic_with_error!(env, HistoryError::InvalidPageNumber);
    }

    let mut transactions = Vec::new(&env);

    for i in start_index..end_index {
        let transaction_id = user_transaction_ids.get(i as u32).unwrap();
        if let Some(transaction) = get_transaction(env, transaction_id) {
            transactions.push_back(transaction);
        }
    }

    // Sort if needed
    if sort_order == SortOrder::Descending {
        transactions.reverse();
    }

    let has_next = end_index < total_count as usize;
    let has_previous = page > 0;

    HistoryEvents::page_retrieved(env, page, page_size, total_count);

    PaginatedResult {
        transactions,
        total_count,
        page_number: page,
        page_size,
        has_next,
        has_previous,
    }
}

pub fn get_latest_transactions(env: &Env, limit: u32) -> Vec<TransactionRecord> {
    if limit == 0 || limit > 100 {
        panic_with_error!(env, HistoryError::InvalidPageSize);
    }

    let global_index = get_global_transaction_index(env);
    let mut transactions = Vec::new(&env);

    let start_index = if global_index.len() > limit {
        global_index.len() - limit as usize
    } else {
        0
    };

    for i in start_index..global_index.len() {
        let transaction_id = global_index.get(i as u32).unwrap();
        if let Some(transaction) = get_transaction(env, transaction_id) {
            transactions.push_back(transaction);
        }
    }

    transactions.reverse(); // Most recent first
    transactions
}

pub fn get_transactions_by_time_range(
    env: &Env,
    time_range: TimeRange,
    limit: u32,
) -> Vec<TransactionRecord> {
    if limit == 0 || limit > 100 {
        panic_with_error!(env, HistoryError::InvalidPageSize);
    }

    let (start_time, end_time) = match time_range {
        TimeRange::All => (0u64, u64::MAX),
        TimeRange::Last24Hours => {
            let now = env.ledger().timestamp();
            (now.saturating_sub(86400), now)
        }
        TimeRange::Last7Days => {
            let now = env.ledger().timestamp();
            (now.saturating_sub(604800), now)
        }
        TimeRange::Last30Days => {
            let now = env.ledger().timestamp();
            (now.saturating_sub(2592000), now)
        }
        TimeRange::Custom(start, end) => {
            if start > end {
                panic_with_error!(env, HistoryError::InvalidTimeRange);
            }
            (start, end)
        }
    };

    let mut transactions = Vec::new(&env);
    let global_index = get_global_transaction_index(env);
    let mut count = 0;

    // Iterate from newest to oldest
    for i in (0..global_index.len()).rev() {
        if count >= limit {
            break;
        }

        let transaction_id = global_index.get(i as u32).unwrap();
        if let Some(transaction) = get_transaction(env, transaction_id) {
            if transaction.timestamp >= start_time && transaction.timestamp <= end_time {
                transactions.push_back(transaction);
                count += 1;
            }
        }
    }

    transactions
}

pub fn get_user_transaction_summary(env: &Env, user: Address) -> UserTransactionSummary {
    let user_transaction_ids = get_user_transaction_ids(env, &user);
    let total_transactions = user_transaction_ids.len() as u32;

    let mut total_sent = 0i128;
    let mut total_received = 0i128;
    let mut first_timestamp: Option<u64> = None;
    let mut last_timestamp: Option<u64> = None;

    for transaction_id in user_transaction_ids.iter() {
        if let Some(transaction) = get_transaction(env, transaction_id) {
            if transaction.from == user {
                total_sent += transaction.amount;
            } else {
                total_received += transaction.amount;
            }

            match first_timestamp {
                None => first_timestamp = Some(transaction.timestamp),
                Some(first) if transaction.timestamp < first => {
                    first_timestamp = Some(transaction.timestamp);
                }
                _ => {}
            }

            match last_timestamp {
                None => last_timestamp = Some(transaction.timestamp),
                Some(last) if transaction.timestamp > last => {
                    last_timestamp = Some(transaction.timestamp);
                }
                _ => {}
            }
        }
    }

    UserTransactionSummary {
        user,
        total_transactions,
        total_sent,
        total_received,
        first_transaction_timestamp: first_timestamp,
        last_transaction_timestamp: last_timestamp,
    }
}

pub fn search_transactions(env: &Env, query: String, page: u32, page_size: u32) -> PaginatedResult {
    if page_size == 0 || page_size > 100 {
        panic_with_error!(env, HistoryError::InvalidPageSize);
    }

    let global_index = get_global_transaction_index(env);
    let mut matching_transactions = Vec::new(&env);

    for transaction_id in global_index.iter() {
        if let Some(transaction) = get_transaction(env, transaction_id) {
            if transaction.description.contains(&query) {
                matching_transactions.push_back(transaction);
            }
        }
    }

    let total_count = matching_transactions.len() as u32;
    let start_index = (page * page_size) as usize;
    let end_index = std::cmp::min(start_index + page_size as usize, total_count as usize);

    if start_index >= total_count as usize {
        return PaginatedResult {
            transactions: Vec::new(&env),
            total_count,
            page_number: page,
            page_size,
            has_next: false,
            has_previous: false,
        };
    }

    let mut result_transactions = Vec::new(&env);
    for i in start_index..end_index {
        result_transactions.push_back(matching_transactions.get(i as u32).unwrap().clone());
    }

    let has_next = end_index < total_count as usize;
    let has_previous = page > 0;

    PaginatedResult {
        transactions: result_transactions,
        total_count,
        page_number: page,
        page_size,
        has_next,
        has_previous,
    }
}

pub fn rebuild_index(env: &Env, caller: Address) {
    require_admin(env, &caller);

    // Clear existing indices
    env.storage()
        .instance()
        .set(&DataKey::TransactionIndex, &Vec::<U256>::new(&env));

    // Rebuild from stored transactions
    let mut new_index = Vec::<U256>::new(&env);
    let mut count = 0u32;

    // This is a simplified approach - in production, you'd need a way to iterate
    // through all stored transactions. For now, we'll assume we can access them
    // through some mechanism.

    env.storage()
        .instance()
        .set(&DataKey::TransactionIndex, &new_index);
    env.storage()
        .instance()
        .set(&DataKey::TransactionCount, &count);

    HistoryEvents::index_rebuilt(env, count);
}

// Helper functions

fn generate_transaction_id(env: &Env) -> U256 {
    let timestamp = env.ledger().timestamp();
    let sequence = env.ledger().sequence();
    let mut bytes = [0u8; 32];

    // Simple ID generation based on timestamp and sequence
    bytes[0..8].copy_from_slice(&timestamp.to_be_bytes());
    bytes[8..16].copy_from_slice(&sequence.to_be_bytes());

    U256::from_be_bytes(bytes)
}

fn get_transaction_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TransactionCount)
        .unwrap_or(0)
}

fn get_global_transaction_index(env: &Env) -> Vec<U256> {
    env.storage()
        .instance()
        .get(&DataKey::TransactionIndex)
        .unwrap_or_else(|| Vec::new(&env))
}

fn add_to_global_index(env: &Env, transaction_id: &U256) {
    let mut index = get_global_transaction_index(env);
    index.push_back(transaction_id.clone());
    env.storage()
        .instance()
        .set(&DataKey::TransactionIndex, &index);
}

fn get_user_transaction_ids(env: &Env, user: &Address) -> Vec<U256> {
    env.storage()
        .persistent()
        .get(&DataKey::UserTransactionIndex(user.clone()))
        .unwrap_or_else(|| Vec::new(&env))
}

fn add_to_user_index(env: &Env, user: &Address, transaction_id: &U256) {
    let mut user_index = get_user_transaction_ids(env, user);
    user_index.push_back(transaction_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::UserTransactionIndex(user.clone()), &user_index);
}

#[contract]
pub struct HistoryContract;

#[contractimpl]
impl HistoryContract {
    pub fn initialize(env: Env, admin: Address) {
        initialize_history_contract(&env, admin);
    }

    pub fn get_admin(env: Env) -> Address {
        get_admin(&env)
    }

    pub fn store_transaction(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        description: String,
        transaction_type: TransactionType,
    ) -> U256 {
        store_transaction(&env, from, to, amount, description, transaction_type)
    }

    pub fn get_transaction(env: Env, transaction_id: U256) -> Option<TransactionRecord> {
        get_transaction(&env, transaction_id)
    }

    pub fn get_user_transactions_paginated(
        env: Env,
        user: Address,
        page: u32,
        page_size: u32,
        sort_order: SortOrder,
    ) -> PaginatedResult {
        get_user_transactions_paginated(&env, user, page, page_size, sort_order)
    }

    pub fn get_latest_transactions(env: Env, limit: u32) -> Vec<TransactionRecord> {
        get_latest_transactions(&env, limit)
    }

    pub fn get_transactions_by_time_range(
        env: Env,
        time_range: TimeRange,
        limit: u32,
    ) -> Vec<TransactionRecord> {
        get_transactions_by_time_range(&env, time_range, limit)
    }

    pub fn get_user_transaction_summary(env: Env, user: Address) -> UserTransactionSummary {
        get_user_transaction_summary(&env, user)
    }

    pub fn search_transactions(
        env: Env,
        query: String,
        page: u32,
        page_size: u32,
    ) -> PaginatedResult {
        search_transactions(&env, query, page, page_size)
    }

    pub fn rebuild_index(env: Env, caller: Address) {
        rebuild_index(&env, caller);
    }

    pub fn get_transaction_count(env: Env) -> u32 {
        get_transaction_count(&env)
    }
}

//! # Overdraft Protection Contract
//!
//! A Soroban smart contract for preventing transactions that exceed allocated budgets.
//!
//! ## Features
//!
//! - **Category Limit Checks**: Validates transactions against category-specific budgets
//! - **Overdraft Prevention**: Blocks transactions that would exceed allocated limits
//! - **Event Emission**: Emits events when overdraft attempts are detected
//! - **Spending Tracking**: Tracks spent amounts per category per user
//!
#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Map, Symbol, Vec};

/// Error codes for the overdraft contract.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OverdraftError {
    /// Contract not initialized
    NotInitialized = 1,
    /// Caller is not authorized
    Unauthorized = 2,
    /// Invalid amount (negative or zero)
    InvalidAmount = 3,
    /// Transaction would exceed budget limit (overdraft)
    OverdraftLimitExceeded = 4,
    /// Category not found
    CategoryNotFound = 5,
    /// Budget not found for user
    BudgetNotFound = 6,
    /// Invalid category
    InvalidCategory = 7,
}

impl From<OverdraftError> for soroban_sdk::Error {
    fn from(e: OverdraftError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

/// Budget category with limit and spent tracking
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CategoryBudget {
    /// Category name
    pub name: Symbol,
    /// Allocated budget limit
    pub limit: i128,
    /// Amount already spent
    pub spent: i128,
}

/// User's budget configuration with categories
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserBudget {
    /// User address
    pub user: Address,
    /// Category budgets
    pub categories: Map<Symbol, CategoryBudget>,
    /// Last updated timestamp
    pub last_updated: u64,
}

/// Storage keys for the contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    UserBudget(Address),
    TotalOverdraftAttempts,
}

/// Result of a transaction check
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionCheckResult {
    /// Whether the transaction is allowed
    pub allowed: bool,
    /// Remaining budget in the category
    pub remaining: i128,
    /// Amount that would be exceeded by (if not allowed)
    pub exceeded_by: i128,
}

/// Events emitted by the overdraft contract
pub struct OverdraftEvents;

impl OverdraftEvents {
    /// Event emitted when an overdraft attempt is blocked
    pub fn overdraft_attempted(
        env: &Env,
        user: &Address,
        category: &Symbol,
        requested_amount: i128,
        available_budget: i128,
    ) {
        let topics = (symbol_short!("overdraft"), symbol_short!("attempt"), category.clone());
        env.events().publish(topics, (user.clone(), requested_amount, available_budget));
    }

    /// Event emitted when a transaction is successfully validated
    pub fn transaction_validated(
        env: &Env,
        user: &Address,
        category: &Symbol,
        amount: i128,
        remaining_budget: i128,
    ) {
        let topics = (symbol_short!("overdraft"), symbol_short!("validated"), category.clone());
        env.events().publish(topics, (user.clone(), amount, remaining_budget));
    }

    /// Event emitted when budget is updated
    pub fn budget_updated(
        env: &Env,
        user: &Address,
        category: &Symbol,
        new_limit: i128,
    ) {
        let topics = (symbol_short!("overdraft"), symbol_short!("updated"), category.clone());
        env.events().publish(topics, (user.clone(), new_limit));
    }
}

#[contract]
pub struct OverdraftContract;

#[contractimpl]
impl OverdraftContract {
    /// Initializes the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TotalOverdraftAttempts, &0u64);
    }

    /// Sets up budget categories for a user.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address calling the function
    /// * `user` - The user address
    /// * `categories` - Vector of category budgets
    pub fn set_user_budget(
        env: Env,
        admin: Address,
        user: Address,
        categories: Vec<CategoryBudget>,
    ) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let current_time = env.ledger().timestamp();

        // Create category map
        let mut category_map = Map::<Symbol, CategoryBudget>::new(&env);
        for category in categories.iter() {
            if category.limit < 0 {
                panic_with_error!(&env, OverdraftError::InvalidAmount);
            }
            category_map.set(category.name.clone(), category.clone());
        }

        let user_budget = UserBudget {
            user: user.clone(),
            categories: category_map,
            last_updated: current_time,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserBudget(user.clone()), &user_budget);
    }

    /// Adds or updates a single category budget for a user.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address calling the function
    /// * `user` - The user address
    /// * `category` - Category name
    /// * `limit` - Budget limit for the category
    pub fn set_category_budget(
        env: Env,
        admin: Address,
        user: Address,
        category: Symbol,
        limit: i128,
    ) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        if limit < 0 {
            panic_with_error!(&env, OverdraftError::InvalidAmount);
        }

        let current_time = env.ledger().timestamp();

        // Get existing user budget or create new one
        let mut user_budget = if let Some(existing) =
            env.storage()
                .persistent()
                .get::<DataKey, UserBudget>(&DataKey::UserBudget(user.clone()))
        {
            existing
        } else {
            UserBudget {
                user: user.clone(),
                categories: Map::<Symbol, CategoryBudget>::new(&env),
                last_updated: current_time,
            }
        };

        let category_budget = CategoryBudget {
            name: category.clone(),
            limit,
            spent: 0,
        };

        user_budget.categories.set(category.clone(), category_budget);
        user_budget.last_updated = current_time;

        env.storage()
            .persistent()
            .set(&DataKey::UserBudget(user.clone()), &user_budget);

        OverdraftEvents::budget_updated(&env, &user, &category, limit);
    }

    /// Checks if a transaction would exceed the category budget.
    /// This function does NOT block the transaction, only checks.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `user` - The user address
    /// * `category` - Category name
    /// * `amount` - Amount to check
    ///
    /// # Returns
    /// TransactionCheckResult with whether the transaction is allowed
    pub fn check_transaction(env: Env, user: Address, category: Symbol, amount: i128) -> TransactionCheckResult {
        if amount <= 0 {
            return TransactionCheckResult {
                allowed: false,
                remaining: 0,
                exceeded_by: 0,
            };
        }

        let user_budget: UserBudget = env
            .storage()
            .persistent()
            .get(&DataKey::UserBudget(user.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::BudgetNotFound));

        let category_budget = user_budget
            .categories
            .get(category.clone())
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::CategoryNotFound));

        let remaining = category_budget.limit - category_budget.spent;
        let allowed = amount <= remaining;
        let exceeded_by = if allowed { 0 } else { amount - remaining };

        TransactionCheckResult {
            allowed,
            remaining,
            exceeded_by,
        }
    }

    /// Validates and processes a transaction against category budgets.
    /// This function BLOCKS transactions that would exceed the budget.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `user` - The user address making the transaction
    /// * `category` - Category name
    /// * `amount` - Transaction amount
    pub fn validate_transaction(env: Env, user: Address, category: Symbol, amount: i128) -> bool {
        user.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, OverdraftError::InvalidAmount);
        }

        let mut user_budget: UserBudget = env
            .storage()
            .persistent()
            .get(&DataKey::UserBudget(user.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::BudgetNotFound));

        let mut category_budget = user_budget
            .categories
            .get(category.clone())
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::CategoryNotFound));

        let remaining = category_budget.limit - category_budget.spent;

        // Check if transaction would exceed budget
        if amount > remaining {
            // Emit overdraft attempt event
            OverdraftEvents::overdraft_attempted(&env, &user, &category, amount, remaining);

            // Increment overdraft attempts counter
            let mut attempts: u64 = env
                .storage()
                .instance()
                .get(&DataKey::TotalOverdraftAttempts)
                .unwrap_or(0);
            attempts += 1;
            env.storage()
                .instance()
                .set(&DataKey::TotalOverdraftAttempts, &attempts);

            // Block the transaction
            panic_with_error!(&env, OverdraftError::OverdraftLimitExceeded);
        }

        // Update spent amount
        category_budget.spent += amount;
        user_budget.categories.set(category.clone(), category_budget);
        user_budget.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::UserBudget(user.clone()), &user_budget);

        // Emit validation success event
        let new_remaining = category_budget.limit - category_budget.spent;
        OverdraftEvents::transaction_validated(&env, &user, &category, amount, new_remaining);

        true
    }

    /// Records spending without validation (for existing transactions).
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address
    /// * `user` - The user address
    /// * `category` - Category name
    /// * `amount` - Amount spent
    pub fn record_spending(
        env: Env,
        admin: Address,
        user: Address,
        category: Symbol,
        amount: i128,
    ) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        if amount <= 0 {
            panic_with_error!(&env, OverdraftError::InvalidAmount);
        }

        let mut user_budget: UserBudget = env
            .storage()
            .persistent()
            .get(&DataKey::UserBudget(user.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::BudgetNotFound));

        let mut category_budget = user_budget
            .categories
            .get(category.clone())
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::CategoryNotFound));

        category_budget.spent += amount;
        user_budget.categories.set(category.clone(), category_budget);
        user_budget.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::UserBudget(user.clone()), &user_budget);
    }

    /// Resets spent amounts for a user (e.g., at the start of a new period).
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address
    /// * `user` - The user address
    pub fn reset_spending(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut user_budget: UserBudget = env
            .storage()
            .persistent()
            .get(&DataKey::UserBudget(user.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, OverdraftError::BudgetNotFound));

        // Reset all category spending to 0
        let mut new_categories = Map::<Symbol, CategoryBudget>::new(&env);
        for (_, category_budget) in user_budget.categories.iter() {
            let reset_category = CategoryBudget {
                name: category_budget.name,
                limit: category_budget.limit,
                spent: 0,
            };
            new_categories.set(category_budget.name.clone(), reset_category);
        }

        user_budget.categories = new_categories;
        user_budget.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::UserBudget(user.clone()), &user_budget);
    }

    /// Gets the budget for a specific user.
    pub fn get_user_budget(env: Env, user: Address) -> Option<UserBudget> {
        env.storage()
            .persistent()
            .get(&DataKey::UserBudget(user))
    }

    /// Gets a specific category budget for a user.
    pub fn get_category_budget(
        env: Env,
        user: Address,
        category: Symbol,
    ) -> Option<CategoryBudget> {
        let user_budget = env
            .storage()
            .persistent()
            .get::<DataKey, UserBudget>(&DataKey::UserBudget(user))?;
        user_budget.categories.get(category)
    }

    /// Returns the total number of overdraft attempts.
    pub fn get_total_overdraft_attempts(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TotalOverdraftAttempts)
            .unwrap_or(0)
    }

    /// Returns the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Internal helper to verify admin authority
    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        if *caller != admin {
            panic_with_error!(env, OverdraftError::Unauthorized);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_total_overdraft_attempts(), 0);
    }

    #[test]
    fn test_set_category_budget() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let user = Address::generate(&env);
        let category = symbol_short!("food");
        
        client.set_category_budget(&admin, &user, &category, &1000i128);
        
        let category_budget = client.get_category_budget(&user, &category);
        assert!(category_budget.is_some());
        assert_eq!(category_budget.unwrap().limit, 1000);
    }

    #[test]
    #[should_panic(expected = "OverdraftLimitExceeded")]
    fn test_overdraft_blocked() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let user = Address::generate(&env);
        let category = symbol_short!("food");
        
        // Set budget limit of 100
        client.set_category_budget(&admin, &user, &category, &100i128);
        
        // Try to spend 150 (should fail)
        client.validate_transaction(&user, &category, &150i128);
    }

    #[test]
    fn test_successful_transaction() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let user = Address::generate(&env);
        let category = symbol_short!("food");
        
        // Set budget limit of 500
        client.set_category_budget(&admin, &user, &category, &500i128);
        
        // Spend 200 (should succeed)
        let result = client.validate_transaction(&user, &category, &200i128);
        assert!(result);
        
        // Check remaining budget is 300
        let check = client.check_transaction(&user, &category, &100i128);
        assert!(check.allowed);
        assert_eq!(check.remaining, 300);
    }

    #[test]
    fn test_check_transaction() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let user = Address::generate(&env);
        let category = symbol_short!("food");
        
        client.set_category_budget(&admin, &user, &category, &1000i128);
        
        let check = client.check_transaction(&user, &category, &500i128);
        assert!(check.allowed);
        assert_eq!(check.remaining, 1000);
        
        let check_over = client.check_transaction(&user, &category, &1500i128);
        assert!(!check_over.allowed);
        assert_eq!(check_over.exceeded_by, 500);
    }

    #[test]
    fn test_reset_spending() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        
        let contract_id = env.register(OverdraftContract, ());
        let client = OverdraftContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let user = Address::generate(&env);
        let category = symbol_short!("food");
        
        client.set_category_budget(&admin, &user, &category, &1000i128);
        
        // Spend 500
        client.validate_transaction(&user, &category, &500i128);
        
        // Verify spent
        let cat_budget = client.get_category_budget(&user, &category).unwrap();
        assert_eq!(cat_budget.spent, 500);
        
        // Reset spending
        client.reset_spending(&admin, &user);
        
        // Verify spent is 0
        let cat_budget_after = client.get_category_budget(&user, &category).unwrap();
        assert_eq!(cat_budget_after.spent, 0);
    }
}
