# 🤝 Contributing to SplitNaira

Thank you for your interest in contributing to **SplitNaira** — a royalty distribution platform built for Nigeria's creative economy on Stellar. Every contribution, big or small, helps us build a fairer system for artists, filmmakers, and creators across Nigeria.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Branching Strategy](#branching-strategy)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Smart Contract Contributions](#smart-contract-contributions)
- [Community](#community)

---

## 📜 Code of Conduct

By participating in this project, you agree to uphold a respectful and inclusive environment. We are committed to making SplitNaira welcoming for contributors regardless of background, experience level, nationality, or identity.

**We do not tolerate:**
- Harassment or discrimination of any kind
- Dismissive or disrespectful communication
- Plagiarism or misrepresentation of work

Violations may result in removal from the project. Please report issues to the maintainers privately.

---

## 💡 How Can I Contribute?

### 🐛 Bug Reports
Found something broken? Open a GitHub Issue with:
- A clear title describing the bug
- Steps to reproduce it
- Expected vs actual behaviour
- Screenshots or logs if applicable
- Your environment (OS, browser, Node version)

### ✨ Feature Requests
Have an idea to improve SplitNaira? Open an Issue tagged `enhancement` with:
- A description of the feature
- The problem it solves
- Any mockups or references (optional)

### 💻 Code Contributions
You can contribute to:
- **Frontend** — Next.js UI components, pages, wallet flows
- **Smart Contracts** — Soroban/Rust contract logic
- **Backend** — Node.js API routes and services
- **Tests** — Unit and integration tests
- **Docs** — README, guides, tutorials

### 🎨 Design Contributions
We welcome UI/UX improvements. Submit Figma links or design proposals as Issues tagged `design`.

### 🌍 Localization
Help translate SplitNaira into Nigerian languages (Yoruba, Igbo, Hausa). Open an Issue tagged `i18n`.

---

## 🛠️ Development Setup

### 1. Fork & Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/splitnaira.git
cd splitnaira
```

### 2. Install Dependencies

```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install

# Soroban contracts (requires Rust)
cd ../contracts
cargo build
```

### 3. Configure Environment

```bash
cp .env.example .env
# Fill in your Stellar testnet keys and local DB credentials
```

### 4. Run Locally

```bash
# Start frontend (from /frontend)
npm run dev

# Start backend (from /backend)
npm run dev

# Run contract tests (from /contracts)
cargo test
```

### 5. Connect Freighter Wallet
- Install the [Freighter browser extension](https://freighter.app)
- Switch to **Testnet** in Freighter settings
- Fund your testnet wallet via [Stellar Friendbot](https://friendbot.stellar.org)

---

## 🌿 Branching Strategy

We follow a simple branching model:

| Branch | Purpose |
|---|---|
| `main` | Production-ready code only |
| `develop` | Active development, staging |
| `feature/your-feature-name` | New features |
| `fix/bug-description` | Bug fixes |
| `docs/topic` | Documentation updates |
| `contracts/feature-name` | Soroban contract changes |

**Always branch off `develop`, not `main`.**

```bash
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

---

## ✍️ Commit Message Guidelines

We follow the **Conventional Commits** specification:

```
type(scope): short description

[optional body]
[optional footer]
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code restructuring (no feature/fix) |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling changes |
| `contract` | Soroban smart contract changes |

### Examples

```bash
feat(splits): add percentage validation on split creation
fix(wallet): resolve Freighter disconnection on page reload
docs(readme): update installation instructions
contract(distribute): optimize gas usage in distribution function
```

---

## 🔁 Pull Request Process

1. **Ensure your branch is up to date** with `develop` before submitting
2. **Write or update tests** for any code you add or change
3. **Run the test suite** locally and confirm it passes:
   ```bash
   npm test          # frontend & backend
   cargo test        # contracts
   ```
4. **Fill out the PR template** completely — describe what you changed and why
5. **Link any related Issues** in your PR description using `Closes #123`
6. **Request a review** from at least one maintainer
7. **Address all review comments** before merging

### PR Checklist

- [ ] Code follows the project's style guide
- [ ] Tests written/updated and passing
- [ ] No console.log or debug statements left in
- [ ] Environment variables added to `.env.example` if needed
- [ ] Documentation updated if behaviour changed
- [ ] Soroban contracts tested on Stellar testnet

---

## 🐞 Issue Reporting

When opening an Issue, please use the appropriate template:

- **Bug Report** — use label `bug`
- **Feature Request** — use label `enhancement`
- **Smart Contract Issue** — use label `contract`
- **Documentation** — use label `docs`
- **Question** — use label `question`

Please **search existing issues** before opening a new one to avoid duplicates.

---

## 🔐 Smart Contract Contributions

Soroban contracts handle real financial value. All contract contributions must:

1. Include **comprehensive unit tests** in `contracts/tests/`
2. Be reviewed and approved by **at least two maintainers**
3. Pass a **security checklist**:
   - No unchecked arithmetic (use `checked_add`, `checked_mul`, etc.)
   - Authorization checks on all state-modifying functions
   - No re-entrancy vulnerabilities
   - Events emitted for all critical state changes
4. Be deployed and **tested on Stellar Testnet** before mainnet consideration
5. Include **inline documentation** on all public functions
6. Regenerate committed contract interface artifacts after any contract surface change:

```bash
# From the repository root (recommended)
npm run generate:contract-types

# Or from contracts/ via Make
make -C contracts generate
```

This runs `contracts/scripts/generate-interface.mjs` to refresh `contracts/interface/splitnaira.contract-interface.json`, then updates `frontend/src/generated/contract-types.ts` and `backend/src/generated/contract-types.ts`. Commit the regenerated files with the contract change. CI runs `npm run verify:data-integrity` to ensure the artifacts stay in sync.

```rust
/// Distributes accumulated revenue to all registered collaborators
/// based on their predefined percentage splits.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `project_id` - Unique identifier for the creative project
///
/// # Errors
/// Returns `Error::NoBalance` if contract has zero balance
pub fn distribute(env: Env, project_id: Symbol) -> Result<(), Error> {
    // implementation
}
```

---

## 🏷️ Labels Reference

| Label | Meaning |
|---|---|
| `good first issue` | Great for new contributors |
| `help wanted` | Extra attention needed |
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `contract` | Soroban smart contract related |
| `frontend` | UI/UX related |
| `backend` | API/server related |
| `docs` | Documentation improvements |
| `design` | UI/UX design proposals |
| `i18n` | Localization/translation |
| `wontfix` | Will not be worked on |

---

## 🌐 Community

- **GitHub Discussions** — for questions, ideas, and general chat
- **Twitter/X** — follow [@SplitNaira](https://twitter.com) for updates
- **Telegram** — join our builder community (link in GitHub bio)

---

## 🙏 Recognition

All contributors are listed in our [CONTRIBUTORS.md](./CONTRIBUTORS.md) file and acknowledged in release notes. Significant contributors may be invited as project maintainers.

---

<p align="center">Built with ❤️ for Nigeria's creative economy — Let's make fair pay the default.</p>
