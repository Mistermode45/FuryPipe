# Security / Supply-Chain Gates

This branch adds security controls without changing FuryPipe runtime modules or the existing CI/release workflows owned by the hardening track.

## Implemented

- CodeQL advanced analysis for JavaScript/TypeScript in `.github/workflows/codeql.yml`.
- Frozen dependency installation with lifecycle scripts disabled.
- Full resolved dependency audit with `pnpm audit --audit-level high`.
- SPDX 2.3 SBOM generation with the built-in npm SBOM command and artifact retention.
- Optional GitHub Dependency Review for pull requests when repository Dependency Graph support is explicitly enabled.
- SHA-pinned third-party GitHub Actions.
- Read-only default `GITHUB_TOKEN` permissions; only CodeQL receives `security-events: write`.

## Repository-setting dependency

GitHub Dependency Review cannot run while Dependency Graph is disabled for the repository. The first PR run failed with GitHub's explicit `Dependency review is not supported on this repository` error.

The workflow therefore does not hide the failure with `continue-on-error`. Instead:

1. the blocking security gate is the frozen full-tree `pnpm audit`;
2. SBOM generation is performed locally and does not depend on GitHub Dependency Graph;
3. GitHub Dependency Review is enabled only when repository variable `FURYPIPE_DEPENDENCY_GRAPH_ENABLED=true` is configured after Dependency Graph has actually been enabled.

Until that repository setting exists, GitHub Dependency Review is `BLOCKED_BY_REPO_SETTING`, not `PASS`.

## Deliberately not claimed

- GitHub secret scanning / push protection are repository settings, not something these workflows can prove enabled.
- Release attestations are not added here because `.github/workflows/release.yml` is a shared critical file and remains outside this parallel track.
- No npm publication, release, merge, deployment, credential rotation, or branch-protection change is performed.
- A workflow is not considered validated until its GitHub Actions run completes successfully on this branch/PR.

## Ownership boundary

ChatGPT track owns:

- `.github/workflows/codeql.yml`
- `.github/workflows/supply-chain.yml`
- `docs/SECURITY_SUPPLY_CHAIN.md`

Codex should avoid those files while this track is active.

ChatGPT does not modify:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `pnpm-lock.yaml`
- runtime source modules

This keeps MCP / Recovery / FuryPrompt work independent and minimizes merge conflicts.

## Secret scanning

The CI track uses the MIT-licensed `gitleaks/gitleaks` CLI directly rather than `gitleaks/gitleaks-action`.

Pinned evidence:

- CLI version: `8.30.1`;
- Linux x64 archive SHA-256: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`;
- workflow: `.github/workflows/secret-scan.yml`.

The separate GitHub Action wrapper was reviewed and rejected for this track because its current license is a source-available EULA rather than MIT. The core Gitleaks repository remains MIT.

The workflow scans full git history and fails on findings. Legitimate test fixtures must be handled with narrow, documented allowlists; a broad `continue-on-error` is not acceptable.

## Dependabot policy

Status: `DEFERRED_UNTIL_BRANCH_POLICY_FINAL`.

The repository default branch is currently `v5-codex-review-clean` while active development occurs on `v5-production-hardening`. Dependabot configuration is intentionally deferred until the target/default branch policy is finalized so automated update PRs are not directed at the wrong integration branch.
