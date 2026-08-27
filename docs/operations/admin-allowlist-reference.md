# Operations Reference: Admin Allowlist Management

## Overview
The SplitNaira platform utilizes cryptographic and role-based allowlists to restrict administrative actions, sensitive contract deployments, and high-privilege backend operations to authorized keys and addresses.

---

## Allowlist Architecture
* **Contract Level**: Soroban smart contracts implement administrative access control lists (ACLs) to gate upgrade procedures and emergency pause hooks.
* **Backend Level**: API middleware checks incoming request signatures against registered admin public keys stored securely in environment secrets or encrypted database tables.

---

## Administrative Operations

### 1. Adding an Address to the Allowlist
To grant administrative privileges to a new operator:
1. Access the secure admin console or execute the administrative CLI script:
   ```bash
   npm run admin:allowlist:add -- --address <STELLAR_PUBLIC_KEY> --role <ROLE_NAME>