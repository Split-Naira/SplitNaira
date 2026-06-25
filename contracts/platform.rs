#![no_std]

// ============================================================
// PredictionEngine contract
// ============================================================
//
// Changes from original:
//   - Added #[contracttype] to Transaction and SpendingPrediction
//     so Soroban's XDR codec can serialise them correctly.
//   - add_transaction now calls user.require_auth() so only the
//     owner of an address can append to their own history.
//   - Storage entries are bumped with extend_ttl on every write
//     and read to keep them alive for ~30 days (in ledger units).
//   - Removed the unused `Map` import from the original.
// ============================================================

use soroban_sdk::{contractimpl, contracttype, Env, Address, Vec, Symbol};

/// One recorded spend event for a user.
#[derive(Clone)]
#[contracttype]
pub struct Transaction {
    pub amount: i128,
    pub timestamp: u64,
}

/// The result emitted as a ledger event after a prediction.
#[derive(Clone)]
#[contracttype]
pub struct SpendingPrediction {
    pub projected_amount: i128,
    pub confidence: u32,   // 0-100 simple confidence score
    pub timestamp: u64,
}

/// ~30 days expressed in Soroban ledger-close seconds (5 s/ledger → 518 400 ledgers).
/// Adjust to match your network's ledger close time.
const TTL_LEDGERS: u32 = 518_400;

pub struct PredictionEngine;

#[contractimpl]
impl PredictionEngine {
    /// Record a spending transaction for `user`.
    /// Requires authentication from `user`; callers cannot forge data for others.
    pub fn add_transaction(env: Env, user: Address, amount: i128, timestamp: u64) {
        // --- auth ---
        user.require_auth();

        // Reject nonsensical values early.
        if amount < 0 {
            panic!("amount must be non-negative");
        }

        let mut txs: Vec<Transaction> = env
            .storage()
            .persistent()
            .get(&user)
            .unwrap_or_else(|| Vec::new(&env));

        // Evict the oldest entry to cap storage cost.
        if txs.len() >= 50 {
            txs.remove(0);
        }

        txs.push_back(Transaction { amount, timestamp });

        env.storage().persistent().set(&user, &txs);

        // Keep the entry alive for another ~30 days.
        env.storage()
            .persistent()
            .extend_ttl(&user, TTL_LEDGERS, TTL_LEDGERS);
    }

    /// Return the moving-average projected spend for `user`.
    /// A primitive confidence metric is included: higher when there are more data points.
    pub fn predict_spending(env: Env, user: Address) -> SpendingPrediction {
        let txs: Vec<Transaction> = env
            .storage()
            .persistent()
            .get(&user)
            .unwrap_or_else(|| Vec::new(&env));

        let len = txs.len() as i128;

        if len == 0 {
            return SpendingPrediction {
                projected_amount: 0,
                confidence: 0,
                timestamp: env.ledger().timestamp(),
            };
        }

        let sum: i128 = txs.iter().map(|t| t.amount).sum();
        let projected = sum / len;

        // Confidence saturates at 50 data points (the ring-buffer cap).
        let confidence = ((len.min(50) * 100) / 50) as u32;

        let prediction = SpendingPrediction {
            projected_amount: projected,
            confidence,
            timestamp: env.ledger().timestamp(),
        };

        env.events().publish(
            (Symbol::new(&env, "prediction"), user.clone()),
            prediction.clone(),
        );

        // Refresh TTL on read too, so active users never lose history.
        env.storage()
            .persistent()
            .extend_ttl(&user, TTL_LEDGERS, TTL_LEDGERS);

        prediction
    }

    /// Retrieve raw transaction history for `user` (read-only; no auth required).
    pub fn get_transactions(env: Env, user: Address) -> Vec<Transaction> {
        env.storage()
            .persistent()
            .get(&user)
            .unwrap_or_else(|| Vec::new(&env))
    }
}


