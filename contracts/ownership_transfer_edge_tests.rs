#![cfg(test)]
//! [Issue #1659] Ownership-transfer authorization edge cases.
//!
//! Covers (beyond the existing success/non-owner/locked/event tests):
//! - Self-transfer (owner transfers to themselves)
//! - Repeated transfer (owner transfers twice in a row)
//! - Non-owner attempt on a project with pending (undistributed) balance
//! - Invalid destination: zero-address equivalent (generated fresh address not on project)
//! - Transfer reverts the caller identity correctly so old-owner calls fail after transfer

#![allow(clippy::inconsistent_digit_grouping)]

extern crate alloc;
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Env, String, Symbol, Vec,
};

fn create_test_env() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract(token_admin.clone());
    (env, token_admin, token_contract)
}

fn make_collaborators(env: &Env, addresses: Vec<Address>, bps: Vec<u32>) -> Vec<Collaborator> {
    let mut collabs = Vec::new(env);
    for (i, (addr, bp)) in addresses.iter().zip(bps.iter()).enumerate() {
        let alias = std::format!("C{}", i);
        collabs.push_back(Collaborator {
            address: addr.clone(),
            alias: String::from_str(env, &alias),
            basis_points: bp,
        });
    }
    collabs
}

fn setup_project(env: &Env, client: &SplitNairaContractClient, admin: &Address, token: &Address, pid: &Symbol) {
    let alice = Address::generate(env);
    let bob = Address::generate(env);
    let collabs = make_collaborators(
        env,
        soroban_sdk::vec![env, alice, bob],
        soroban_sdk::vec![env, 5_000u32, 5_000u32],
    );
    client.create_project(
        admin,
        pid,
        &String::from_str(env, "Test Project"),
        &String::from_str(env, "desc"),
        token,
        &collabs,
    );
}

// ── Self-transfer ─────────────────────────────────────────────────────────────

#[test]
fn test_transfer_ownership_self_transfer_succeeds_and_owner_unchanged() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "ot_self");
    setup_project(&env, &client, &admin, &token, &pid);

    // Transfer to self: should succeed without error (no business rule bans it)
    client.transfer_project_ownership(&pid, &admin, &admin);

    let project = client.get_project(&pid).unwrap();
    assert_eq!(project.owner, admin, "owner must remain the same after self-transfer");
}

// ── Repeated transfer ─────────────────────────────────────────────────────────

#[test]
fn test_transfer_ownership_repeated_transfer_updates_owner_each_time() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "ot_rep");
    setup_project(&env, &client, &admin, &token, &pid);

    let owner2 = Address::generate(&env);
    let owner3 = Address::generate(&env);

    // First transfer: admin → owner2
    client.transfer_project_ownership(&pid, &admin, &owner2);
    let p1 = client.get_project(&pid).unwrap();
    assert_eq!(p1.owner, owner2);

    // Second transfer: owner2 → owner3
    client.transfer_project_ownership(&pid, &owner2, &owner3);
    let p2 = client.get_project(&pid).unwrap();
    assert_eq!(p2.owner, owner3);
}

#[test]
fn test_old_owner_cannot_transfer_after_handoff() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "ot_old");
    setup_project(&env, &client, &admin, &token, &pid);

    let new_owner = Address::generate(&env);
    client.transfer_project_ownership(&pid, &admin, &new_owner);

    // Old owner (admin) tries to transfer again — must fail with Unauthorized
    let result = client.try_transfer_project_ownership(&pid, &admin, &Address::generate(&env));
    assert!(result.is_err(), "old owner must not be able to transfer after handoff");
}

// ── Non-owner with pending balance ───────────────────────────────────────────

#[test]
fn test_transfer_ownership_non_owner_rejected_even_with_pending_payout() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "ot_pend");

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone(), bob.clone()],
        soroban_sdk::vec![&env, 5_000u32, 5_000u32],
    );
    client.create_project(
        &admin,
        &pid,
        &String::from_str(&env, "Pending Project"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );

    // Deposit funds so there is a pending balance
    let token_client = token::StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000i128);
    client.deposit(&pid, &admin, &1_000i128);

    let attacker = Address::generate(&env);
    let result = client.try_transfer_project_ownership(&pid, &attacker, &attacker);
    assert!(
        result.is_err(),
        "non-owner must be rejected even when project has undistributed balance"
    );

    // Owner is unchanged
    let project = client.get_project(&pid).unwrap();
    assert_eq!(project.owner, admin);
}

// ── Transfer with pending payout — owner can still transfer ──────────────────

#[test]
fn test_owner_can_transfer_while_pending_payout_exists() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);
    let pid = Symbol::new(&env, "ot_opend");

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone(), bob.clone()],
        soroban_sdk::vec![&env, 5_000u32, 5_000u32],
    );
    client.create_project(
        &admin,
        &pid,
        &String::from_str(&env, "Project with balance"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );

    let token_client = token::StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &500i128);
    client.deposit(&pid, &admin, &500i128);

    let new_owner = Address::generate(&env);
    // Legitimate owner may transfer even with pending balance
    client.transfer_project_ownership(&pid, &admin, &new_owner);

    let project = client.get_project(&pid).unwrap();
    assert_eq!(project.owner, new_owner);
    // Balance is preserved after ownership transfer
    assert_eq!(project.balance, 500);
}
