#![cfg(test)]
//! Property tests: repeated deposits before distribution.
//!
//! Each property is checked against many randomly generated scenarios
//! (collaborator count, basis-point splits, deposit counts and amounts).
//! Randomness comes from a small seeded xorshift PRNG so runs are
//! deterministic and need no extra crates. Override the base seed with
//! `SPLITNAIRA_PROPTEST_SEED=<u64>` to explore new cases; every assertion
//! message includes the failing case seed for reproduction.
//!
//! Invariants covered:
//! 1. Repeated deposits accumulate exactly into the project balance, the
//!    contract token balance, and accounted balance (no unallocated drift),
//!    without touching round / total_distributed / claimed ledgers.
//! 2. Distribution after N deposits is path-independent: payouts equal those
//!    of a single deposit of the same total, with remainder to the last
//!    collaborator and the balance fully drained.
//! 3. Interleaved deposits into two projects on the same token never leak
//!    between projects.
//! 4. Sub-threshold deposits (balance < collaborator count) are rejected by
//!    distribute but keep accumulating until distribution becomes possible.

extern crate std;

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Symbol, Vec};

const CASES: u64 = 48;
const MAX_DEPOSIT: i128 = 1_000_0000000; // 1,000 whole tokens in stroops

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic PRNG
// ─────────────────────────────────────────────────────────────────────────────

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // Avoid the all-zero state, which xorshift cannot leave.
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15 | 1)
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Uniform-ish value in `lo..=hi`.
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo + 1)
    }

    fn amount(&mut self) -> i128 {
        self.range(1, MAX_DEPOSIT as u64) as i128
    }
}

fn base_seed() -> u64 {
    std::env::var("SPLITNAIRA_PROPTEST_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0x5EED_1234)
}

fn for_each_case(mut property: impl FnMut(u64, &mut Rng)) {
    let base = base_seed();
    for case in 0..CASES {
        let seed = base.wrapping_add(case);
        property(seed, &mut Rng::new(seed));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario helpers
// ─────────────────────────────────────────────────────────────────────────────

struct Scenario<'a> {
    env: &'a Env,
    client: SplitNairaContractClient<'a>,
    contract_id: Address,
    token: Address,
}

impl<'a> Scenario<'a> {
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        env.budget().reset_unlimited();
        let token_admin = Address::generate(env);
        let token = env.register_stellar_asset_contract(token_admin);
        let contract_id = env.register_contract(None, SplitNairaContract);
        let client = SplitNairaContractClient::new(env, &contract_id);
        Scenario { env, client, contract_id, token }
    }

    fn create(&self, id: &str, collabs: &Vec<Collaborator>) -> Symbol {
        let project_id = Symbol::new(self.env, id);
        self.client.create_project(
            &Address::generate(self.env),
            &project_id,
            &String::from_str(self.env, "Property Project"),
            &String::from_str(self.env, "music"),
            &self.token,
            collabs,
        );
        project_id
    }

    fn deposit(&self, project_id: &Symbol, from: &Address, amount: i128) {
        token::StellarAssetClient::new(self.env, &self.token).mint(from, &amount);
        self.client.deposit(project_id, from, &amount);
    }

    fn token_balance(&self, who: &Address) -> i128 {
        token::Client::new(self.env, &self.token).balance(who)
    }
}

/// Random collaborator set: 2..=5 members, every share >= 1 bps, summing to 10_000.
fn random_collaborators(env: &Env, rng: &mut Rng) -> Vec<Collaborator> {
    let n = rng.range(2, 5) as u32;
    let mut remaining = 10_000u32;
    let mut collabs = Vec::new(env);
    for i in 0..n {
        let left_after = n - i - 1;
        let bps = if left_after == 0 {
            remaining
        } else {
            rng.range(1, (remaining - left_after) as u64) as u32
        };
        remaining -= bps;
        collabs.push_back(Collaborator {
            address: Address::generate(env),
            alias: String::from_str(env, "collab"),
            basis_points: bps,
        });
    }
    collabs
}

/// Mirrors the contract's documented payout rule: floor share per
/// collaborator, remainder to the last one.
fn expected_payouts(total: i128, collabs: &Vec<Collaborator>) -> std::vec::Vec<i128> {
    let last = collabs.len() as usize - 1;
    let mut sent = 0i128;
    let mut out = std::vec::Vec::new();
    for (i, c) in collabs.iter().enumerate() {
        let amount = if i == last {
            total - sent
        } else {
            total * c.basis_points as i128 / 10_000
        };
        sent += amount;
        out.push(amount);
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn prop_repeated_deposits_accumulate_exactly() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);
        let collabs = random_collaborators(&env, rng);
        let project_id = s.create("prop_accumulate", &collabs);

        let funders: std::vec::Vec<Address> =
            (0..rng.range(1, 3)).map(|_| Address::generate(&env)).collect();
        let deposits = rng.range(1, 12);
        let mut expected = 0i128;

        for _ in 0..deposits {
            let from = &funders[rng.range(0, funders.len() as u64 - 1) as usize];
            let amount = rng.amount();
            s.deposit(&project_id, from, amount);
            expected += amount;

            assert_eq!(s.client.get_balance(&project_id), expected, "seed={seed}");
            assert_eq!(s.token_balance(&s.contract_id), expected, "seed={seed}");
            assert_eq!(
                s.client.get_unallocated_balance(&s.token),
                0,
                "deposits must be fully accounted, seed={seed}"
            );
        }

        let project = s.client.get_project(&project_id).unwrap();
        assert_eq!(project.distribution_round, 0, "seed={seed}");
        assert_eq!(project.total_distributed, 0, "seed={seed}");
        for c in collabs.iter() {
            assert_eq!(s.client.get_claimed(&project_id, &c.address), 0, "seed={seed}");
            assert_eq!(s.token_balance(&c.address), 0, "seed={seed}");
        }
    });
}

