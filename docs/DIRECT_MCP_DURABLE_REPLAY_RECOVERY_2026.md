# Direct MCP Durable Replay Recovery — M5 (2026)

## Status

M5 follows the merged Direct MCP chain:

```text
M1 transport/inventory
-> M2 exact proposal/policy/approval
-> M3 governed single call
-> M4 process-local duplicate suppression / explicit bounded replay
-> M5 durable crash/restart replay recovery
```

M5 does **not** introduce automatic retry, mutation replay, open-world replay,
multi-call transactions, distributed consensus, server-initiated authority,
release, publish, or deployment behavior.

The existing authority invariants remain mandatory:

```text
annotation != trust != approval != authorization != execution != replay
executed != succeeded != verified
replay_candidate != replay_authorized != replay_attempted
durable != authoritative
persisted != verified
stale reservation != safe retry
```

## Why M5 precedes multi-call orchestration

M4 intentionally keeps its duplicate ledger process-local. After a process crash,
that ledger disappears. A later process therefore cannot prove whether the prior
process:

- stopped before a wire call;
- consumed its permit but stopped before the call;
- sent a tool request and lost the response;
- received a result but stopped before recording evidence.

Building a multi-call DAG on top of that ambiguity would multiply unknown remote
state. M5 closes the restart/recovery gap before any multi-call plan is considered.

## Security goal

M5 must guarantee:

> A process restart must never convert missing local evidence into replay authority.

When durable evidence cannot prove that no remote call was possible, the state is
classified as unknown and execution remains blocked.

## Storage substrate

M5 uses FuryPipe's existing Recovery Store rather than a second persistence stack.

Required Recovery Store properties already available:

- root-wide inter-process write lock;
- atomic content-addressed writes;
- bounded `putBounded()` metadata constraints;
- namespace separation;
- optional AES-256-GCM host-managed encryption;
- quotas;
- backup/restore/rekey;
- expiry-aware GC;
- crash cleanup for temporary files.

Recovery Store durability is storage evidence only. It is not a signed trust
anchor, consensus service, globally verified clock, or remote-state oracle.

## Host scope

Every M5 durable store is bound to an explicit host scope:

```text
tenantId
+ principalId/non-secret principal digest
+ MCP sourceId
+ endpointFingerprint
```

No fallback across tenant or principal is allowed.

A host that cannot provide the required tenant/principal identity must not claim
cross-process replay protection.

## Durable execution key

M5 preserves the M4 exact replay key:

```text
sourceId
+ transport
+ endpointFingerprint
+ toolName
+ inputSchemaSha256
+ inputSha256
```

The endpoint fingerprint already binds configured non-secret principal identity
when credentials are present.

M5 storage metadata additionally binds the explicit durable tenant/principal
scope so two tenants cannot collide even if all MCP-visible fields match.

## State model

M5 introduces durable records separate from M4 process-local authority.

### 1. pre_call reservation

Created after fresh M1/M2/M3 revalidation and immediately before permit
consumption.

It means:

```text
execution slot reserved
!= permit consumed
!= remote call possible
```

A pre-call reservation carries a short bounded lease. It may be reclaimed only
after lease expiry **and only when no armed marker exists**.

### 2. armed marker

Persisted after permit consumption and synchronously before `Client.callTool()`.

It means:

```text
remote execution may occur or may already have occurred
```

Once an armed marker exists, a restart must treat the attempt as potentially
executed until exact terminal evidence is written or an explicit future operator
reconciliation protocol resolves it.

An armed marker never expires into replay authority.

### 3. terminal outcome

Written after the call path reaches a classified result.

Allowed durable outcomes:

- `succeeded`
- `tool_error`
- `unknown`
- `evidence_failed`
- `verification_failed`

The terminal record binds:

- durable scope digest;
- replay key;
- attempt;
- reservation digest;
- armed-marker digest when applicable;
- result SHA-256 when safely available;
- succeeded flag when known;
- bounded timestamps;
- M4 replay reason/prior-result digest when the attempt was an explicit replay.

