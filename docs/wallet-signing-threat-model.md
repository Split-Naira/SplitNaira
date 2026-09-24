# Threat Model: Wallet Signing & Unsigned XDR Endpoints

## Trust boundaries

- Backend builds an unsigned transaction (XDR) and returns it to the client.
- The client's wallet (Freighter, etc.) is the only party that ever sees the signing key.
- Backend re-validates the signed XDR before submitting to the network.

## Risks

- **Replay**: a previously signed XDR resubmitted after its intended effect already happened.
- **Phishing / blind signing**: a malicious frontend or MITM swaps the XDR operations before the wallet prompt, and the user signs without noticing.
- **Tampering in transit**: unsigned XDR modified between backend and client before signing.
- **Endpoint abuse**: the unsigned-XDR endpoint used to probe or construct arbitrary operations outside the intended flow.

## Validation assumptions

- The backend treats the wallet's signature as the sole proof of user intent — it does not trust any client-asserted "user approved this" flag.
- Source account, sequence number, and operation set on the signed XDR are re-checked server-side against what was originally issued, not re-derived from client input.

## Mitigations

- Short-lived, single-use unsigned XDR (sequence number bound, expires quickly).
- Server-side re-validation of signed XDR operations against the original request before submission.
- Wallets display operation details (not raw base64) so users can catch a tampered transaction.
- Owner-gated mutations verify the claimed `owner` against on-chain project state before any XDR is built (see below).

## Owner-gated mutations (#1092)

The contract rejects non-owners on `lock_project`, `update_collaborators`, and
`update_metadata` with `SplitError::Unauthorized` (#3), but only once a signed
transaction reaches the network. The API now checks ownership first, so a
wrong wallet fails fast and never gets an unsigned XDR to sign.

| Route | Contract call | Backend check |
|---|---|---|
| `POST /splits/:projectId/lock` | `lock_project` | `owner` must equal on-chain `project.owner` |
| `PUT /splits/:projectId/collaborators` | `update_collaborators` | `owner` must equal on-chain `project.owner` |
| `PATCH /splits/:projectId/metadata` | `update_metadata` | `owner` must equal on-chain `project.owner` |
| `POST /splits/:projectId/deposit` | `deposit` | None — any funded account may deposit |
| `POST /splits/:projectId/distribute` | `distribute` | None — distribution is permissionless |
| `POST /splits/:projectId/claim` | `claim` | None — the contract checks the claimer's share |
| `POST /splits` | `create_project` | None — the caller becomes the owner |
| `POST /splits/admin/*` | admin calls | Payments-admin API key (`requirePaymentsAdminAccess`) |

Behaviour (implemented in `assertProjectOwner`, `backend/src/services/splits.service.ts`):

- Unknown project → `404 NOT_FOUND`.
- `owner` differs from the on-chain owner → `401 UNAUTHORIZED` with message
  `Caller is not the project owner` and remediation action `Switch Wallet`,
  the same wording the contract error #3 maps to.
- Project reads go through the 30s read cache. Ownership can be transferred
  on-chain, so a mismatch is re-checked against a fresh read before rejecting;
  a new owner is never blocked by stale cache state.
- The check runs after request validation, so malformed input still returns
  `400` without any RPC calls.

This is a fail-fast guard, not the authority: the contract's `require_auth()`
on the owner remains the enforcement point, and the body `owner` is a claim
until the wallet signs.

## Open questions

- Should unsigned XDR issuance be rate-limited per account to reduce probing?
- Do we need an explicit nonce/challenge beyond the sequence number for extra replay protection?
