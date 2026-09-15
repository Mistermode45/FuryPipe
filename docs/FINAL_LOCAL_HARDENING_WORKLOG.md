# FuryPipe V5 — Final Local Hardening Worklog

Status: in progress until final branch CI and Draft PR are verified.
Date: 2026-09-14
Repository: `Mistermode45/FuryPipe`
Branch: `v5-codex-final-local-hardening`
Base branch/SHA: `v5-production-hardening` / `8299f74439bf74a208431e2106b6ff5c9781ed93`

## Baseline and architecture observed

- The dedicated branch began clean at the exact production-hardening base SHA above.
- Node.js `v26.8.2`; pnpm `10.21.0`.
- FuryPipe already has bounded Context IR/document compilation, Recovery-backed persistence, governed provider-attempt/retry layers, an Agent Fabric runtime, FuryPrompt compilation, Learning/Long-Term Memory, Control Room, and Release Readiness/RC evidence evaluators.
- Existing Recovery tests use real child Node processes for process-level serialization/crash-residue checks; the hardening wave retained that architecture.
- Reserved i18n/dashboard, PR #123/#124, Control Room security exporter, MCP observability, `TASKS.md`, and `WORKLOG.md` paths were left untouched.
- No credentials or secrets were added to this worklog.

## Defects, causes, and corrections

| Track | Root cause | Correction and regression proof |
| --- | --- | --- |
| A | ExactGuard accepted sticky global regexes that `matchAll` cannot use as intended; ledger scope storage used an ordinary object vulnerable to special property names and had no entry/text bounds; document compilation had no total input bound. | Reject sticky `y`; use a `Map` and explicit object materialization; cap ledger entry count and text bytes and document UTF-8 input at 16 MiB; targeted regressions cover these boundaries. |
| B | Rekey checked the plaintext object quota but could write a larger encrypted variant beyond namespace/global quotas. | Measure encrypted bytes and enforce both quotas before non-overwriting write; quota regression verifies no encrypted replacement appears and original plaintext remains. |
| C | Malformed/non-finite/negative policy costs could affect guarded routing; retrieval could exceed its intended handle bound and iterate a live collection over awaits. | Validate the exact cost record; reserve bounded adds and snapshot handles before awaits; tests cover malformed costs and in-flight additions. |
| D | A caller-supplied timestamp could make an old transport result look fresh; exact expiry was not considered expired. | Capture process-local start/finish times in the governed execution result, bind assessment to those values, require exact timing consistency, and expire at `now >= expiresAt`. |
| E | OpenClaw's probe validated response bodies without requiring an HTTP-success response, accepted JSON-shaped data on any content type, read health bodies without a bound, and parsed config without a size bound. | Require a successful status, JSON media type and contract-valid payload; redirects are denied, health bodies are capped at 64 KiB and config inspection at 1 MiB. |
| F | Snapshot fields and token usage could be forged or replayed; concurrent identical MCP calls could duplicate effects; independent memory adapters could race on start/resume. | Persist ordered stage sequence and consumed-token accounting, verify exact history against snapshots, atomically claim each start/handoff identity, and share in-flight MCP promises. |
| G | Structured values were interpolated in a way that could forge prompt section boundaries. | JSON-serialize structured values and escape delimiter characters; preserve `TRIVIAL` verbatim and explicitly avoid claiming semantic injection resistance. |
| H | `in` accepted inherited object properties as learned topics; fixed-size history scans silently omitted revisions from latest/purge. | Use own-property lookup; scan up to a hard 10,000-record bound and fail closed at saturation while keeping public history pages capped at 512. |
| I | `VERIFIED` state could lack source-bound provenance; required V5 gates could be omitted/relabelled; old successful runs or contradictory report counts/status could be promoted; future RC reports and malformed Control Room provenance were insufficiently constrained. | Require the 17-gate canonical base set, track the conditional eighteenth provider-benchmark gate for performance claims, enforce exact required-gate evidence/blocker coverage, add release/RC evidence v2 with SHA/timestamp/origin/reference checks, latest-run selection, artifact digest binding, bounded metadata, and deny-all authorization fallback for malformed RC authorization. |

## Commands and evidence

### Branch-start evidence

- `git status --short`: clean before this work.
- `git branch --show-current`: `v5-codex-final-local-hardening`.
- `git rev-parse HEAD`: `8299f74439bf74a208431e2106b6ff5c9781ed93`.

### Targeted local verification

