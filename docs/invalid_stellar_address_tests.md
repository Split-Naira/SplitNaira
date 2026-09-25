# Invalid Stellar Address Input Tests

Boundary test cases verifying rejection of malformed or checksum-failing addresses.

## Admin token address parsing

`backend/src/__tests__/admin-token-parsing.test.ts` checks that every admin route that takes a token rejects a malformed token address. The routes are `POST /splits/admin/allow-token`, `disallow-token` and `withdraw-unallocated`, and `GET /splits/admin/is-token-allowed` and `unallocated`.

A malformed token gets a `400` with `error: "validation_error"` and the problem listed under `details.fieldErrors.token`. The route makes no Soroban RPC call and writes no `Payments admin action prepared` audit log entry. The response never echoes the rejected value.

The suite uses the real `@stellar/stellar-sdk` parser. These inputs are rejected: empty string, arbitrary text, bad checksum, truncated strkey, lowercased strkey, whitespace-padded strkey, `S…` secret seed, `0x` hex contract id, number, `null`, and a missing field.

The service-layer builders (`buildAllowTokenUnsignedXdr`, `buildDisallowTokenUnsignedXdr`, `buildWithdrawUnallocatedUnsignedXdr`) also throw `RequestValidationError` (`"<label> address must be a valid Stellar address"`) before any RPC call.

> **Behaviour change:** `buildWithdrawUnallocatedUnsignedXdr` used to fetch the admin account over RPC first and only then parse the addresses. A malformed address therefore cost an RPC call and ended in a generic `500`. It now checks `admin`, `token` and `to` before any network call, the same way `allow`/`disallow` already did. HTTP clients see no difference, because the route's Zod schema already rejected these inputs.
