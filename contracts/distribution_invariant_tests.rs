#![cfg(test)]

//! Distribution invariant tests (issues #1251, #1252).
//!
//! Covers financial invariants of `distribute` across arbitrary valid
//! inputs:
//!
//! - total allocation invariants (payouts always sum to the pre-distribution
//!   project balance; the balance is fully drained);
//! - rounding behavior (integer division truncates toward zero, and the
//!   final collaborator absorbs the remainder so no dust is stranded);
//! - minimum participant count (exactly two collaborators, the smallest
//!   valid project);
//! - maximum participant count (the admin-configured upper bound).
//!
//! Unlike `deposit_property_tests.rs`, which drives repeated deposits through
//! a seeded PRNG, these tests pin exact expected payout amounts for a small
//! set of hand-picked splits so a regression in the rounding rule fails with
//! a concrete, human-readable diff.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Symbol, Vec};

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

/// Builds a collaborator list from a slice of basis-point shares.
fn collabs_from_bp(env: &Env, bps: &[u32]) -> Vec<Collaborator> {
    let mut list = Vec::new(env);
    for (i, bp) in bps.iter().enumerate() {
        let alias = format!("Collab{}", i);
        list.push_back(Collaborator {
            address: Address::generate(env),
            alias: String::from_str(env, &alias),
            basis_points: *bp,
        });
    }
    list
}

/// Mints `amount` to `from` and deposits it into the project.
fn fund(
    env: &Env,
    client: &SplitNairaContractClient,
    token: &Address,
    project_id: &Symbol,
    from: &Address,
    amount: i128,
) {
    let token_client = token::StellarAssetClient::new(env, token);
    token_client.mint(from, &amount);
    client.deposit(project_id, from, &amount);
}

// -----------------------------------------------------------------------------
// 1. Rounding behavior
// -----------------------------------------------------------------------------

/// A three-way uneven split must pay each non-final collaborator
/// `floor(balance * bps / 10_000)` and hand the full integer-division
/// remainder to the final collaborator.
///
/// With `balance = 1_000_001` and a `3333 / 3333 / 3334` split:
/// - Alice: `floor(1_000_001 * 3333 / 10_000) = 333_333`
/// - Bob:   `floor(1_000_001 * 3333 / 10_000) = 333_333`
/// - Carol: `1_000_001 - 333_333 - 333_333     = 333_335` (remainder)
#[test]
fn distribute_uneven_three_way_split_pays_remainder_to_last_collaborator() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let collaborators = collabs_from_bp(&env, &[3333, 3333, 3334]);
    let alice = collaborators.get(0).unwrap().address.clone();
    let bob = collaborators.get(1).unwrap().address.clone();
    let carol = collaborators.get(2).unwrap().address.clone();

    let project_id = Symbol::new(&env, "rounding_split");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Rounding Split"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let balance = 1_000_001i128;
    fund(&env, &client, &token, &project_id, &owner, balance);

    client.distribute(&project_id);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&alice), 333_333);
    assert_eq!(token_client.balance(&bob), 333_333);
    assert_eq!(token_client.balance(&carol), 333_335);

    // The full balance was paid out; nothing is stranded as dust.
    assert_eq!(client.get_balance(&project_id), 0);

    let project = client.get_project(&project_id).unwrap();
    assert_eq!(project.total_distributed, balance);
    assert_eq!(project.distribution_round, 1);
}

/// A two-way split of an odd amount must round the first collaborator down
/// and pay the odd stroop to the final collaborator.
#[test]
fn distribute_odd_amount_two_way_split_leaves_no_dust() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let collaborators = collabs_from_bp(&env, &[5000, 5000]);
    let alice = collaborators.get(0).unwrap().address.clone();
    let bob = collaborators.get(1).unwrap().address.clone();

    let project_id = Symbol::new(&env, "odd_two_way");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Odd Two Way"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let balance = 999i128;
    fund(&env, &client, &token, &project_id, &owner, balance);

    client.distribute(&project_id);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&alice), 499);
    assert_eq!(token_client.balance(&bob), 500);

    assert_eq!(client.get_balance(&project_id), 0);
}

// -----------------------------------------------------------------------------
// 2. Total allocation invariants
// -----------------------------------------------------------------------------

/// For an arbitrary uneven split, the sum of all payouts must equal the
/// pre-distribution balance exactly, and every collaborator's `claimed`
/// ledger must equal their payout.
#[test]
fn distribute_payouts_sum_exactly_to_pre_distribution_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let bps = [1000u32, 2000, 3000, 4000];
    let collaborators = collabs_from_bp(&env, &bps);
    let addresses: Vec<Address> = {
        let mut v = Vec::new(&env);
        for c in collaborators.iter() {
            v.push_back(c.address.clone());
        }
        v
    };

    let project_id = Symbol::new(&env, "sum_invariant");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Sum Invariant"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let balance = 999_983i128;
    fund(&env, &client, &token, &project_id, &owner, balance);

    client.distribute(&project_id);

    let token_client = token::Client::new(&env, &token);
    let mut total_paid = 0i128;
    for addr in addresses.iter() {
        let paid = token_client.balance(&addr);
        let claimed = client.get_claimed(&project_id, &addr);
        assert_eq!(paid, claimed, "claimed ledger must equal payout");
        total_paid += paid;
    }

    assert_eq!(total_paid, balance, "payouts must sum to the balance");
    assert_eq!(client.get_balance(&project_id), 0);
}