- `pnpm run typecheck` — PASS after the Agent/provider/policy/retrieval changes.
- `pnpm exec vitest run tests/agent-runtime.test.ts tests/provider-transport-health.test.ts tests/provider-runtime.test.ts tests/policy-engine.test.ts tests/source-retrieval.test.ts tests/exact-guard.test.ts tests/context-fabric.test.ts tests/recovery-store.test.ts tests/openclaw-probe.test.ts` — PASS, 9 files / 83 tests.
- `pnpm exec vitest run tests/agent-runtime.test.ts tests/fury-prompt.test.ts tests/long-term-memory.test.ts tests/control-room-evidence-file.test.ts tests/control-room.test.ts tests/release-readiness.test.ts tests/release-evidence.test.ts` — PASS, 7 files / 70 tests.
- `pnpm run typecheck` — PASS after Release Readiness/Control Room changes.
- `pnpm exec vitest run tests/release-readiness.test.ts tests/release-evidence.test.ts tests/control-room-evidence-file.test.ts tests/control-room.test.ts` — PASS, 4 files / 38 tests, including future-report, duplicate-provenance, malformed-authorization and oversized-reference cases.
- `pnpm exec vitest run tests/provider-execution-gate.test.ts tests/governed-provider-executor.test.ts tests/provider-transport-conformance.test.ts` — PASS, 3 files / 52 tests; permits at the exact TTL boundary are now expired, and transport fixtures supply still-fresh health evidence.
- `pnpm exec vitest run tests/openclaw-probe.test.ts` — PASS, 1 file / 9 tests after response content-type and redirect assertions were added.
- `pnpm exec vitest run tests/openclaw-adapter.test.ts tests/openclaw-probe.test.ts` — PASS, 2 files / 13 tests, including the 1 MiB config bound.
- `pnpm exec vitest run tests/document-compiler.test.ts tests/context-ir-property.test.ts` — PASS, 2 files / 11 tests, including the 16 MiB document bound and a seed printed in the property-test name.
- `pnpm exec vitest run tests/agent-runtime.test.ts` — PASS, 1 file / 16 tests, including in-memory record/claim saturation.
- `pnpm exec vitest run tests/provider-runtime.test.ts` — PASS, 1 file / 12 tests, including exact-key replacement at the 10,000-entry price-table cap.
- `pnpm exec vitest run tests/context-fabric.test.ts` — PASS, 1 file / 8 tests, including ledger entry/text bounds.
- `pnpm exec vitest run tests/release-readiness.test.ts tests/release-evidence.test.ts tests/control-room-evidence-file.test.ts tests/control-room.test.ts` — PASS, 4 files / 39 tests after canonical gate-set enforcement.
- The same release/Control Room suite — PASS, 4 files / 49 tests after explicit GitHub Actions workflow-origin/reference validation, conditional benchmark-gate handling, exact required-gate coverage, and origin/overlap regressions. The first run exposed that the duplicate-run fixture failed earlier on the new required reference; the fixture now supplies valid provenance so the duplicate-ID assertion reaches its intended branch. Hardening also corrected older incomplete parser fixtures to enumerate each required gate as verified or blocked.
- `pnpm exec vitest run tests/openclaw-adapter.test.ts tests/openclaw-probe.test.ts` — PASS, 2 files / 14 tests after bounded health-response parsing.
- `pnpm run typecheck` — PASS after the latest provider, OpenClaw, Instruction Ledger and release changes.
- An earlier focused run exposed test-fixture assumptions after provenance became mandatory and one mocked Recovery reference error; fixtures were corrected, and the final focused suites passed. No production gate was weakened or skipped.
- First full-suite attempt: 12 provider transport conformance tests failed because test health evidence expired at the exact boundary; the review also found permits remained usable at `expiresAt`. Fixtures were given valid fresh health evidence, the production expiry check now rejects at `now >= expiresAt`, and a subsequent run passed 166 files / 2,015 tests. Additional hardening tests were added afterward; their superseding final result is recorded below.
- Final `pnpm test` — PASS, 166 files / 2,033 tests after all source/test changes.
- Final `git diff --check` — PASS; Git emitted only its LF-to-CRLF advisory for modified files.

### Required final local gates

| Gate | Status | Exact result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | `PASS` | Lockfile unchanged; already up to date under pnpm 10.21.0. |
| `pnpm audit` | `PASS` | No known vulnerabilities reported. |
| `pnpm run typecheck` | `PASS` | `tsc --noEmit` completed with exit code 0. |
| `pnpm test` | `PASS` | 166 test files / 2,033 tests passed; no failed suites or tests. |
| `pnpm run build` | `PASS` | Library modules/declarations, Node and MCP builds emitted; `--version` smoke reported 0.13.2. |
| `pnpm run package:smoke` | `PASS` | Package, benchmark-claim, provider-attempt, and governed-provider package smoke checks passed. |
| `git diff --check` | `PASS` | No whitespace errors; only LF-to-CRLF advisory output. |

All required local gates above were run on 2026-09-14 after the final
source/test changes in this working tree. Reserved paths remained unchanged.
These results are local evidence only; branch-specific hosted workflows have
not yet run.

## GitHub evidence and external boundaries

The base SHA had previously observed successful CI/security runs (CI run
`34779353350`, Supply Chain `34779351012`, CodeQL `34779350997`, License
Compliance `34779351018`, Provenance `34779351013`, Secret Scan `34779353337`,
Benchmark Contract `34779353336`). These are **base-only historical evidence**
and do not verify this branch's final commit. Branch-final run IDs and individual
job results remain `NOT_EXECUTED` until fetched after push.

The real OpenClaw Gateway, authenticated provider/business outcomes, hosted MCP
and OAuth, Figma/Playwright, filesystem power-loss durability, maintainer release
approval, and production deployment remain `BLOCKED_EXTERNAL_ENV` or
`NOT_EXECUTED`, as applicable. No external result is inferred from local tests.

## Final handoff fields

- Final HEAD: `PENDING`
- Branch remote HEAD: `PENDING`
- Draft PR (base `v5-production-hardening`): `PENDING`
- Final nine-job matrix (exact SHA): `PENDING`
- Final security gate/job results: `PENDING`
- Merged / tag / npm publish / release / deploy: **NO**
