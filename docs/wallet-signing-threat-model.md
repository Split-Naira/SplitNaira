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

## Open questions

- Should unsigned XDR issuance be rate-limited per account to reduce probing?
- Do we need an explicit nonce/challenge beyond the sequence number for extra replay protection?
