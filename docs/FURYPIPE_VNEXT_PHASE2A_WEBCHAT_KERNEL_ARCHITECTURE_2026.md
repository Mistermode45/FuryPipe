# FuryPipe VNext — Phase 2A Local WebChat + Fury Kernel Facade

**Status:** Gates 2A.0–2A.3 implemented; exact-HEAD validation pending  
**Base:** PR #209 exact HEAD `2a9d83dc835ca10b246bdc6a5e2de55e4a68739d`  
**Track:** `vnext-phase2a-webchat-kernel-facade`

## 1. Objective

Phase 2A adds a local conversational surface and a Fury Kernel facade without turning the browser, WebSocket transport, bootstrap cookie, or Gateway command admission into execution authority.

The existing proxy remains unchanged. The VNext Gateway remains loopback-only by default.

## 2. Non-negotiable invariants

```text
localhost != authenticated user
bootstrap ticket != browser session
browser cookie != command scope
transport received != command authorized
command eligible != execution permit
chat message accepted != model/tool execution approved
conversation state != durable memory
provider response != verified evidence
kernel receipt != execution authority
UI event != session authority
```

No Phase 2A component may weaken M1-M5.1 governance, ExactGuard, provider fallback reconstruction, CI, provenance, or evidence semantics.

## 3. Reuse, do not duplicate

Phase 2A reuses:

- `gateway-local-operator-bootstrap-node.ts` for one-time local browser bootstrap and HttpOnly cookie resolution.
- `gateway-runtime-daemon-node.ts` for daemon lifecycle, bounded event history, and safe observability.
- `gateway-transport-node.ts` for message bounds, sequence/replay protection, rate limiting, backpressure, session revalidation, and command admission.
- `gateway-command-authorization-node.ts` for roles/scopes/plugin-permission intersection. Admission remains `executionAuthority:false`.
- `agent-fabric.ts` for the research → plan → implement → review → verify stage contract.
- `agent-runtime.ts` for bounded context budgets, capability execution receipts, scoped writes, MCP/skill/subagent boundaries, handoff/resume, and memory claims.
- existing Model/Provider Fabric and Context/Visual Engine behind explicit Kernel adapters; no direct browser-to-provider path.

Web Studio is not reused as WebChat. It remains a site creation/QA product surface.

## 4. Architecture

```text
Local WebChat UI
    |
    | existing #208 bootstrap + HttpOnly cookie
    v
Fury Gateway WebSocket Host
    |
    | transport receipt
    | session revalidation
    | command admission
    | executionAuthority = false
    v
Conversation Gateway Adapter
    |
    | admitted conversation operation only
    v
Fury Kernel Facade
    |
    +--> Conversation Store (ephemeral + bounded by default)
    +--> Context Adapter
    +--> Model Fabric Adapter
    +--> Agent Runtime Adapter
    +--> Evidence Adapter
    |
    v
Governed execution boundaries
```

The Gateway network callback never executes tools, shell, repository writes, MCP calls, or provider management directly.

## 5. Conversation contract

Introduce a Fury-owned versioned contract:

```text
furypipe-conversation/v1
```

Initial operations:

- `conversation.open`
- `conversation.inspect`
- `conversation.message.submit`
- `conversation.cancel`
- `conversation.close`

A conversation identifier is server-generated, random, opaque, bounded, and process-local in the first implementation. Browser/client supplied conversation identifiers are not accepted for creation. Terminal conversations have an explicit close operation so bounded daemon capacity is reclaimable; a conversation with an active turn cannot be closed.

A message identifier is caller-provided or Kernel-generated according to one canonical rule and is unique within a conversation.

### 5.1 Message roles

Initial roles:

- `user`
- `assistant`
- `system` only from trusted Kernel construction, never from browser input.

Browser input cannot inject an authoritative system message.

### 5.2 Bounds

The implementation must define hard limits for:

- active conversations;
- messages per conversation;
- UTF-8 bytes per message;
- total bytes per conversation;
- concurrent in-flight turns;
- turn timeout;
- event history;
- model/context budget;
- capability executions.

Overflow fails closed with typed errors. No silent truncation of authority-bearing data.

## 6. Authority model

Conversation operations are state operations, not execution permits.

A successful Gateway admission may allow the Kernel to accept or inspect conversation state. It does not authorize:

- provider inference;
- browser automation;
- process execution;
- repository writes;
- MCP execution;
- plugin management;
- remote network access.

Any operation that needs a capability must pass the existing scope/plugin-permission intersection and the downstream Fury governance boundary.

The first Kernel foundation may therefore accept/inspect conversation state while leaving model/tool execution disabled until its dedicated adapter gate is wired and tested.

