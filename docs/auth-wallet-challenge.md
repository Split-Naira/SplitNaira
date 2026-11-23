# Signed wallet login (Issue #1232)

A public Stellar address is not a credential. Anyone can read it from the
ledger, so treating it as authentication lets an attacker mint a JWT for any
wallet. The signed challenge flow proves the caller holds the Ed25519 key
behind the address before a token is issued.

## Flow

1. **Request a challenge**

   ```http
   POST /auth/wallet/challenge
   Content-Type: application/json

   { "walletAddress": "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT" }
   ```

   `201 Created` returns a `challengeId`, the exact `challenge` string to
   sign, and `issuedAt` / `expiresAt` timestamps. The response never contains
   a token.

2. **Sign the challenge string** with the wallet (Freighter `signMessage`,
   StellarWalletsKit, or `Keypair#sign` server-side). Sign the UTF-8 bytes of
   `challenge` exactly as returned; do not trim, re-wrap, or re-serialize it.

3. **Verify the signature**

   ```http
   POST /auth/wallet/verify
   Content-Type: application/json

   {
     "walletAddress": "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
     "challengeId": "b6f1a2d4-8c3e-4a1b-9f2e-6d5c7a8b9c0d",
     "signature": "<base64-encoded 64-byte Ed25519 signature>"
   }
   ```

   `200 OK` returns the same profile shape as `POST /users/login` plus a JWT
   `token`. Use it as `Authorization: Bearer <token>`.

## Rejection rules

| Case | Status | `code` |
| --- | --- | --- |
| Unknown challenge id | 401 | `WALLET_CHALLENGE_UNKNOWN` |
| Expired challenge | 401 | `WALLET_CHALLENGE_EXPIRED` |
| Challenge issued for another wallet | 401 | `WALLET_CHALLENGE_WALLET_MISMATCH` |
| Malformed/incorrect signature | 401 | `WALLET_CHALLENGE_INVALID_SIGNATURE` |
| Unknown, inactive, or deleted account | 401 | `UNAUTHORIZED` (generic) |
| Invalid request body | 400 | `VALIDATION_ERROR` |

The signature is verified before the account lookup, so a caller cannot use
the endpoint to enumerate registered wallets. A failed signature does not
consume the challenge — the user can retry until it expires. A successful
verification consumes it atomically, so replaying the same request cannot
produce a second token.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WALLET_CHALLENGE_TTL_MS` | `300000` (5 minutes) | Lifetime of an issued challenge. |

Challenges are stored in a bounded, per-process in-memory map, matching the
existing idempotency and login-attempt stores. In a multi-instance deployment,
either keep auth traffic sticky for the challenge lifetime or replace
`WalletChallengeStore` with a shared implementation behind the same interface.

## Migration from `POST /users/login`

`POST /users/login` still works for backwards compatibility, but it
authenticates from the address alone and is registered in
`API_DEPRECATIONS` (`wallet-login-address-only`) until **2027-06-30**. Client
migrations should switch to the two-step flow above; the resulting JWT is
identical in shape and is accepted by every `authJwtMiddleware` route.
