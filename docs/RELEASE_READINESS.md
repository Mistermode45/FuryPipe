# FuryPipe V5 Release Readiness

## Status

`EVALUATOR_IMPLEMENTED_RELEASE_BLOCKED`

This module evaluates release evidence. It does **not** merge branches, create tags, publish npm packages, create GitHub releases, rotate credentials or deploy production.

## Files

- `src/release-readiness/index.ts`
- `tests/release-readiness.test.ts`

## Output

The evaluator returns one of two technical states:

- `BLOCKED`
- `READY_FOR_RELEASE_DECISION`

`READY_FOR_RELEASE_DECISION` is deliberately not named `RELEASED`, `AUTHORIZED` or `DEPLOYED`.

Release authorization is recorded separately and no release action is ever executed by the evaluator.

## Required V5 gates

The default V5 policy requires verified evidence for:

- CI push matrix;
- CI PR matrix;
- CodeQL;
- secret scanning;
- supply-chain/SBOM;
- license compliance;
- Recovery production guarantees;
- MCP production/runtime conformance;
- Agent Runtime;
- FuryPrompt runtime wiring;
- Learning/Knowledge runtime;
- Web/Figma Studio release scope;
- Control Room release scope;
- i18n release scope;
- release documentation / compatibility;
- branch policy;
- provenance / attestation path.

## Conditional / advisory gates

GitHub Dependency Review is reported separately because FuryPipe already requires frozen dependency audit and SBOM evidence. A repository-setting blocker stays visible and should be removed before stable release when the GitHub plan/settings allow it.

Provider benchmarks are advisory when release notes make no performance claims. If `performanceClaims=true`, provider benchmark evidence becomes a required gate automatically.

Therefore FuryPipe cannot publish claims such as “500× faster” merely because the benchmark harness passes.

## Current expected V5 result

Until Codex closes the remaining production runtime work, the honest expected result is:

`BLOCKED`

Typical blockers include M4 Recovery, external/production MCP evidence, Agent/FuryPrompt wiring and other release-scope features that remain `PARTIAL`.

This evaluator is intended to feed Control Room and future RC automation once those gates become real evidence.


## RC evidence snapshot

`src/release-readiness/evidence.ts` adds a second fail-closed layer for the release-candidate preparation phase.

`createRcEvidenceSnapshot()` requires the RC source SHA and package version to match the Release Readiness report. It also requires explicit successful evidence for the core GitHub workflows and explicit `VERIFIED` preparation artifacts, including package/install/upgrade/rollback smoke evidence, SBOM, provenance path, compatibility matrix, migration notes, release notes and the SHA-256 of the exact package artifact.

The RC snapshot can return `READY_FOR_RELEASE_DECISION`, but it copies authorization separately and always returns `releaseActionsExecuted: false`.

Supporting operator documents:

- `docs/release/RC_CHECKLIST.md`
- `docs/release/ROLLBACK.md`
- `docs/release/MIGRATION_V5.md`
- `docs/release/RELEASE_NOTES_TEMPLATE.md`


## Build provenance before release

`.github/workflows/provenance.yml` establishes a pre-release provenance path for the exact npm tarball produced from the hardening commit.

On pull requests, the workflow validates that the package can be built and packed with the frozen dependency graph. It does not request attestation/OIDC write permissions.

On a push to `v5-production-hardening` or an explicit workflow dispatch, a separate least-privilege job:

1. checks out the exact commit;
2. installs the frozen graph without dependency lifecycle scripts;
3. runs typecheck and build;
4. creates the exact `npm pack --ignore-scripts` tarball;
5. records its SHA-256;
6. generates a GitHub artifact attestation with the official pinned `actions/attest` action;
7. uploads the tarball plus checksum as a 30-day workflow artifact.

This workflow does **not** create a tag, npm publication, GitHub Release or deployment. A successful attestation is evidence for the required `release.provenance` gate, but Release Readiness still requires all other gates and separate authorization.

The release workflow keeps npm's own `npm publish --provenance` path for an eventually authorized tagged release. The pre-release attestation exists so provenance can be verified before publication rather than only after a tag is pushed.