#[test]
fn prop_distribution_after_repeated_deposits_is_path_independent() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);
        let collabs = random_collaborators(&env, rng);
        // Twin project with identical shares but fresh recipient addresses.
        let mut twin = Vec::new(&env);
        for c in collabs.iter() {
            twin.push_back(Collaborator { address: Address::generate(&env), ..c });
        }
        let many = s.create("prop_many", &collabs);
        let single = s.create("prop_single", &twin);
        let funder = Address::generate(&env);

        let mut total = 0i128;
        for _ in 0..rng.range(2, 12) {
            let amount = rng.amount();
            s.deposit(&many, &funder, amount);
            total += amount;
        }
        s.deposit(&single, &funder, total);

        s.client.distribute(&many);
        s.client.distribute(&single);

        let expected = expected_payouts(total, &collabs);
        for (i, (a, b)) in collabs.iter().zip(twin.iter()).enumerate() {
            let paid_many = s.token_balance(&a.address);
            assert_eq!(paid_many, expected[i], "collab {i}, seed={seed}");
            assert_eq!(paid_many, s.token_balance(&b.address), "collab {i}, seed={seed}");
            assert_eq!(s.client.get_claimed(&many, &a.address), paid_many, "seed={seed}");
        }

        for id in [&many, &single] {
            let project = s.client.get_project(id).unwrap();
            assert_eq!(s.client.get_balance(id), 0, "seed={seed}");
            assert_eq!(project.distribution_round, 1, "seed={seed}");
            assert_eq!(project.total_distributed, total, "seed={seed}");
        }
        assert_eq!(s.token_balance(&s.contract_id), 0, "seed={seed}");
        assert_eq!(s.client.get_unallocated_balance(&s.token), 0, "seed={seed}");
    });
}

#[test]
fn prop_interleaved_deposits_do_not_leak_between_projects() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);
        let a = s.create("prop_a", &random_collaborators(&env, rng));
        let b = s.create("prop_b", &random_collaborators(&env, rng));
        let funder = Address::generate(&env);

        let (mut total_a, mut total_b) = (0i128, 0i128);
        for _ in 0..rng.range(2, 16) {
            let amount = rng.amount();
            if rng.next_u64() % 2 == 0 {
                s.deposit(&a, &funder, amount);
                total_a += amount;
            } else {
                s.deposit(&b, &funder, amount);
                total_b += amount;
            }
        }

        assert_eq!(s.client.get_balance(&a), total_a, "seed={seed}");
        assert_eq!(s.client.get_balance(&b), total_b, "seed={seed}");
        assert_eq!(s.token_balance(&s.contract_id), total_a + total_b, "seed={seed}");

        // Distributing one project must leave the other's balance untouched.
        if total_a > 0 {
            s.client.distribute(&a);
            assert_eq!(s.client.get_balance(&a), 0, "seed={seed}");
        }
        assert_eq!(s.client.get_balance(&b), total_b, "seed={seed}");
        assert_eq!(s.token_balance(&s.contract_id), total_b, "seed={seed}");
        assert_eq!(s.client.get_unallocated_balance(&s.token), 0, "seed={seed}");
    });
}

#[test]
fn prop_sub_threshold_deposits_accumulate_until_distributable() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);
        let collabs = random_collaborators(&env, rng);
        let n = collabs.len() as i128;
        let project_id = s.create("prop_dust", &collabs);
        let funder = Address::generate(&env);

        // Deposit 1 stroop at a time; distribute must refuse until balance >= n.
        let mut balance = 0i128;
        while balance < n {
            assert_eq!(
                s.client.try_distribute(&project_id),
                Err(Ok(SplitError::NoBalance)),
                "balance={balance}, collaborators={n}, seed={seed}"
            );
            s.deposit(&project_id, &funder, 1);
            balance += 1;
            assert_eq!(s.client.get_balance(&project_id), balance, "seed={seed}");
        }

        s.client.distribute(&project_id);
        let project = s.client.get_project(&project_id).unwrap();
        assert_eq!(project.distribution_round, 1, "seed={seed}");
        assert_eq!(project.total_distributed, balance, "seed={seed}");
        assert_eq!(s.client.get_balance(&project_id), 0, "seed={seed}");
    });
}