No raw argument, result, credential, permit, header value, env value, or task
plaintext is durable.

## Ordering contract

The only permitted execution ordering is:

```text
fresh inventory/revalidation
-> create process-local M3 permit
-> durable pre_call reservation
-> consume M3 permit
-> durable armed marker
-> exactly one callTool()
-> classify result
-> durable terminal outcome
-> M4 receipt registration
```

Any failure before `armed` must not call the tool.

Any failure after `armed` but before exact terminal persistence is treated as
unknown on recovery.

## Crash matrix

### Crash before durable reservation

No M5 attempt exists. The tool was not authorized by M5.

### Crash after pre_call reservation, before permit consumption

No armed marker exists. After the bounded reservation lease expires, recovery
may reclaim the slot.

### Crash after permit consumption, before armed marker persistence

The executor must not call the tool unless the armed write succeeds. Therefore a
missing armed marker still proves no M5-governed wire call was allowed.

### Crash after armed marker, before call

Remote state is conservatively unknown. The restart cannot prove that the call
was not issued.

### Crash during/after call, before terminal persistence

Remote state is unknown. Replay is blocked.

### Crash after terminal persistence

The terminal record is reloadable and must be revalidated from the Recovery
content address before it can influence duplicate/replay policy.

## Duplicate suppression across processes

For each durable scope + replay key, at most one live pre-call reservation may
exist.

The implementation must use an atomic Recovery Store bound rather than:

```text
list()
-> decide
-> put()
```

because that sequence has a cross-process TOCTOU race.

A second process encountering a live reservation must fail closed.

## Replay after known terminal outcome

A durable known terminal outcome does not itself authorize replay.

A replay still requires all M4 authority:

- fresh M1 inventory;
- fresh M2 exact proposal/policy/approval;
- trusted source;
- `trusted_read_only_closed_world`;
- `closedWorldReadCandidate=true`;
- exact same replay key;
- fresh process-local replay intent;
- bounded attempt count;
- valid suppression window.

Durable state only supplies verified prior-attempt evidence.

## Unknown outcomes

`unknown` and abandoned armed reservations are not governed replay candidates.

They are not removed by normal duplicate-window GC.

A future operator reconciliation protocol may classify remote state, but that is
outside M5 and must have independent evidence.

## Attempt bounds

M5 keeps M4's maximum of three total governed attempts per replay key inside the
suppression window.

The durable attempt number must match the M4 receipt attempt number.

A mismatch is a fail-closed integrity error.

## Current foundation slice

The first implementation slice deliberately stops before executor wiring.

It currently provides:

- an opaque host coordinator bound to hashed tenant/principal scope;
- canonical content-addressed reservation, armed and terminal records;
- atomic one-reservation-per-attempt admission through `putBounded()`;
- restart inspection;
- cross-scope isolation;
- known-terminal-only durable replay lineage;
- a three-attempt durable bound;
- a safe public inspection surface while mutation primitives remain internal.

It deliberately does **not** reclaim an expired unarmed reservation yet.

Reason: the current Recovery Store serializes each operation, but it does not
expose a single transaction/CAS primitive that can atomically prove "no armed
marker exists" and revoke the expired reservation. Implementing
`list -> prove absent -> delete` as automatic recovery would introduce a race
with a process attempting to arm near lease expiry.

Until that atomic revocation primitive exists, an expired unarmed reservation
remains fail-closed. This is stricter than the final M5 target and is not treated
as completion of the reclaim requirement.

The executor now supports an explicit opt-in `durableReplay` coordinator.

When enabled, the wire-call ordering is enforced as:

```text
M4 process-local reservation
-> durable pre_call reservation
-> consume M3 permit
-> durable armed marker
-> exactly one callTool()
-> durable terminal for known success/tool_error
-> M4 terminal settlement
-> receipt return
```

