#![cfg(test)]

//! Zero-value and minimum-value deposit boundaries (issue #1645).
//!
//! Pinned behaviour of `deposit` at the bottom of the amount range:
//!
//! | Amount                 | Result                                                   |
//! |------------------------|----------------------------------------------------------|
//! | `i128::MIN`, `-1`, `0` | `InvalidAmount`, checked before the project lookup and before any token transfer or authorization |
//! | `1` (one stroop)       | accepted: balance, accounting, event and claim epoch all move by exactly one stroop |
//!
//! A deposit is accepted at one stroop even though it may not yet be
//! *distributable*: `distribute` needs a balance of at least one stroop per
//! collaborator (`NoBalance` otherwise), so the smallest distributable balance
//! is the collaborator count. Sub-minimum deposits accumulate until that
//! threshold is reached. A `claim` whose share rounds down to zero returns `0`
//! and does not use up the collaborator's claim for that epoch.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, vec, Address, Env, FromVal, String, Symbol, TryFromVal, Val, Vec,
};

struct Fixture<'a> {
    env: Env,
    client: SplitNairaContractClient<'a>,
    contract_id: Address,
    token: Address,
    funder: Address,
    alice: Address,
    bob: Address,
    project_id: Symbol,
}

/// Two collaborators on a 60/40 split, with a funder holding `funds`.
fn fixture<'a>(env: &'a Env, funds: i128) -> Fixture<'a> {
    env.mock_all_auths();
    let token = env.register_stellar_asset_contract(Address::generate(env));
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);

    let alice = Address::generate(env);
    let bob = Address::generate(env);
    let funder = Address::generate(env);
    let project_id = Symbol::new(env, "deposit_bounds");

    client.create_project(
        &Address::generate(env),
        &project_id,
        &String::from_str(env, "Deposit Bounds"),
        &String::from_str(env, "music"),
        &token,
        &vec![
            env,
            Collaborator {
                address: alice.clone(),
                alias: String::from_str(env, "Alice"),
                basis_points: 6000,
            },
            Collaborator {
                address: bob.clone(),
                alias: String::from_str(env, "Bob"),
                basis_points: 4000,
            },
        ],
    );
    if funds > 0 {
        token::StellarAssetClient::new(env, &token).mint(&funder, &funds);
    }

    Fixture {
        env: env.clone(),
        client,
        contract_id,
        token,
        funder,
        alice,
        bob,
        project_id,
    }
}

impl<'a> Fixture<'a> {
    fn token_balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(who)
    }
}

/// `(amount, project_balance)` of the most recent `deposit_received` event
/// published by the contract.
fn last_deposit_event(f: &Fixture) -> Option<(i128, i128)> {
    let mut out = None;
    for event in f.env.events().all().iter() {
        if event.0 != f.contract_id {
            continue;
        }
        let topic0 = Symbol::from_val(&f.env, &event.1.get(0).unwrap());
        if topic0 == Symbol::new(&f.env, "deposit_received") {
            let data = Vec::<Val>::try_from_val(&f.env, &event.2).unwrap();
            // data = (from, amount, project_balance)
            let amount = i128::from_val(&f.env, &data.get(1).unwrap());
            let balance = i128::from_val(&f.env, &data.get(2).unwrap());
            out = Some((amount, balance));
        }
    }
    out
}

// -----------------------------------------------------------------------------
// Zero and negative amounts
// -----------------------------------------------------------------------------

#[test]
fn non_positive_amounts_are_rejected_before_project_lookup_and_transfer() {
    let env = Env::default();
    let f = fixture(&env, 1_000);

    let missing = Symbol::new(&env, "never_created");
    for amount in [0i128, -1, i128::MIN] {
        assert_eq!(
            f.client.try_deposit(&f.project_id, &f.funder, &amount),
            Err(Ok(SplitError::InvalidAmount)),
            "amount {amount} on an existing project"
        );
        // The amount guard runs first, so a missing project still reports
        // InvalidAmount rather than NotFound.
        assert_eq!(
            f.client.try_deposit(&missing, &f.funder, &amount),
            Err(Ok(SplitError::InvalidAmount)),
            "amount {amount} on a missing project"
        );
    }

    assert_eq!(f.client.get_balance(&f.project_id), 0);
    assert_eq!(f.token_balance(&f.funder), 1_000);
    assert_eq!(f.token_balance(&f.contract_id), 0);
    assert_eq!(f.client.get_unallocated_balance(&f.token), 0);
}

