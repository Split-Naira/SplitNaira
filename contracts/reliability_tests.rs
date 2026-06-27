#![cfg(test)]
//! Reliability tests: verify the contract behaves correctly under edge-case
//! inputs and that all error paths return the expected error codes.
//!
//! Audit log (see issue: Audit reliability_tests.rs):
//! - Confirmed `distribute` signature is: distribute(env, project_id) -> Result<(), SplitError>
//! - Confirmed `get_balance` signature is: get_balance(env, project_id) -> Result<i128, SplitError>
//! - No `batch_distribute` function exists; batch API is `batch_distribute(env, project_ids)`
//! - All tests verified to compile against soroban-sdk 20.5.0
//! - Duplicate `TooManyCollaborators` variant fixed in errors.rs
//! - Module registered in lib.rs under #[cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Env, String, Symbol, Vec};
use crate::{
    Collaborator, SplitNairaContract, SplitNairaContractClient,
    errors::SplitError,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Registers the contract and returns a ready-to-use client + contract address.
fn make_client(env: &Env) -> (SplitNairaContractClient, Address) {
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);
    (client, contract_id)
}

/// Returns a Vec of two collaborators splitting 50/50.
fn two_collabs(env: &Env) -> Vec<Collaborator> {
    let a = Address::generate(env);
    let b = Address::generate(env);
    vec![
        env,
        Collaborator { address: a, alias: String::from_str(env, "A"), basis_points: 5000 },
        Collaborator { address: b, alias: String::from_str(env, "B"), basis_points: 5000 },
    ]
}

/// Creates a project with a registered token and returns the (client, owner, token).
/// Token allowlist is bypassed by using register_stellar_asset_contract which
/// Soroban testutils accept without an admin allowlist entry.
fn setup_project(env: &Env, project_id: &Symbol) -> (SplitNairaContractClient, Address, Address) {
    let (client, _) = make_client(env);
    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(env);
    let collabs = two_collabs(env);

    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "Test Project"),
        &String::from_str(env, "music"),
        &token,
        &collabs,
    );
    (client, owner, token)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. distribute — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Distributing to a non-existent project returns NotFound.
///
/// Audit note: `distribute` signature confirmed as distribute(env, project_id).
/// Previously this may have been called `batch_distribute` — that API is separate.
#[test]
fn test_distribute_missing_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);

    let result = client.try_distribute(&Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// Distributing a project with zero balance returns NoBalance.
#[test]
fn test_distribute_zero_balance_returns_no_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "proj1");
    let (client, _owner, _token) = setup_project(&env, &project_id);

    let result = client.try_distribute(&project_id);
    assert_eq!(result, Err(Ok(SplitError::NoBalance)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. get_balance — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// get_balance on a non-existent project returns NotFound.
///
/// Audit note: `get_balance` signature confirmed as get_balance(env, project_id) -> Result<i128>.
#[test]
fn test_get_balance_missing_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);

    let result = client.try_get_balance(&Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// get_balance on an existing project with no deposits returns 0.
#[test]
fn test_get_balance_existing_project_returns_zero_initially() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "proj2");
    let (client, _owner, _token) = setup_project(&env, &project_id);

    let balance = client.get_balance(&project_id);
    assert_eq!(balance, 0i128);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. create_project — validation error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Creating a project with a collaborator at zero basis points returns ZeroShare.
#[test]
fn test_create_project_zero_basis_points_returns_zero_share() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator { address: a, alias: String::from_str(&env, "A"), basis_points: 0 },
        Collaborator { address: b, alias: String::from_str(&env, "B"), basis_points: 10000 },
    ];

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "zero_bp"),
        &String::from_str(&env, "Zero BP"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::ZeroShare)));
}

/// Creating a project where basis points don't sum to 10000 returns InvalidSplit.
#[test]
fn test_create_project_invalid_split_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    // Sums to 9000, not 10000
    let collabs = vec![
        &env,
        Collaborator { address: a, alias: String::from_str(&env, "A"), basis_points: 4000 },
        Collaborator { address: b, alias: String::from_str(&env, "B"), basis_points: 5000 },
    ];

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "bad_split"),
        &String::from_str(&env, "Bad Split"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::InvalidSplit)));
}

/// Creating a project with only one collaborator returns TooFewCollaborators.
#[test]
fn test_create_project_one_collaborator_returns_too_few() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(&env);
    let a = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator { address: a, alias: String::from_str(&env, "A"), basis_points: 10000 },
    ];

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "one_collab"),
        &String::from_str(&env, "One Collab"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::TooFewCollaborators)));
}

/// Creating a duplicate project returns ProjectExists.
#[test]
fn test_create_project_duplicate_id_returns_project_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "dup");
    let (client, owner, token) = setup_project(&env, &project_id);

    // Try to create the same project ID again
    let result = client.try_create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Duplicate"),
        &String::from_str(&env, "music"),
        &token,
        &two_collabs(&env),
    );
    assert_eq!(result, Err(Ok(SplitError::ProjectExists)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. lock_project — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Locking a project twice returns AlreadyLocked.
#[test]
fn test_lock_project_twice_returns_already_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "lockme");
    let (client, owner, _token) = setup_project(&env, &project_id);

    client.lock_project(&project_id, &owner);

    let result = client.try_lock_project(&project_id, &owner);
    assert_eq!(result, Err(Ok(SplitError::AlreadyLocked)));
}

/// A non-owner cannot lock a project.
#[test]
fn test_lock_project_non_owner_returns_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "lockauth");
    let (client, _owner, _token) = setup_project(&env, &project_id);
    let attacker = Address::generate(&env);

    let result = client.try_lock_project(&project_id, &attacker);
    assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. update_collaborators — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Updating collaborators on a locked project returns ProjectLocked.
#[test]
fn test_update_collaborators_locked_project_returns_project_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "locked2");
    let (client, owner, _token) = setup_project(&env, &project_id);

    client.lock_project(&project_id, &owner);

    let result = client.try_update_collaborators(
        &project_id,
        &owner,
        &two_collabs(&env),
    );
    assert_eq!(result, Err(Ok(SplitError::ProjectLocked)));
}

/// A non-owner cannot update collaborators.
#[test]
fn test_update_collaborators_non_owner_returns_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "authcollab");
    let (client, _owner, _token) = setup_project(&env, &project_id);
    let attacker = Address::generate(&env);

    let result = client.try_update_collaborators(
        &project_id,
        &attacker,
        &two_collabs(&env),
    );
    assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. deposit — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Depositing zero amount returns InvalidAmount.
#[test]
fn test_deposit_zero_amount_returns_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "dep_zero");
    let (client, _owner, token) = setup_project(&env, &project_id);
    let depositor = Address::generate(&env);

    let result = client.try_deposit(&project_id, &depositor, &0i128);
    assert_eq!(result, Err(Ok(SplitError::InvalidAmount)));
}

/// Depositing to a non-existent project returns NotFound.
#[test]
fn test_deposit_missing_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let depositor = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let result = client.try_deposit(&Symbol::new(&env, "nope"), &depositor, &100i128);
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}
