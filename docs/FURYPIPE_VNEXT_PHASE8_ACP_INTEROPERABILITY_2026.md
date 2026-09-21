# FuryPipe VNext — Phase 8 ACP + External Agent Interoperability (2026)

> Status: Gate 8.0 architecture + threat model.
>
> Stack base: validated Phase 7 restack exact HEAD `011eac79bf793e11efa672b3f4b7c6455e4298e6`.
>
> Date: 2026-09-21.
>
> This track does not authorize merge, release, tag, npm publish or deploy.

## 1. Goal

Phase 8 makes FuryPipe interoperable with external agent ecosystems without turning
protocol compatibility into ambient execution authority.

The roadmap order is mandatory:

1. **ACP server/agent mode first** — FuryPipe can be launched by ACP-compatible
   editors/clients.
2. **Governed external-agent client/delegation second** — FuryPipe may later
   delegate bounded work to an external ACP agent.
3. **A2A/other remote-agent adapters later** — only behind the same delegation
   authority and evidence boundary.

Interoperability is a transport/capability concern. It must not weaken FuryPipe's
existing Gateway, Phase 6 coding/browser, Phase 7 memory, policy, provenance,
recovery or evidence contracts.

## 2. Current protocol target

Research checkpoint: 2026-09-21.

Production target:

- Agent Client Protocol **v1**, the current stable protocol version;
- JSON-RPC 2.0 request/response/notification model;
- official TypeScript SDK `@agentclientprotocol/sdk`;
- current observed official SDK release: `1.4.0`;
- stdio/subprocess transport first;
- exact dependency pin when the runtime dependency is introduced.

ACP v2 is explicitly experimental/draft in the official TypeScript SDK and is
therefore not a production dependency of the initial Phase 8 runtime.

If v2 experimentation is added later, it must use an explicit experimental
adapter/import and must not silently alter v1 semantics.

Primary research references:

- https://github.com/agentclientprotocol/agent-client-protocol
- https://github.com/agentclientprotocol/typescript-sdk
- https://agentclientprotocol.com/
- https://zed.dev/acp
- https://zed.dev/blog/acp-registry

The official protocol currently describes a client/agent message flow built
around `initialize`, optional authentication, session creation/resumption,
`session/prompt`, `session/update`, permission requests and cancellation.
Client-side optional facilities include filesystem and terminal methods and are
capability-negotiated.

## 3. Non-negotiable lifecycle truth

ACP protocol state must never be collapsed into FuryPipe authority.

```text
process spawned
!= transport connected
!= ACP initialized
!= protocol version negotiated
!= capability advertised
!= capability usable
!= authenticated
!= FuryPipe principal resolved
!= session created
!= prompt received
!= task admitted
!= permission requested
!= permission granted
!= FuryPipe execution permit minted
!= side effect attempted
!= side effect outcome known
!= task succeeded
!= result verified
```

For external delegation:

```text
agent discovered
!= configured
!= trusted
!= process launched
!= connected
!= initialized
!= authenticated
!= delegation eligible
!= delegated
!= response received
!= response trusted
!= patch accepted
!= side effect authorized
!= result verified
```

Additional invariants:

```text
ACP capability advertised != FuryPipe authorization
ACP permission response != standing FuryPipe authorization
ACP session != Gateway session
ACP session resume != authority resume
session/cancel != side effect rollback
session/update != trusted instruction
external agent output != verified truth
external agent patch != approved patch
external agent tool result != FuryPipe evidence
```

## 4. Trust boundaries

### 4.1 ACP client/editor

The ACP client is an external peer.

It may provide:

- prompts;
- session lifecycle requests;
- user permission decisions;
- file-system capabilities;
- terminal capabilities;
- content blocks;
- session configuration;
- extension metadata.

All received content is untrusted data until validated.

A client advertising `fs.writeTextFile`, terminal, elicitation or another
capability proves only protocol support. It does not grant FuryPipe policy
authority to use it.

