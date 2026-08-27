# Stellar & Soroban Payment Terms Glossary

This glossary defines key technical terminology used across the SplitNaira smart contracts, backend services, and deployment pipelines.

## Stellar Network & Ledger
* **Ledger Sequence:** A monotonically increasing integer representing a specific block height on the Stellar network. Used for time-bound transaction validation and recurring schedule tracking.
* **XDR (External Data Representation):** The canonical binary serialization format required for all data structures transmitted across the Stellar network and manipulated via Soroban host functions.
* **Soroban:** The smart contract platform for Stellar, powered by Rust and executed on a WASM-based virtual machine (`wasm32v1-none`).

## Smart Contract & Execution Primitives
* **Contract Instance Storage:** Persistent state storage attached directly to a deployed contract instance, used to store administrative configurations, balances, and index mappings.
* **Host Authentication (`require_auth`):** Cryptographic verification enforced by the Soroban host ensuring that a transaction initiator has explicitly signed off on a sensitive action (e.g., fund transfers, split creations, deactivations).
* **WASM Binary Size Limit:** A strict deployment constraint ($100\text{ KB}$) enforced via automated CI pipelines to prevent unoptimized contract bloat.
* **Pessimistic Locking (`SELECT FOR UPDATE`):** Database concurrency control used in backend services to prevent race conditions and double-spending during concurrent balance updates.