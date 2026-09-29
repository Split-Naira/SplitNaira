#![cfg(test)]

//! Issue #838 — Contract storage TTL renewal integration tests.
//!
//! These tests verify that project-related storage is refreshed through the
//! contract's public entry points.
//!
//! The default Soroban test host does not automatically evict persistent
//! storage when the ledger sequence is advanced. Therefore, these tests use:
//!
//! - Public contract calls to verify entries remain readable.
//! - Persistent-storage presence checks for specific keys.
//! - Large ledger advances to exercise the TTL renewal paths.
//!
//! Actual network-level eviction should be validated separately against a
//! host/network configuration that performs persistent-entry eviction.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token,
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
    DataKey,
    SplitNairaContract,
    SplitNairaContractClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Creates a fresh test environment with mocked authorization and a test token.
fn setup_env_with_token<'a>(
    env: &'a Env,
) -> (SplitNairaContractClient<'a>, Address) {
    env.mock_all_auths();

    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);

    (client, token)
}

/// Creates two collaborators with a 50/50 split.
fn two_collaborators(
    env: &Env,
) -> (Address, Address, Vec<Collaborator>) {
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    let collaborators = vec![
        env,
        Collaborator {
            address: alice.clone(),
            alias: String::from_str(env, "Alice"),
            basis_points: 5000,
        },
        Collaborator {
            address: bob.clone(),
            alias: String::from_str(env, "Bob"),
            basis_points: 5000,
        },
    ];

    (alice, bob, collaborators)
}

/// Creates a project and returns its owner.
fn create_project(
    env: &Env,
    client: &SplitNairaContractClient,
    token: &Address,
    project_id: &Symbol,
    collaborators: &Vec<Collaborator>,
) -> Address {
    let owner = Address::generate(env);

    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "TTL Project"),
        &String::from_str(env, "music"),
        token,
        collaborators,
    );

    owner
}

/// Checks whether a persistent storage key exists.
///
/// The check runs inside the contract context because persistent storage
/// access requires the contract address to be active.
fn has_persistent(
    env: &Env,
    contract_id: &Address,
    key: &DataKey,
) -> bool {
    env.as_contract(contract_id, || {
        env.storage().persistent().has(key)
    })
}

/// Advances the ledger by the supplied number of ledgers.
fn advance_ledger(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|info| {
        info.sequence_number += ledgers;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// refresh_project_storage
// ─────────────────────────────────────────────────────────────────────────────

/// Refreshing an existing project after a large ledger advance should
/// succeed and keep the project's core entries readable.
#[test]
fn test_refresh_project_storage_keeps_project_alive() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (_, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_refresh");

    create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    let contract_id = env.current_contract_address();

    advance_ledger(&env, 200_000);

    // The test host does not perform automatic eviction, but the key should
    // still exist before the refresh.
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::Project(project_id.clone())
    ));

    // Permissionless refresh should renew the project's storage.
    client.refresh_project_storage(&project_id);

    let project = client
        .get_project(&project_id)
        .expect("project should remain readable after refresh");

    assert_eq!(project.project_id, project_id);

    let balance = client
        .get_balance(&project_id)
        .expect("balance should remain readable after refresh");

    assert_eq!(balance, 0);

    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::Project(project_id.clone())
    ));

    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::ProjectBalance(project_id)
    ));
}

