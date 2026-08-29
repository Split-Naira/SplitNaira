# Windows npm Dependency Installation Runbook

Use this runbook when `npm ci` or `npm install` fails on a Windows checkout.
It covers the repository's npm workspaces (`frontend` and `backend`); for
general shell, Docker, Rust, and line-ending guidance, see the
[Windows Troubleshooting Guide](../WINDOWS_TROUBLESHOOTING.md).

## Scope and ownership

Backend and Frontend Engineering own the workspace manifests and lockfile;
contributors own their local Node, npm, and Windows tooling. Report a repeatable
install problem with Windows version, PowerShell version, `node --version`,
`npm --version`, the command, and the first error block — never upload
`.npmrc` credentials or a full environment dump.

## Standard recovery path

1. Use 64-bit Node.js 18+ and npm 8+:

   ```powershell
   node --version
   npm --version
   ```

2. Close development servers, editors with active Node tasks, and terminal
   windows that are using this checkout. File locks from a running Node process
   are a common source of `EPERM` failures.

3. From the repository root, verify the lockfile is unchanged and install the
   pinned workspace dependency graph:

   ```powershell
   git status --short
   npm cache verify
   npm ci
   ```

   `npm ci` installs the root and both npm workspaces from
   `package-lock.json`; it is the expected command for a fresh checkout and
   CI. Do not run separate workspace installs after a successful root
   `npm ci`.

4. Use `npm install` only when deliberately adding or upgrading a dependency.
   Commit the matching `package.json` and `package-lock.json` changes together.

If the lockfile is intentionally unchanged but the installation remains
corrupted, `npm ci` is the clean retry: it removes the root `node_modules`
tree before installing. Do not delete `package-lock.json` to work around an
install failure.

## Symptom-based triage

| Symptom | Cause | Resolution |
|---------|-------|------------|
| `npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy blocks npm's wrapper. | For the current terminal only, run `Set-ExecutionPolicy -Scope Process RemoteSigned`, open a new terminal if needed, then retry `npm ci`. Follow organisation policy before making a user- or machine-wide policy change. |
| `EPERM`, `EBUSY`, or `operation not permitted` while removing files | Antivirus, Explorer, an editor, or a Node process has a file open. | Close those processes; restart the terminal; run `npm cache verify` then `npm ci`. If managed antivirus keeps locking the checkout, ask IT to allow the repository/workspace path rather than disabling protection. |
| `node-gyp`, `gyp ERR!`, `MSBUILD`, `link.exe`, or C++ compiler errors | The native build toolchain is unavailable. | Install Visual Studio Build Tools with the **Desktop development with C++** workload, restart the terminal, and rerun `npm ci`. A supported command is `winget install Microsoft.VisualStudio.2022.BuildTools --add Microsoft.VisualStudio.Workload.VC`. |
| `ENAMETOOLONG` or nested `ENOENT` paths | Windows long paths are disabled. | Enable Windows long-path support through your organisation's supported policy, then run `git config --global core.longpaths true` and reclone/install. See the [main Windows guide](../WINDOWS_TROUBLESHOOTING.md#common-path-issues). |
| `EBADENGINE`, syntax errors in npm, or optional package/platform errors | The Node/npm architecture or version is unsupported. | Install 64-bit Node 18+ using `nvm-windows` or `fnm`, confirm with the version commands above, and rerun `npm ci`. The Windows Lightning CSS binary is optional, so it is skipped on other operating systems. Do not edit the lockfile to suppress an engine check. |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `ECONNRESET`, or `ETIMEDOUT` | A proxy, corporate TLS interception, VPN, or registry outage is blocking npm. | Check `npm config get registry`, `proxy`, and `https-proxy`; use your organisation's approved registry/CA configuration. Do not disable TLS verification with `strict-ssl=false`. |
| `E401` or `E403` from a private registry | npm credentials or registry access are missing. | Use the approved per-user `.npmrc`/credential flow and retry. Keep tokens out of repository `.npmrc` files and issue logs. |
| Peer-dependency or lockfile mismatch | The working tree's manifest and lockfile no longer describe the same graph. | Restore the intended manifest/lockfile pair from source control, then run `npm ci`. Escalate to the dependency owner if the committed pair fails on a clean supported environment. |

## Avoid unsafe workarounds

- Do not use `--force`, `--legacy-peer-deps`, `--ignore-scripts`, or
  `strict-ssl=false` as a normal fix. They can hide a dependency conflict,
  bypass required native setup, or weaken TLS verification.
- Do not run PowerShell or npm as Administrator merely to make an install
  succeed. Correct file ownership or the execution-policy scope instead.
- Do not commit `node_modules`, user `.npmrc` files, certificates, proxy URLs,
  or registry tokens.

## Verification and escalation

After a successful install, use the commands relevant to your change:

```powershell
npm run lint
npm run test:backend
npm run test:frontend
```

If the failure persists, attach the concise diagnostic details noted above to
an issue and link this runbook. The user-facing impact is limited to local
contributor setup; production dependency resolution continues to use the
committed lockfile in CI.
