# Branch Protection & Required Status Checks Guide

To maintain high code quality, test coverage thresholds, and artifact integrity across the SplitNaira monorepo, repository administrators must configure branch protection rules on `main` and `develop`.

## Required Status Checks

Before a pull request can be merged into protected branches, the following CI checks must successfully report execution:

1. **Backend Unit & E2E Tests (`ci / backend-tests`):** Verifies NestJS service integration, controllers, and database models.
2. **Frontend Component Tests (`ci / frontend-tests`):** Validates React components and user interface interactions via Jest and Testing Library.
3. **Smart Contract Test Suite (`ci / soroban-contracts`):** Executes cargo test suites across Soroban contracts (`stellarspend-contracts`, `veritix-contract`).
4. **Code Coverage Enforcement (`ci / tarpaulin-coverage`):** Validates that all Rust and TypeScript workspaces meet or exceed the mandatory $80\%$ coverage threshold.
5. **WASM Binary Size Constraint (`ci / wasm-size-check`):** Ensures compiled contract binaries remain under the $100\text{ KB}$ limit.

## Administrative Configuration Steps

1. Navigate to your GitHub repository: **Settings > Branches**.
2. Under **Branch protection rules**, click **Add rule** (or edit existing rules for `main` / `develop`).
3. Enable **Require a pull request before merging**.
4. Enable **Require status checks to pass before merging**.
5. Search for and select the required jobs listed above.
6. Enable **Require branches to be up to date before merging** to prevent race conditions during parallel merges.