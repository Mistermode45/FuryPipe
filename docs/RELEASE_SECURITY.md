# Release security / provenance audit

## Status

`RELEASE_NOT_AUTHORIZED`

No release, npm publication, tag creation, production deployment or merge is performed by this track.

## Existing release workflow

The existing shared workflow `.github/workflows/release.yml` already contains useful controls:

- tag-triggered release only (`v*`);
- concurrency per release ref;
- checkout pinned by full commit SHA;
- `persist-credentials: false`;
- full history for ancestry verification;
- production Node baseline `24.21.0`;
- package/tag version equality check;
- tagged commit must be reachable from the repository default branch;
- install with `--frozen-lockfile --ignore-scripts` before privileged publish;
- npm Trusted Publisher / OIDC design;
- `id-token: write` only on the npm publish job;
- pinned npm publishing client;
- `npm publish --provenance`;
- GitHub Release creation isolated in a second job.

Current evidence status:

- npm provenance configuration: `CONFIGURED_NOT_EXECUTED`;
- npm Trusted Publisher: `NOT_VERIFIED_BY_THIS_TRACK`;
- GitHub Release path: `CONFIGURED_NOT_EXECUTED`;
- stable release: `NOT_AUTHORIZED`.

## GitHub repository rules

Repository rulesets endpoint currently returns an empty list:

`RULESETS_NONE_OBSERVED`

Branch-protection detail could not be read by the connected GitHub integration because that endpoint returned `403 Resource not accessible by integration`.

Therefore branch protection status is:

`BRANCH_PROTECTION_NOT_VERIFIED`

Do not convert that status to disabled or enabled without an account-level/admin verification.

## Missing / deferred release gates

### GitHub artifact attestations

No separate GitHub artifact attestation workflow is added in this parallel track.

Reason:

- `.github/workflows/release.yml` is a shared critical file;
- release integration is reserved until the runtime branch and final release policy are reconciled;
- no release is currently authorized.

Status:

`ATTESTATION_DEFERRED_TO_RELEASE_INTEGRATION`

### Branch policy

Before a release candidate:

1. finalize the default/integration/release branch model;
2. configure required checks/rulesets or branch protection;
3. require current CI/security checks;
4. disallow direct release-branch pushes where appropriate;
5. verify release environment approvals;
6. verify npm Trusted Publisher configuration;
7. verify provenance on a non-stable release candidate if policy allows;
8. record exact workflow/action SHAs.

## Required M19 evidence

A future release candidate must record:

- source commit SHA;
- tag;
- CI matrix run IDs;
- CodeQL run;
- secret-scan run;
- dependency audit;
- SBOM digest/artifact;
- benchmark evidence;
- license/provenance review;
- package tarball digest;
- npm provenance/attestation evidence;
- compatibility matrix;
- approval for publication.

Until those gates are actually executed, FuryPipe remains development software rather than `RELEASE_READY`.