## 7. Kernel facade contract

The Kernel is the only orchestration boundary exposed to product surfaces.

Suggested public facade:

```ts
interface FuryKernel {
  openConversation(): KernelConversationSnapshot;
  inspectConversation(id: string): KernelConversationSnapshot;
  closeConversation(id: string): KernelClosedConversation;
  submitMessage(input: KernelSubmitMessageInput): Promise<KernelTurnResult>;
  cancelTurn(input: KernelCancelTurnInput): KernelCancellationResult;
}
```

Every returned result must make authority explicit. Conversation receipts and UI events use `executionAuthority:false`.

The facade must not accept raw browser cookies, bootstrap tickets, or unvalidated Gateway messages. Those remain Gateway responsibilities.

## 8. Kernel turn state machine

```text
accepted
  -> preparing
  -> model_pending
  -> completed

accepted
  -> preparing
  -> blocked

accepted
  -> preparing
  -> cancelled

model_pending
  -> cancelled | completed | failed
```

Tool-capable turns add a separate governed branch later. A model answer is not evidence that a tool executed.

## 9. Agent Runtime integration

Do not replace `agent-runtime.ts`.

The Kernel adapter may invoke Agent Runtime only after a policy decision explicitly selects an agentic workflow.

Agent Runtime invariants remain:

- read-only by default;
- scoped-write only during implement;
- network disabled unless a future governed adapter explicitly grants it;
- capability callbacks produce receipts only after successful return;
- planning/selection never counts as execution;
- context budgets are hard bounded;
- persisted resume claims are one-time.

The conversational loop must not automatically map every user message to a five-stage agent run. Simple chat stays simple.

## 10. Context and memory

Conversation transcript and durable memory are separate concepts.

Initial policy:

- conversation transcript: process-local, bounded, ephemeral;
- Fury Memory: opt-in adapter only;
- no automatic durable persistence of plaintext conversation in Phase 2A foundation;
- no credential/token/cookie/bootstrap persistence;
- durable memory records must preserve provenance, scope, verification, retention, supersedes/contradicts metadata when introduced.

## 11. Provider/model boundary

WebChat never talks directly to Anthropic/OpenAI/provider endpoints.

The Kernel calls a Model Fabric adapter. The adapter must preserve FuryPipe provider rules:

- BASE prompt stays model-neutral;
- provider fallback reconstructs adapter/profile/context/request/permit from BASE;
- no stale provider-specific prompt propagation;
- request budgets and cancellation are explicit;
- provider success != verified evidence.

Provider inference authority is separate from conversation write authority.

## 12. Local WebChat surface

Target route namespace:

```text
/gateway/webchat/
```

Requirements:

- served only by the local Gateway host in this phase;
- exact Origin checks remain enforced;
- existing HttpOnly `furypipe_gateway_local` cookie is reused;
- no secrets in URL/query/hash;
- CSP restrictive by default;
- no third-party scripts/CDNs;
- no inline credential material;
- no direct WebSocket tool execution;
- reconnect does not imply resend permission;
- UI displays conversation state separately from tool/evidence state.

The UI must visually distinguish at least:

- message accepted;
- model response;
- tool requested;
- tool eligible;
- tool executed;
- tool succeeded;
- evidence verified;
- blocked/approval required.

## 13. Gateway command surface

Do not overload existing `gateway.inspect` as chat mutation authority.

Before network exposure, add explicit conversation scopes or an equivalent narrowly named scope set. Do not grant broad `channels.manage`, `settings.manage`, or capability scopes merely to make chat work.

Suggested scopes for review:

```text
conversations.inspect
conversations.write
```

If these are adopted, local operator bootstrap should receive only the minimum scopes required by the local WebChat plus `gateway.inspect`.

Provider/tool capabilities remain absent until their own governed gates.

## 14. Threat model

Must test at minimum:

1. forged/serialized session or admission evidence;
2. duplicate/replayed message IDs;
3. sequence replay/gap;
4. cross-Origin browser attempts;
5. duplicate cookies;
6. oversized/deep JSON;
7. prototype pollution keys;
8. conversation count/message count/byte exhaustion;
9. concurrent duplicate submit;
10. cancel vs completion race;
11. stale/revoked browser session;
12. reconnect without implicit resend;
13. attempted browser system-role injection;
14. attempted capability escalation through conversation payload;
15. prompt/provider fallback contamination;
16. secrets in logs/events;
17. UI event mistaken for execution/evidence receipt.

## 15. Delivery gates

### Gate 2A.0 — architecture
- this document;
- exact ancestry from #209;
- no runtime behavior change.

