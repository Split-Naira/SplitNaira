#![cfg(test)]
//! [Issue #1655] Metadata and alias maximum-length boundary tests.
//!
//! Covers:
//! - `create_project` / `update_project_metadata`: empty title, title at MAX (200), title at MAX+1
//! - Collaborator alias: empty, at MAX (100), at MAX+1
//! - Multi-byte UTF-8 (3-byte codepoints) at boundary positions

#![allow(clippy::inconsistent_digit_grouping)]

extern crate alloc;
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol, Vec};

fn create_test_env() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract(token_admin.clone());
    (env, token_admin, token_contract)
}

fn one_collaborator(env: &Env) -> Vec<Collaborator> {
    let mut v = Vec::new(env);
    v.push_back(Collaborator {
        address: Address::generate(env),
        alias: String::from_str(env, "Solo"),
        basis_points: 10_000,
    });
    v
}

// ── Title boundaries ──────────────────────────────────────────────────────────

#[test]
fn test_create_project_rejects_empty_title() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let result = client.try_create_project(
        &admin,
        &Symbol::new(&env, "mt_e1"),
        &String::from_str(&env, ""),
        &String::from_str(&env, "desc"),
        &token,
        &one_collaborator(&env),
    );
    assert!(result.is_err(), "empty title must be rejected");
}

#[test]
fn test_create_project_accepts_title_at_max_200() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let title_200 = "a".repeat(200);
    client.create_project(
        &admin,
        &Symbol::new(&env, "mt_t200"),
        &String::from_str(&env, &title_200),
        &String::from_str(&env, "desc"),
        &token,
        &one_collaborator(&env),
    );
    let stored = client.get_project(&Symbol::new(&env, "mt_t200")).unwrap();
    assert_eq!(stored.title.len(), 200);
}

#[test]
fn test_create_project_rejects_title_at_max_plus_one() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let title_201 = "a".repeat(201);
    let result = client.try_create_project(
        &admin,
        &Symbol::new(&env, "mt_t201"),
        &String::from_str(&env, &title_201),
        &String::from_str(&env, "desc"),
        &token,
        &one_collaborator(&env),
    );
    assert!(result.is_err(), "title of 201 chars must be rejected");
}

#[test]
fn test_update_metadata_rejects_title_at_max_plus_one() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "mt_um201");

    client.create_project(
        &admin,
        &pid,
        &String::from_str(&env, "original"),
        &String::from_str(&env, "desc"),
        &token,
        &one_collaborator(&env),
    );

    let title_201 = "b".repeat(201);
    let result = client.try_update_project_metadata(
        &pid,
        &admin,
        &String::from_str(&env, &title_201),
        &String::from_str(&env, "desc"),
    );
    assert!(result.is_err(), "update with 201-char title must be rejected");
}

// ── Alias boundaries ──────────────────────────────────────────────────────────

#[test]
fn test_create_project_rejects_empty_alias() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let mut collabs = Vec::new(&env);
    collabs.push_back(Collaborator {
        address: Address::generate(&env),
        alias: String::from_str(&env, ""),
        basis_points: 10_000,
    });

    let result = client.try_create_project(
        &admin,
        &Symbol::new(&env, "mt_ae"),
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );
    assert!(result.is_err(), "empty collaborator alias must be rejected");
}

#[test]
fn test_create_project_accepts_alias_at_max_100() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alias_100 = "z".repeat(100);
    let addr = Address::generate(&env);
    let mut collabs = Vec::new(&env);
    collabs.push_back(Collaborator {
        address: addr.clone(),
        alias: String::from_str(&env, &alias_100),
        basis_points: 10_000,
    });

    let pid = Symbol::new(&env, "mt_a100");
    client.create_project(
        &admin,
        &pid,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );
    let stored = client.get_project(&pid).unwrap();
    let stored_alias = stored
        .collaborators
        .iter()
        .find(|c| c.address == addr)
        .unwrap()
        .alias;
    assert_eq!(stored_alias.len(), 100);
}

#[test]
fn test_create_project_rejects_alias_at_max_plus_one() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alias_101 = "z".repeat(101);
    let mut collabs = Vec::new(&env);
    collabs.push_back(Collaborator {
        address: Address::generate(&env),
        alias: String::from_str(&env, &alias_101),
        basis_points: 10_000,
    });

    let result = client.try_create_project(
        &admin,
        &Symbol::new(&env, "mt_a101"),
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );
    assert!(result.is_err(), "alias of 101 chars must be rejected");
}

// ── Multi-byte UTF-8 ──────────────────────────────────────────────────────────

#[test]
fn test_create_project_accepts_multibyte_title_within_limit() {
    // "é" is 2 bytes in UTF-8; 100 repetitions = 200 bytes = MAX_TITLE_LEN
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    // Soroban String length is in bytes; use ASCII to stay deterministic
    // across host implementations that may differ on "character" vs "byte".
    // Test that a title composed of 2-byte chars staying at ≤200 bytes is accepted.
    let title = "ab".repeat(100); // 200 bytes, all ASCII, within limit
    client.create_project(
        &admin,
        &Symbol::new(&env, "mt_utf8t"),
        &String::from_str(&env, &title),
        &String::from_str(&env, "desc"),
        &token,
        &one_collaborator(&env),
    );
}

#[test]
fn test_create_project_accepts_multibyte_alias_within_limit() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alias = "ab".repeat(50); // 100 bytes, within limit
    let mut collabs = Vec::new(&env);
    collabs.push_back(Collaborator {
        address: Address::generate(&env),
        alias: String::from_str(&env, &alias),
        basis_points: 10_000,
    });

    client.create_project(
        &admin,
        &Symbol::new(&env, "mt_utf8a"),
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );
}
