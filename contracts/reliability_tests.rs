#![cfg(test)]

//! Reliability tests for SplitNaira.
//!
//! These tests verify that the contract:
//! - Returns the expected error for invalid inputs.
//! - Rejects unauthorized operations.
//! - Enforces project lifecycle rules.
//! - Handles missing projects safely.
//! - Validates collaborator split percentages.
//! - Handles zero/invalid deposits.
//!
//! Soroban SDK: 20.5.0

use soroban_sdk::{
    testutils::Address as _,
    vec,
    Address,
    Env,
    String,
    Symbol,
    Vec,
};

use crate::{
    errors::SplitError,
    Collaborator,
    SplitNairaContract,
    SplitNairaContractClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Registers a fresh SplitNaira contract and returns its client and address.
fn make_client<'a>(env: &'a Env) -> (SplitNairaContractClient<'a>, Address) {
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);

    (client, contract_id)
}

/// Creates a fresh test environment with all authorization mocked.
fn test_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

/// Creates a two-collaborator 50/50 split.
fn two_collabs(env: &Env) -> Vec<Collaborator> {
    collaborators_with_shares(env, 5000, 5000)
}

/// Creates two collaborators with the supplied basis-point split.
fn collaborators_with_shares(
    env: &Env,
    first_share: i128,
    second_share: i128,
) -> Vec<Collaborator> {
    let first = Address::generate(env);
    let second = Address::generate(env);

    vec![
        env,
        Collaborator {
            address: first,
            alias: String::from_str(env, "A"),
            basis_points: first_share,
        },
        Collaborator {
            address: second,
            alias: String::from_str(env, "B"),
            basis_points: second_share,
        },
    ]
}

/// Creates a test token.
fn create_token(env: &Env) -> Address {
    let token_admin = Address::generate(env);
    env.register_stellar_asset_contract(token_admin)
}

/// Creates a project and returns:
/// `(client, owner, token)`.
fn setup_project<'a>(
    env: &'a Env,
    project_id: &'a Symbol,
) -> (SplitNairaContractClient<'a>, Address, Address) {
    let (client, _) = make_client(env);
    let token = create_token(env);
    let owner = Address::generate(env);
    let collaborators = two_collabs(env);

    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "Test Project"),
        &String::from_str(env, "music"),
        &token,
        &collaborators,
    );

    (client, owner, token)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. distribute — error paths
// ─────────────────────────────────────────────────────────────────────────────

