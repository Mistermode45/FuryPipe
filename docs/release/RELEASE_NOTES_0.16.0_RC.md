# FuryPipe 0.16.0 — release notes draft

> Draft only. Do not publish this document from the RC branch.

## Source identity

- Version: 0.16.0
- Code-freeze baseline before documentation-only preparation: f292ec23d69cfe6cff89cc083e0a872a987e2995
- Final documentation head: record with git rev-parse HEAD after the documentation commit
- Package SHA-256: 9b2627e0d7e521a152610712bb03104983956e00c140154e86a94ea69f835cbc
- Package size: 5,577,127 bytes
- Release status: READY_FOR_RELEASE_DECISION, not released

## Highlights

- FuryPipe 0.16.0 packages the current task-first beta and governed runtime
  surfaces without granting execution authority from dashboard display data.
- The RC includes source-bound release evidence, clean-room package checks and
  explicit separation between local contracts and external live integrations.

## Task-first beta

- furypipe task --plan remains an explicit planning path.
- The package smoke verifies that planning does not silently select or execute
  a capability.
- Readiness is observation-only; a displayed state is not execution authority.

## Capability onboarding

- furypipe setup --lang=fr|en --yes --no-color provides a bounded,
  non-interactive setup path.
- furypipe doctor --json reports runtime, configuration and beta-readiness
  observations without printing provider credentials.
- Missing optional provider evidence remains visible as unavailable or
  degraded instead of being promoted to success.

## Gateway

- The local Gateway/WebChat surface is loopback-only by default.
- Default endpoints are http://127.0.0.1:48722 and
  http://127.0.0.1:48722/gateway/webchat/.
- Bootstrap is one-time and session-scoped; reconnect behavior is bounded.
- No remote Gateway exposure is claimed by this draft.

## Recovery

- Recovery/restart evidence covers durable state, unknown outcomes, bounded
  wake/recovery and cleanup behavior.
- Production crash durability and production deployment rollback are not
  claimed by this RC.

## Upgrade / rollback

- Local package lifecycle evidence verifies upgrade from 0.15.0 to 0.16.0.
- Configuration and user-owned data are preserved by the tested contract.
- Local package/config/binary rollback to 0.15.0 is verified.
- This does not constitute a production deployment rollback demonstration.

## Clean-room / self-host

- The installed tarball passes package-only clean-room checks across the hosted
  Ubuntu 24.04, macOS 14 and Windows 2025 matrix with Node 22, 24 and 26.
- Self-host loopback start, readiness, persistence and restart checks pass.

## MCP

- Local and hosted MCP contracts pass within their declared scope.
- No third-party remote MCP tools/call execution is claimed or performed.

## Provider architecture

- Provider policy, transport, authorization and execution remain separate.
- Provider contract/package checks pass.
- Provider live calls, provider-origin quality comparisons and provider
  performance claims were not executed.

## Browser / dashboard

- Dashboard cross-engine QA: 117/117.
- Web Studio cross-engine QA: 120/120.
- Gateway WebChat browser QA: 15/15.
- These are automated browser proofs. Human visual acceptance remains pending.
- No external Figma connectivity is claimed.

## Performance / FuryBench

- FuryBench passes the bounded offline comparison protocol with 25 iterations,
  5 warmups and 3 paired rounds.
- The protocol is intended to reduce Windows scheduler outlier sensitivity.
- No production, provider latency, quality or cost improvement claim is made
  from this offline benchmark.

## Security / SBOM

- Production dependency audit reports no known high-severity vulnerability in
  the verified scope.
- Hosted secret scan passes.
- Action pinning checks 93 references across 22 workflows.
- SPDX SBOM contains 235 packages and 18 direct dependencies.
- The RC tarball contains 614 entries and no detected secret, temporary or
  private-workspace entry.

## Breaking changes

- No additional breaking-change claim is made by this draft beyond the
  versioned 0.16.0 package contract.
- Do not rely on an implicit destructive migration. Upgrade from a known
  0.15.0 artifact and retain its digest until the new runtime is verified.

## Upgrade instructions

Before publication, use the tarball acceptance path in
[FINAL_HUMAN_ACCEPTANCE_0.16.0.md](../release-acceptance/FINAL_HUMAN_ACCEPTANCE_0.16.0.md).

After an authorized publication:

~~~text
npm install -g furypipe@0.16.0
furypipe --version
furypipe doctor --json
~~~

The post-publication checks in
[POST_PUBLISH_VERIFICATION_0.16.0.md](../release-acceptance/POST_PUBLISH_VERIFICATION_0.16.0.md)
remain mandatory.

## Known limitations

- Human visual review is pending.
- Screen-reader review is pending.
- Live provider, OIDC, remote MCP and external OpenClaw validations are
  optional for FuryPipe core and were not executed.
- GitHub provenance attestation for an eligible non-PR release event remains
  required before publication.
- Merge, tag, GitHub Release, npm publication, deploy and production rollback
  are not authorized or executed by this track.
