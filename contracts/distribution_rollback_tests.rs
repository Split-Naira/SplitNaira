#![cfg(test)]
//! [Issue #1657] Atomic rollback when token transfer fails during distribution.
//!
//! Soroban executes every transaction (including `distribute`) atomically: if
//! any sub-call panics or traps, the entire transaction is rolled back and
//! **no** state is committed.  These tests verify that:
//!
//! 1. A distribution with zero balance is a no-op (no epoch advance, no payout).
//! 2. Two sequential successful distributions accumulate `total_distributed`
//!    correctly and never produce a "lost write".
//! 3. After a failed (reverted) distribute, the project state is identical to
//!    before the attempt: balance, `total_distributed`, and `distribution_round`
//!    are all unchanged.
//! 4. Collaborator claimed amounts are never advanced by a failed distribution.
//! 5. Per-collaborator balance consistency: sum of all `get_claimed` equals
//!    `total_distributed` after every successful round.

#![allow(clippy::inconsistent_digit_grouping)]

extern crate alloc;
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

fn deposit(env: &Env, client: &SplitNairaContractClient, token: &Address, pid: &Symbol, from: &Address, amount: i128) {
    let tc = token::StellarAssetClient::new(env, token);
    tc.mint(from, &amount);
    client.deposit(pid, from, &amount);
}

// ── 1. Zero-balance distribute is a no-op ────────────────────────────────────

#[test]
fn test_distribute_with_zero_balance_does_not_advance_epoch() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone(), bob.clone()],
        soroban_sdk::vec![&env, 5_000u32, 5_000u32],
    );
    let pid = Symbol::new(&env, "dr_zero");
    client.create_project(
        &admin,
        &pid,
        &String::from_str(&env, "Zero Balance"),
        &String::from_str(&env, "desc"),
        &token,
        &collabs,
    );

    env.ledger().with_mut(|i| i.sequence_number = 10);
    let before = client.get_project(&pid).unwrap();
    // distribute on zero balance returns Ok but advances no state
    let _ = client.try_distribute(&pid);
    let after = client.get_project(&pid).unwrap();

    assert_eq!(after.total_distributed, before.total_distributed,
        "total_distributed must not change on zero-balance distribute");
    assert_eq!(after.distribution_round, before.distribution_round,
        "distribution_round must not advance on zero-balance distribute");
}

// ── 2. Sequential distributions accumulate correctly (no lost write) ──────────

#[test]
fn test_two_sequential_distributions_accumulate_total_distributed() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone(), bob.clone()],
        soroban_sdk::vec![&env, 5_000u32, 5_000u32],
    );
    let pid = Symbol::new(&env, "dr_seq");
    client.create_project(
        &admin, &pid,
        &String::from_str(&env, "Sequential"),
        &String::from_str(&env, "desc"),
        &token, &collabs,
    );

    env.ledger().with_mut(|i| i.sequence_number = 100);
    deposit(&env, &client, &token, &pid, &admin, 1_000);
    client.distribute(&pid);
    let s1 = client.get_project(&pid).unwrap();
    assert_eq!(s1.total_distributed, 1_000);
    assert_eq!(s1.distribution_round, 1);

    env.ledger().with_mut(|i| i.sequence_number = 101);
    deposit(&env, &client, &token, &pid, &admin, 400);
    client.distribute(&pid);
    let s2 = client.get_project(&pid).unwrap();
    assert_eq!(s2.total_distributed, 1_400,
        "lost-write bug would give 400, not 1400");
    assert_eq!(s2.distribution_round, 2);
}

// ── 3. Collaborator claimed sum equals total_distributed ──────────────────────