// -----------------------------------------------------------------------------
// 3. Minimum participant count
// -----------------------------------------------------------------------------

/// Exactly two collaborators is the smallest valid project. Distribution
/// must succeed and preserve the allocation invariant.
#[test]
fn distribute_with_minimum_two_collaborators_preserves_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let collaborators = collabs_from_bp(&env, &[9999, 1]);
    let high = collaborators.get(0).unwrap().address.clone();
    let low = collaborators.get(1).unwrap().address.clone();

    let project_id = Symbol::new(&env, "min_two");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Min Two"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let balance = 100_000i128;
    fund(&env, &client, &token, &project_id, &owner, balance);

    client.distribute(&project_id);

    let token_client = token::Client::new(&env, &token);
    let paid_high = token_client.balance(&high);
    let paid_low = token_client.balance(&low);

    // `floor(100_000 * 9999 / 10_000) = 99_990`; final collaborator
    // absorbs the remainder: `100_000 - 99_990 = 10`.
    assert_eq!(paid_high, 99_990);
    assert_eq!(paid_low, 10);
    assert_eq!(paid_high + paid_low, balance);
    assert_eq!(client.get_balance(&project_id), 0);
}

// -----------------------------------------------------------------------------
// 4. Maximum participant count
// -----------------------------------------------------------------------------

/// A project configured at the admin-set maximum collaborator cap must
/// distribute correctly and preserve the allocation invariant.
#[test]
fn distribute_with_maximum_participant_count_preserves_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let admin = Address::generate(&env);
    client.set_admin(&admin);

    // Raise the cap to a manageable test size (the hard ceiling is 200).
    let max_collaborators = 20u32;
    client.set_max_collaborators(&admin, &max_collaborators);

    let owner = Address::generate(&env);

    // Split 10_000 basis points evenly across `max_collaborators`
    // collaborators. 10_000 / 20 = 500 bps each, so no rounding occurs and
    // the invariant is straightforward to verify.
    let bps = [500u32; 20];
    let collaborators = collabs_from_bp(&env, &bps);

    let project_id = Symbol::new(&env, "max_participants");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Max Participants"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    let balance = 1_000_000i128;
    fund(&env, &client, &token, &project_id, &owner, balance);

    client.distribute(&project_id);

    let token_client = token::Client::new(&env, &token);
    let mut total_paid = 0i128;
    for c in collaborators.iter() {
        let paid = token_client.balance(&c.address);
        assert_eq!(paid, balance / i128::from(max_collaborators));
        total_paid += paid;
    }

    assert_eq!(total_paid, balance);
    assert_eq!(client.get_balance(&project_id), 0);
}

/// Creating a project with more collaborators than the configured cap must
/// be rejected with `TooManyCollaborators` and must not create the project.
#[test]
fn create_project_above_configured_cap_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_max_collaborators(&admin, &5u32);

    let owner = Address::generate(&env);
    // 6 collaborators exceeds the cap of 5.
    let collaborators = collabs_from_bp(&env, &[1667, 1667, 1666, 1667, 1666, 1667]);

    let project_id = Symbol::new(&env, "over_cap");
    let result = client.try_create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Over Cap"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    assert_eq!(result, Err(Ok(SplitError::TooManyCollaborators)));
    assert!(!client.project_exists(&project_id));
}

// -----------------------------------------------------------------------------
// Repeated distribution with unchanged balance (#1658)
// -----------------------------------------------------------------------------

/// A second `distribute` call immediately after a successful first call must
/// return `NoBalance` — it must not pay the same available balance twice (#1658).
#[test]
fn repeated_distribute_on_zero_balance_returns_no_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let collaborators = collabs_from_bp(&env, &[5000, 5000]);
    let project_id = Symbol::new(&env, "repeat_dist");

    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Repeat Dist"),
        &String::from_str(&env, "music"),
        &token,
        &collaborators,
    );

    fund(&env, &client, &token, &project_id, &owner, 1000);

    // First distribution must succeed and drain the balance to zero.
    client.distribute(&project_id);
    assert_eq!(client.get_balance(&project_id), 0);

    // Second call with no new deposits must fail — the balance is now 0.
    let result = client.try_distribute(&project_id);
    assert_eq!(
        result,
        Err(Ok(SplitError::NoBalance)),
        "repeated distribute on zero balance should return NoBalance"
    );
}

/// Distributing, then receiving a new deposit, then distributing again is
/// valid — only the new funds are paid out the second time (#1658).
#[test]
fn distribute_after_new_deposit_pays_only_new_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(&env);
    let collabs = collabs_from_bp(&env, &[5000, 5000]);
    let project_id = Symbol::new(&env, "two_rounds");

    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Two Rounds"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    // Round 1: deposit 1000, distribute.
    fund(&env, &client, &token, &project_id, &owner, 1000);
    client.distribute(&project_id);
    assert_eq!(client.get_balance(&project_id), 0);

    // Immediately after round 1 a second call must fail.
    let result = client.try_distribute(&project_id);
    assert_eq!(result, Err(Ok(SplitError::NoBalance)));

    // Round 2: new deposit of 500.
    fund(&env, &client, &token, &project_id, &owner, 500);
    // Second distribution must succeed on the new 500 only.
    client.distribute(&project_id);
    assert_eq!(client.get_balance(&project_id), 0);

    // After round 2 the balance is again 0.
    let result = client.try_distribute(&project_id);
    assert_eq!(result, Err(Ok(SplitError::NoBalance)));
}
