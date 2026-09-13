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
- governed provider execution and streaming runtime observations;
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
- raw protected ExactGuard spans;
- provider prompt/output plaintext, raw response bytes or provider request IDs.

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


## Governed provider runtime observations

The live collector can ingest authentic process-local outputs from the governed provider runtimes:

- `observeProviderExecution(result)` observes one buffered `furypipe-governed-provider-execution-result/v1`;
- `observeProviderStreamSession(session)` binds one exact governed stream session and returns a session-scoped observer;
- the returned `observeEvent(event)` consumes only authentic governed events from that exact stream, in exact sequence.

The collector accepts these values only when their process-local FuryPipe provenance checks succeed. Serialized values, object spreads, `structuredClone` copies and hand-crafted lookalikes are rejected. Re-observing the same exact buffered result, stream session or governed stream event is idempotent and does not inflate counters.

The Provider section exposes bounded aggregate metadata only:

- buffered execution and stream-session counts;
- accepted / rejected / unknown provider-request counts;
- stream completed / incomplete / failed / cancelled / requires-action / unknown / provider-error counts;
- accepted streams for which no terminal event has yet been observed;
- reported token categories;
- known-vs-unknown cost observation counts;
- runtime-observability and provider-verification states.

It deliberately does **not** retain or emit:

- FuryPrompt or request plaintext;
- streamed text deltas;
- provider response bytes;
- provider request IDs;
- finish reasons or provider error messages;
- API keys, authorization headers or other credentials.

`runtimeObservability: VERIFIED` means only that the Control Room observed authentic process-local FuryPipe runtime objects. It does not convert transport-reported network/provider evidence into independently verified truth.

Accordingly, runtime-collected Provider evidence defaults to:

```text
runtimeObservability = VERIFIED   # after at least one authentic observation
providerVerification = NOT_AVAILABLE
Provider section status = PARTIAL
```

A provider request reported as accepted, an HTTP 2xx stream, a terminal provider event or provider-reported usage/cost remains transport/runtime evidence. None of those proves provider uptime, account authorization, billing authenticity or network truth independently.

An accepted stream remains visibly open until its governed terminal/provider-error event is observed. The Control Room does not infer completion from session creation or elapsed time.

The source-bound host evidence file described below does **not** currently accept a Provider section. Independent provider verification needs a dedicated evidence contract rather than a static JSON field that could silently relabel transport-reported data.


## MCP runtime observations

The live collector can also observe exact process-local MCP runtime objects:

- `observeMcpHttpHandler(handler)` accepts only a `createProductionMcpHandler()` result whose identity still exists in FuryPipe's internal WeakMap;
- `observeMcpStdioHandle(handle)` accepts only a handle returned by `runModernMcpStdio()`.

The production HTTP boundary retains only bounded runtime counters and configuration booleans:

- number of requests reaching the FuryPipe boundary;
- number of requests dispatched to the MCP SDK handler;
- whether Bearer verification is configured;
- number of successful Bearer verifications;
- whether OAuth discovery metadata is configured;
- number of discovery metadata responses.

It does **not** retain request bodies, JSON-RPC params, tool arguments, Host/Origin values, Authorization headers, access tokens, `AuthInfo`, client IDs or recovery plaintext.

Control Room derives MCP status conservatively:

- authentic HTTP handler with no request: `http = NOT_EXECUTED`;
- boundary request rejected before dispatch: `http = PARTIAL`;
- request dispatched to the local MCP SDK handler: `http = VERIFIED` for the **local handler path only**;
- Bearer configured but no successful verification: `bearerAuth = PARTIAL`;
- successful local Bearer verification: `bearerAuth = VERIFIED`;
- any locally observed OAuth resource-server/discovery configuration remains `oauth = PARTIAL`;
- `externalConformance = NOT_AVAILABLE` unless a separate exact-source host evidence report provides stronger evidence;
- an authentic stdio handle proves local construction only, therefore runtime-derived `stdio = PARTIAL`.

