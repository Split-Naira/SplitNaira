# Diagnosing Soroban RPC Simulation Failures

Quick triage guide for `simulateTransaction` failures against the Soroban RPC.

## Common failure signatures

- `Error(Contract, #N)` — contract-level revert. Look up `#N` in `contracts/*/src/error.rs`.
- `UnknownError` / `HostError: Storage` — account or contract data missing on the target network (wrong network passphrase or unfunded account).
- `txMalformed` / `txSorobanInvalid` — footprint or resource fee mismatch; usually a stale simulation before signing.
- Timeout / connection reset — RPC node under load or wrong `SOROBAN_RPC_URL` for the environment.

## Reproducing

```bash
curl -s -X POST "$SOROBAN_RPC_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"simulateTransaction","params":{"transaction":"<base64 envelope>"}}'
```

Compare the `latestLedger` in the response against the network's current ledger to rule out a stale RPC node.

## Collecting diagnostics

- Backend logs: see `docs/backend-deploy.md` for log locations per environment.
- Include: network (testnet/mainnet), contract ID, function name, and the raw simulation response.

## Related

- `docs/SOROBAN_SETUP.md`
- `runbooks/rollback-guide.md`