### 4.2 FuryPipe ACP server/agent adapter

The adapter translates ACP v1 protocol events into FuryPipe task/session inputs
and translates FuryPipe observations back to ACP updates.

It must not become a second policy engine.

It must reuse:

- Gateway/Fury Kernel session and command admission;
- current principal resolution;
- Phase 6 coding/browser authorization;
- Phase 7 memory boundaries;
- existing policy/capability resolution;
- evidence and recovery primitives.

### 4.3 External ACP agent

When FuryPipe later acts as an ACP client, the external agent is an untrusted
execution peer.

Its:

- messages;
- plans;
- tool-call descriptions;
- patches;
- terminal requests;
- file requests;
- metadata;
- claimed completion;
- claimed tests;
- claimed provenance

must remain untrusted until independently admitted and verified.

## 5. Initial ACP server surface

Gate 8.1 starts with the smallest useful server/agent surface.

Required:

- `initialize`;
- protocol v1 negotiation;
- capability advertisement;
- `session/new`;
- `session/prompt`;
- `session/cancel`;
- `session/update` emission;
- deterministic JSON-RPC error mapping;
- bounded input validation;
- clean transport shutdown.

Initially optional/disabled until separately governed:

- session load/resume;
- authentication flows;
- client filesystem calls;
- client terminal calls;
- elicitation;
- custom extension methods;
- HTTP/WebSocket ACP transports;
- ACP v2.

The first server gate should work using stdio and remain usable from ACP clients
without requiring a remote listener.

## 6. ACP session bridge

ACP session identifiers are protocol identifiers, not authority tokens.

The FuryPipe bridge stores only a bounded mapping:

```text
acpSessionIdDigest
gatewaySessionIdDigest / kernel session reference
principal reference
createdAt
lastActivityAt
protocolVersion
capabilitySnapshotDigest
state
```

Never persist as future authority:

- live Gateway session leases;
- process-local execution permits;
- plaintext credentials;
- client-provided bearer/auth secrets;
- browser cookies;
- shell permits;
- file write permits;
- model/provider permits.

If a process restarts, durable session metadata may support reconstruction, but
current identity, policy and capability authorization must be re-evaluated.

## 7. Prompt and content handling

ACP content is model/user context, not system authority.

Rules:

- client prompt text remains user-originated data;
- images/audio/resources are capability-gated and bounded;
- `_meta` is untrusted extension metadata;
- custom extension methods cannot silently become privileged commands;
- session updates from external agents are never system/developer instructions;
- prompt injection inside files, tool output or agent output never grants
  additional authority.

All content sizes, array lengths and nesting must be bounded before forwarding
into FuryPipe context.

## 8. Filesystem boundary

ACP v1 requires protocol file paths to be absolute.

FuryPipe must add stricter rules before any client-side filesystem facility is
used:

```text
absolute path
-> canonicalize
-> verify current session root/workspace
-> reject traversal/symlink/junction escape
-> current policy check
-> exact operation permit
-> perform one operation
-> evidence receipt
```

Client FS capability advertisement is not sufficient.

Phase 6 path protections remain authoritative, including Windows-specific
junction, UNC, device-path, ADS and case-fold considerations.

The initial Gate 8.1 server does not require client filesystem write authority.

## 9. Terminal boundary

ACP terminal support is a remote execution surface.

Before FuryPipe requests or relies on a client terminal:

- current principal must be resolved;
- command must be policy-admitted;
- environment must be allowlisted/bounded;
- working directory must be root-bounded;
- timeout/output/process limits must apply;
- a fresh one-shot execution permit must exist;
- post-invocation uncertainty must become `outcome-unknown`;
- no automatic blind retry may occur.

A terminal ID is a protocol handle, not an execution permit.

## 10. Permission bridging

ACP supports an agent asking a client/user for permission for a tool call.