These statuses must not be read as hosted interoperability claims. In particular, `http = VERIFIED` proves local dispatch through the production boundary, not DNS/TLS reachability or a remote client. `bearerAuth = VERIFIED` proves the configured local verifier accepted one request, not that a real Authorization Server was integrated. Local OAuth metadata never promotes external conformance.

If `ControlRoomRuntimeOptions.mcp` is supplied explicitly, that source-bound host evidence remains authoritative and is not silently overwritten by runtime-derived observations.


## Security CI evidence contract

The public `furypipe/control-room-security-evidence` module converts terminal CI results into the canonical Control Room `SecurityEvidence` shape without making network calls.

Input format:

```text
furypipe-control-room-security-ci-evidence/v1
```

Every supplied workflow run includes:

- a positive GitHub Actions run ID;
- the exact lowercase 40-character `headSha`;
- one terminal conclusion: `success`, `failure`, `cancelled` or `skipped`.

The evidence document itself is also bound to an exact `sourceCommit`. Any workflow whose `headSha` differs from that source commit is rejected even if its conclusion says `success`.

The mapping is deliberately conservative:

| CI conclusion | Control Room status |
| --- | --- |
| `success` | `VERIFIED` |
| `failure` | `BLOCKED` |
| `cancelled` | `PARTIAL` |
| `skipped` | `NOT_EXECUTED` |
| missing evidence | `NOT_AVAILABLE` |

The current repository workflows map as follows:

- `CodeQL` workflow -> `security.codeql`;
- `Secret Scan` workflow -> `security.secretScan`;
- `License Compliance` workflow -> `security.licenseCompliance`;
- Supply Chain job `Workflow action pinning` -> `security.actionPinning`;
- Supply Chain job `Frozen dependency audit` -> `security.dependencyAudit`;
- Supply Chain job `SPDX SBOM` -> `security.sbom`;
- Supply Chain job `GitHub dependency review` -> `security.dependencyReview`.

A successful Supply Chain workflow does **not** automatically verify every nested security field. Job conclusions are mapped independently. In particular, the Dependency Review job is conditionally skipped when the repository dependency graph setting is not enabled; that remains `NOT_EXECUTED`, not `VERIFIED`.

The parser reconstructs only the bounded fields above. Logs, workflow URLs, arbitrary messages, artifact contents and unknown/secret-bearing fields are discarded.

This module is a pure evidence adapter. It does not call GitHub, read credentials, query Actions or modify repository settings. A trusted CI/host process must collect the actual terminal conclusions for the exact source SHA and then pass that bounded evidence to FuryPipe. The resulting `snapshot.security` can be supplied to the existing source-bound Control Room host evidence/runtime path.


### Automated Security CI evidence export

The CI-facing exporter is deliberately separate from the Node runtime. The workflow `Control Room Security Evidence` collects GitHub Actions metadata for one exact source SHA and produces the existing `furypipe-control-room-security-ci-evidence/v1` document consumed by the Node loader.

Trust boundaries and collection rules:

