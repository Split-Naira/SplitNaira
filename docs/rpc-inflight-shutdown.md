# Stellar RPC calls during process shutdown

Issue #1639.

`rpc-inflight-shutdown` tracks in-flight RPC work. On `SIGTERM`/`SIGINT` paths,
call `shutdownRpcInflight()` after `markShuttingDown()` so:

1. Retry/timeout timers are cleared.
2. In-flight waiters see `AbortSignal`.
3. Aborted calls are classified like timeouts (**unknown on-chain outcome**) —
   do not mark transactions failed or succeeded without a later reconcile.