FuryPipe treats a positive ACP permission response as one input to admission,
not the final authority.

Required flow:

```text
operation proposed
-> FuryPipe policy says permission may be requested
-> bounded ACP permission request
-> client/user decision received
-> decision bound to exact operation digest
-> revalidate current principal/policy/session/capabilities
-> mint short-lived FuryPipe process-local permit
-> execute once
-> evidence
```

A copied, stale, replayed or mismatched permission response must fail closed.

“Always allow” style client choices must not silently become permanent FuryPipe
superuser grants unless a separate explicit FuryPipe policy operation stores such
a policy.

## 11. Cancellation and uncertainty

ACP `session/cancel` is cooperative cancellation.

Cancellation does not prove:

- a provider request was never sent;
- a shell command never started;
- a file write did not happen;
- a browser action did not occur;
- an external delegated agent did not commit a side effect.

Existing FuryPipe side-effect semantics remain authoritative.

If a side effect may have occurred but no outcome receipt exists:

```text
outcome = unknown
automaticRetry = forbidden
reconciliation = required
```

## 12. Observability

Expose bounded inspect-only state, for example:

```text
acp.status
acp.sessions
acp.connections
acp.delegations
```

Observability must report lifecycle truth without granting execution.

Never expose:

- auth secrets;
- environment secrets;
- full prompt bodies by default;
- raw client metadata when sensitive;
- provider credentials;
- Gateway leases;
- execution permits;
- external-agent credentials.

All observability objects use:

```text
authority: observability-only
executionAuthority: false
```

## 13. External ACP client/delegation architecture

Only after ACP server mode is exact-head green.

Target flow:

```text
Fury task
-> delegation candidate
-> external-agent registry lookup
-> trust/compatibility/health check
-> delegation policy
-> bounded DelegationPermit
-> spawn/connect external agent
-> initialize + capability negotiation
-> create isolated session
-> send bounded task/context
-> observe updates
-> receive result
-> independently verify
-> accept/reject result
-> durable receipt
```

### DelegationPermit

A permit must be:

- process-local;
- non-forgeable;
- one-shot;
- short-lived;
- principal-bound;
- task-digest-bound;
- external-agent-identity-bound;
- protocol-version-bound;
- root/worktree-bound where applicable;
- capability-bound;
- budget-bound.

Suggested fields:

```text
permitId
principalIdDigest
taskDigest
agentIdentityDigest
protocolVersion
allowedCapabilities
workspaceRootDigest
maxWallTimeMs
maxMessages
maxToolCalls
maxBytesIn
maxBytesOut
issuedAt
expiresAt
```

Persisted durable records store evidence of admission/attempt/outcome, never the
live permit itself.

## 14. External-agent result acceptance

External-agent output is advisory until verified.

For coding work:

```text
agent patch received
!= patch valid
!= patch current
!= patch applied
!= tests executed
!= tests passed
!= verification accepted
!= commit authorized
!= push authorized
!= merge authorized
```

Use Phase 6 worktree/patch/test primitives for acceptance.

The external agent cannot authorize:

- commit;
- push;
- merge;
- release;
- deployment;
- credential use;
- widening filesystem roots;
- arbitrary network access.

## 15. Registry/discovery

ACP Registry interoperability may be added as discovery data.

Registry presence means:

```text
listed != installed != trusted != configured != executable
```

Registry metadata may inform:

- package/command discovery;
- agent identity;
- version compatibility;
- documentation links.

FuryPipe still performs its own trust, license, provenance, policy and executable
resolution.

No registry entry may directly cause package install or process execution.

## 16. A2A / other remote-agent adapters

A2A or another agent-to-agent transport must be an adapter behind the same
delegation contract, not a second authority system.

Remote transports additionally require:

