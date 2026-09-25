# Contract Interface Diff Examples

Worked examples for reviewing changes to
`contracts/interface/splitnaira.contract-interface.json`. Use them with the
[Contract Interface Release Checklist](./CONTRACT_INTERFACE_RELEASE_CHECKLIST.md).

**Owner:** contracts maintainers (`contracts/`). A contracts reviewer approves
any PR that changes the interface artifact. If the change is breaking, a
backend or frontend reviewer must also approve it.

## How to read an interface diff

`npm run generate:contract-interface` generates the artifact from
`lib.rs`, `events.rs`, `errors.rs` and `Cargo.toml`. Never edit it by hand. A
diff in the artifact must match a diff in one of those source files.

| Section    | What changed on-chain                            | Downstream consumers                                     |
| ---------- | ------------------------------------------------ | -------------------------------------------------------- |
| `methods`  | Public `#[contractimpl]` function signatures     | Backend `stellar.ts`/services, frontend contract callers |
| `events`   | Event topics and payload fields                  | Backend event indexers, analytics, `contract-events.md`  |
| `types`    | `#[contracttype]` structs/enums (incl. `DataKey`) | Generated `contract-types.ts` in backend and frontend    |
| `errors`   | `SplitError` names and numeric codes             | Error mapping in backend and frontend, support runbooks  |
| `sourceHash` | Hash of the source files                       | Changes on every source edit. On its own it is not a surface change |

Quick triage:

1. Is the only change `sourceHash`? Then the surface did not change. The PR
   changed only comments or bodies. Classify it as **non-breaking**.
2. Did anything get **removed, renamed, reordered, or retyped**? Then
   classify it as **breaking**.
3. Did something get **added** without touching existing entries? Then it is
   usually **non-breaking**. The exceptions are listed below.

## Example 1: new read-only method (non-breaking)

```diff
     {
       "name": "is_distributions_paused",
       "args": [],
       "returnType": "bool",
       "mutability": "read"
     },
+    {
+      "name": "get_pause_reason",
+      "args": [],
+      "returnType": "Option<String>",
+      "mutability": "read"
+    },
```

Reviewer checks:

- [ ] No existing method changed.
- [ ] The regenerated `contract-types.ts` files are committed.
- [ ] The changelog entry is labeled non-breaking.

## Example 2: argument added to an existing method (breaking)

```diff
     {
       "name": "claim",
       "args": [
         { "name": "project_id", "type": "Symbol" },
-        { "name": "claimer", "type": "Address" }
+        { "name": "claimer", "type": "Address" },
+        { "name": "min_amount", "type": "i128" }
       ],
       "returnType": "Result<i128, SplitError>",
       "mutability": "write"
     },
```

Every existing caller now fails with an argument count mismatch. Reviewer
checks:

- [ ] The backend and frontend `claim` callers are updated in the same PR, or
      the PR lists a coordinated rollout order.
- [ ] Release notes tell operators to deploy the new contract before shipping
      the frontend that uses it (see the
      [contract release and upgrade runbook](./contract-release-and-upgrade-runbook.md)).
- [ ] The PR is labeled breaking.

## Example 3: return type widened (breaking)

```diff
       "name": "get_claimable",
       ...
-      "returnType": "Result<ClaimableInfo, SplitError>",
+      "returnType": "Result<Option<ClaimableInfo>, SplitError>",
```

The XDR decoding changes, so the old generated types will fail to decode the
result. Treat this like Example 2.

## Example 4: event field appended (non-breaking with caveats)

```diff
       "name": "CollaboratorClaimed",
       ...
       "fields": [
         { "name": "project_id", "type": "Symbol", "doc": "" },
         { "name": "claimer", "type": "Address", "doc": "" },
         { "name": "amount", "type": "i128", "doc": "Claimed amount in stroops; must be > 0." },
-        { "name": "distribution_round", "type": "u32", "doc": "..." }
+        { "name": "distribution_round", "type": "u32", "doc": "..." },
+        { "name": "remaining_balance", "type": "i128", "doc": "Project balance after the claim." }
       ]
```

