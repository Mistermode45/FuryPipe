# FuryPipe V5 — RC checklist

This checklist prepares a release candidate decision. It does not authorize or execute a release.

## Identity

Before collecting evidence, pin all of the following to the same candidate:

- exact 40-character source commit SHA;
- package version from `package.json`;
- release channel (`rc` before `stable`);
- Release Readiness report generated for that exact SHA/version.

A report from another commit or package version is stale evidence.

## Automated non-destructive preparation

The workflow `.github/workflows/rc-preparation.yml` builds the exact candidate without
tagging or publishing it. It emits a source-bound RC preparation artifact containing the
npm tarball and SHA-256, a fresh-install smoke, SPDX 2.3 SBOM, document digests and a
claim-free RC notes draft.

When a previous stable public version of the same FuryPipe repository exists, the workflow
also performs a package-level upgrade to the candidate and a package-level rollback to the
previous version. This proves package-manager reversibility only. It is never promoted to
production deployment rollback evidence.

If the canonical public npm registry is reachable and proves that FuryPipe has no earlier
stable public version, the preparation evidence records
`FIRST_PUBLICATION_VERIFIED`. In that specific case, package upgrade and package-level
rollback stay `NOT_EXECUTED` by design and do not block the release decision. A registry
lookup failure remains `NOT_EXECUTED` and blocking; it must never be reinterpreted as proof
of first publication. A repository-provenance mismatch remains `BLOCKED`.

The pull-request preparation workflow deliberately leaves release provenance `PARTIAL`:
the separate Provenance Attestation workflow validates the pack path on PRs, while signed
artifact attestation requires its eligible non-PR execution path.

## Required technical evidence

The RC evidence snapshot remains `BLOCKED` until all required preparation evidence is verified:

- CI matrix completed successfully;
- CodeQL completed successfully;
- Secret Scan completed successfully;
- Supply Chain / SBOM completed successfully;
- Supply Chain sub-jobs are inspected individually; GitHub Dependency Review `SKIPPED` is not a verified review;
- License Compliance completed successfully;
- Benchmark Contract completed successfully;
- Dashboard Browser QA completed successfully for its declared Chromium scope;
- Web Studio Browser QA completed successfully for its declared Chromium scope when Web Studio is in release scope;
- Cross-Browser QA completed successfully for its declared Chromium/Firefox/WebKit scope when browser parity is in release scope;
- repository integration/release branch policy verified from GitHub-origin evidence;
- package smoke verified;
- installation smoke verified from the packed artifact;
- public npm publication baseline verified from the canonical registry;
- upgrade smoke verified when an earlier supported install exists, otherwise left `NOT_EXECUTED` only with `FIRST_PUBLICATION_VERIFIED`;
- package-level rollback verified when an earlier supported install exists, otherwise left `NOT_EXECUTED` only with `FIRST_PUBLICATION_VERIFIED`;
- rollback procedure documented for operational recovery;
- SBOM produced;
- provenance path verified;
- compatibility matrix current;
- migration notes current;
- release notes current;
- SHA-256 of the exact package artifact recorded.

Provider benchmarks are not silently required when no performance claim is made, but their absence must remain explicit and release notes must contain no unverified performance claim.

## Blockers that must remain honest

Use the project status vocabulary. In particular:

- external credentials/infrastructure unavailable: `BLOCKED_EXTERNAL_ENV`;
- repository feature unavailable: `BLOCKED_BY_REPO_SETTING`;
- provider benchmark not run: `BENCHMARK_NON_EXECUTED`;
- incomplete runtime proof: `PARTIAL`;
- no execution: `NOT_EXECUTED`.

Do not convert these states into `VERIFIED`.

## Separate maintainer authorization

Even if all technical preparation is green and the report says `READY_FOR_RELEASE_DECISION`, the following remain separate maintainer decisions:

- merge to the final/default release branch;
- create a release tag;
- publish to npm;
- create a public GitHub release;
- deploy production.

The RC evaluator and RC evidence snapshot must report `releaseActionsExecuted: false`.
