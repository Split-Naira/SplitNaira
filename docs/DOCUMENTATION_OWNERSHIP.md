# Documentation Ownership Matrix — SplitNaira Hardening

## Status

**Tracked follow-up**

Documentation ownership by subsystem is a hardening follow-up for **SplitNaira**. The objective is to ensure that security-critical behavior, operational procedures, and contributor guidance have a clearly accountable owner across the full system.

This matrix covers:

* Backend
* Frontend
* Contracts
* CI/CD
* Documentation
* Operations
* Security surfaces

---

## Ownership Matrix

| Subsystem     | Documentation Surface                                                                                | Primary Owner       | Reviewers                     | Update Trigger                                         | Status    |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------- | ------------------------------------------------------ | --------- |
| **Backend**   | API behavior, authentication, encryption, secrets handling, error handling, service configuration    | Backend Maintainer  | Security + Ops                | API/security/config changes                            | ☐ Pending |
| **Frontend**  | User flows, wallet interactions, transaction states, error states, security-sensitive UI behavior    | Frontend Maintainer | Backend + Security            | UX, wallet, or transaction-flow changes                | ☐ Pending |
| **Contracts** | Contract architecture, permissions, pause/unpause, upgradeability, admin roles, deployment addresses | Contract Maintainer | Security + Backend            | Contract deployment or permission changes              | ☐ Pending |
| **CI/CD**     | Pipelines, environment variables, secret handling, deployments, release controls                     | DevOps/CI Owner     | Security + Backend            | Pipeline, deployment, or secret-management changes     | ☐ Pending |
| **Docs**      | Architecture, contributor guides, security model, runbooks, configuration references                 | Documentation Owner | All subsystem owners          | Material architecture or process changes               | ☐ Pending |
| **Ops**       | Incident response, monitoring, key rotation, contract pause, recovery, customer communication        | Operations Owner    | Security + Contract + Backend | Operational/security incident or infrastructure change | ☐ Pending |
| **Security**  | Threat model, cryptographic controls, key management, security assumptions, vulnerability response   | Security Owner      | All subsystem owners          | Security-control or threat-model changes               | ☐ Pending |

---

# 1. Backend

### Documentation should cover

* API architecture
* Authentication and authorization
* Sensitive-data handling
* AES-GCM encryption/decryption
* `UNLOCK_PRIVATE_KEY` handling
* Key rotation
* Database security
* Error handling
* Rate limiting
* Transaction processing
* External service dependencies
* Environment configuration

### Owner responsibility

The Backend Owner is responsible for ensuring that documentation accurately reflects the deployed backend behavior.

Security-sensitive backend changes should receive Security review before documentation is marked complete.

---

# 2. Frontend

### Documentation should cover

* Application architecture
* Wallet connection flow
* Transaction lifecycle
* User confirmation flows
* Transaction failure states
* Authentication flows
* Sensitive-data handling
* Environment variables
* Security-sensitive UI behavior

Frontend documentation must not encourage contributors to expose private keys, secrets, or sensitive transaction information in browser logs.

---

# 3. Contracts

### Documentation should cover

* Contract architecture
* Contract addresses by network
* Deployment process
* Owner/admin roles
* Pause/unpause mechanisms
* Upgradeability
* Access-control model
* Emergency procedures
* Events relevant to monitoring
* Contract dependencies
* Recovery procedures

Any change to ownership, privileged roles, upgradeability, or emergency controls must trigger a documentation review.

---

# 4. CI/CD

### Documentation should cover

* Build pipeline
* Test pipeline
* Deployment pipeline
* Required environment variables
* Secret-management process
* Production deployment controls
* Branch protections
* Release process
* Rollback procedure
* Secret rotation procedure
* Security scanning

Production secrets must never be documented using their actual values.

Use placeholders:

```env
UNLOCK_PRIVATE_KEY=<stored-in-secret-manager>
```

---

# 5. Documentation

The Documentation Owner maintains the overall documentation structure and ensures that subsystem documentation is discoverable and consistent.

### Core documentation should include

```text
docs/
├── architecture/
├── backend/
├── frontend/
├── contracts/
├── ci/
├── operations/
├── security/
└── contributing/
```

The Documentation Owner does not replace technical ownership.

Subsystem owners remain responsible for the correctness of documentation relating to their systems.

---

# 6. Operations

### Documentation should cover

* Production deployment
* Monitoring
* Alerting
* Incident response
* Key rotation
* Contract pause
* Recovery procedures
* Rollbacks
* Customer communication
* Service restoration
* Post-incident review

The Operations Owner should ensure that critical runbooks are executable by someone other than the person who originally created them.

---

# 7. Security

### Documentation should cover

* Threat model
* Security assumptions
* Trust boundaries
* Cryptographic architecture
* Key management
* Secret management
* Access control
* Private-key handling
* Vulnerability reporting
* Incident severity
* Security incident response
* Contract emergency controls
* Security monitoring

Security documentation should be reviewed whenever the underlying security assumptions change.

---

# 8. Cross-Subsystem Dependencies

Some documentation cannot be owned by a single subsystem.

Examples:

```text
Key Rotation
    Backend ─────┐
    CI/CD ───────┼──► Security + Operations
    Contracts ───┘
```

```text
Contract Pause
    Contracts ────┐
    Backend ──────┼──► Operations
    Frontend ─────┘
```

```text
Customer Incident
    Backend ──────┐
    Contracts ────┤
    Frontend ─────┼──► Operations + Security
    CI/CD ────────┘
```

Changes affecting multiple subsystems require the relevant owners to review the documentation together.

---

# 9. Definition of Done

The documentation ownership follow-up is considered complete when:

* [ ] Every subsystem has a named primary owner.
* [ ] Every security-critical document has an identified reviewer.
* [ ] Update triggers are defined.
* [ ] Backend documentation is current.
* [ ] Frontend documentation is current.
* [ ] Contract documentation is current.
* [ ] CI/CD documentation is current.
* [ ] Operations runbooks are current.
* [ ] Security documentation is current.
* [ ] Cross-subsystem dependencies are documented.
* [ ] Documentation is linked from the repository's main documentation entry point.
* [ ] Critical runbooks have been reviewed and, where practical, tested.
* [ ] Ownership is reviewed whenever maintainers or subsystem responsibilities change.

---

## Tracking Item

**Follow-up:** Establish and maintain a named documentation owner for each SplitNaira subsystem and complete the corresponding documentation surfaces.

**Priority:** High

**Category:** Security / Operations / Documentation Hardening

**Completion criteria:** All ownership cells are assigned, required documentation is reviewed by the appropriate subsystem owner, and critical security/operations runbooks are verified against the current implementation.
