# Ownership snapshot reconciliation

Issue #1633.

Off-chain project owner fields are convenience snapshots. **Chain state is
authoritative.** The `reconcileOwnershipSnapshots` helper compares DB vs chain
and reports mismatches; it never writes DB values onto the chain and never
promotes a conflicting DB owner for authorization when chain data is present.

Unknown chain owner ⇒ treat ownership as unresolved (do not fall back to DB for
financial actions).