/// Refreshing an unknown project returns NotFound.
#[test]
fn test_refresh_project_storage_missing_project_returns_not_found() {
    let env = Env::default();
    let (client, _) = setup_env_with_token(&env);

    let project_id = Symbol::new(&env, "ghost");

    let result = client.try_refresh_project_storage(&project_id);

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-path TTL renewal
// ─────────────────────────────────────────────────────────────────────────────

/// `get_project` should continue to work after a large ledger advance.
#[test]
fn test_get_project_remains_readable_after_ledger_advance() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (_, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_project_read");

    create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    // Initial read exercises the normal read/bump path.
    let initial_project = client
        .get_project(&project_id)
        .expect("project should be readable immediately");

    assert_eq!(initial_project.project_id, project_id);

    advance_ledger(&env, 120_000);

    let project = client
        .get_project(&project_id)
        .expect("project should remain readable after ledger advance");

    assert_eq!(project.project_id, project_id);
}

/// `get_balance` should continue to work after a large ledger advance.
#[test]
fn test_get_balance_remains_readable_after_ledger_advance() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (_, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_balance_read");

    create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    assert_eq!(client.get_balance(&project_id), Ok(0));

    advance_ledger(&env, 120_000);

    assert_eq!(
        client.get_balance(&project_id),
        Ok(0)
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Deposit / distribute TTL renewal
// ─────────────────────────────────────────────────────────────────────────────

/// Deposit and distribute should keep the project's core storage readable
/// after a substantial ledger advance.
#[test]
fn test_deposit_and_distribute_keep_project_storage_alive() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (alice, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_distribution");

    create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    let funder = Address::generate(&env);
    let stellar_token = token::StellarAssetClient::new(&env, &token);

    let amount = 2_000_0000000_i128;

    stellar_token.mint(&funder, &amount);

    client.deposit(
        &project_id,
        &funder,
        &amount,
    );

    assert_eq!(
        client.get_balance(&project_id),
        Ok(amount)
    );

    client.distribute(&project_id);

    // Alice owns 50% of the project.
    assert_eq!(
        client.get_claimed(&project_id, &alice),
        Ok(1_000_0000000_i128)
    );

    advance_ledger(&env, 150_000);

    // Core project data should still be readable.
    let project = client
        .get_project(&project_id)
        .expect("project should remain readable");

    assert_eq!(project.project_id, project_id);

    let claimable = client
        .get_claimable(&project_id, &alice)
        .expect("claimable data should remain readable");

    assert_eq!(
        claimable.claimed,
        1_000_0000000_i128
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collaborator TTL renewal
// ─────────────────────────────────────────────────────────────────────────────

/// A collaborator's claimed and last-claim storage should remain available
/// after the collaborator has claimed and the ledger advances.
#[test]
fn test_claim_renews_collaborator_storage() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (alice, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_claim");

    create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    let funder = Address::generate(&env);
    let stellar_token = token::StellarAssetClient::new(&env, &token);

    let amount = 2_000_0000000_i128;

    stellar_token.mint(&funder, &amount);

    client.deposit(
        &project_id,
        &funder,
        &amount,
    );

    client.distribute(&project_id);

    let claimed_amount = client
        .claim(&project_id, &alice)
        .expect("claim should succeed");

    assert!(claimed_amount > 0);

    let contract_id = env.current_contract_address();

    advance_ledger(&env, 90_000);

    // Verify collaborator-specific persistent entries remain present.
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::Claimed(
            project_id.clone(),
            alice.clone()
        )
    ));

    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::LastClaimAmount(
            project_id.clone(),
            alice.clone()
        )
    ));

    // Verify the public read path still works.
    let claimable = client
        .get_claimable(&project_id, &alice)
        .expect("claimable data should remain readable");

    assert!(claimable.claimed > 0);
    assert_eq!(
        claimable.last_claim_amount,
        claimed_amount
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// General metadata / existence checks
// ─────────────────────────────────────────────────────────────────────────────

/// Project existence and metadata should remain consistent after ledger
/// advancement.
#[test]
fn test_project_metadata_remains_consistent_after_ledger_advance() {
    let env = Env::default();
    let (client, token) = setup_env_with_token(&env);

    let (_, _, collaborators) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_metadata");

    let owner = create_project(
        &env,
        &client,
        &token,
        &project_id,
        &collaborators,
    );

    advance_ledger(&env, 75_000);

    assert!(client.project_exists(&project_id));

    let missing_project = Symbol::new(&env, "missing");

    assert!(!client.project_exists(&missing_project));

    let project = client
        .get_project(&project_id)
        .expect("project should remain readable");

    assert_eq!(project.project_id, project_id);
    assert_eq!(project.owner, owner);
    assert!(!project.locked);
}