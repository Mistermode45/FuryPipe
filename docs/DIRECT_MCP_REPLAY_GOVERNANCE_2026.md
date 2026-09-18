# Direct MCP Replay Governance — M4 (2026)

## Status

M4 follows the merged M1/M2/M3 Direct MCP chain and addresses the remaining
bounded replay / idempotency policy gap.

M4 does **not** add automatic transport retry, hidden replay, background
execution, multi-call plans, server-initiated sampling/elicitation authority, or
release/deployment behavior.

The invariant remains:

```text
annotation != trust != approval != authorization != execution != replay
```

and:

```text
executed != succeeded != verified
replay_candidate != replay_authorized != replay_attempted
```

## Dependency baseline

The implementation continues to target the exact pinned official
`@modelcontextprotocol/client@2.0.0` line and MCP protocol revision
`2026-07-28`.

The MCP `idempotentHint` is descriptive server metadata, not authority. Per the
protocol model, it is meaningful for mutating tools; it does not itself authorize
a repeated call.

M3 already passes an explicit fresh `toolDefinition` to `Client.callTool()`.
That prevents the SDK's SEP-2243 missing-definition HEADER_MISMATCH
evict/refetch/retry path from becoming hidden replay authority for governed
execution. M4 preserves that property.

## Problem

M3 prevents reusing the exact same in-process approved lifecycle object, but a
caller could create a second fresh M1→M2 approval for the same
source/tool/input and attempt the same logical action again.

That may be intentional, but FuryPipe must not confuse:

```text
new approval != new semantic intent
same input != safe replay
idempotent hint != replay authorization
```

M4 therefore introduces a bounded duplicate-attempt ledger and an explicit
replay-governance transition.

## Replay key

A replay key is a digest over non-secret, authority-relevant identity:

```text
sourceId
+ transport
+ endpointFingerprint
+ selected tool name
+ inputSchemaSha256
+ inputSha256
+ principal-bound endpoint identity
```

Credential values, raw arguments, raw results, HTTP headers, stdio env values,
and raw permit ids are never part of persisted replay evidence.

The endpoint fingerprint already binds any configured non-secret
`principalId`, so switching principals changes the replay key.

## Outcome classes

M4 keeps prior execution outcomes distinct.

### Known success

```text
executed = true
succeeded = true
```

A repeated identical attempt inside the duplicate-suppression window is blocked
by default. Repeating the action requires a fresh explicit replay intent.

### Known tool-level failure

```text
executed = true
succeeded = false
verified = false
```

This is known execution, not a transport ambiguity. It may become a replay
candidate, but never replay authority.

### Unknown execution outcome

A thrown SDK/transport/protocol error after permit consumption remains:

```text
MCP_DIRECT_EXECUTION_OUTCOME_UNKNOWN
```

Unknown outcome is never automatically replayed. M4 does not provide a policy
shortcut around that rule.

### Pre-call rejection

Schema drift, risk drift, protocol drift, expired approval, principal mismatch,
or other failures before `callTool()` are not recorded as executed attempts and
therefore do not consume replay budget.

## Duplicate-attempt ledger

The first M4 implementation uses a process-local bounded ledger.

Each record contains only:

- replay-key SHA-256;
- source id;
- endpoint fingerprint;
- tool name;
- input-schema SHA-256;
- input SHA-256;
- prior execution class;
- attempt timestamp;
- expiry timestamp;
- bounded attempt count.

No raw MCP input/result or credential material is retained.

The ledger has:

- explicit maximum entry count;
- explicit TTL;
- deterministic eviction;
- no cross-principal fallback;
- no serialization authority;
- no claim of cross-process durability.

A future durable replay ledger, if needed, must use the Recovery store with
tenant/principal separation and its own migration/locking evidence. M4 does not
silently promote the process-local ledger into durable authority.

## Replay intent

A replay requires a short-lived process-local single-use
`McpDirectReplayIntent`.

It is bound to:

```text
replay key
+ prior execution receipt/evidence digest
+ fresh approved proposal/input digest
+ replay reason
+ creation timestamp
+ expiry
```

