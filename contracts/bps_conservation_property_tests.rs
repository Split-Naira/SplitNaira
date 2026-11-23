#![cfg(test)]
//! Property tests: basis-point conservation and remainder handling (#1644).
//!
//! The existing property suites pin the *payout rule* for small projects
//! (`deposit_property_tests.rs`: 2..=5 members, path independence) and the
//! *split-sum validation* (`split_sum_property_tests.rs`). This suite proves
//! the conservation guarantees documented in
//! `docs/contract-distribution-remainder-accounting.md` that nothing else
//! checks, across the whole supported member range and the whole safe amount
//! range:
//!
//! 1. **Per-share error bound.** For every collaborator except the last,
//!    `paid * 10_000 <= balance * bps < (paid + 1) * 10_000` (exact floor).
//!    The last collaborator's surplus over its own floored share is the
//!    remainder and lies in `0..=n-1`. Payouts sum to exactly the balance.
//! 2. **Generated allocations up to the collaborator cap.** Allocations of
//!    2..=50 members (the default cap) with skewed, equal and 1-bp shares,
//!    deposited amounts spanning `n` stroops up to `i128::MAX / 10_000` (the
//!    largest balance for which `balance * bps` cannot overflow).
//! 3. **Mixed push/pull sequences conserve funds.** Random interleavings of
//!    deposits, `claim` (valid, duplicate, and non-collaborator) and
//!    `distribute` (including sub-threshold balances that are rejected) keep
//!    `deposited == paid out + project balance`, the contract's token balance
//!    equal to the project balance, `Σ get_claimed == total_distributed`, and
//!    zero unallocated drift — after every single step, successful or not.
//! 4. **Remainder bound is tight.** A deterministic case reaches the maximum
//!    remainder of `n - 1` stroops at the collaborator cap.
//! 5. **Minimum balance boundary.** `balance == n` distributes and conserves
//!    (even when small shares round to zero); `balance == n - 1` is rejected
//!    with `NoBalance` and moves nothing.
//!
//! Randomness comes from the same seeded xorshift PRNG used by the other
//! property suites, so runs are deterministic and need no extra crates.
//! Override the base seed with `SPLITNAIRA_PROPTEST_SEED=<u64>`; every
//! assertion message carries the failing case seed for reproduction.

extern crate std;

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Symbol, Vec};

const CASES: u64 = 48;
/// Mixed sequences re-check every invariant after every step, so they run
/// fewer (longer) cases to keep the suite fast in debug builds.
const SEQUENCE_CASES: u64 = 12;
const SEQUENCE_STEPS: u32 = 16;
const TOTAL_BP: u32 = 10_000;
/// Matches `DEFAULT_MAX_COLLABORATORS` in `lib.rs`.
const MAX_MEMBERS: u32 = 50;
/// Largest balance for which `balance * 10_000` (and therefore
/// `balance * bps`) cannot overflow `i128` inside `distribute`.
const MAX_SAFE_BALANCE: i128 = i128::MAX / TOTAL_BP as i128;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic PRNG
// ─────────────────────────────────────────────────────────────────────────────

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // Avoid the all-zero state, which xorshift cannot leave.
        Rng(seed ^ 0xA076_1D64_78BD_642F | 1)
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

    fn next_i128(&mut self) -> i128 {
        (((self.next_u64() as u128) << 64) | self.next_u64() as u128) as i128 & i128::MAX
    }

    /// A distributable amount for `n` members, drawn from one of several
    /// magnitude bands so tiny, typical and near-overflow balances are all hit.
    fn amount(&mut self, n: u32) -> i128 {
        let n = n as i128;
        match self.range(0, 4) {
            // Smallest distributable balances, where shares round to zero.
            0 => n + self.range(0, 2 * n as u64) as i128,
            // Typical token amounts (up to 1,000,000 whole 7-decimal tokens).
            1 => n + self.range(0, 10_000_000_000_000) as i128,
            // Balances just below multiples of 10_000 maximise fractional dust.
            2 => (self.range(1, 1_000_000) as i128) * 10_000 - 1 + n,
            // Huge balances, still in the safe range.
            3 => n + self.next_i128() % (MAX_SAFE_BALANCE - n),
            // The exact upper boundary.
            _ => MAX_SAFE_BALANCE,
        }
    }
}