- explicit destination allowlist;
- TLS/authentication requirements;
- SSRF protections;
- redirect restrictions;
- credential scoping;
- bounded request/response sizes;
- replay protection where needed;
- remote identity/provenance evidence;
- timeout/cancellation;
- `outcome-unknown` handling.

Phase 8 must not silently expose FuryPipe Gateway publicly.

## 17. Dependency policy

When Gate 8.1 introduces the official TypeScript SDK:

- pin an exact reviewed version;
- update lockfile through the repository package manager;
- preserve supply-chain/audit gates;
- record Apache-2.0 attribution as required;
- verify packed-package runtime exports;
- do not import experimental v2 from production paths.

Current research candidate:

```text
@agentclientprotocol/sdk = 1.4.0
```

This version is a research checkpoint, not a permanent automatic-upgrade rule.

## 18. Proposed Phase 8 gates

### Gate 8.0 — architecture + threat model

This document.

### Gate 8.1 — ACP v1 stdio server foundation — VALIDATED

Implementation:

- exact dependency pin: `@agentclientprotocol/sdk = 1.4.0`;
- exact peer pin: `zod = 4.6.2`;
- stable ACP v1 import only; no experimental v2 import;
- one server instance represents one ACP connection boundary;
- `initialize`, `session/new`, `session/prompt`, `session/cancel`;
- `text` and `resource_link` prompt blocks only;
- resource links remain untrusted data and are never fetched by this gate;
- MCP attachment is rejected;
- client FS/terminal/permission methods are not invoked;
- sessions and cancellation controllers are process-local;
- ACP session IDs are protocol handles only;
- prompt/update/session budgets are bounded;
- package export and packed-artifact smoke are mandatory.

Exact validated SHA:

`292315e8c9312b344b261fc203b4f8d98c11c575`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 256 test files / 2,924 tests SUCCESS on observed Ubuntu/Node 26;
- Phase 8 ACP package smoke SUCCESS across the matrix.

### Gate 8.2 — Fury Kernel/Gateway session bridge — IMPLEMENTED

The bridge is deliberately not a second authentication or policy system.

Contract:

- the host supplies an already-generated process-local Gateway session lease;
- copied/serialized Gateway leases are rejected;
- `session/new` revalidates `conversation.open` against the current Gateway
  session and command registry before binding;
- each `session/prompt` revalidates
  `conversation.message.submit` before the injected prompt handler runs;
- an ACP session maps to a bounded Fury Kernel conversation state;
- Gateway admission remains `executionAuthority:false`;
- the bridge does not mint execution permits and does not execute providers,
  tools, filesystem, terminal or network actions;
- process-local ACP session snapshots are anti-forgery evidence;
- copied ACP snapshots are rejected at the bridge boundary;
- concurrent binding attempts for one ACP session converge on one Kernel
  conversation and one durable evidence record;
- cancellation remains authority-reducing and is never blocked merely because
  Gateway authority was revoked after a prompt had already started;
- durable RecoveryStore records contain digests only:
  ACP session, Gateway session, principal, Kernel conversation and cwd;
- live Gateway leases, raw principal IDs, raw cwd, raw conversation IDs and
  process-local permits are never persisted;
- durable evidence after restart is evidence only and does not reactivate a
  process-local mapping or authority;
- bridge evidence is bounded with RecoveryStore atomic capacity/uniqueness
  constraints.

Exact validated Gate 8.2 HEAD:

`27a8d188e4b866f66cf90cb8298c5d5d97961ecd`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 257 test files / 2,932 tests SUCCESS on observed Ubuntu/Node 22;
- 7 dedicated ACP server tests;
- 8 dedicated Gateway session bridge tests;
- Phase 8 ACP package smoke SUCCESS across the complete matrix.

### Gate 8.3 — tool/update projection — IMPLEMENTED

The projection boundary is display-only and does not create or transport
execution authority.

Contract:

- stable ACP v1 update forms only: `agent_message_chunk`, `plan`,
  `tool_call`, `tool_call_update`;