// ============================================================
// MultisigWallet contract
// ============================================================
//
// Changes from original:
//   - Added execute_tx — the key missing piece. After an approval
//     pushes count to threshold the caller can invoke execute_tx
//     to mark the transaction done and emit the event.
//   - Added pending tx expiry (TX_EXPIRY_LEDGERS). Proposals that
//     have not reached threshold within ~7 days are rejected.
//   - BlacklistedDestination is now checked inside propose_tx
//     so blacklisted recipients are blocked at proposal time.
//   - is_signer uses a direct storage key lookup (O(1)) instead
//     of a linear Vec scan.
//   - bump_instance is called on every mutating entry-point so the
//     instance storage TTL stays fresh.
//   - All public entry-points that take an Address now call
//     require_auth on the relevant signer/admin.
// ============================================================

use soroban_sdk::{
    contracterror, contracttype, panic_with_error, symbol_short,
    Address, Env, Symbol, Vec,
};

// --------------- storage keys ---------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Signers,
    Threshold,
    HighValueThreshold,
    NextTxId,
    PendingTx(u64),
    /// Sparse approval flag: stored only when a signer has approved.
    Approval(u64, Address),
    ApprovalCount(u64),
    Balance(Address),
    /// Maps (wallet_owner, recipient) -> bool
    BlacklistedDestination(Address, Address),
    /// O(1) signer presence check: stored as a unit value per signer.
    SignerPresence(Address),
}

// --------------- types ---------------

#[derive(Clone)]
#[contracttype]
pub struct PendingTx {
    pub id: u64,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub payload: Symbol,
    pub asset: Option<Address>,
    pub created_at: u64,
    pub expires_at_ledger: u32,   // new: reject approval after this ledger
    pub executed: bool,
}

// --------------- errors ---------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MultiSigError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidThreshold = 4,
    DuplicateSigner = 5,
    InvalidAmount = 6,
    PendingTxNotFound = 7,
    UnauthorizedSigner = 8,
    DuplicateApproval = 9,
    AlreadyExecuted = 10,
    InsufficientBalance = 11,
    MultisigNotConfigured = 12,
    Overflow = 13,
    BlacklistedDestination = 14,
    TxExpired = 15,             // new
    ThresholdNotMet = 16,       // new
}

// --------------- event helpers ---------------

pub struct MultisigEvents;

impl MultisigEvents {
    pub fn pending_created(env: &Env, tx: &PendingTx) {
        let topics = (symbol_short!("tx"), symbol_short!("pending"), tx.id);
        env.events().publish(
            topics,
            (tx.from.clone(), tx.to.clone(), tx.amount, tx.asset.clone()),
        );
    }

    pub fn approval_recorded(
        env: &Env,
        tx_id: u64,
        signer: &Address,
        approvals_count: u32,
        threshold: u32,
    ) {
        let topics = (symbol_short!("approve"), symbol_short!("record"), tx_id);
        env.events()
            .publish(topics, (signer.clone(), approvals_count, threshold));
    }

    pub fn transaction_executed(env: &Env, tx: &PendingTx, executor: &Address) {
        let topics = (symbol_short!("tx"), symbol_short!("executed"), tx.id);
        env.events().publish(
            topics,
            (
                executor.clone(),
                tx.from.clone(),
                tx.to.clone(),
                tx.amount,
                tx.asset.clone(),
            ),
        );
    }
}

// --------------- constants ---------------

/// Instance TTL refresh: ~30 days.
const INSTANCE_TTL: u32 = 518_400;

/// Maximum lifetime of an un-executed pending tx: ~7 days.
const TX_EXPIRY_LEDGERS: u32 = 120_960;

// --------------- state helpers ---------------

pub fn initialize_state(env: &Env, admin: Address) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(env, MultiSigError::AlreadyInitialized);
    }

    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::Signers, &Vec::<Address>::new(env));
    env.storage().instance().set(&DataKey::Threshold, &0u32);
    env.storage().instance().set(&DataKey::HighValueThreshold, &i128::MAX);
    env.storage().instance().set(&DataKey::NextTxId, &0u64);

    bump_instance(env);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, MultiSigError::NotInitialized))
}

pub fn require_admin(env: &Env, caller: &Address) {
    caller.require_auth();
    if get_admin(env) != *caller {
        panic_with_error!(env, MultiSigError::Unauthorized);
    }
}

