# Authorization Coverage Tests (issue #1483)

`contracts/authorization_coverage_tests.rs` inventories every public contract
entry point and proves that unauthorized callers fail for each protected
operation. Run it with:

```bash
cargo test --manifest-path contracts/Cargo.toml --features testutils \
    authorization_coverage
```

## Entry-point inventory (34 public functions)

| Class          | Count | Entry points                                                                                                                                                                                                                                                                                                                                                  | Gate                                                                                                               |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Admin-gated    | 7     | `set_max_collaborators`, `allow_token`, `disallow_token`, `pause_distributions`, `unpause_distributions`, `withdraw_unallocated`, `migrate_flat_to_buckets`                                                                                                                                                                                                   | `require_contract_admin`: stored-admin identity check (rejects impostors with `Unauthorized`), then `require_auth` |
| Owner-gated    | 4     | `update_collaborators`, `lock_project`, `update_project_metadata`, `transfer_project_ownership`                                                                                                                                                                                                                                                               | project-owner identity check (rejects impostors with `Unauthorized`), then `require_auth`                          |
| Signer-gated   | 4     | `set_admin`, `create_project`, `deposit`, `claim`                                                                                                                                                                                                                                                                                                             | `Address::require_auth` only — no contract-level identity check                                                    |
| Permissionless | 2     | `distribute`, `batch_distribute`                                                                                                                                                                                                                                                                                                                              | none by design (the math is trustless; see `authorization_tests::test_distribute_is_permissionless`)               |
| Read-only      | 17    | `get_max_collaborators`, `get_project`, `project_exists`, `get_claimed`, `refresh_project_storage`, `get_project_count`, `list_projects`, `list_project_summaries`, `get_balance`, `get_unallocated_balance`, `is_token_allowed`, `is_distributions_paused`, `get_allowed_token_count`, `get_allowed_tokens`, `get_admin`, `get_project_ids`, `get_claimable` | none — must execute with no authorization at all                                                                   |

## How "unauthorized callers fail" is asserted

- **Identity-gated operations (11).** The suite drives an impostor address
  through each call and asserts the exact contract error (`Unauthorized`, or
  `AdminNotSet` before an admin is configured), then verifies no state
  changed (pause flag, allowlist, admin, project owner/shares/metadata).
- **Signer-gated operations (4).** `require_auth` is the entire gate; a
  withheld or mismatched authorization is a _host trap_. In this `no_std`
  test build a host trap is a non-unwinding panic (SIGABRT) that kills the
  whole test binary — verified empirically — so the negative direction cannot
  be caught in-process with `try_` calls. Instead the suite asserts the
  positive requirement recorded by the recording auth environment
  (`env.auths()`): each entry point demands an authorization entry for
  exactly the documented signer, and `set_admin` rotation demands the
  _stored_ administrator rather than the address being nominated.
- **Read-only operations (17).** Proven to execute on a fully
  auth-enforcing environment (no `mock_all_auths` at all): if any read path
  secretly called `require_auth`, the test process would abort.

## Related suites

