#![cfg(test)]
//! Collaborator address validation tests (issue #948).
//!
//! Covers `validate_collaborators` and `create_project` responses to invalid
//! inputs: zero basis points, duplicate addresses, too few collaborators,
//! invalid split totals, and the happy-path confirming that well-formed
//! collaborator lists are accepted.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String, Symbol, Vec};

fn setup() -> (Env, SplitNairaContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    (env, client, token)
}

fn new_project_id(env: &Env, name: &str) -> Symbol {
    Symbol::new(env, name)
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_project_with_valid_addresses_succeeds() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: alice,
            alias: String::from_str(&env, "Alice"),
            basis_points: 6000,
        },
        Collaborator {
            address: bob,
            alias: String::from_str(&env, "Bob"),
            basis_points: 4000,
        },
    ];

    client.create_project(
        &owner,
        &new_project_id(&env, "valid_split"),
        &String::from_str(&env, "Valid Split Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(client.get_project_count(), 1);
}

#[test]
fn create_project_with_three_collaborators_succeeds() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "Producer"),
            basis_points: 5000,
        },
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "Artist"),
            basis_points: 3000,
        },
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "Label"),
            basis_points: 2000,
        },
    ];

    client.create_project(
        &owner,
        &new_project_id(&env, "triple_split"),
        &String::from_str(&env, "Triple Split"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(client.get_project_count(), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TooFewCollaborators
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_project_with_one_collaborator_returns_too_few() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "Solo"),
            basis_points: 10000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "solo_project"),
        &String::from_str(&env, "Solo Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::TooFewCollaborators)));
}

#[test]
fn create_project_with_empty_collaborators_returns_too_few() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs: Vec<Collaborator> = Vec::new(&env);

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "empty_project"),
        &String::from_str(&env, "Empty Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::TooFewCollaborators)));
}

// ─────────────────────────────────────────────────────────────────────────────
// ZeroShare
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_project_with_zero_basis_points_returns_zero_share() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: alice,
            alias: String::from_str(&env, "Alice"),
            basis_points: 0, // invalid — zero share
        },
        Collaborator {
            address: bob,
            alias: String::from_str(&env, "Bob"),
            basis_points: 10000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "zero_share"),
        &String::from_str(&env, "Zero Share Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::ZeroShare)));
}

#[test]
fn create_project_all_zero_basis_points_returns_zero_share() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "A"),
            basis_points: 0,
        },
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "B"),
            basis_points: 0,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "all_zero"),
        &String::from_str(&env, "All Zero Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::ZeroShare)));
}

// ─────────────────────────────────────────────────────────────────────────────
// DuplicateCollaborator
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_project_with_duplicate_address_returns_duplicate_error() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let same_addr = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: same_addr.clone(),
            alias: String::from_str(&env, "Alice"),
            basis_points: 5000,
        },
        Collaborator {
            address: same_addr.clone(), // same address again
            alias: String::from_str(&env, "Also Alice"),
            basis_points: 5000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "dup_collab"),
        &String::from_str(&env, "Duplicate Collaborator Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::DuplicateCollaborator)));
}

#[test]
fn create_project_duplicate_in_three_returns_duplicate_error() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let dup_addr = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "First"),
            basis_points: 4000,
        },
        Collaborator {
            address: dup_addr.clone(),
            alias: String::from_str(&env, "Second"),
            basis_points: 3000,
        },
        Collaborator {
            address: dup_addr.clone(), // duplicate of Second
            alias: String::from_str(&env, "Third"),
            basis_points: 3000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "dup_mid"),
        &String::from_str(&env, "Mid Duplicate Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::DuplicateCollaborator)));
}

// ─────────────────────────────────────────────────────────────────────────────
// InvalidSplit (basis points don't sum to 10 000)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_project_basis_points_under_ten_thousand_returns_invalid_split() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "A"),
            basis_points: 4000, // total = 7000 ≠ 10000
        },
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "B"),
            basis_points: 3000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "under_split"),
        &String::from_str(&env, "Under Split"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::InvalidSplit)));
}

#[test]
fn create_project_basis_points_over_ten_thousand_returns_invalid_split() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);

    let collabs = vec![
        &env,
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "A"),
            basis_points: 7000, // total = 13000 ≠ 10000
        },
        Collaborator {
            address: Address::generate(&env),
            alias: String::from_str(&env, "B"),
            basis_points: 6000,
        },
    ];

    let result = client.try_create_project(
        &owner,
        &new_project_id(&env, "over_split"),
        &String::from_str(&env, "Over Split"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::InvalidSplit)));
}