/// Replace the signer list.  Also rebuilds the O(1) presence index.
pub fn set_signers(env: &Env, caller: Address, signers: Vec<Address>, threshold: u32) {
    require_admin(env, &caller);
    validate_signer_config(env, &signers, threshold);

    // Tear down old presence index.
    let old_signers: Vec<Address> = get_signers(env);
    for s in old_signers.iter() {
        env.storage()
            .instance()
            .remove(&DataKey::SignerPresence(s));
    }

    // Build new presence index.
    for s in signers.iter() {
        env.storage()
            .instance()
            .set(&DataKey::SignerPresence(s.clone()), &true);
    }

    env.storage().instance().set(&DataKey::Signers, &signers);
    env.storage().instance().set(&DataKey::Threshold, &threshold);

    bump_instance(env);
}

pub fn set_high_value_threshold(env: &Env, caller: Address, amount: i128) {
    require_admin(env, &caller);
    if amount < 0 {
        panic_with_error!(env, MultiSigError::InvalidAmount);
    }
    env.storage().instance().set(&DataKey::HighValueThreshold, &amount);
    bump_instance(env);
}

pub fn get_signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Signers)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
}

pub fn get_high_value_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::HighValueThreshold)
        .unwrap_or(i128::MAX)
}

pub fn ensure_multisig_configured(env: &Env) {
    let signers = get_signers(env);
    let threshold = get_threshold(env);
    if signers.len() == 0 || threshold == 0 || threshold > signers.len() {
        panic_with_error!(env, MultiSigError::MultisigNotConfigured);
    }
}

/// O(1) signer check via presence index.
pub fn is_signer(env: &Env, signer: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::SignerPresence(signer.clone()))
}

pub fn require_signer(env: &Env, signer: &Address) {
    if !is_signer(env, signer) {
        panic_with_error!(env, MultiSigError::UnauthorizedSigner);
    }
}

pub fn next_tx_id(env: &Env) -> u64 {
    let current: u64 = env.storage().instance().get(&DataKey::NextTxId).unwrap_or(0);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(env, MultiSigError::Overflow));
    env.storage().instance().set(&DataKey::NextTxId, &next);
    next
}

// --------------- proposal helpers ---------------

/// Create a pending transaction, enforcing blacklist and returning its id.
pub fn propose_tx(
    env: &Env,
    from: Address,
    to: Address,
    amount: i128,
    payload: Symbol,
    asset: Option<Address>,
) -> u64 {
    from.require_auth();
    require_signer(env, &from);
    ensure_multisig_configured(env);

    if amount <= 0 {
        panic_with_error!(env, MultiSigError::InvalidAmount);
    }

    // Block blacklisted recipients.
    if env
        .storage()
        .persistent()
        .has(&DataKey::BlacklistedDestination(from.clone(), to.clone()))
    {
        panic_with_error!(env, MultiSigError::BlacklistedDestination);
    }

    let id = next_tx_id(env);
    let current_ledger = env.ledger().sequence();

    let tx = PendingTx {
        id,
        from,
        to,
        amount,
        payload,
        asset,
        created_at: env.ledger().timestamp(),
        expires_at_ledger: current_ledger
            .checked_add(TX_EXPIRY_LEDGERS)
            .unwrap_or(u32::MAX),
        executed: false,
    };

    env.storage()
        .persistent()
        .set(&DataKey::PendingTx(id), &tx);

    MultisigEvents::pending_created(env, &tx);
    bump_instance(env);

    id
}

/// Record a signer's approval.  Returns the new approval count.
pub fn approve_tx(env: &Env, signer: Address, tx_id: u64) -> u32 {
    signer.require_auth();
    require_signer(env, &signer);

    let mut tx: PendingTx = env
        .storage()
        .persistent()
        .get(&DataKey::PendingTx(tx_id))
        .unwrap_or_else(|| panic_with_error!(env, MultiSigError::PendingTxNotFound));

    if tx.executed {
        panic_with_error!(env, MultiSigError::AlreadyExecuted);
    }

    // Reject approvals on expired proposals.
    if env.ledger().sequence() > tx.expires_at_ledger {
        panic_with_error!(env, MultiSigError::TxExpired);
    }

    let count = record_approval(env, tx_id, &signer);
    let threshold = get_threshold(env);

    MultisigEvents::approval_recorded(env, tx_id, &signer, count, threshold);
    bump_instance(env);

    count
}