A durable arming failure occurs before `callTool()` and therefore prevents the
wire call. If a known tool result returns but terminal durability cannot be
committed, FuryPipe throws the non-retriable
`MCP_DIRECT_EXECUTION_DURABILITY_FAILED` error and leaves the durable state
armed, which blocks restart replay.

For existing callers that omit `durableReplay`, M3/M4 behavior is unchanged.

Restart-time creation of a new M4 replay intent from durable evidence is still
out of scope for this slice; durable terminal evidence is evidence, not replay
authority.

## Reservation lease

The pre-call reservation lease is bounded and must exceed the maximum expected
local pre-call persistence interval while remaining short.

Lease expiry is not permission to delete an armed attempt.

Reclaim algorithm:

1. load exact reservation;
2. verify Recovery content digest;
3. verify durable scope/replay key;
4. verify lease expired;
5. prove no armed marker exists for the reservation;
6. delete only that exact reservation;
7. create a fresh attempt through the normal authority path.

No wall-clock inference may turn an armed record into safe replay.

## GC

Normal known terminal records may carry an ISO `expiresAt` metadata value
matching the duplicate-suppression window so Recovery Store GC can remove them.

The following must not expire automatically:

- `unknown` terminal outcomes;
- armed reservations lacking terminal evidence;
- corruption evidence needed to keep execution blocked.

Operators must resolve or explicitly archive them through a separate governed
maintenance path.

## Quotas and saturation

Durable replay storage must be bounded per namespace and globally.

When a quota, uniqueness bound, or storage lock cannot be obtained:

```text
fail closed
!= fall back to process-local execution
```

M5 must never silently degrade durable mode into M4-only mode for an execution
whose host requested durable protection.

## Migration

Durable records use explicit versioned formats.

Initial formats:

```text
furypipe-mcp-direct-durable-reservation/v1
furypipe-mcp-direct-durable-armed/v1
furypipe-mcp-direct-durable-terminal/v1
```

Unknown future versions fail closed.

M5 does not rewrite prior objects in place.

## Public API boundary

A supported M5 host API may expose:

- durable replay store construction from an existing `RecoveryStore`;
- status inspection returning bounded digest-only evidence;
- durable-mode executor option;
- recovery classification;
- explicit safe pre-call reservation reclamation.

It must not expose:

- raw durable reservation mutation primitives;
- arbitrary attempt-number setters;
- replay-key forgery helpers;
- M3 permits;
- process-local M4 ledger internals;
- a "mark succeeded" operator shortcut;
- an "assume not executed" restart shortcut.

## Required tests

Before M5 can be integrated, exact-head evidence must prove at least:

1. two processes racing one replay key produce at most one pre-call reservation;
2. restart after pre-call/no-armed can reclaim only after lease expiry;
3. restart after armed/no-terminal remains blocked;
4. restart after unknown terminal remains blocked;
5. restart after known success reloads exact digest-only prior evidence;
6. explicit closed-world replay still requires fresh M4 replay intent;
7. mutation cannot replay even with `idempotentHint=true`;
8. open-world read cannot replay;
9. tenant A cannot observe/use tenant B replay state;
10. principal A cannot observe/use principal B replay state;
11. input/schema/endpoint/risk/protocol drift blocks before wire call;
12. corrupted Recovery payload fails closed;
13. quota/lock/storage failure fails closed without process-local fallback;
14. plaintext canaries are absent from durable payload and metadata;
15. attempt count cannot exceed three;
16. real MCP v2 stdio restart E2E proves no duplicate tool call after armed crash;
17. package smoke exposes only the supported host surface;
18. all existing M1-M4 tests remain green.

## Exact-head merge gate

M5 remains OPEN + DRAFT until:

- implementation is complete;
- independent review is complete;
- targeted restart/process-race E2E passes;
- package smoke passes;
- full CI matrix is 9/9 green on the exact head;
- all repository workflows are green on that exact head;
- CodeQL, Secret Scan, Supply Chain, Provenance, Benchmark Contract and Control
  Room Security Evidence remain unchanged or stronger.

No release, tag, npm publish, deploy, production promotion, or automatic merge is
part of M5.