fn base_seed() -> u64 {
    std::env::var("SPLITNAIRA_PROPTEST_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0xB95_1644)
}

fn for_each_case(property: impl FnMut(u64, &mut Rng)) {
    for_each_case_n(CASES, property);
}

fn for_each_case_n(cases: u64, mut property: impl FnMut(u64, &mut Rng)) {
    let base = base_seed();
    for case in 0..cases {
        let seed = base.wrapping_add(case);
        property(seed, &mut Rng::new(seed));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation generators
// ─────────────────────────────────────────────────────────────────────────────

/// A valid allocation of `n` members (each >= 1 bp, summing to 10_000), drawn
/// from one of three shapes: uniformly random, as-equal-as-possible, or one
/// dominant member with every other member at 1 bp.
fn random_allocation(rng: &mut Rng, n: u32) -> std::vec::Vec<u32> {
    match rng.range(0, 2) {
        0 => {
            let mut remaining = TOTAL_BP;
            let mut shares = std::vec::Vec::new();
            for i in 0..n {
                let left_after = n - i - 1;
                let bp = if left_after == 0 {
                    remaining
                } else {
                    // Bias toward small shares so long tails of members stay valid.
                    let cap = (remaining - left_after).min(2 * TOTAL_BP / n);
                    rng.range(1, cap.max(1) as u64) as u32
                };
                remaining -= bp;
                shares.push(bp);
            }
            shares
        }
        1 => {
            let base = TOTAL_BP / n;
            let mut shares = std::vec![base; n as usize];
            let extra = (TOTAL_BP - base * n) as usize;
            for share in shares.iter_mut().take(extra) {
                *share += 1;
            }
            shares
        }
        _ => {
            let mut shares = std::vec![1u32; n as usize];
            let dominant = rng.range(0, (n - 1) as u64) as usize;
            shares[dominant] = TOTAL_BP - (n - 1);
            shares
        }
    }
}

fn to_collaborators(env: &Env, bps: &[u32]) -> Vec<Collaborator> {
    let mut collaborators = Vec::new(env);
    for bp in bps {
        collaborators.push_back(Collaborator {
            address: Address::generate(env),
            alias: String::from_str(env, "collab"),
            basis_points: *bp,
        });
    }
    collaborators
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario harness
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
        Scenario {
            env,
            client,
            contract_id,
            token,
        }
    }

    fn create(&self, collaborators: &Vec<Collaborator>) -> Symbol {
        let project_id = Symbol::new(self.env, "bps_conservation");
        self.client.create_project(
            &Address::generate(self.env),
            &project_id,
            &String::from_str(self.env, "Conservation Project"),
            &String::from_str(self.env, "music"),
            &self.token,
            collaborators,
        );
        project_id
    }

    fn deposit(&self, project_id: &Symbol, amount: i128) {
        let funder = Address::generate(self.env);
        token::StellarAssetClient::new(self.env, &self.token).mint(&funder, &amount);
        self.client.deposit(project_id, &funder, &amount);
    }

    fn token_balance(&self, who: &Address) -> i128 {
        token::Client::new(self.env, &self.token).balance(who)
    }

    /// Asserts every conservation invariant that must hold between any two
    /// operations, given the total amount deposited so far.
    fn assert_conserved(
        &self,
        project_id: &Symbol,
        collaborators: &Vec<Collaborator>,
        deposited: i128,
        context: &str,
    ) {
        let balance = self.client.get_balance(project_id);
        let project = self.client.get_project(project_id).unwrap();

        let mut paid_out = 0i128;
        let mut claimed = 0i128;
        for c in collaborators.iter() {
            paid_out += self.token_balance(&c.address);
            claimed += self.client.get_claimed(project_id, &c.address);
        }

        assert!(
            balance >= 0,
            "{context}: negative project balance {balance}"
        );
        assert_eq!(
            paid_out + balance,
            deposited,
            "{context}: deposited funds must equal paid out + pending balance"
        );
        assert_eq!(
            claimed, project.total_distributed,
            "{context}: claimed ledger must equal total_distributed"
        );
        assert_eq!(
            paid_out, project.total_distributed,
            "{context}: tokens received must equal total_distributed"
        );
        assert_eq!(
            self.token_balance(&self.contract_id),
            balance,
            "{context}: contract custody must equal the pending project balance"
        );
        assert_eq!(
            self.client.get_unallocated_balance(&self.token),
            0,
            "{context}: rounding must never create unallocated funds"
        );
    }
}

/// Checks the per-share error bound for one `distribute` round over
/// `balance` and returns nothing; panics with `context` on violation.
fn assert_round_bounds(bps: &[u32], payouts: &[i128], balance: i128, context: &str) {
    let n = bps.len();
    let last = n - 1;
    let total: i128 = payouts.iter().sum();
    assert_eq!(
        total, balance,
        "{context}: round must pay out exactly the balance"
    );

    for (i, (bp, paid)) in bps.iter().zip(payouts.iter()).enumerate() {
        let exact = balance * *bp as i128; // share scaled by 10_000; safe by MAX_SAFE_BALANCE
        let floor = exact / TOTAL_BP as i128;
        assert!(*paid >= 0, "{context}: member {i} paid a negative amount");
        if i == last {
            let surplus = *paid - floor;
            assert!(
                (0..n as i128).contains(&surplus),
                "{context}: remainder {surplus} to last member outside 0..={}",
                n - 1
            );
        } else {
            assert_eq!(
                *paid, floor,
                "{context}: member {i} must receive its exact floor"
            );
            assert!(
                *paid * TOTAL_BP as i128 <= exact && exact < (*paid + 1) * TOTAL_BP as i128,
                "{context}: member {i} payout outside the one-stroop error bound"
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────────────

/// Across 2..=50 members and the full safe amount range, every non-last member
/// receives exactly its floor, the last member's remainder is within `0..n`,
/// and the round conserves the balance exactly.
#[test]
fn prop_distribution_conserves_and_bounds_remainder_up_to_member_cap() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);

        let n = rng.range(2, MAX_MEMBERS as u64) as u32;
        let bps = random_allocation(rng, n);
        assert_eq!(bps.iter().sum::<u32>(), TOTAL_BP, "seed={seed}: generator");
        let collaborators = to_collaborators(&env, &bps);
        let project_id = s.create(&collaborators);

        let amount = rng.amount(n);
        assert!(
            amount >= n as i128 && amount <= MAX_SAFE_BALANCE,
            "seed={seed}: generator"
        );
        s.deposit(&project_id, amount);
        s.client.distribute(&project_id);

        let payouts: std::vec::Vec<i128> = collaborators
            .iter()
            .map(|c| s.token_balance(&c.address))
            .collect();
        let context = std::format!("seed={seed} n={n} amount={amount}");
        assert_round_bounds(&bps, &payouts, amount, &context);
        s.assert_conserved(&project_id, &collaborators, amount, &context);

        let project = s.client.get_project(&project_id).unwrap();
        assert_eq!(project.distribution_round, 1, "{context}");
        assert_eq!(s.client.get_balance(&project_id), 0, "{context}");
    });
}

/// Random interleavings of deposits, claims (valid, duplicate and from
/// outsiders) and distributions (including rejected sub-threshold ones)
/// conserve funds after every step, and each successful distribution round
/// respects the per-share error bound over the balance it settled.
#[test]
fn prop_mixed_claim_and_distribute_sequences_conserve_funds() {
    for_each_case_n(SEQUENCE_CASES, |seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);

        let n = rng.range(2, 8) as u32;
        let bps = random_allocation(rng, n);
        let collaborators = to_collaborators(&env, &bps);
        let project_id = s.create(&collaborators);
        let outsider = Address::generate(&env);

        let mut deposited = 0i128;
        let mut rounds = 0u32;
        for step in 0..SEQUENCE_STEPS {
            let context = std::format!("seed={seed} n={n} step={step}");
            match rng.range(0, 3) {
                0 => {
                    // Mix of dust deposits (below the member count) and normal ones.
                    let amount = if rng.range(0, 3) == 0 {
                        rng.range(1, n as u64) as i128
                    } else {
                        rng.range(1, 50_000_000_000) as i128
                    };
                    s.deposit(&project_id, amount);
                    deposited += amount;
                }
                1 => {
                    let idx = rng.range(0, n as u64) as u32;
                    if idx == n {
                        assert_eq!(
                            s.client.try_claim(&project_id, &outsider),
                            Err(Ok(SplitError::NotACollaborator)),
                            "{context}"
                        );
                    } else {
                        let c = collaborators.get(idx).unwrap();
                        let balance = s.client.get_balance(&project_id);
                        let before = s.token_balance(&c.address);
                        match s.client.try_claim(&project_id, &c.address) {
                            Ok(Ok(amount)) => {
                                // Pull payouts take the floor of the current
                                // pool and never assign the remainder.
                                let expected = balance * c.basis_points as i128 / 10_000;
                                assert_eq!(amount, expected.max(0), "{context}");
                                assert_eq!(
                                    s.token_balance(&c.address) - before,
                                    amount,
                                    "{context}"
                                );
                            }
                            Err(Ok(SplitError::AlreadyClaimed)) => {
                                assert_eq!(s.token_balance(&c.address), before, "{context}");
                                assert_eq!(s.client.get_balance(&project_id), balance, "{context}");
                            }
                            other => panic!("{context}: unexpected claim result {other:?}"),
                        }
                    }
                }
                _ => {
                    let balance = s.client.get_balance(&project_id);
                    let before: std::vec::Vec<i128> = collaborators
                        .iter()
                        .map(|c| s.token_balance(&c.address))
                        .collect();
                    let result = s.client.try_distribute(&project_id);
                    if balance < n as i128 {
                        assert_eq!(result, Err(Ok(SplitError::NoBalance)), "{context}");
                        assert_eq!(s.client.get_balance(&project_id), balance, "{context}");
                    } else {
                        assert_eq!(result, Ok(Ok(())), "{context}");
                        rounds += 1;
                        let payouts: std::vec::Vec<i128> = collaborators
                            .iter()
                            .zip(before.iter())
                            .map(|(c, b)| s.token_balance(&c.address) - b)
                            .collect();
                        assert_round_bounds(&bps, &payouts, balance, &context);
                        assert_eq!(s.client.get_balance(&project_id), 0, "{context}");
                    }
                }
            }
            s.assert_conserved(&project_id, &collaborators, deposited, &context);
            assert_eq!(
                s.client
                    .get_project(&project_id)
                    .unwrap()
                    .distribution_round,
                rounds,
                "{context}: only successful distributions advance the round"
            );
        }
    });
}

