# Database Connection Lifecycle and Leak Regression Tests

Issue #1471. Code: [`backend/src/services/database.ts`](../backend/src/services/database.ts).
Tests: [`backend/src/__tests__/database-connection-leak.test.ts`](../backend/src/__tests__/database-connection-leak.test.ts).

## Guarantees

`withTransaction` checks one connection (`QueryRunner`) out of the pg pool per
attempt and **always** releases it, exactly once, on every path:

| Path                                     | Outcome                                                  | Connection                                                               |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Callback succeeds                        | commit, return result                                    | released                                                                 |
| Callback throws (request failure)        | rollback, rethrow callback error                         | released                                                                 |
| `connect()` / `startTransaction()` fails | rethrow                                                  | released                                                                 |
| `commitTransaction()` fails              | rollback, rethrow                                        | released                                                                 |
| `rollbackTransaction()` fails            | log, rethrow **callback's** error                        | released; Postgres aborts the open transaction when the session is reset |
| `release()` fails                        | log, never thrown (a committed result is still returned) | release attempted once                                                   |
| Deadlock (`40P01`) retry                 | each attempt rolls back                                  | each attempt's runner released (3 max)                                   |
| Nested `withTransaction`                 | independent transactions                                 | one connection per level, all released                                   |

`closeDatabase` (called from the `SIGTERM`/`SIGINT` handler in `src/index.ts`):

1. waits for any in-flight `initDatabase()`;
2. **unregisters the data source before destroying it**, so a request arriving
   mid-shutdown fails fast with `Database not initialized` instead of checking
   a connection out of a pool being torn down;
3. destroys the pool. If `destroy()` rejects, the error propagates, but module
   state is already cleared: a second shutdown signal is a no-op and a later
   `initDatabase()` builds a fresh pool.

Before this change, a failed `destroy()` left the stale data source registered,
and transactions started during shutdown could still check out connections.
Two regression tests cover this. Both fail against the old implementation.

## Bounded shutdown with active transactions (Issue #1638)

`withTransaction` increments a module-level active-transaction gauge after
`startTransaction()` succeeds and decrements it in `finally`, after commit or
rollback. `closeDatabase` is only called after that gauge reaches zero or the
drain deadline passes.

Shutdown order in `runShutdownSequence` (`src/services/shutdown.ts`):

1. flip readiness to `503 shutting_down`;
2. stop accepting new connections (`server.close()`);
3. end open SSE streams and stop the event listener;
4. **drain active transactions**, polling every 25 ms;
5. close the database pool;
6. wait for the HTTP server to finish closing, then exit 0.

A payout that is mid-transaction therefore gets to commit or roll back before
the pool is destroyed. Draining is bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS`
(default 10000 ms); on timeout the remaining count is logged, the pool is still
closed, and the process exits 1 because shutdown was not graceful.
`SHUTDOWN_FORCE_TIMEOUT_MS` (default 15000 ms) is the backstop for a hung
`server.close()` or pool destroy: it force-exits 1.

Tests: `src/services/shutdown.test.ts` covers commit, rollback, drain timeout,
clean ordering, and forced termination; `src/__tests__/graceful-shutdown.integration.test.ts`
exercises the real SIGTERM path when Postgres is available.

## How the tests detect leaks

The suite installs a fake pool via `setDataSourceForTests`. It counts
checked-out connections and open transactions, and records how many times each
runner was released. After each scenario it asserts:

- `checkedOut === 0` and `openTransactions === 0`;
- every runner created was released **exactly once**.

The scenarios cover each failure point in the table above, 50 concurrent mixed
success/failure transactions, an Express route that fails mid-transaction
(repeated 10 times, then a success), and the shutdown paths.

## Validation

```bash
cd backend
npm test -- database-connection-leak   # no Postgres required
npm test -- shutdown                    # bounded drain + forced termination; no Postgres required
npm run test:shutdown                    # real process + Postgres; CI only (CI=true, DATABASE_URL set)
```

## Pool settings

`DATABASE_POOL_MAX` (default 10), `DATABASE_POOL_IDLE_MS` (30000) and
`DATABASE_POOL_CONN_TIMEOUT_MS` (2000) are described in
[backend-env-vars.md](./backend-env-vars.md). A leaked connection shows up first
as pool-exhaustion timeouts (`timeout exceeded when trying to connect`). If you
see those in production, check for code that calls `createQueryRunner()`
directly instead of using `withTransaction`.
