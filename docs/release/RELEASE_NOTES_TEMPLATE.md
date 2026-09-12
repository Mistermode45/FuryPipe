# FuryPipe <VERSION> — release notes template

> This template must be filled from verified evidence for the exact release commit. Remove sections that are not applicable; do not replace missing evidence with estimates.

## Source identity

- Version: `<VERSION>`
- Commit: `<40-char SHA>`
- Package SHA-256: `<64-char SHA-256>`
- Release Readiness: `<BLOCKED | READY_FOR_RELEASE_DECISION>`

## Highlights

- <verified user-facing change>
- <verified user-facing change>

## Compatibility

- Node: <verified versions>
- OS: <verified platforms>
- MCP: <verified protocol/transports>
- Upgrade notes: see `docs/release/MIGRATION_V5.md`

## Security / supply chain evidence

- CI: <run/evidence>
- CodeQL: <run/evidence>
- Secret Scan: <run/evidence>
- Supply Chain / SBOM: <run/evidence>
- License Compliance: <run/evidence>
- Provenance/attestation: <evidence>

## Benchmarks

Provider benchmark status: `<BENCHMARK_NON_EXECUTED | VERIFIED>`

If provider benchmarks are not verified, state that plainly and include **no performance, speed, quality or cost-improvement claim** derived from unexecuted comparisons.

## Known limitations / external blockers

- <BLOCKED_EXTERNAL_ENV / BLOCKED_BY_REPO_SETTING / PARTIAL items>
- <external validation not executed>

## Rollback

See `docs/release/ROLLBACK.md`.

## Authorization record

Technical readiness does not authorize release actions.

- Default/final branch merge authorized: <yes/no>
- Tag creation authorized: <yes/no>
- npm publish authorized: <yes/no>
- Production deploy authorized: <yes/no>

The automated evidence path must never fill these as “yes” by inference.