- GitHub is queried only from the dedicated CI/operator script; the Node runtime still has no GitHub token or GitHub API client.
- The API origin is fixed to `https://api.github.com`; no configurable base URL is accepted.
- The workflow grants only `contents: read` and `actions: read`.
- Pull-request execution is restricted to same-repository heads so untrusted fork code is not run with the Actions-read token.
- Workflow runs are filtered by the exact lowercase 40-character `head_sha`.
- For each required workflow (`CodeQL`, `Secret Scan`, `License Compliance`, `Supply Chain`), the newest run for that SHA is selected; an older green run can never replace a newer failure or cancellation.
- Only terminal `success`, `failure`, `cancelled` and `skipped` conclusions are representable. Non-terminal runs/jobs remain waiting; unsupported terminal conclusions fail closed instead of being relabelled.
- Supply Chain jobs are fetched from the selected Supply Chain run and mapped independently. Missing, duplicate or wrong-run mapped jobs are never inferred from the parent workflow.
- GitHub responses are bounded to 1 MiB per request, pagination is bounded to the API's 1,000-result search ceiling, redirects are rejected, each request has an explicit 15-second timeout, and there is no hidden network retry.
- CI waiting is explicit and bounded to 20 minutes with a 15-second poll interval. Timeout is a failure, never success.
- A final freshness pass re-collects the exact-source runs/jobs before writing the artifact so a concurrent rerun cannot silently leave stale evidence.
- The final candidate is revalidated through the canonical Security CI parser from the existing contract before serialization.
- Canonical JSON bytes are deterministic for identical evidence input, and a SHA-256 checksum is written beside the JSON.
- GitHub response bodies, logs, URLs, arbitrary messages, authorization headers and tokens are not copied into the evidence document.

The workflow uploads exactly:

```text
control-room-security-ci-evidence.json
control-room-security-ci-evidence.json.sha256
```

The exporter creates no tag, release, package publication, deployment, issue/PR mutation or repository-setting change. Its artifact is source-bound CI evidence only; it does not prove provider/network availability, hosted MCP conformance or release authorization.


### Node ingestion of Security CI evidence

The Node host can ingest the Security CI evidence document directly when an exact build identity is present:

```text
FURYPIPE_SOURCE_COMMIT=<exact 40-char commit SHA>
FURYPIPE_CONTROL_ROOM_SECURITY_CI_EVIDENCE=/absolute/path/to/security-ci-evidence.json
```

The Security CI file is read locally only. The Node process does not call GitHub or receive a GitHub token. The loader:

- accepts regular files only and rejects symlinks;
- limits the document to 64 KiB;
- requires valid JSON;
- requires every supplied workflow `headSha` and the document `sourceCommit` to match `FURYPIPE_SOURCE_COMMIT`;
- passes only the canonical `SecurityEvidence` statuses to Control Room.

If `FURYPIPE_CONTROL_ROOM_EVIDENCE` also contains a static `security` section:

- matching Security evidence is accepted without conflict;
- if the two sources disagree, the exact-source Security CI evidence is authoritative;
- FuryPipe emits an explicit startup warning and does not merge individual fields from the two sources.

This precedence is intentional. The CI contract binds each supplied workflow run to the exact head SHA, while the generic host evidence format contains only already-derived statuses. A conflict is therefore made visible rather than silently combining two different truths.

An invalid or stale Security CI file is ignored with a warning. Other valid Control Room host/runtime evidence continues to operate; invalid CI evidence is never promoted to a Security status.


## Source-bound host evidence file

The Node host can now combine live runtime observations with bounded evidence produced by CI or another trusted host process.

Set:

```text
FURYPIPE_SOURCE_COMMIT=<exact 40-char commit SHA>
FURYPIPE_CONTROL_ROOM_EVIDENCE=/absolute/path/to/control-room-evidence.json
```

The file format is `furypipe-control-room-host-evidence/v1`. Its `sourceCommit` must match the running `FURYPIPE_SOURCE_COMMIT` exactly.

Accepted optional sections are Recovery, Agent, Learning, MCP, i18n, Web Studio, security/supply-chain, benchmarks and Release Readiness. The loader reconstructs only known bounded fields; unknown fields are discarded rather than passed through. This prevents an evidence file from becoming an accidental secret/prompt transport.

Safety boundaries:

- maximum file size: 256 KiB;
- regular files only; symlinks are rejected;
- JSON only;
- exact source-commit binding;
- release-readiness evidence must use the same source commit;
- release actions must remain `false`;
- counts/statuses are revalidated through the canonical Control Room snapshot validator;
- invalid host evidence is ignored by Node while live receipt/Agent/Learning observation continues.

This mechanism does not make local implementation presence equal VERIFIED. CI or the host must explicitly supply the evidence status for the exact source commit.