/// `balance == n` always distributes and conserves, even when small shares
/// round to zero; `balance == n - 1` is rejected and moves nothing.
#[test]
fn prop_minimum_balance_boundary_conserves_or_rejects() {
    for_each_case(|seed, rng| {
        let env = Env::default();
        let s = Scenario::new(&env);

        let n = rng.range(2, MAX_MEMBERS as u64) as u32;
        let bps = random_allocation(rng, n);
        let collaborators = to_collaborators(&env, &bps);
        let project_id = s.create(&collaborators);
        let context = std::format!("seed={seed} n={n}");

        // One stroop short of the guard: rejected, state untouched.
        s.deposit(&project_id, n as i128 - 1);
        assert_eq!(
            s.client.try_distribute(&project_id),
            Err(Ok(SplitError::NoBalance)),
            "{context}"
        );
        s.assert_conserved(&project_id, &collaborators, n as i128 - 1, &context);
        assert_eq!(
            s.client
                .get_project(&project_id)
                .unwrap()
                .distribution_round,
            0,
            "{context}"
        );

        // Topping up by one stroop reaches the guard exactly.
        s.deposit(&project_id, 1);
        s.client.distribute(&project_id);
        let payouts: std::vec::Vec<i128> = collaborators
            .iter()
            .map(|c| s.token_balance(&c.address))
            .collect();
        assert_round_bounds(&bps, &payouts, n as i128, &context);
        s.assert_conserved(&project_id, &collaborators, n as i128, &context);

        // Zero-amount shares leave the claimed ledger untouched.
        for (c, paid) in collaborators.iter().zip(payouts.iter()) {
            assert_eq!(
                s.client.get_claimed(&project_id, &c.address),
                *paid,
                "{context}"
            );
        }
    });
}