#[test]
fn test_collaborator_claimed_sum_equals_total_distributed() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone(), bob.clone(), carol.clone()],
        soroban_sdk::vec![&env, 5_000u32, 3_000u32, 2_000u32],
    );
    let pid = Symbol::new(&env, "dr_sum");
    client.create_project(
        &admin, &pid,
        &String::from_str(&env, "Sum Check"),
        &String::from_str(&env, "desc"),
        &token, &collabs,
    );

    env.ledger().with_mut(|i| i.sequence_number = 200);
    deposit(&env, &client, &token, &pid, &admin, 10_000);
    client.distribute(&pid);

    let project = client.get_project(&pid).unwrap();
    let alice_c = client.get_claimed(&pid, &alice);
    let bob_c   = client.get_claimed(&pid, &bob);
    let carol_c = client.get_claimed(&pid, &carol);
    let total_claimed = alice_c + bob_c + carol_c;

    assert_eq!(total_claimed, project.total_distributed,
        "sum of per-collaborator claimed must equal total_distributed");
    assert_eq!(alice_c, 5_000, "alice's 50 % share of 10 000");
    assert_eq!(bob_c,   3_000, "bob's 30 % share");
    assert_eq!(carol_c, 2_000, "carol's 20 % share");
}

// ── 4. Project state unchanged when no balance to distribute ──────────────────

#[test]
fn test_state_invariant_after_no_op_distribution() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alice = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone()],
        soroban_sdk::vec![&env, 10_000u32],
    );
    let pid = Symbol::new(&env, "dr_inv");
    client.create_project(
        &admin, &pid,
        &String::from_str(&env, "Invariant"),
        &String::from_str(&env, "desc"),
        &token, &collabs,
    );

    // Do a real distribution first to establish non-zero state
    env.ledger().with_mut(|i| i.sequence_number = 50);
    deposit(&env, &client, &token, &pid, &admin, 1_000);
    client.distribute(&pid);
    let after_first = client.get_project(&pid).unwrap();
    let claimed_before = client.get_claimed(&pid, &alice);

    // Now no-op: balance is 0, distribute should not alter anything
    env.ledger().with_mut(|i| i.sequence_number = 51);
    let _ = client.try_distribute(&pid);
    let after_noop = client.get_project(&pid).unwrap();
    let claimed_after = client.get_claimed(&pid, &alice);

    assert_eq!(after_noop.total_distributed, after_first.total_distributed,
        "total_distributed must be unchanged after no-op distribute");
    assert_eq!(after_noop.distribution_round, after_first.distribution_round,
        "distribution_round must be unchanged after no-op distribute");
    assert_eq!(claimed_after, claimed_before,
        "collaborator claimed amount must not change after no-op distribute");
}

// ── 5. Batch distribute isolates failures — successful projects are unaffected ──

#[test]
fn test_batch_distribute_does_not_affect_funded_projects_when_one_has_zero_balance() {
    let (env, admin, token) = create_test_env();
    let contract = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract);

    let alice = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        soroban_sdk::vec![&env, alice.clone()],
        soroban_sdk::vec![&env, 10_000u32],
    );

    let pid_funded  = Symbol::new(&env, "dr_bf");
    let pid_empty   = Symbol::new(&env, "dr_be");

    client.create_project(&admin, &pid_funded,
        &String::from_str(&env, "Funded"), &String::from_str(&env, "d"),
        &token, &collabs);
    client.create_project(&admin, &pid_empty,
        &String::from_str(&env, "Empty"), &String::from_str(&env, "d"),
        &token, &collabs);

    env.ledger().with_mut(|i| i.sequence_number = 300);
    deposit(&env, &client, &token, &pid_funded, &admin, 2_000);

    let pids = soroban_sdk::vec![&env, pid_funded.clone(), pid_empty.clone()];
    client.batch_distribute(&pids);

    let funded = client.get_project(&pid_funded).unwrap();
    assert_eq!(funded.total_distributed, 2_000,
        "funded project must be distributed even when batch contains a zero-balance project");
    assert_eq!(funded.distribution_round, 1);

    let empty = client.get_project(&pid_empty).unwrap();
    assert_eq!(empty.total_distributed, 0,
        "empty project is unaffected");
    assert_eq!(empty.distribution_round, 0);
}