### Gate 2A.1 — Kernel conversation foundation
Implementation present on this track:
- bounded in-memory conversation store;
- exact schemas and server-owned opaque conversation IDs;
- state machine, cancellation and explicit close/reclamation;
- idempotency/replay protections;
- immutable snapshots;
- package export and smoke coverage;
- no provider/tool execution;
- unit tests.

Validation remains evidence-bound to the exact final HEAD; superseded CI runs do not count as final PASS evidence.

### Gate 2A.2 — Gateway conversation adapter
Implementation present on this track:
- explicit `conversations.inspect` and `conversations.write` scopes;
- five registered conversation commands with zero plugin permissions;
- command admission required before state dispatch;
- transport receipt, command admission and state-command result remain distinct;
- network callback schedules bounded synchronous state work in a microtask;
- state dispatch backpressure is independent from capability execution;
- result serialization is bounded and oversized inspection pages fail closed;
- denied admission never reaches the Kernel adapter;
- unit and real WebSocket integration tests.

The state dispatcher is not a provider/tool/process/MCP/repository execution boundary and continues to emit `executionAuthority:false`.

### Gate 2A.3 — local WebChat
Implementation present on this track:
- static local HTML/CSS/JavaScript under `/gateway/webchat/`;
- #208 one-time bootstrap and HttpOnly browser cookie reused unchanged;
- no bootstrap secret in URL/query/hash;
- exact loopback origin and same Gateway WebSocket protocol;
- reconnect/resync with stale-socket race protection;
- deterministic conversation close/open rollover;
- no browser transcript persistence;
- DOM updates use `textContent`, not dynamic `innerHTML`;
- restrictive CSP, no-store, COOP/CORP, Permissions-Policy and no third-party scripts/CDNs;
- responsive/accessibility-oriented UI with explicit authority-state legend;
- HTTP security tests;
- real Chromium/Firefox/WebKit desktop+mobile browser QA added to the existing Cross-Browser workflow.

Model inference is disabled by default and is available only through the separately governed Gate 2A.4 execution path when the operator explicitly configures it.

### Gate 2A.4 — Model Fabric bridge
Implementation present on this track:
- provider inference disabled by default;
- explicit host-owned provider/model route only;
- browser receives `capability.provider-inference` only when the route is configured;
- `conversation.model.execute` is a separate process-risk command with declared `provider-inference` permission;
- state-command and async execution-command allowlists are disjoint and independently backpressured;
- command admission remains non-authoritative; the bridge creates fresh one-shot provider policies/permits;
- existing Provider Runtime, attempt planner, Context Runtime, governed executor and retry/fallback orchestrator are reused rather than duplicated;
- every fallback attempt is rebuilt from the captured model-neutral BASE prompt;
- prior transcript is bounded and injected as untrusted `transcript` context;
- secret context remains default-deny;
- OpenAI Responses, Anthropic Messages and Google Interactions text decoding is strict and bounded;
- tool/function-call response shapes fail closed and are not converted into chat text;
- provider output is marked `verification: unverified`, distinct from verified evidence;
- cancellation terminalizes the local Kernel turn while preserving any ambiguous transport outcome;
- Kernel turns have an explicit safe `failed` terminal state carrying only a bounded failure code;
- package exports and smoke coverage are included;
- provider-mocked and local HTTP transport integration tests cover success, fallback, cancellation, malformed/tool-call output, credential isolation and context limits.

Final PASS remains evidence-bound to the exact final HEAD after the complete CI/browser/package matrix succeeds.

### Gate 2A.5 — governed tool bridge
- separate from plain chat;
- Agent Runtime / governance integration;
- explicit approvals where required;
- no direct UI/socket execution;
- end-to-end evidence tests.

## 16. Test and CI requirements

Every implementation gate must pass:

- unit tests;
- integration tests;
- existing full CI matrix;
- package smoke;
- Secret Scan;
- Benchmark Contract;
- browser QA when UI lands;
- CodeQL/Supply Chain/Provenance/FuryTrust gates already required by the repository.

A PASS claim is valid only for the exact tested HEAD SHA.

## 17. Out of scope for the foundation

- remote WebChat;
- cloud-hosted Gateway;
- WSS/secure-tunnel remote auth;
- durable plaintext chat history;
- voice;
- ACP client orchestration;
- A2A;
- autonomous background tool execution;
- implicit browser/process/MCP/repository authority;
- replacing the historical proxy on port 48721.

## 18. Success criteria

Phase 2A is complete only when a local authenticated browser can converse through the Gateway and Fury Kernel while the system still proves:

```text
browser session != execution authority
conversation accepted != provider/tool permit
tool eligible != tool executed
executed != succeeded != verified
```

The product surface can become richer without weakening the governance model that makes FuryPipe trustworthy.