- FuryPipe-owned exact input schema with unknown-field rejection;
- text, title, IDs, plan entry counts, semantic payload bytes and serialized
  wire bytes are bounded;
- plans project only content/priority/status;
- tool calls project only ID/title/kind/status and optional bounded text;
- `rawInput`, `rawOutput`, file locations, terminal handles, diffs and
  arbitrary `_meta` are not accepted by the Gate 8.3 projector;
- projection receipts are `authority:'display-only'` and
  `executionAuthority:false`;
- only the protocol `SessionUpdate` is emitted on the ACP wire;
- `emitText()` is preserved and now delegates through the same projector;
- `emitUpdate()` shares the existing per-prompt update-count/payload budgets
  and cancellation signal;
- Gate 8.2 bridge and Gate 8.3 projector are exported and verified from the
  packed npm artifact.

Exact validated Gate 8.3 HEAD:

`d5d73c3bb09e25fea03b1b770a23f1e671955cb5`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 258 test files / 2,939 tests SUCCESS on observed Ubuntu/Node 22;
- 7 dedicated ACP display/update projection tests;
- Phase 8 ACP package smoke SUCCESS across the complete matrix.

### Gate 8.4 — governed permission bridge — IMPLEMENTED

Contract:

- ACP permission is an input to authorization, never standing authority;
- the protocol requester is process-local and bound to the active ACP session;
- only `allow_once` and `reject_once` are offered by FuryPipe;
- `allow_always` / `reject_always` are not interpreted as FuryPipe policy;
- permission tool-call display contains bounded ID/title/kind/status only;
- raw input/output, terminal handles, diffs, credentials and arbitrary metadata
  are not sent in the permission request;
- operation schema is exact and includes tool kind, risk class, current Gateway
  scopes and plugin permissions;
- plugin permissions automatically require their corresponding capability
  scopes;
- current Gateway/Kernal session binding is revalidated before the permission
  request;
- current Gateway authority is revalidated again after the user chooses
  `allow_once`;
- only then is a short-lived process-local FuryPipe permit minted;
- the permit is exact-operation, ACP-session, Gateway-session and
  principal-bound;
- permit consumption requires the executor to present the exact normalized
  operation again; a digest mismatch fails closed and consumes the permit;
- permit expiry is exclusive at `expiresAt` and fails closed;
- the permit is one-shot and TTL-bounded by the current Gateway session expiry;
- copied requesters and copied/forged permits fail closed;
- an expired/stale/revoked permit fails closed before side-effect execution;
- permission decisions/receipts remain `executionAuthority:false`;
- only the live process-local permit carries `executionAuthority:true`;
- Gate 8.4 still performs no filesystem/terminal side effect itself.

Gate 8.4 requires fresh exact-head 7/7 workflow and 9/9 CI proof before
Gate 8.5 begins.

### Gate 8.5 — governed client FS/terminal capabilities — VALIDATED

Contract:

- Phase 6 root/sandbox/process controls are reused; no second sandbox or process
  policy engine is introduced;
- ACP client capabilities are snapshotted from `initialize` as
  non-authoritative connection evidence;
- client capability != path/command authorization != side effect success;
- prompt-scoped client transports are opaque, process-local and deactivated when
  the prompt finishes, so reconnect/restart cannot revive capability state;
- filesystem operations require native absolute paths and are remapped through
  the current Phase 6 sandbox root before any permission request;
- lexical parent traversal, outside-root paths, UNC/device paths, ADS-like
  components, symlink/junction escapes and policy-root mismatches fail closed;
- read/write byte limits are bounded by the Phase 6 sandbox file budget;
- terminal command, args, cwd, environment, timeout and output limits are
  validated through the Phase 6 coding process runtime before ACP invocation;
- only explicitly requested, allowlisted environment values cross the ACP
  boundary; inherited host environment is not forwarded;