- `authorization_tests.rs` — deep owner/admin boundary tests and the
  permissionless-distribution guarantee (issue #865).
- `admin_token_authorization_tests.rs` — caller matrix for the admin token
  operations (`allow_token`, `disallow_token`, `withdraw_unallocated`), issue
  #1648. See below.
- `failure_invariant_tests.rs` — rejected operations leave storage and
  balances untouched (issue #1486).

## Admin token operations: caller matrix (issue #1648)

`contracts/admin_token_authorization_tests.rs` runs every admin token
operation as each persona against a funded project that also holds stray
(unallocated) tokens. Run it with:

```bash
cargo test --manifest-path contracts/Cargo.toml admin_token_authorization
```

| Caller                        | `allow_token`  | `disallow_token` | `withdraw_unallocated` |
| ----------------------------- | -------------- | ---------------- | ---------------------- |
| Any caller, admin not set     | `AdminNotSet`  | `AdminNotSet`    | `AdminNotSet`          |
| Project owner                 | `Unauthorized` | `Unauthorized`   | `Unauthorized`         |
| Project collaborator          | `Unauthorized` | `Unauthorized`   | `Unauthorized`         |
| Unrelated address             | `Unauthorized` | `Unauthorized`   | `Unauthorized`         |
| Previous admin after rotation | `Unauthorized` | `Unauthorized`   | `Unauthorized`         |
| Current admin                 | ok             | ok               | ok, up to unallocated  |

Boundary cases the suite also pins:

- The identity check runs before argument validation. A non-admin sending a
  zero, negative, contract-recipient or overdraw withdrawal still gets
  `Unauthorized`, and every rejection leaves the allowlist, token balances
  and accounted project funds unchanged.
- Each admin call demands the stored admin's signature. The withdrawal
  recipient is not asked to sign.
- `allow_token` is idempotent (no double count). `disallow_token` on a token
  that is not listed is a no-op, and the count never underflows.
- `withdraw_unallocated` accepts one stroop and the exact unallocated amount,
  and rejects one stroop more with `InsufficientUnallocated`. Project funds
  stay fully distributable afterwards, including after the token is delisted.

## Backend resource routes: persona matrix

`backend/src/routes/collaboration.authz-matrix.test.ts` sends a request from
every persona to every collaboration resource route, through the real router
and middleware chain. Contributors adding a route under `/collaboration` must
add a row here and a matching `ROUTES` entry in that file.

Run it with:

```bash
cd backend && npx vitest run src/routes/collaboration.authz-matrix.test.ts
```

Personas:

- **anonymous:** no `X-Stellar-Address` header.
- **malformed:** a header value that isn't a Stellar address.
- **owner:** the project owner, as recorded in the project's stored collaboration record.
- **admin / editor / viewer:** collaborators with those roles.
- **unrelated:** a valid address with no role on the project.

Roles always come from the stored record, never from the request body.

| Route                                                        | anonymous | malformed | owner   | admin   | editor | viewer | unrelated |
| ------------------------------------------------------------ | --------- | --------- | ------- | ------- | ------ | ------ | --------- |
| `POST /collaboration/projects/:projectId/delete`             | 401       | 400       | **200** | 403     | 403    | 403    | 403       |
| `POST /collaboration/projects/:projectId/invitations`        | 401       | 400       | **201** | **201** | 403    | 403    | 403       |
| `POST /collaboration/invitations/:invitationId/cancel`¹      | 401       | 400       | **200** | **200** | 403    | 403    | 403       |
| `POST /collaboration/projects/:projectId/transfer-ownership` | 401       | 400       | **200** | 403     | 403    | 403    | 403       |
| `GET /collaboration/permissions/matrix` (public)             | 200       | 200       | 200     | 200     | 200    | 200    | 200       |
| `POST /collaboration/invitations/accept` (token-gated)²      | 200       | —         | —       | —       | —      | —      | —         |

¹ In the test, the invitation was sent by the admin. Cancel is allowed for the
inviter or the project owner (`forbidden_not_inviter` otherwise).
² Holding the invitation token is the credential. The caller's identity isn't
checked, by design.

Boundary cases the suite also pins:

- Body fields such as `role`, `owner`, `actor` and `inviterWalletAddress` are
  ignored. A viewer who claims `role: "owner"` still gets a 403.
- No cross-project access. The owner of one project gets 403
  (`project_role_unknown`) on another project.
- It fails closed. An unknown project, or a role authority that throws, gives a
  403 and never a default role.
- A collaborator listed without a role is treated as `viewer`. The owner stays
  `owner` even if also listed with a lower role.
- A header with surrounding whitespace counts as the same identity. A
  lower-cased address is rejected (400) rather than matched.
- After a transfer, the previous owner loses the right to transfer again. A
  denied cancel leaves the invitation `pending`.

This suite adds route-level coverage only. It doesn't change any guard:
`requireStellarAddress`, `createProjectPermissionMiddleware` and the
service-level owner and inviter checks are exercised as they are.
`collaboration.test.ts` (happy paths) and `permissions-enforcement.test.ts`
(middleware unit tests) are unchanged.
