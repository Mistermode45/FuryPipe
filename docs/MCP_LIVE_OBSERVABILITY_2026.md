# FuryPipe MCP Live Observability 2026

## Status

This track adds passive MCP observability to the normal Anthropic/Claude Code proxy path.

It does **not** add direct MCP execution.

Lifecycle invariants:

```
exposed
!= transport_verified
!= selected
!= observed_result
!= executed_by_furypipe
!= verified
```

Tool annotations are descriptive hints, not authority:

```
annotation
!= trust
!= approval
!= authorization
!= execution
```

## Runtime flow

For an Anthropic Messages request:

```
client request
  -> inspect MCP declarations in tools[]
  -> inspect historical assistant tool_use blocks
  -> correlate latest user tool_result by exact tool_use_id
  -> hash tool_use id / input / result
  -> classify annotation risk
  -> emit plaintext-free ProxyEvent / JSONL evidence
  -> continue the existing FuryPipe transform/provider path unchanged
```

Observation failure is fail-open: the provider request continues and a bounded
`mcp_error` diagnostic may be recorded.

## Exposure evidence

A tool is considered exposed only when the current request declares it as:

- `type: "mcp"`; or
- a Claude Code-style `mcp__server__tool` name.

Exposure does not prove server transport health. Every observed tool therefore
starts with:

```
transport_verified = false
```

until a separate transport-health layer supplies stronger evidence.

## External result evidence

An `observed_result` means only that FuryPipe saw a user `tool_result` whose
`tool_use_id` correlates with a previously observed assistant `tool_use` for
a currently exposed MCP tool.

It is intentionally recorded as:

```
executed_by_furypipe = false
```

FuryPipe did not perform that external call and must not manufacture an
`AgentCapabilityExecutionReceipt` from this observation.

To prevent repeated receipts from conversation history, only results carried by
the latest user turn are emitted as newly observed result evidence. Older
results suppress stale pending state but are not emitted again.

## Privacy

JSONL evidence never persists MCP argument/result plaintext.

Persisted fields are limited to:

- tool/server/tool identifiers;
- exposure evidence kind;
- SHA-256 of `tool_use_id`;
- canonical input SHA-256;
- result SHA-256;
- error boolean;
- lifecycle status;
- risk/trust classification;
- explicit false authority/execution flags.

## Risk policy

FuryPipe follows the MCP 2026-07-28 annotation defaults:

- `readOnlyHint = false`;
- `destructiveHint = true`;
- `idempotentHint = false`;
- `openWorldHint = true`.

Default proxy trust is `untrusted`.

Therefore, without a host-provided trust resolver:

```
risk_class = untrusted_unknown
closed_world_read_candidate = false
authorization_granted = false
requires_policy_gate = true
```

A future host may explicitly classify a server as trusted. Even then, the risk
assessment only produces a candidate classification. It never grants execution
authority.

## Node host

The Node product host enables passive MCP observation by default.

Kill switch:

```
FURYPIPE_MCP_OBSERVATION=off
```

This switch affects observation only. It does not alter existing MCP server
configuration in Claude Code and does not connect or disconnect any server.

## Deferred work

Separate tracks are required for:

1. source-bound trusted-server configuration;
2. real MCP transport health evidence;
3. governed direct MCP client connections;
4. parameter construction and schema validation;
5. approval policy for open-world reads and every mutation;
6. execution receipts produced only when FuryPipe actually performs a call;
7. bounded replay/idempotency policy;
8. dashboard visualization and live validation.

No direct MCP auto-execution may be claimed until those layers are separately
implemented and verified.