- each Gate 8.5 plan contains only digests and non-authoritative metadata;
  paths, file contents, commands, args and environment values are not placed in
  plan/receipt observability;
- Gate 8.4 operations may carry `targetDigestSha256`; Gate 8.5 requires it and
  binds each allow-once permit to the concrete normalized path/content/command
  request digest;
- path/process state and advertised capability are revalidated immediately
  before Gate 8.4 permit consumption;
- the Gate 8.4 permit is consumed before the first ACP client side effect;
- copied plans/transports/permits and wrong-session/wrong-request digests fail
  closed;
- client filesystem write failure after invocation is `outcome:'unknown'`;
  blind automatic replay is forbidden;
- terminal/create lost response, timeout/cancellation after possible process
  start, or uncertain terminal cleanup is `outcome:'unknown'`;
- terminal cancellation is cooperative and is never represented as rollback;
- terminal output is bounded and explicit environment values are redacted from
  returned output/evidence;
- evidence receipts are `executionAuthority:false` and
  `automaticReplayAllowed:false`;
- package export smoke covers the governed client capability runtime.

Exact validated Gate 8.5 HEAD:

`6836845c976e3b0c6cbe272289eb3b1d4bfa7f4d`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 260 test files / 2,959 tests SUCCESS on observed Ubuntu/Node 22;
- Phase 8 ACP package smoke SUCCESS across the matrix;
- Windows Node 22/24/26 all passed the canonical Phase 6 root regression and
  packed-artifact smoke;
- the temporary path-safe diagnostic was removed before this exact-head proof.

### Gate 8.6 — ACP conformance + editor compatibility — VALIDATED

Contract:

- ACP SDK remains exact-pinned to `@agentclientprotocol/sdk = 1.4.0`;
- each Fury ACP server instance is a single connection boundary and fails
  closed if reused for a second connection;
- every connection must complete exactly one `initialize` before
  `session/new`; duplicate initialization cannot rebind advertised
  capabilities;
- omitted client capabilities remain unsupported and never become execution
  authority;
- additional workspace roots are explicitly advertised through
  `sessionCapabilities.additionalDirectories`;
- unsupported protocol versions continue ACP v1 negotiation by returning the
  latest supported stable version;
- official SDK `ClientApp` / `ActiveSession` flows are exercised as the
  representative editor compatibility fixture;
- malformed NDJSON produces JSON-RPC parse/invalid-request errors without
  silently becoming protocol input;
- JSON-RPC batches are rejected on stable ACP v1 before session handlers run;
- unknown extension methods return method-not-found while the connection
  remains usable;
- independent sessions may execute prompts concurrently, while one session
  cannot run two prompts concurrently;
- protocol request cancellation reduces authority cooperatively and never
  implies rollback;
- `_meta` and other peer metadata remain non-authoritative data;
- a fresh server instance does not restore stale session IDs or client
  capability authority from a prior connection;
- no reconnect/restart path converts evidence into live execution authority;
- existing Phase 8 packed-artifact smoke remains mandatory.

Exact validated Gate 8.6 implementation HEAD:

`6130922dee6cfdaefdc653cd8c9b41d051366e7a`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 261 test files / 2,970 tests SUCCESS on observed Ubuntu/Node 26;
- 11 dedicated Gate 8.6 conformance/editor compatibility tests SUCCESS;
- packed ACP lifecycle smoke SUCCESS across the matrix;
- Windows Node 22/24/26 SUCCESS;
- ACP v1 single-connection boundary, initialize-before-session, duplicate
  initialize rejection, capability mismatch, cross-session concurrency,
  same-session prompt exclusion, cooperative cancellation, unknown methods,
  non-authoritative metadata, malformed NDJSON, stable-v1 batch rejection and
  reconnect/restart authority invalidation are covered by exact-head tests.

This documentation-only closure commit requires the same 7/7 workflow and 9/9
CI matrix proof before Gate 8.7 begins.