#[test]
fn non_positive_amount_is_rejected_without_requiring_the_funders_signature() {
    // Fully auth-enforcing environment for the deposit itself: if the guard
    // ran after `from.require_auth()`, the unsigned call would trap instead
    // of returning a contract error.
    let env = Env::default();
    let f = fixture(&env, 0);
    env.set_auths(&[]);

    assert_eq!(
        f.client.try_deposit(&f.project_id, &f.funder, &0),
        Err(Ok(SplitError::InvalidAmount))
    );
    assert_eq!(
        f.client.try_deposit(&f.project_id, &f.funder, &-1),
        Err(Ok(SplitError::InvalidAmount))
    );
}

#[test]
fn rejected_zero_deposit_does_not_open_a_new_claim_epoch() {
    let env = Env::default();
    let f = fixture(&env, 10_000);

    f.client.deposit(&f.project_id, &f.funder, &10_000);
    assert_eq!(f.client.claim(&f.project_id, &f.alice), 6_000);

    assert_eq!(
        f.client.try_deposit(&f.project_id, &f.funder, &0),
        Err(Ok(SplitError::InvalidAmount))
    );

    // Still the same epoch: the zero deposit did not reopen alice's claim.
    assert_eq!(
        f.client.try_claim(&f.project_id, &f.alice),
        Err(Ok(SplitError::AlreadyClaimed))
    );
    assert_eq!(f.client.get_balance(&f.project_id), 4_000);
}

// -----------------------------------------------------------------------------
// One stroop
// -----------------------------------------------------------------------------

#[test]
fn one_stroop_deposit_is_accepted_and_accounted_exactly() {
    let env = Env::default();
    let f = fixture(&env, 1);

    f.client.deposit(&f.project_id, &f.funder, &1);
    assert_eq!(
        last_deposit_event(&f),
        Some((1i128, 1i128)),
        "deposit_received must carry amount 1 and project_balance 1"
    );

    assert_eq!(f.client.get_balance(&f.project_id), 1);
    assert_eq!(f.token_balance(&f.funder), 0);
    assert_eq!(f.token_balance(&f.contract_id), 1);
    // The single stroop is accounted to the project, so none of it is
    // recoverable as unallocated.
    assert_eq!(f.client.get_unallocated_balance(&f.token), 0);

    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.total_distributed, 0);
    assert_eq!(project.distribution_round, 0);
}

#[test]
fn one_stroop_is_below_the_distributable_minimum_and_is_preserved() {
    let env = Env::default();
    let f = fixture(&env, 1);

    f.client.deposit(&f.project_id, &f.funder, &1);

    // Two collaborators need at least two stroops.
    assert_eq!(
        f.client.try_distribute(&f.project_id),
        Err(Ok(SplitError::NoBalance))
    );
    assert_eq!(f.client.get_balance(&f.project_id), 1);
    assert_eq!(f.token_balance(&f.contract_id), 1);
    assert_eq!(
        f.client
            .get_project(&f.project_id)
            .unwrap()
            .distribution_round,
        0
    );
}