/// The remainder bound is tight: 50 equal shares of 200 bps over a balance of
/// `50k + 49` leave a fractional 49/50 stroop on every share, so the last
/// member receives exactly `n - 1 = 49` stroops above its own floor.
#[test]
fn test_remainder_reaches_maximum_at_member_cap() {
    let env = Env::default();
    let s = Scenario::new(&env);

    let n = MAX_MEMBERS;
    let bps = std::vec![TOTAL_BP / n; n as usize];
    let collaborators = to_collaborators(&env, &bps);
    let project_id = s.create(&collaborators);

    let k = 1_000_003i128;
    let balance = 50 * k + 49;
    s.deposit(&project_id, balance);
    s.client.distribute(&project_id);

    let last = collaborators.len() - 1;
    for (i, c) in collaborators.iter().enumerate() {
        let expected = if i as u32 == last { k + 49 } else { k };
        assert_eq!(s.token_balance(&c.address), expected, "member {i}");
    }
    s.assert_conserved(&project_id, &collaborators, balance, "tight remainder");
}

/// The largest safe balance distributes without overflow and conserves to the
/// stroop, including with the most skewed allowed allocation.
#[test]
fn test_max_safe_balance_conserves_with_skewed_allocation() {
    let env = Env::default();
    let s = Scenario::new(&env);

    let n = MAX_MEMBERS;
    let mut bps = std::vec![1u32; n as usize];
    bps[0] = TOTAL_BP - (n - 1);
    let collaborators = to_collaborators(&env, &bps);
    let project_id = s.create(&collaborators);

    s.deposit(&project_id, MAX_SAFE_BALANCE);
    s.client.distribute(&project_id);

    let payouts: std::vec::Vec<i128> = collaborators
        .iter()
        .map(|c| s.token_balance(&c.address))
        .collect();
    assert_round_bounds(&bps, &payouts, MAX_SAFE_BALANCE, "max safe balance");
    s.assert_conserved(
        &project_id,
        &collaborators,
        MAX_SAFE_BALANCE,
        "max safe balance",
    );
}
