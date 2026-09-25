#![cfg(test)]
//! Claim-path tests for fully distributed projects after an admin pause.
//!
//! A "fully distributed" project is one where `distribute` has already paid
//! out the entire project balance (`get_balance == 0`). These tests pin the
//! behavior of `claim` against such projects while `pause_distributions` is
//! active and after `unpause_distributions`:
//!
//! - The pause check runs before any project lookup or balance check, so a
//!   paused `claim` returns `DistributionsPaused` (code 16) even when there is
//!   nothing left to claim, and even for non-collaborators.
//! - A rejected claim mutates nothing: token balances, the `Claimed` ledger,
//!   `LastClaimAmount`, `total_distributed`, and `distribution_round` are
//!   unchanged.
//! - Read paths (`get_balance`, `get_claimed`, `get_claimable`) keep working
//!   while paused so support tooling can inspect payout history.
//! - After unpause, claiming on a fully distributed project returns `0`
//!   without moving funds; a fresh deposit made during the pause is claimable
//!   only after unpause, and only the new deposit is paid out.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Symbol, Vec};

const DEPOSIT: i128 = 10_000_000;
const ALICE_BPS: u32 = 6_000;
const BOB_BPS: u32 = 4_000;

struct Fixture<'a> {
    env: Env,
    client: SplitNairaContractClient<'a>,
    admin: Address,
    owner: Address,
    token: Address,
    alice: Address,
    bob: Address,
    project_id: Symbol,
}

/// Creates a 60/40 project, deposits `DEPOSIT`, runs one full `distribute`
/// round, then pauses distributions. On return the project balance is zero.
fn fully_distributed_then_paused<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.set_admin(&admin);

    let mut collabs = Vec::new(&env);
    collabs.push_back(Collaborator {
        address: alice.clone(),
        alias: String::from_str(&env, "Alice"),
        basis_points: ALICE_BPS,
    });
    collabs.push_back(Collaborator {
        address: bob.clone(),
        alias: String::from_str(&env, "Bob"),
        basis_points: BOB_BPS,
    });

    let project_id = Symbol::new(&env, "paused_done");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Paused Fully Distributed"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    fund_and_deposit(&env, &client, &token, &project_id, &owner, DEPOSIT);
    client.distribute(&project_id);
    assert_eq!(client.get_balance(&project_id), 0, "fixture must be fully distributed");

    client.pause_distributions(&admin);
    assert!(client.is_distributions_paused());

    Fixture {
        env,
        client,
        admin,
        owner,
        token,
        alice,
        bob,
        project_id,
    }
}

fn fund_and_deposit(
    env: &Env,
    client: &SplitNairaContractClient,
    token: &Address,
    project_id: &Symbol,
    from: &Address,
    amount: i128,
) {
    token::StellarAssetClient::new(env, token).mint(from, &amount);
    client.deposit(project_id, from, &amount);
}

fn token_balance(f: &Fixture, who: &Address) -> i128 {
    token::Client::new(&f.env, &f.token).balance(who)
}

#[test]
fn claim_on_fully_distributed_project_is_rejected_while_paused() {
    let f = fully_distributed_then_paused();

    // Pause takes precedence over the zero-balance `Ok(0)` short-circuit.
    assert_eq!(
        f.client.try_claim(&f.project_id, &f.alice),
        Err(Ok(SplitError::DistributionsPaused))
    );
    assert_eq!(
        f.client.try_claim(&f.project_id, &f.bob),
        Err(Ok(SplitError::DistributionsPaused))
    );
}

#[test]
fn paused_claim_rejects_non_collaborator_with_pause_error() {
    let f = fully_distributed_then_paused();
    let stranger = Address::generate(&f.env);

    // The pause check runs before collaborator membership is evaluated.
    assert_eq!(
        f.client.try_claim(&f.project_id, &stranger),
        Err(Ok(SplitError::DistributionsPaused))
    );
}

#[test]
fn rejected_paused_claim_does_not_mutate_state() {
    let f = fully_distributed_then_paused();

    let alice_tokens = token_balance(&f, &f.alice);
    let before_project = f.client.get_project(&f.project_id).unwrap();
    let before_claimable = f.client.get_claimable(&f.project_id, &f.alice);

    let _ = f.client.try_claim(&f.project_id, &f.alice);

    assert_eq!(token_balance(&f, &f.alice), alice_tokens);
    assert_eq!(f.client.get_balance(&f.project_id), 0);

    let after_project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(after_project.total_distributed, before_project.total_distributed);
    assert_eq!(after_project.distribution_round, before_project.distribution_round);
    assert_eq!(f.client.get_claimable(&f.project_id, &f.alice), before_claimable);
}