/// Execute a transaction once it has reached the approval threshold.
/// Any authorised signer may be the executor.
pub fn execute_tx(env: &Env, executor: Address, tx_id: u64) {
    executor.require_auth();
    require_signer(env, &executor);

    let mut tx: PendingTx = env
        .storage()
        .persistent()
        .get(&DataKey::PendingTx(tx_id))
        .unwrap_or_else(|| panic_with_error!(env, MultiSigError::PendingTxNotFound));

    if tx.executed {
        panic_with_error!(env, MultiSigError::AlreadyExecuted);
    }

    if env.ledger().sequence() > tx.expires_at_ledger {
        panic_with_error!(env, MultiSigError::TxExpired);
    }

    let count = get_approval_count(env, tx_id);
    let threshold = get_threshold(env);
    if count < threshold {
        panic_with_error!(env, MultiSigError::ThresholdNotMet);
    }

    // Mark executed before any external calls (checks-effects-interactions).
    tx.executed = true;
    env.storage().persistent().set(&DataKey::PendingTx(tx_id), &tx);

    // ---------------------------------------------------------------
    // INSERT ACTUAL TRANSFER / INVOCATION LOGIC HERE.
    // For a token transfer you would do something like:
    //
    //   use soroban_sdk::token::Client as TokenClient;
    //   let token = TokenClient::new(env, &tx.asset.unwrap());
    //   token.transfer(&env.current_contract_address(), &tx.to, &tx.amount);
    //
    // The exact implementation depends on whether this contract holds
    // a native asset balance or delegates to a SAC / custom token.
    // ---------------------------------------------------------------

    MultisigEvents::transaction_executed(env, &tx, &executor);
    bump_instance(env);
}

/// Add a destination to the blacklist for a given sender.
pub fn blacklist_destination(env: &Env, caller: Address, destination: Address) {
    require_admin(env, &caller);
    env.storage()
        .persistent()
        .set(&DataKey::BlacklistedDestination(caller, destination), &true);
    bump_instance(env);
}

// --------------- approval internals ---------------

pub fn has_approval(env: &Env, tx_id: u64, signer: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Approval(tx_id, signer.clone()))
}

pub fn get_approval_count(env: &Env, tx_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ApprovalCount(tx_id))
        .unwrap_or(0)
}

pub fn record_approval(env: &Env, tx_id: u64, signer: &Address) -> u32 {
    if has_approval(env, tx_id, signer) {
        panic_with_error!(env, MultiSigError::DuplicateApproval);
    }

    env.storage()
        .persistent()
        .set(&DataKey::Approval(tx_id, signer.clone()), &true);

    let current = get_approval_count(env, tx_id);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(env, MultiSigError::Overflow));

    env.storage()
        .persistent()
        .set(&DataKey::ApprovalCount(tx_id), &next);

    next
}

// --------------- private helpers ---------------

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
}

fn validate_signer_config(env: &Env, signers: &Vec<Address>, threshold: u32) {
    let signer_count = signers.len();

    if signer_count == 0 || threshold == 0 || threshold > signer_count {
        panic_with_error!(env, MultiSigError::InvalidThreshold);
    }

    // O(n²) duplicate check — acceptable for small signer sets (≤ ~20).
    for i in 0..signer_count {
        let si = signers
            .get(i)
            .unwrap_or_else(|| panic_with_error!(env, MultiSigError::InvalidThreshold));
        for j in (i + 1)..signer_count {
            let sj = signers
                .get(j)
                .unwrap_or_else(|| panic_with_error!(env, MultiSigError::InvalidThreshold));
            if si == sj {
                panic_with_error!(env, MultiSigError::DuplicateSigner);
            }
        }
    }
}