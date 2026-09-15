# FuryPipe V5 — Final Local Hardening

Date: 2026-09-14
Branch: `v5-codex-final-local-hardening`
Base: `v5-production-hardening` at `8299f74439bf74a208431e2106b6ff5c9781ed93`

This document records the local hardening wave and its evidence boundaries. A
locally passing test does not prove hosted services, real providers, a live
OpenClaw Gateway, external MCP/OAuth, Figma/Playwright, release authorization,
or production deployment.

## Track results

| Track | Local result | Remaining boundary |
| --- | --- | --- |
| A — Context IR / Unicode | Bounded document compilation to 16 MiB and Instruction Ledger to 4,096 entries / 8 MiB total text (256 KiB per entry); hardened ExactGuard sticky-regex validation and special-key handling; deterministic Unicode/document properties are covered by the seeded property suite. | The test generator is bounded and seeded; this is not exhaustive Unicode fuzzing. |
| B — Recovery | Rekey now enforces namespace and global encrypted-byte quotas before writing. Existing tests exercise separate Node processes, interruption residue, locks, backup/restore, encryption and quotas. | Simulated process termination is not hardware/power-loss durability proof; filesystem durability remains `PARTIAL`. |
| C — Policy / retrieval | Invalid routing-cost records fail closed; retrieval snapshots handles before awaits and enforces a bounded index; rekey/retrieval regressions have targeted tests. | No hosted retrieval or provider-health evidence is inferred. |
| D — Provider fabric | Transport health is bound to immutable process-local execution timestamps; callers cannot re-age old transport results. Retry/fallback tests verify each attempt is rebuilt from model-neutral BASE. | No real provider credential, account, billing, or business outcome was tested. |
| E — OpenClaw | A healthy-looking response on a non-2xx status or non-JSON content type no longer counts as healthy; redirects are denied, health bodies are capped at 64 KiB, and config inspection at 1 MiB. | Real Gateway probe: `BLOCKED_EXTERNAL_ENV`. |
| F — Agent Fabric | Resume validates persisted sequence/token history and exact snapshot shape; one-time atomic start/resume claims prevent duplicate progress; concurrent MCP calls share an in-flight promise. | Durable Recovery/process tests are local evidence, not a multi-host/distributed service guarantee. |
| G — FuryPrompt | Structured values are JSON-serialized and delimiter-escaped so content cannot forge structural sections. | Semantic prompt injection is not prevented by escaping; no tool is executed implicitly. |
| H — Learning / memory | Prototype-sensitive topic lookup uses own-property checks; long-term-memory scans fail closed at their 10,000-object bound rather than silently truncating latest/history/purge. | Semantic RAG/embeddings are not implemented or claimed. |
| I — Release readiness | Schema v2 requires the 17 canonical base gates, with provider benchmarks as a conditional eighteenth required gate for performance claims; verified gates/artifacts bind to source SHA, timestamp, allowed origin and bounded reference; newest workflow run wins; Control Room rejects omitted, contradictory, future, duplicate, or malformed provenance. Authorization remains separate and release actions remain disabled. | External references are caller-supplied locators and are not independently authenticated by the evaluator. |

## Validation record

Final local command results, final commit SHA, GitHub run IDs, per-job matrix
results, and the Draft PR URL are maintained in
[`FINAL_LOCAL_HARDENING_WORKLOG.md`](FINAL_LOCAL_HARDENING_WORKLOG.md).

Required local gates are frozen install, dependency audit, typecheck, the full
test suite, build, and package smoke. The nine-job Ubuntu/macOS/Windows ×
Node 22/24/26 matrix and security workflows must be inspected on this branch's
exact final SHA before they can be recorded as remotely verified. A base-branch
green run is not evidence for a later branch SHA.

No merge, tag, GitHub Release, npm publish, or production deployment is part of
this work.
