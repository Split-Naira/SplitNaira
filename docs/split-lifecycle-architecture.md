# Split Lifecycle Architecture Diagram (#903)

> **Issue:** #903
> **Track:** Stellar Wave
> **Status:** Complete

## Purpose

[docs/ARCHITECTURE.md](./ARCHITECTURE.md) shows the static system components
(frontend, backend, contracts, Stellar network) and how they're layered. This
document is complementary: it shows the actual **lifecycle of a split
project** as it moves through the system — create, fund, distribute, and
observe — including which service each step talks to, which steps require a
wallet signature, and where the trust boundaries are.

## Split Lifecycle

```mermaid
sequenceDiagram
    actor Owner as Project Owner
    actor Payer as Payer (any wallet)
    actor Collaborator
    participant FE as Frontend (Next.js)
    participant Wallet as Stellar Wallet<br/>(Freighter / Albedo)
    participant BE as Backend API<br/>(Express)
    participant DB as PostgreSQL
    participant SC as Soroban Contract<br/>(splitnaira-contracts)
    participant RPC as Stellar/Soroban RPC<br/>(external service)

    rect rgb(235, 245, 255)
    note over Owner,SC: 1. CREATE
    Owner->>FE: Define project (title, type, token, collaborators + basis points)
    FE->>Wallet: Request signature for create_project
    Wallet-->>Owner: Prompt to approve
    Owner->>Wallet: Approve
    Wallet->>RPC: Submit signed create_project tx
    RPC->>SC: Execute create_project
    SC->>SC: Guard: reject if project_id already exists (#904)
    SC-->>RPC: ProjectCreated event
    end

    rect rgb(235, 255, 240)
    note over Payer,SC: 2. FUND
    Payer->>FE: Initiate deposit (project_id, amount)
    FE->>Wallet: Request signature for deposit
    Wallet-->>Payer: Prompt to approve
    Payer->>Wallet: Approve
    Wallet->>RPC: Submit signed deposit tx
    RPC->>SC: Execute deposit
    SC->>SC: Transfer token from payer to contract,<br/>increment project balance
    SC-->>RPC: DepositReceived event
    end

    rect rgb(255, 245, 230)
    note over Owner,Collaborator: 3. DISTRIBUTE
    alt Push distribution (anyone can trigger)
        Owner->>FE: Trigger distribute (or batch_distribute)
        FE->>Wallet: Request signature
        Wallet->>RPC: Submit signed distribute tx
        RPC->>SC: Execute distribute
        SC->>SC: Pay every collaborator their basis-point<br/>share of current balance in one call
        SC-->>RPC: PaymentSent (per collaborator) +<br/>DistributionComplete events
    else Pull claim (individual collaborator, on demand)
        Collaborator->>FE: Trigger claim
        FE->>Wallet: Request signature for claim
        Wallet->>RPC: Submit signed claim tx
        RPC->>SC: Execute claim
        SC->>SC: Compute this collaborator's share of<br/>current balance, transfer to them
        SC-->>RPC: CollaboratorClaimed event
    end
    end

    rect rgb(250, 235, 255)
    note over BE,FE: 4. OBSERVE
    loop Every 5s (backoff to 30s on RPC failure)
        BE->>RPC: Poll for new ledger events since last cursor
        RPC-->>BE: ProjectCreated / DepositReceived /<br/>PaymentSent / CollaboratorClaimed / ...
        BE->>DB: Persist TransactionRecord,<br/>advance cursor (ServiceState)
        BE->>FE: Push update via SSE (SseEventBus)
    end
    FE-->>Owner: Live-updating balance, distribution history
    FE-->>Collaborator: Live-updating claimable amount
    end
```

## Trust Boundaries and External Services

| Boundary | What crosses it | Who/what is trusted |
|----------|------------------|----------------------|
| **User ↔ Wallet extension** | The transaction to be signed (unsigned XDR) | The wallet (Freighter/Albedo) is the only party that ever holds the signing key. The backend never sees or handles private keys — see [wallet-signing-threat-model.md](./wallet-signing-threat-model.md). |
| **Frontend ↔ Backend** | API requests/metadata only, never a signing key | Frontend is treated as untrusted input by the backend; all state-changing outcomes are ultimately verified on-chain, not taken on the frontend's word. |
| **Wallet ↔ Stellar/Soroban RPC** | Signed transactions | RPC is an **external service** (not operated by SplitNaira) — the create/fund/distribute paths all depend on its availability. The backend's Observe loop treats RPC failures as a first-class case (error-count backoff, not a crash). |
| **Backend ↔ RPC (read path)** | Polling for ledger events | Read-only; the backend cannot mutate on-chain state through this path, only observe it. |
| **Contract-internal** | `create_project`'s duplicate-id guard, `deposit`'s balance accounting, `distribute`/`claim`'s payout math | This is the actual source of truth. The backend's PostgreSQL copy is a read cache for fast queries/history — if it disagrees with the chain, the chain wins. |

## Notes on Push vs. Pull Distribution

The contract supports two independent ways money actually reaches a
collaborator, and both are shown in step 3 above because either can happen at
any time once a project has a balance:

- **`distribute` / `batch_distribute`** — permissionless; anyone can call it,
  and it pays out every collaborator's share of the current balance in one
  transaction.
- **`claim`** — an individual collaborator can pull just their own share on
  demand, independent of whether anyone has called `distribute`.

Both mutate the same on-chain balance and both emit events the backend's
Observe loop picks up identically.

## Related

- [Architecture Overview](./ARCHITECTURE.md) — static component/layer diagram
- [Wallet signing threat model](./wallet-signing-threat-model.md)
- [Contract events reference](./contract-events.md)
- [Backend performance (Wave 5)](./backend-performance-wave5.md)