Indexers that decode events by field name keep working. Indexers that decode
by position or struct shape may break. Reviewer checks:

- [ ] Update [contract-events.md](./contract-events.md) and the event schema
      snapshot tests ([event_schema_snapshot_tests.md](./event_schema_snapshot_tests.md)).
- [ ] Check that the backend event indexer does not use a strict tuple or
      struct decode.
- [ ] If you **remove**, **rename**, or **reorder** a field, or change a
      `topics` entry, classify the change as breaking.

## Example 5: error code changed or renumbered (breaking)

```diff
     {
       "name": "DistributionsPaused",
-      "code": 16,
+      "code": 17,
       "doc": "Distributions have been paused by the administrator."
     },
```

Error codes are on-chain API. The backend and frontend map `Error(Contract, #16)`
to user-facing copy. Renumbering an error silently changes what users see.

- [ ] Reject renumbering. Add a new code instead.
- [ ] A **new** error code (appended with an unused number) is non-breaking,
      but it must be added to the backend and frontend error maps and to
      [contract-error-code-changes.md](./contract-error-code-changes.md).

## Example 6: `DataKey` variant added (storage review required)

```diff
       "DataKey": {
         "kind": "enum",
         "variants": [
           ...
           { "name": "DistributionsPaused", "fields": [], "doc": "Global flag to pause all distributions (emergency stop)" },
-          { "name": "MaxCollaborators", "fields": [], "doc": "..." }
+          { "name": "MaxCollaborators", "fields": [], "doc": "..." },
+          { "name": "PauseReason", "fields": [], "doc": "Optional admin-provided pause reason." }
         ]
       }
```

Appending a variant does not change the keys that already exist. Inserting,
reordering, or removing a variant changes the storage layout.

- [ ] New variants are appended at the end, never inserted in the middle.
- [ ] Review against the
      [storage layout and migrations guide](./contract-storage-layout-and-migrations.md).
- [ ] TTL handling for the new key is considered (see `ttl_renewal_tests.rs`).

## Example 7: `mutability` flip (review behavior)

```diff
       "name": "get_max_collaborators",
       "args": [],
       "returnType": "u32",
-      "mutability": "write"
+      "mutability": "read"
```

The signature did not change. The generator now classifies the method as read
only. Confirm that the Rust body really stopped writing storage (TTL bumps
count as writes). Clients that simulate instead of submitting depend on this
flag. Classify it as non-breaking only if the behavior matches.

## Example 8: `sourceHash` only (no surface change)

```diff
-  "sourceHash": "2c6a911592d28639702220d8fe1744dfdd97983427d6b7cf256a73fe439dc608",
+  "sourceHash": "9f1e0c7a4b...",
```

This is expected after comment, test-module, or function-body edits to
`lib.rs`. For example, registering a new `#[cfg(test)] mod` changes the hash.
No consumer action is needed. The regenerated artifact must still be committed,
because `npm run verify:data-integrity` fails in CI otherwise.

## What to put in the PR description

```markdown
### Contract interface
- Classification: breaking | non-breaking
- Sections changed: methods / events / types / errors / sourceHash only
- Consumer impact: <backend/frontend files updated, or "none">
- Rollout order: <contract first, then backend, then frontend, or "n/a">
- Validation: `cargo test`, `npm run generate:contract-interface`, `npm run generate:contract-types`
```

## Operational impact

- A breaking interface change needs a new contract deployment. After the
  deployment, update `interfaceChecksum` in `deployments.json`. Otherwise
  `scripts/check-contract-interface-drift.mjs` reports drift.
- A change to user-visible error codes or pause behavior also needs an update
  to the support runbooks
  ([stuck-payouts](./runbooks/stuck-payouts.md) and
  [support-escalation-wallet-submissions](./runbooks/support-escalation-wallet-submissions.md)).