### Gate 8.7 — external ACP client foundation — VALIDATED

Contract:

- only explicitly configured local agent entries exist in the runtime registry;
- registry presence remains evidence only:
  `configured != trusted != executable != delegated`;
- configured command, args, cwd and environment remain process-local and are
  never exposed through registry descriptors;
- registry descriptors expose only bounded IDs and digests and carry
  `executionAuthority:false` and `delegationAuthority:false`;
- registry construction never spawns or connects an external process;
- opening an external session is an explicit host call; there is no automatic
  selection, package installation, discovery-to-execution path or background
  delegation;
- the current Phase 6 CodingSandbox remains authoritative for command allowlist,
  cwd resolution, environment allowlist, output bounds, process/session count
  and startup timeout bounds;
- external ACP processes are spawned shell-free with stdio only;
- FuryPipe acts as an ACP v1 client with empty client capabilities and
  `mcpServers: []`;
- only `initialize` and `session/new` are performed in this gate;
- the public runtime exposes no prompt/delegate operation, so an established
  external session is not delegation authority;
- configured expected agent name is compatibility evidence only and is checked
  fail-closed when present; peer-reported identity never becomes authority;
- external ACP session handles are opaque process-local evidence; copied handles
  or descriptors are rejected;
- raw external ACP session IDs, command arguments and environment values are not
  exposed in session snapshots;
- protocol/stderr output is bounded; startup timeout and process loss fail
  closed;
- unexpected process loss becomes `state:'disconnected'`, never success;
- external session snapshots set `automaticReplayAllowed:false`;
- a fresh runtime cannot revive a previous process-local external session;
- Gate 8.8 remains responsible for task-bound one-shot delegation permits and
  sending actual delegated prompts.

Gate 8.7 adds a real stdio subprocess fixture across the CI matrix, package
export smoke, adversarial copied-evidence tests, current-policy revalidation,
identity mismatch checks, process/session limits and disconnect semantics.

Exact validated Gate 8.7 implementation HEAD:

`498af34e1b6a91b47776bc35b7f70c3871a189d9`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 262 test files / 2,980 tests SUCCESS on observed Ubuntu/Node 26;
- 10 dedicated external ACP client foundation tests SUCCESS;
- real stdio subprocess initialize/session fixture SUCCESS;
- copied descriptor/session evidence rejection SUCCESS;
- current Phase 6 sandbox command revalidation SUCCESS;
- agent identity mismatch and protocol-version mismatch fail closed;
- bounded concurrent external-session limit SUCCESS;
- unexpected process loss becomes `disconnected` with
  `automaticReplayAllowed:false`;
- Phase 8 packed-artifact smoke loads the external ACP client foundation from
  the packaged tarball across the matrix;
- Windows Node 22/24/26 SUCCESS.

This documentation-only closure commit requires the same 7/7 workflow and 9/9
CI matrix proof before Gate 8.8 begins.

### Gate 8.8 — governed delegation permits — IMPLEMENTED / REQUIRES EXACT-HEAD PROOF

Contract:

- delegation requests are process-local evidence and bind:
  - current principal digest;
  - exact configured external-agent identity digest;
  - exact process-local external session handle digest;
  - ACP protocol v1;
  - exact task digest;
  - canonical workspace-root digest;
  - exact capability-set digest;
  - exact budget digest;
- delegation permits are process-local, short-lived, exact-request-bound and
  one-shot;
- permit consumption occurs synchronously before `session/prompt` can be
  invoked;
- copied, stale, expired or request-mismatched permits fail closed;
- policy admission separately binds principal, agent, allowed capability set,
  budget ceiling and TTL;
- current external-session lifecycle, agent identity and workspace root are
  revalidated immediately before permit consumption;
- only bounded text prompts are delegated in this gate;
- output/update/message/tool/wall-time budgets are enforced while observing the
  live ACP turn;
