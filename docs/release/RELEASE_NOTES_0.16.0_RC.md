# FuryPipe 0.16.0 — release notes draft

> Draft only. Do not publish this document from the RC branch.

## Source identity

- Version: 0.16.0 (not published; npm `latest` is 0.15.0)
- Gateway hotfix code commit: 6ac1e62948a2ef8ccc189fe275671c223670b5f8
- Installed Gateway -> MCP stdio end-to-end regression: b689873609270faa5368cb0cf3deb8fe2960eb1e
- Cross-OS package identity fixes: c7b4248 (`.gitattributes` eol=lf + CI content
  digest), 6d0926a (bin/cli.js mode 644), f41aa95 (fail closed on non-644 modes)
- Package-content source commit: f41aa957619a0d4b468f81a5d627b4980f783ac1
- Canonical RC tarball: RC Preparation Evidence job on that commit
  (ubuntu-24.04, Node 24.21.0) — SHA-256 99feb17fc8747e9b5de8a5cf23f58536a5a348d66242bfb62690703a7bbdf08a, 5,404,064 bytes
- Cross-OS content digest: 30108a5fa50a23245d1e21b7d528311e0d2d624b30f68314a8724fe9a47af052
- Reproducibility proof on f41aa95: all 9 CI legs (ubuntu-24.04, macos-14,
  windows-2025 x Node 22.23.2/24.21.0/26.8.2; npm 10.9.8, 11.19.0, 11.19.1)
  and RC Preparation report the same tarball SHA-256 and content digest,
  614 files, all mode 644, zero CR bytes.
- Superseded digests: 9b2627… (pre-Gateway-hotfix), 7d26a8… (Windows CRLF
  checkout of the hotfix head), b6a651… / a60919… (intermediate heads before
  the line-ending, file-mode and reason-validator fixes). None of them is the current candidate.
- Later documentation/evidence-only commits touch no packaged file; the RC
  Preparation job on the final head must report the same tarball SHA-256,
  otherwise the candidate is re-identified from that head.
- Published npm integrity: recorded only after an authorized publish.
- Release status: READY_FOR_RELEASE_DECISION, not released

## Highlights

- FuryPipe 0.16.0 packages the current task-first beta and governed runtime
  surfaces without granting execution authority from dashboard display data.
- The RC includes source-bound release evidence, clean-room package checks and
  explicit separation between local contracts and external live integrations.
- The P1 installed-package Gateway regression is closed: the ESM build keeps
  the CommonJS MCP stdio/WebSocket boundaries external, loads those runtimes
  lazily, and resolves them from declared package dependencies.
- The installed tarball regression passes Gateway readiness, loopback,
  graceful shutdown, MCP stdio connect, tools/list and shutdown, and now also
  drives the bundled CLI Gateway through an authenticated WebSocket
  `tools.source.inspect.stdio` against a local MCP stdio child — the exact
  path that crashed — on Linux, macOS and Windows with Node 22/24/26.
- The npm tarball no longer depends on the build OS: every text file is
  checked out LF, every packed file is mode 644 (npm marks bins executable
  at install), and CI fails on any CR byte or non-644 mode. All nine CI legs
  (Linux/macOS/Windows x Node 22/24/26) report the same content digest.
- Automation definition reasons reject control characters through an escaped
  character class instead of raw control bytes in the source.

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
- The installed-package MCP stdio fixture passes connect, tools/list and
  shutdown without a provider or network call.
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
- The package digest above is the post-hotfix candidate digest; the prior
  pre-hotfix digest is obsolete and must not be used for acceptance.

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
