# Governed Direct MCP Runtime — 2026 foundation

## Status

Foundation track only. This document does **not** claim that FuryPipe currently
connects to or executes third-party MCP tools. The passive runtime merged in PR
#184 remains observation-only.

## Lifecycle contract

```text
configured
!= connected
!= healthy
!= listed
!= trusted
!= selected
!= approved
!= executed
!= succeeded
!= verified
```

Annotations remain descriptive:

```text
annotation != trust != approval != authorization != execution
```

## SDK/spec baseline

The implementation target is stable `@modelcontextprotocol/client` v2 for the
MCP 2026-07-28 revision.

- local process transport: stdio;
- remote transport: Streamable HTTP;
- legacy SSE: compatibility-only, never silently preferred;
- modern 2026 connections use discovery/version negotiation;
- a universal `ping()` is not defined for the modern era;
- therefore connection alone is not health evidence;
- successful bounded `listTools()` may provide liveness evidence.

## M0 — this PR

This track adds only the pure governance state machine:

1. source configuration with a non-secret endpoint fingerprint;
2. connection evidence;
3. separate health evidence;
4. bounded digest-only tool inventory;
5. explicit selection;
6. independent policy/operator approval;
7. source/tool/input-bound execution permit;
8. execution state;
9. separate verification state.

It imports no MCP client SDK and cannot call a tool.

## M1 — client transport adapter

Next:

1. add `@modelcontextprotocol/client@2.0.0` with lockfile update;
2. stdio + Streamable HTTP;
3. bounded connect timeout and clean close;
4. protocol-era capture;
5. source-bound endpoint identity;
6. bounded `listTools()` inventory only;
7. no `callTool()`.

## M2 — inventory + policy

Normalize tool schemas/annotations, bind source trust, reuse
`assessMcpToolRisk()`, validate proposed arguments, and create selection,
policy and approval receipts.

## M3 — governed execution

A call is allowed only after an input-bound permit is created and revalidated
immediately before exactly one `callTool()`. Returning a result sets
`executed`; protocol/result semantics determine `succeeded`; neither implies
`verified`.

## M4 — verification/live proof

Output-schema validation, semantic/operator verification when needed, exact-head
CI across supported OS/Node matrices, live stdio + Streamable HTTP proof, bypass
tests, and plaintext-canary telemetry checks.

## Security invariants

- untrusted sources default to no execution;
- annotations never grant trust or authority;
- no automatic destructive call;
- permits cannot be rebound across source/tool/input/policy decision;
- secrets are not persisted in receipts;
- endpoint identity is represented by a non-secret fingerprint;
- inventory is bounded to 256 tools;
- reconnect/retry never implies replay authority;
- idempotency hints are not retry authority;
- existing ExactGuard/policy controls continue to win.

No release, tag, npm publish, or deploy is part of this track.
