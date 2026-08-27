# Windows Shell Compatibility & NPM Install Guidance

Contributors operating on Windows environments may encounter shell execution blocks or script parsing failures when executing `npm install` across monorepo workspaces. This guide provides resolution steps and fallback configurations.

## Common Windows Shell Issues

1. **PowerShell Execution Policy Restrictions:** Scripts (`.ps1`) bundled with certain dependencies are blocked by default security policies.
2. **Command Prompt (`cmd.exe`) Path Parsing Failures:** Complex shell scripts failing due to unix-style syntax or missing bash interpreters.

## Recommended Workflows & Fallbacks

* **Bypassing Execution Policy (PowerShell):**
  If PowerShell blocks local lifecycle scripts during installation, run your terminal as Administrator or execute with scoped bypass flags:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
  npm install