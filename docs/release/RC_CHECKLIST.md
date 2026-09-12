# FuryPipe V5 — RC checklist

This checklist prepares a release candidate decision. It does not authorize or execute a release.

## Identity

Before collecting evidence, pin all of the following to the same candidate:

- exact 40-character source commit SHA;
- package version from `package.json`;
- release channel (`rc` before `stable`);
- Release Readiness report generated for that exact SHA/version.

A report from another commit or package version is stale evidence.

## Required technical evidence

The RC evidence snapshot remains `BLOCKED` until all required preparation evidence is verified:

- CI matrix completed successfully;
- CodeQL completed successfully;
- Secret Scan completed successfully;
- Supply Chain / SBOM completed successfully;
- License Compliance completed successfully;
- Benchmark Contract completed successfully;
- package smoke verified;
- installation smoke verified from the packed artifact;
- upgrade smoke verified when an earlier supported install exists;
- rollback procedure evidenced;
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