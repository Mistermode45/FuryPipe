# Control Room V5

## Status

`DASHBOARD_WIRED_LIVE_RECEIPT_PROVIDER_OPT_IN`

The Control Room V5 kernel provides a fail-visible metadata snapshot for FuryPipe V5 and is wired into the loopback dashboard through:

- `GET /api/control-room.json`;
- `GET /fragments/control-room`;
- the server-rendered Control Room panel.

The Node host wires the Control Room provider only when an exact `FURYPIPE_SOURCE_COMMIT` is supplied. Without that build identity the panel remains `NOT_AVAILABLE`. The dashboard never infers green states from implementation presence or unrelated counters.

## Evidence sections

The snapshot covers:

- receipts / ExactGuard;
- Recovery and `BACKUP_EXISTS` vs `RESTORE_VERIFIED`;
- Agent runtime;
- Human/Agent Learning;
- MCP transport/auth/conformance;
- i18n runtime/wiring;
- Web/Figma Studio;
- security/supply-chain;
- benchmark harness/provider-run distinction;
- M19 Release Readiness.

Release Readiness is bound to the exact Control Room `sourceCommit`. Evidence from another commit is rejected as stale.

The release section shows:

- technical state: `NOT_AVAILABLE`, `BLOCKED` or `READY_FOR_RELEASE_DECISION`;
- verified required gates / total required gates;
- blocker count;
- warning count;
- number of separately authorized release actions;
- `releaseActionsExecuted: false`.

`READY_FOR_RELEASE_DECISION` is not a release authorization and does not cause merge, tag, npm publish, GitHub Release creation or deployment.

## Status semantics

- `VERIFIED`: evidence exists and the gate is verified;
- `PARTIAL`: implementation/evidence exists but is incomplete;
- `NOT_EXECUTED`: validation has not run;
- `NOT_AVAILABLE`: no current evidence provider/report exists;
- `BLOCKED`: a required or external blocker prevents completion.

The dashboard must display these states as-is.

## Host integration boundary

The existing dashboard accepts an optional Control Room provider. The next host-level integration must build the snapshot from bounded runtime evidence; it must not inspect or expose raw secrets, prompts or recovered object plaintext.

Until that provider is configured, `/api/control-room.json` correctly returns `503 {"status":"NOT_AVAILABLE"}`.

## Security

The Control Room model is metadata-only. It must never become a channel for:

- API keys, bearer tokens or OAuth codes;
- prompt or agent-objective plaintext;
- recovered object plaintext;
- learner identifiers;
- secret values;
- raw protected ExactGuard spans.

Counts, statuses, digests, commit IDs and bounded evidence metadata are permitted.


## Node runtime evidence provider

The Node host now wires `src/control-room/runtime.ts` when `FURYPIPE_SOURCE_COMMIT` contains the exact lowercase 40-character source SHA for the running build.

When enabled:

- `transformRequest` emits plaintext-free compression receipts for the proxy path;
- each raw `ProxyEvent` is observed before tracker reduction;
- Control Room reports real receipt totals, verified receipt totals, protected-span counts and Recovery-handle counts;
- Recovery handles are deduplicated for the observed-object count;
- request plaintext, image source text and model output are not retained by the collector.

Subsystems not observed by the Node proxy remain `NOT_AVAILABLE` / `NOT_EXECUTED`. The runtime collector supports explicit host evidence overrides, but it never converts implementation presence into runtime verification by itself.

If `FURYPIPE_SOURCE_COMMIT` is absent or malformed, the dashboard keeps the previous `503 NOT_AVAILABLE` behavior. This is intentional: evidence without exact build identity is not trustworthy enough for release decisions.

Recovery encryption is represented as `unknown` when the collector sees Recovery handles but does not own the backing Recovery configuration.


## Agent and Learning runtime observations

The live collector can now ingest the metadata-only outputs already returned by FuryPipe runtime APIs:

- `observeAgentRun(result)` consumes `furypipe-agent-run/v1`;
- `observeLearningCycle(result)` consumes `furypipe-agent-learning-cycle/v1`.

Agent observations are keyed by opaque `runId`. Re-observing the same run replaces its prior state, so a legitimate `handoff_required -> completed` resume remains one run instead of being counted twice. Control Room exposes only aggregate run counts and context-token counts.

Learning observations are keyed by opaque `cycleId`. Only completed cycles contribute new lesson/reuse counts, and reused lesson IDs are deduplicated inside the current cycle state.

These observers deliberately do **not** infer stronger guarantees:

- observing an Agent result does not prove Recovery-backed memory;
- observing a handoff does not prove distributed orchestration;
- observing a Learning cycle does not prove durable storage or semantic retrieval.

Those statuses remain `NOT_AVAILABLE` unless the host supplies separate verified evidence. Run IDs, cycle IDs, lesson IDs, content handles, objectives, task text and evidence text are not emitted in the Control Room snapshot.
