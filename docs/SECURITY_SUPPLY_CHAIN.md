# Security / Supply-Chain Gates

This branch adds security controls without changing FuryPipe runtime modules or the existing CI/release workflows owned by the hardening track.

## Implemented

- CodeQL advanced analysis for JavaScript/TypeScript.
- Pull-request dependency review that fails on newly introduced high/critical vulnerabilities in runtime or development scopes.
- CycloneDX SBOM generation from the frozen dependency graph after lifecycle scripts are disabled.
- SHA-pinned GitHub Actions.
- Read-only default `GITHUB_TOKEN` permissions; only CodeQL receives `security-events: write`.

## Deliberately not claimed

- GitHub secret scanning / push protection are repository settings, not something this workflow can prove enabled.
- Release attestations are not added here because the release workflow is a shared critical file and remains owned by the hardening/release track.
- No npm publication, release, merge, deployment, credential rotation, or branch-protection change is performed.

## Ownership boundary

ChatGPT track owns:

- `.github/workflows/security.yml`
- `docs/SECURITY_SUPPLY_CHAIN.md`

Codex should avoid those files while this track is active. ChatGPT does not modify:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `pnpm-lock.yaml`
- runtime source modules

This keeps MCP / Recovery / FuryPrompt work independent and minimizes merge conflicts.
