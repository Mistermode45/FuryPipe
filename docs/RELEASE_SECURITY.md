# FuryPipe release security and provenance

## Current public release

```text
PACKAGE:          furypipe@0.14.0
TAG:              v0.14.0
SOURCE COMMIT:    f05af8b4291371706240853d0bd1a35ffda1cba6
GITHUB RELEASE:   RELEASED
NPM PACKAGE:      PUBLISHED
NPM PROVENANCE:   VERIFIED
RELEASE WORKFLOW: 35013750389 / SUCCESS
PROD DEPLOYMENT:  NOT_CLAIMED
```

FuryPipe `v0.14.0` was publicly released on **2026-09-15**.

The tag targets the exact source commit above. The tag-triggered GitHub Actions release completed successfully, `furypipe@0.14.0` was published through npm Trusted Publishing with provenance, and GitHub Release `v0.14.0` exists as a non-draft, non-prerelease release.

Publication still does **not** imply production deployment, OAuth verification, Figma verification or provider-performance verification.

This document records release facts and their boundaries. It must not be used to promote unexecuted integration states to verified.

## Historical bootstrap record — v0.13.2

```text
PACKAGE:          furypipe@0.13.2
TAG:              v0.13.2
SOURCE COMMIT:    b01acfb79203b8de413f23efbd9041e9ae92988f
GITHUB RELEASE:   RELEASED
NPM PACKAGE:      PUBLISHED
PROD DEPLOYMENT:  NOT_CLAIMED
```

FuryPipe `v0.13.2` was publicly released on **2026-09-15**.

## Source binding

The release tag `v0.13.2` is an annotated tag whose target commit is exactly:

```text
b01acfb79203b8de413f23efbd9041e9ae92988f
```

The merge/default-branch commit after PR #2 was:

```text
0e73d338b717e722cb75f13ad2a029ce6a837be5
```

The candidate commit is an ancestor of that merge commit. Exact-SHA release evidence for the candidate must not be silently transferred to the merge commit.

## Release-readiness decision

The source-bound release-readiness evaluation satisfied the required release gates for the candidate commit and reached:

```text
READY_FOR_RELEASE_DECISION
```

That state authorized a release decision; it did not itself mean `PUBLISHED`.

## Candidate evidence

The candidate was validated through separate CI/security/release evidence, including:

- CI;
- CodeQL/static analysis;
- Secret Scan;
- Supply Chain;
- License Compliance;
- Benchmark Contract;
- Control Room security evidence;
- RC preparation;
- provenance attestation;
- hosted MCP conformance;
- hosted Web Studio conformance.

The release process preserves distinctions such as:

```text
wired != executed != verified
verified != released
released != deployed
```

## Package identity

The validated RC package was:

```text
name:    furypipe
version: 0.13.2
SHA-256: 48332b85030b25533b391436d80fc8ba582e990594fabad23131bef056802451
```

The first public npm publication used that validated tarball.

## First-publication bootstrap

The initial tag-triggered GitHub Actions release attempted npm Trusted Publishing before the package existed on npm.

That attempt failed with an npm `E404` during `npm publish`.

Because npm Trusted Publishing could not bootstrap a package that did not yet exist, the first `furypipe@0.13.2` publication was performed manually with the validated RC tarball and the maintainer's npm account.

After the first publication:

1. the npm Trusted Publisher was configured for repository `Mistermode45/FuryPipe`;
2. workflow file `release.yml` was bound to the publisher;
3. GitHub environment `release` was bound to the publisher;
4. the failed GitHub Actions jobs were rerun;
5. the workflow observed `furypipe@0.13.2 already published - skipping`;
6. the GitHub Release job completed successfully.

## npm provenance boundary for v0.13.2

Do **not** claim that the manual first npm publication of `0.13.2` itself carries npm Trusted Publishing provenance unless that exact registry statement is independently verified.

A separate pre-release provenance/attestation workflow existed for the validated candidate package, but:

```text
pre-release artifact attestation != npm publication provenance
```

Trusted Publishing is configured for subsequent automated npm publications.

## GitHub Release

GitHub Release `v0.13.2` exists and is:

- published;
- non-draft;
- non-prerelease.

The Release workflow completed successfully on rerun attempt 2.

## Hosted MCP scope

Hosted MCP conformance was verified for the exact release candidate.

That evidence does **not** imply that every OAuth Authorization Server path was executed.

OAuth Authorization Server status remains separate from hosted MCP transport/protocol conformance.

## Hosted Web Studio scope

Hosted Web Studio conformance was verified for the candidate release.

That evidence does **not** automatically verify:

- external Figma connectivity;
- production field performance;
- production deployment.

Those states remain separate until directly evidenced.

## Provider benchmark scope

No provider performance claim is implied merely by the Benchmark Contract workflow.

When `performanceClaims=false`, absence of a provider benchmark can be non-blocking for release while still remaining `NOT_EXECUTED`.

## Production deployment

Publishing `furypipe@0.13.2` and creating GitHub Release `v0.13.2` does not by itself prove a production deployment.

Deployment evidence must identify its own target, source commit, environment and verification.

## Release workflow security controls

The tag-triggered release workflow is designed to preserve:

- concurrency per release ref;
- pinned/reviewed GitHub Actions;
- `persist-credentials: false`;
- full history for ancestry validation;
- tag/package-version equality;
- tagged commit reachability from the default branch;
- frozen dependency installation with lifecycle scripts disabled before privileged publish;
- least-privilege GitHub permissions;
- npm Trusted Publishing/OIDC;
- a reviewed npm publishing client;
- provenance-enabled automated npm publication;
- GitHub Release creation isolated from the npm publish job.

Future changes must not weaken these controls merely to make a release pass.

## Current lifecycle summary

```text
v0.13.2 source candidate   VERIFIED
v0.13.2 tag                VERIFIED
npm furypipe@0.13.2        PUBLISHED
GitHub Release v0.13.2     RELEASED
Trusted Publisher          CONFIGURED
npm provenance for manual
first publication          NOT_CLAIMED
OAuth Authorization Server NOT_EXECUTED / separate scope
external Figma             NOT_EXECUTED / separate scope
provider perf benchmark    NOT_EXECUTED when not required
production deployment      NOT_CLAIMED
```
