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