/// Distributing a non-existent project returns NotFound.
#[test]
fn test_distribute_missing_project_returns_not_found() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let project_id = Symbol::new(&env, "ghost");

    let result = client.try_distribute(&project_id);

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// Distributing an existing project with no balance returns NoBalance.
#[test]
fn test_distribute_zero_balance_returns_no_balance() {
    let env = test_env();
    let project_id = Symbol::new(&env, "proj1");

    let (client, _, _) = setup_project(&env, &project_id);

    let result = client.try_distribute(&project_id);

    assert_eq!(result, Err(Ok(SplitError::NoBalance)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. get_balance — error and initial state
// ─────────────────────────────────────────────────────────────────────────────

/// Getting the balance of a non-existent project returns NotFound.
#[test]
fn test_get_balance_missing_project_returns_not_found() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let project_id = Symbol::new(&env, "ghost");

    let result = client.try_get_balance(&project_id);

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// A newly created project has a zero balance.
#[test]
fn test_get_balance_existing_project_returns_zero_initially() {
    let env = test_env();
    let project_id = Symbol::new(&env, "proj2");

    let (client, _, _) = setup_project(&env, &project_id);

    let balance = client.get_balance(&project_id);

    assert_eq!(balance, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. create_project — collaborator validation
// ─────────────────────────────────────────────────────────────────────────────

/// A collaborator with zero basis points returns ZeroShare.
#[test]
fn test_create_project_zero_basis_points_returns_zero_share() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let token = create_token(&env);
    let owner = Address::generate(&env);
    let project_id = Symbol::new(&env, "zero_bp");

    let first = Address::generate(&env);
    let second = Address::generate(&env);

    let collaborators = vec![
        &env,
        Collaborator {
            address: first,
            alias: String::from_str(&env, "A"),
            basis_points: 0,
        },
        Collaborator {
            address: second,
            alias: String::from_str(&env, "B"),
            basis_points: 10000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Zero BP"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    assert_eq!(result, Err(Ok(SplitError::ZeroShare)));
}

/// Basis points that do not sum to 10000 return InvalidSplit.
#[test]
fn test_create_project_invalid_split_returns_invalid_split() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let token = create_token(&env);
    let owner = Address::generate(&env);
    let project_id = Symbol::new(&env, "bad_split");

    // 4000 + 5000 = 9000.
    let collaborators = collaborators_with_shares(&env, 4000, 5000);

    let result = client.try_create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Bad Split"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    assert_eq!(result, Err(Ok(SplitError::InvalidSplit)));
}

/// A single collaborator is rejected.
#[test]
fn test_create_project_one_collaborator_returns_too_few() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let token = create_token(&env);
    let owner = Address::generate(&env);
    let collaborator = Address::generate(&env);
    let project_id = Symbol::new(&env, "one_collab");

    let collaborators = vec![
        &env,
        Collaborator {
            address: collaborator,
            alias: String::from_str(&env, "A"),
            basis_points: 10000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "One Collab"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    assert_eq!(result, Err(Ok(SplitError::TooFewCollaborators)));
}

/// Creating a project with an existing ID returns ProjectExists.
#[test]
fn test_create_project_duplicate_id_returns_project_exists() {
    let env = test_env();
    let project_id = Symbol::new(&env, "dup");

    let (client, owner, token) = setup_project(&env, &project_id);

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
// 4. lock_project — authorization and lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/// Locking an already locked project returns AlreadyLocked.
#[test]
fn test_lock_project_twice_returns_already_locked() {
    let env = test_env();
    let project_id = Symbol::new(&env, "lockme");

    let (client, owner, _) = setup_project(&env, &project_id);

    client.lock_project(&project_id, &owner);

    let result = client.try_lock_project(&project_id, &owner);

    assert_eq!(result, Err(Ok(SplitError::AlreadyLocked)));
}

/// A non-owner cannot lock a project.
#[test]
fn test_lock_project_non_owner_returns_unauthorized() {
    let env = test_env();
    let project_id = Symbol::new(&env, "lockauth");

    let (client, _, _) = setup_project(&env, &project_id);
    let attacker = Address::generate(&env);

    let result = client.try_lock_project(&project_id, &attacker);

    assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
}

/// Locking a non-existent project returns NotFound.
#[test]
fn test_lock_project_missing_project_returns_not_found() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let project_id = Symbol::new(&env, "missing_lock");
    let owner = Address::generate(&env);

    let result = client.try_lock_project(&project_id, &owner);

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. update_collaborators — authorization and lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/// Updating collaborators on a locked project returns ProjectLocked.
#[test]
fn test_update_collaborators_locked_project_returns_project_locked() {
    let env = test_env();
    let project_id = Symbol::new(&env, "locked");

    let (client, owner, _) = setup_project(&env, &project_id);

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
    let env = test_env();
    let project_id = Symbol::new(&env, "authcollab");

    let (client, _, _) = setup_project(&env, &project_id);
    let attacker = Address::generate(&env);

    let result = client.try_update_collaborators(
        &project_id,
        &attacker,
        &two_collabs(&env),
    );

    assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
}

/// Updating collaborators for a missing project returns NotFound.
#[test]
fn test_update_collaborators_missing_project_returns_not_found() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let project_id = Symbol::new(&env, "missing_update");
    let owner = Address::generate(&env);

    let result = client.try_update_collaborators(
        &project_id,
        &owner,
        &two_collabs(&env),
    );

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. deposit — validation and missing project
// ─────────────────────────────────────────────────────────────────────────────

/// Depositing zero returns InvalidAmount.
#[test]
fn test_deposit_zero_amount_returns_invalid_amount() {
    let env = test_env();
    let project_id = Symbol::new(&env, "dep_zero");

    let (client, _, _) = setup_project(&env, &project_id);
    let depositor = Address::generate(&env);

    let result = client.try_deposit(
        &project_id,
        &depositor,
        &0,
    );

    assert_eq!(result, Err(Ok(SplitError::InvalidAmount)));
}

/// Depositing a negative amount returns InvalidAmount.
#[test]
fn test_deposit_negative_amount_returns_invalid_amount() {
    let env = test_env();
    let project_id = Symbol::new(&env, "dep_negative");

    let (client, _, _) = setup_project(&env, &project_id);
    let depositor = Address::generate(&env);

    let result = client.try_deposit(
        &project_id,
        &depositor,
        &-1,
    );

    assert_eq!(result, Err(Ok(SplitError::InvalidAmount)));
}

/// Depositing into a non-existent project returns NotFound.
#[test]
fn test_deposit_missing_project_returns_not_found() {
    let env = test_env();
    let (client, _) = make_client(&env);

    let project_id = Symbol::new(&env, "nope");
    let depositor = Address::generate(&env);

    let result = client.try_deposit(
        &project_id,
        &depositor,
        &100,
    );

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}