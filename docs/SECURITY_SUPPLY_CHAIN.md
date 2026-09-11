# Security / Supply-Chain Gates

This branch adds security controls without changing FuryPipe runtime modules or the existing CI/release workflows owned by the hardening track.

## Implemented

- CodeQL advanced analysis for JavaScript/TypeScript in `.github/workflows/codeql.yml`.
- Pull-request dependency review in `.github/workflows/supply-chain.yml`.
- Repository SPDX SBOM export through GitHub's dependency graph API.
- SHA-pinned third-party GitHub Actions.
- Read-only default `GITHUB_TOKEN` permissions; only CodeQL receives `security-events: write`.

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
