# FuryPipe V5 — rollback plan

## Before publication

Before a public tag/npm release, rollback means reverting or excluding the technical change from the hardening/integration branch and rerunning the full gates. No package registry action is required.

Do not rewrite shared history or force-push the hardening branch to hide a bad change.

## After an npm release

npm package versions are treated as immutable release artifacts. A faulty published version should normally be superseded by a corrective version after the same release gates, rather than silently replacing bytes under an existing version.

Any exceptional registry removal must follow registry policy and requires explicit maintainer authorization.

## GitHub release/tag

Do not move or recreate a published release tag to point at different source. If a release is defective:

1. mark/document the release problem;
2. prepare a corrective commit/version;
3. rerun Release Readiness and RC evidence;
4. publish only after separate authorization.

## Runtime/deployment rollback

A future production deployment must record the previously deployed artifact digest and deployment identifier before promotion. Rollback evidence is not `VERIFIED` until the deployment mechanism has actually demonstrated restoration to that known artifact.

FuryPipe currently must not claim production rollback validation when no production deployment environment was exercised.

## Recovery Store compatibility

Recovery uses versioned handles/manifests and optional AES-256-GCM storage metadata. Before a release that changes Recovery on-disk semantics:

- prove old supported data is readable or provide an explicit migration;
- keep migrations fail-closed;
- never overwrite an orphan/unknown object to “repair” it;
- keep key material host-owned;
- test restore from a verified backup.

A source-code rollback is not a substitute for data compatibility evidence.