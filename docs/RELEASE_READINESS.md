# FuryPipe V5 Release Readiness

## Status

`EVALUATOR_IMPLEMENTED_RELEASE_BLOCKED`

This module evaluates release evidence. It does **not** merge branches, create tags, publish npm packages, create GitHub releases, rotate credentials or deploy production.

The fail-closed provenance contract is `furypipe-release-readiness/v2`. A
`VERIFIED` gate without a reference, allowed evidence origin, exact matching
source SHA, and an observation no later than the report is a blocker (or an
advisory warning for optional gates). References are caller-supplied locators;
the evaluator validates their shape and binding but does not authenticate the
external record itself. MCP and Web/Figma Studio require hosted evidence;
provider benchmarks require provider-origin evidence; GitHub CI/security and
branch policy require their corresponding GitHub origins.

The evaluator also requires the complete canonical V5 gate identity set and
fixed required/optional classification from `createV5ReleaseGates()`. Omitting
an external gate or relabeling a required gate as optional cannot produce a
green technical report. The v2 report persists the boolean `performanceClaims`
policy itself: consumers require exactly 17 canonical gates when it is false
and the conditional provider benchmark as the 18th required gate when it is
true. A report whose claim policy and required-gate count disagree is rejected.

Release authorization is an exact four-field runtime contract
(`mergeDefaultBranch`, `createReleaseTag`, `publishNpm`,
`deployProduction`). Unknown keys are rejected rather than copied into
Control Room or RC evidence.

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

`createRcEvidenceSnapshot()` emits `furypipe-rc-evidence/v2` and requires the
RC source SHA and package version to match the Release Readiness report. Each
workflow observation carries its head SHA and update timestamp; the latest run
ID for each required workflow — CI, CodeQL, Secret Scan, Supply Chain, License
Compliance, Provenance Attestation and Benchmark Contract — must be successful
on the exact RC SHA, so an older green run cannot mask a newer
skipped/failing/mixed-SHA run. Every
workflow record also requires an explicit `github-actions` origin and a
bounded Actions run reference; these fields locate caller-supplied evidence but
do not independently authenticate it. Every
`VERIFIED` preparation artifact, including package/install/upgrade/rollback
smokes, SBOM, provenance, compatibility, migration notes, release notes and
the exact package SHA-256, requires a source-bound evidence reference and an
origin appropriate to that artifact. These references are validated metadata,
not cryptographic authentication of the referenced system.

The RC snapshot can return `READY_FOR_RELEASE_DECISION`, but it copies authorization separately and always returns `releaseActionsExecuted: false`.
Validated workflow/artifact evidence is canonicalized to known schema fields
before entering the snapshot. Unknown runtime fields are discarded, and
artifact proofs are copied and deeply frozen, so caller-owned mutation or
schema smuggling cannot rewrite or expand the recorded evidence.

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