#[test]
fn payout_history_is_readable_while_paused() {
    let f = fully_distributed_then_paused();

    let alice_share = DEPOSIT * ALICE_BPS as i128 / 10_000;
    let bob_share = DEPOSIT - alice_share;

    assert_eq!(f.client.get_balance(&f.project_id), 0);
    assert_eq!(f.client.get_claimed(&f.project_id, &f.alice), alice_share);
    assert_eq!(f.client.get_claimed(&f.project_id, &f.bob), bob_share);

    let info = f.client.get_claimable(&f.project_id, &f.alice);
    assert_eq!(info.claimed, alice_share);
    assert_eq!(info.distribution_round, 1);
    assert_eq!(info.last_claim_amount, 0, "push distribution is not a claim");

    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.total_distributed, DEPOSIT);
}

#[test]
fn distribute_on_fully_distributed_project_is_rejected_while_paused() {
    let f = fully_distributed_then_paused();

    assert_eq!(
        f.client.try_distribute(&f.project_id),
        Err(Ok(SplitError::DistributionsPaused))
    );

    f.client.unpause_distributions(&f.admin);

    // Once unpaused, the underlying reason surfaces: nothing left to pay.
    assert_eq!(
        f.client.try_distribute(&f.project_id),
        Err(Ok(SplitError::NoBalance))
    );
}

#[test]
fn claim_after_unpause_returns_zero_without_moving_funds() {
    let f = fully_distributed_then_paused();
    f.client.unpause_distributions(&f.admin);

    let alice_tokens = token_balance(&f, &f.alice);
    let claimed_before = f.client.get_claimed(&f.project_id, &f.alice);

    assert_eq!(f.client.claim(&f.project_id, &f.alice), 0);

    assert_eq!(token_balance(&f, &f.alice), alice_tokens);
    assert_eq!(f.client.get_claimed(&f.project_id, &f.alice), claimed_before);
    assert_eq!(f.client.get_claimable(&f.project_id, &f.alice).last_claim_amount, 0);

    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.total_distributed, DEPOSIT);
    assert_eq!(project.distribution_round, 1);
}

#[test]
fn deposit_during_pause_is_claimable_only_after_unpause() {
    let f = fully_distributed_then_paused();

    // Deposits stay open during a pause (see runbooks/stuck-payouts.md).
    let top_up: i128 = 5_000_000;
    fund_and_deposit(&f.env, &f.client, &f.token, &f.project_id, &f.owner, top_up);
    assert_eq!(f.client.get_balance(&f.project_id), top_up);

    assert_eq!(
        f.client.try_claim(&f.project_id, &f.alice),
        Err(Ok(SplitError::DistributionsPaused))
    );
    assert_eq!(f.client.get_balance(&f.project_id), top_up);

    f.client.unpause_distributions(&f.admin);

    let alice_tokens = token_balance(&f, &f.alice);
    let claimed_before = f.client.get_claimed(&f.project_id, &f.alice);
    let expected = top_up * ALICE_BPS as i128 / 10_000;

    // Only the new deposit is paid; the earlier round is not re-claimed.
    assert_eq!(f.client.claim(&f.project_id, &f.alice), expected);
    assert_eq!(token_balance(&f, &f.alice) - alice_tokens, expected);
    assert_eq!(f.client.get_claimed(&f.project_id, &f.alice), claimed_before + expected);
    assert_eq!(f.client.get_balance(&f.project_id), top_up - expected);

    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.total_distributed, DEPOSIT + expected);
    assert_eq!(project.distribution_round, 1, "claim must not bump the push round");
}

#[test]
fn repause_after_partial_claim_blocks_remaining_collaborator() {
    let f = fully_distributed_then_paused();

    let top_up: i128 = 5_000_000;
    fund_and_deposit(&f.env, &f.client, &f.token, &f.project_id, &f.owner, top_up);
    f.client.unpause_distributions(&f.admin);
    let alice_claim = f.client.claim(&f.project_id, &f.alice);

    f.client.pause_distributions(&f.admin);

    let remaining = top_up - alice_claim;
    let bob_tokens = token_balance(&f, &f.bob);
    assert_eq!(
        f.client.try_claim(&f.project_id, &f.bob),
        Err(Ok(SplitError::DistributionsPaused))
    );
    assert_eq!(token_balance(&f, &f.bob), bob_tokens);
    assert_eq!(f.client.get_balance(&f.project_id), remaining);
}