#[test]
fn claim_that_rounds_to_zero_returns_zero_and_keeps_the_claim_available() {
    let env = Env::default();
    let f = fixture(&env, 2);

    f.client.deposit(&f.project_id, &f.funder, &1);

    // 1 * 6000 / 10000 rounds down to 0: nothing moves, and the epoch is not
    // consumed, so a repeat call is not reported as AlreadyClaimed.
    assert_eq!(f.client.claim(&f.project_id, &f.alice), 0);
    assert_eq!(f.client.claim(&f.project_id, &f.alice), 0);
    assert_eq!(f.client.get_balance(&f.project_id), 1);
    assert_eq!(f.client.get_claimed(&f.project_id, &f.alice), 0);
    assert_eq!(f.token_balance(&f.alice), 0);

    // A second one-stroop deposit makes alice's share 2 * 6000 / 10000 = 1.
    f.client.deposit(&f.project_id, &f.funder, &1);
    assert_eq!(f.client.claim(&f.project_id, &f.alice), 1);
    assert_eq!(f.client.get_balance(&f.project_id), 1);
    assert_eq!(
        f.client.try_claim(&f.project_id, &f.alice),
        Err(Ok(SplitError::AlreadyClaimed))
    );
}

// -----------------------------------------------------------------------------
// Minimum distributable amount
// -----------------------------------------------------------------------------

#[test]
fn sub_minimum_deposits_accumulate_until_the_collaborator_count_is_reached() {
    let env = Env::default();
    let f = fixture(&env, 2);

    f.client.deposit(&f.project_id, &f.funder, &1);
    assert_eq!(
        f.client.try_distribute(&f.project_id),
        Err(Ok(SplitError::NoBalance))
    );

    // Second stroop reaches the minimum (== collaborator count).
    f.client.deposit(&f.project_id, &f.funder, &1);
    assert_eq!(last_deposit_event(&f), Some((1i128, 2i128)));
    f.client.distribute(&f.project_id);

    // alice: floor(2 * 6000 / 10000) = 1; bob takes the remainder, 1.
    assert_eq!(f.token_balance(&f.alice), 1);
    assert_eq!(f.token_balance(&f.bob), 1);
    assert_eq!(f.client.get_balance(&f.project_id), 0);
    assert_eq!(f.token_balance(&f.contract_id), 0);

    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.total_distributed, 2);
    assert_eq!(project.distribution_round, 1);
}

#[test]
fn minimum_distributable_balance_scales_with_collaborator_count() {
    let env = Env::default();
    env.mock_all_auths();
    let token = env.register_stellar_asset_contract(Address::generate(&env));
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let asset = token::StellarAssetClient::new(&env, &token);
    let balances = token::Client::new(&env, &token);

    // Five collaborators: 9 600 / 100 / 100 / 100 / 100 bps.
    let shares = [9_600u32, 100, 100, 100, 100];
    let mut collaborators: Vec<Collaborator> = Vec::new(&env);
    let mut addresses: Vec<Address> = Vec::new(&env);
    for bps in shares {
        let address = Address::generate(&env);
        addresses.push_back(address.clone());
        collaborators.push_back(Collaborator {
            address,
            alias: String::from_str(&env, "C"),
            basis_points: bps,
        });
    }
    let project_id = Symbol::new(&env, "five_way");
    client.create_project(
        &Address::generate(&env),
        &project_id,
        &String::from_str(&env, "Five Way"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let funder = Address::generate(&env);
    asset.mint(&funder, &5);

    // One below the minimum (4 < 5 collaborators) is rejected.
    client.deposit(&project_id, &funder, &4);
    assert_eq!(
        client.try_distribute(&project_id),
        Err(Ok(SplitError::NoBalance))
    );

    // Exactly the minimum distributes. Low-bps shares round down to zero, so
    // the minimum guarantees conservation, not a non-zero payout to everyone:
    // floor(5 * 9600 / 10000) = 4, the middle three get 0, the last gets the
    // remainder 1.
    client.deposit(&project_id, &funder, &1);
    client.distribute(&project_id);

    let expected = [4i128, 0, 0, 0, 1];
    let mut paid = 0i128;
    for (i, want) in expected.iter().enumerate() {
        let got = balances.balance(&addresses.get(i as u32).unwrap());
        assert_eq!(got, *want, "collaborator {i}");
        assert_eq!(
            client.get_claimed(&project_id, &addresses.get(i as u32).unwrap()),
            *want
        );
        paid += got;
    }
    assert_eq!(paid, 5, "the whole minimum balance is paid out");
    assert_eq!(client.get_balance(&project_id), 0);
    assert_eq!(balances.balance(&contract_id), 0);
}