- unpermitted external tool activity causes cancellation and an
  `outcome:'unknown'` receipt because side effects may already have started;
- cancellation, timeout or transport loss after prompt invocation never proves
  rollback and therefore cannot become success;
- `automaticReplayAllowed:false` is permanent on delegation receipts;
- raw task text, raw ACP session IDs and live permit authority are excluded from
  durable-style receipts;
- external agent output remains advisory;
- a separately supplied FuryPipe verifier runs only after a completed turn;
- only `stopReason:'end_turn'` plus independent
  `verificationStatus:'verified'` may produce `accepted:true`;
- verifier rejection/uncertainty cannot be promoted by the external agent;
- a closed/disconnected session cannot mint a new delegation request;
- a process restart cannot restore request/permit authority because the backing
  WeakMap evidence is process-local.

Gate 8.8 adds adversarial tests for exact binding, copied permits, request/permit
mismatch, policy mismatch, expiry/one-shot semantics, independent verification,
unpermitted tool activity, post-invocation transport loss and closed-session
rejection.

Required exact-head proof is 7/7 workflows and 9/9 CI matrix before Gate 8.8 is
marked validated.

### Gate 8.9 — remote A2A adapter contract

- adapter-only;
- no public Gateway exposure;
- identity/auth/network/replay protections.

### Gate 8.10 — final interoperability evidence

- exact-head CI matrix;
- protocol fixtures;
- package smoke;
- Secret Scan;
- browser QA regression;
- security/adversarial tests;
- restart and post-invocation uncertainty proof.

## 19. Required adversarial tests

ACP server:

- malformed JSON-RPC;
- unknown methods;
- unsupported protocol version;
- duplicate request IDs where relevant;
- oversized message/content;
- forged session ID;
- session mix-up across principals;
- cancel before prompt;
- cancel during provider/tool work;
- copied permission response;
- stale permission response;
- mismatched operation digest;
- client capability disappears after reconnect;
- malicious `_meta`;
- prompt injection in user/file/tool content;
- absolute path outside workspace;
- symlink/junction/path escape;
- terminal command outside current policy;
- secret-bearing output redaction.

External delegation:

- untrusted registry metadata;
- wrong external-agent binary;
- version/capability mismatch;
- forged agent identity;
- process crash before response;
- response lost after possible side effect;
- duplicated result;
- malicious patch;
- stale base SHA;
- external agent claims tests passed without evidence;
- external agent requests wider filesystem/network scope;
- delegation permit reuse;
- expired permit;
- wrong task/agent/root binding;
- output-size exhaustion;
- cancellation without rollback evidence.

## 20. Caveman correctness checklist

For every ACP feature, answer explicitly:

1. What exact state exists?
2. Who owns that state?
3. What evidence proves it?
4. What authority exists right now?
5. What does the peer merely claim?
6. What happens if the process crashes here?
7. What happens if the response is lost?
8. Can the operation be retried safely?
9. Can another session/process race this state?
10. Can a copied object forge authority?
11. Can stale authority survive reconnect/restart?
12. Can untrusted content become instructions?
13. Can any secret cross the observation boundary?

Priority:

```text
security
> correctness
> evidence
> recoverability
> interoperability
> maintainability
> performance
> convenience
```

No magic. No protocol capability as authority. No blind retry. No secret leak.
No auto-install. No auto-merge.

## 21. Gate 8.0 exit criteria

Gate 8.0 is complete only when:

- this architecture is committed on a branch stacked exactly on validated Phase 7;
- PR remains OPEN + DRAFT;
- exact-head Secret Scan, CI, Benchmark Contract, RC Preparation Evidence,
  Dashboard Browser QA, Web Studio Browser QA and Cross-Browser QA are green;
- all 9 CI matrix jobs are green;
- no runtime dependency has yet been introduced;
- no merge/release/tag/npm publish/deploy occurred.
