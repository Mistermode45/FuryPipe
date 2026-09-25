# FuryPipe upstream provenance

FuryPipe has historical roots in the open-source `pxpipe` repository and has since evolved into a broader governed AI workflow runtime.

This document records provenance. It is **not** the current product status page; use [README.md](README.md) and [CHANGELOG.md](CHANGELOG.md) for current public release information.

## Audited upstream baseline

- upstream repository: `https://github.com/teamchong/pxpipe.git`
- audited upstream branch: `main`
- audited upstream commit: `8ba82b713a1e823bc1c09b7a68e47f63caa7b426`
- original local fetch/audit date: **2026-09-11**
- FuryPipe repository: `https://github.com/Mistermode45/FuryPipe.git`

The audited upstream commit is preserved as a provenance reference. FuryPipe does not claim that later FuryPipe behavior, architecture or release evidence is provided by that upstream snapshot.

## FuryPipe divergence

FuryPipe extends the historical base with substantial FuryPipe-specific systems, including:

- FuryPipe package and CLI identity;
- ExactGuard;
- Recovery Store and recovery evidence;
- Context IR / Context Fabric;
- Capability Router;
- Instruction Fabric;
- Context Optimizer;
- Task Orchestrator;
- Agent Fabric / Agent Runtime;
- Continuous Memory / Long-Term Memory;
- provider fabrics, governed provider execution and streaming;
- modern MCP and hosted-conformance work;
- Control Room and Web Studio;
- release-readiness, security, provenance and supply-chain gates.

The authoritative current implementation is the FuryPipe repository, not the upstream pxpipe repository.

## Runtime independence

FuryPipe no longer consumes historical upstream runtime interfaces.

The current runtime:

- exposes only the `furypipe` CLI identity;
- consumes only `FURYPIPE_*` environment variables;
- uses FuryPipe-owned filesystem locations;
- uses the FuryPipe-specific default listener port;
- does not reuse an upstream process or runtime configuration.

Historical upstream names remain in provenance, licensing and immutable historical records only. They are not runtime compatibility paths.

See [COMPATIBILITY.md](COMPATIBILITY.md).

## License and attribution

The upstream MIT license and its existing copyright attribution remain preserved in [LICENSE](LICENSE).

Third-party and upstream obligations are tracked in:

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- [SOURCE_LEDGER.md](SOURCE_LEDGER.md)
- [SKILL_LICENSE_MATRIX.md](SKILL_LICENSE_MATRIX.md)

Preserving upstream attribution does not imply that upstream maintainers endorse FuryPipe, and FuryPipe does not claim ownership of third-party work.

## Release history

The earlier V5 hardening branch and PR history are retained in repository history and evidence documents. They should not be read as current lifecycle status.

Current public release status:

- FuryPipe `v0.15.0`: released **2026-09-16**
- npm `furypipe@0.15.0`: published
- GitHub Release `v0.15.0`: published
- FuryPipe `v0.16.0`: release candidate under preparation; not published
- production deployment: separate lifecycle state

Exact release details are recorded in [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md).