Copying, serializing, reconstructing, or spreading the intent destroys its
authority.

Replay reasons are bounded enums, not free-form plaintext.

## Policy

M4 is deny-by-default.

### Automatic replay

Not implemented.

### Governed closed-world read replay

A host policy may make a replay *eligible* only when all are true:

- source is trusted;
- current fresh risk class is `trusted_read_only_closed_world`;
- same source/tool/schema/input binding;
- prior outcome is known;
- current M1/M2 approval is fresh;
- an explicit fresh replay intent exists;
- duplicate count and time window remain within bounds.

Even in this case, replay is an explicit M4 transition, not an automatic retry.

### Mutating tools

Mutating tools do not receive replay authority from
`idempotentHint=true`.

M4 does not auto-authorize mutating replay. Any future mutation-replay mode must
have a separate explicit operator approval contract and independent evidence.

### Open-world reads

Open-world reads are not governed-policy replay candidates in M4. They require
a future explicit operator replay policy if support is added.

## Single-use replay permit

A successful replay-governance decision creates a short-lived process-local
single-use replay permit.

The permit is consumed synchronously immediately before the M3 executor obtains
execution authority.

A permit is invalid if any of these drift:

- endpoint fingerprint;
- principal-bound endpoint identity;
- selected tool;
- input schema digest;
- input digest;
- risk class;
- protocol era;
- replay key;
- prior execution reference;
- approval expiry.

## Retry and transport behavior

M4 does not add retries around `Client.callTool()`.

In particular:

- timeout after permit consumption => unknown outcome, no replay;
- connection drop after permit consumption => unknown outcome, no replay;
- SDK/protocol throw after permit consumption => unknown outcome, no replay;
- successful tool-level `isError=true` => known failure, explicit replay may be
  evaluated later;
- no exponential retry loop;
- no hidden retry count;
- no replay due solely to `idempotentHint`.

## Concurrency

Two concurrent attempts for the same replay key must not both acquire authority.

The ledger transition from available → reserved is synchronous and process-local.
The reservation is converted to a terminal known/unknown outcome after the M3
attempt.

If the process crashes while a reservation is active, M4 does not infer whether
the remote tool executed. A subsequent process has no durable proof and must not
claim safe replay from the lost process-local state.

## Public surface

Supported public M4 APIs may expose:

- replay eligibility evidence;
- replay intent creation;
- governed replay execution entry point;
- digest-only replay receipts;
- bounded non-sensitive status.

They must not expose:

- ledger mutation primitives;
- replay-key forgery helpers;
- raw M3 permits;
- raw lifecycle mutators;
- internal SDK client factories;
- raw proposal-argument resolvers;
- arbitrary clock injection.

## Required tests

Before merge, M4 must prove:

1. same key duplicate is blocked inside TTL;
2. different principal produces a different replay key;
3. different input digest produces a different replay key;
4. unknown outcome cannot be replay-authorized;
5. `idempotentHint=true` alone grants nothing;
6. mutating tool replay is denied by M4 governed-policy path;
7. open-world read replay is denied by M4 governed-policy path;
8. trusted closed-world read requires explicit fresh replay intent;
9. replay intent is single-use and expires;
10. concurrent identical replay attempts permit at most one execution;
11. replay receipt contains no raw argument/result/credential canaries;
12. exact input/schema/risk/protocol drift blocks before `callTool()`;
13. real official v2 stdio E2E proves one original call plus one explicitly
    authorized replay, with no hidden third call;
14. public package smoke proves internal ledger/permit seams are unavailable.

## Merge gate

M4 remains OPEN + DRAFT until:

- architecture and implementation are independently reviewed;
- targeted tests pass;
- real official MCP v2 E2E passes;
- full CI 9/9 passes on the exact head;
- all 12 repository workflows are green on the exact head;
- CodeQL, Secret Scan, Supply Chain, Provenance and existing security contracts
  remain unchanged or stronger.

No release, tag, npm publish or deploy is part of M4.
