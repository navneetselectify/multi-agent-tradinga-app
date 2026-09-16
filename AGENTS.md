# AGENTS.md (OpenCode Project Contract)

This repository is dedicated to learning **OpenCode-based multi-agent and agent-team development**. Keep implementation lightweight and focus on studying agent coordination.

Every agent session in this repository must strictly adhere to the project rules and constraints below.

---

## 🚫 Critical Restrictions (Read Before Starting)

1. **Human-Controlled Git Governance:**
   Agents must not perform Git operations. The human developer owns all Git lifecycle operations including status, add, commit, branch, checkout, merge, rebase, push, pull, and related repository-management operations.
2. **NO ACCIDENTAL BOOTSTRAPPING:**
   Do not create directories, initialize package managers, or import frameworks (e.g., Next.js, FastAPI, LangGraph) unless explicitly specified in an active, approved Epic.
3. **NO CREDENTIALS:**
   Never expose, write, or commit API keys or credentials. Use git-ignored local configuration files for all sensitive keys.

---

## 🧭 Incremental Execution Flow

For every task or Epic assigned:

### Step 1: Inspect & Analyze
- Use `glob`, `grep`, and `read` to understand the current workspace state.
- Trust executable configurations and code over prose.

### Step 2: Design & Propose
- Propose architecture decisions and changes first.
- Keep proposals minimal, incremental, and direct. Do not over-engineer.
- Obtain explicit human approval before implementing any new architectural components or installing new dependencies.

### Step 3: Implement & Verify
- Implement code changes carefully, matching local styles and typing constraints.
- Run local compilers, linters, or test suites to verify your changes.
- Ensure the build is clean and error-free before concluding your turn.

---

## ⚡ Agent-Team Interaction & Behaviors

- **Specialization & Roles:** You may be asked to act as a designer, developer, tester, or reviewer. Maintain your persona strictly.
- **Fail Fast:** If a command, tool, or build check fails, report the error immediately. Do not attempt to mask failures or bypass safety checks.
- **Explain Critical Steps:** Always explain any modifying commands before running them.
