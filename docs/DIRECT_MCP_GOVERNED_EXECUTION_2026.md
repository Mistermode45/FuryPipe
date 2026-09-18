# Direct MCP Governed Execution — M3 (2026)

## Status and dependency basis

M3 is the first FuryPipe Direct MCP milestone permitted to execute one MCP tool
call after M1 inventory evidence and M2 policy/approval evidence.

The implementation target is the official
`@modelcontextprotocol/client@2.0.0` stable line for the MCP 2026-07-28
protocol. FuryPipe already pins that exact package version.

M3 does **not** introduce release, deployment, retry orchestration, multi-call
plans, server-initiated sampling/elicitation authority, or background execution.

## Authority lifecycle

The lifecycle remains explicit:

```text
configured
!= connected
!= healthy
!= listed
!= trusted
!= selected
!= arguments_validated
!= policy_evaluated
!= approved
!= execution_attempted
!= executed
!= succeeded
!= verified
```

Annotations remain descriptive hints:

```text
annotation != trust != approval != authorization != execution
```

An M3 call is allowed only from process-local FuryPipe evidence produced by the
supported M1/M2 path.

## Execution contract

Before any permit is consumed, M3 must:

1. validate the approved lifecycle and proposal provenance;
2. re-derive the endpoint fingerprint from the runtime config;
3. open a fresh official MCP v2 client connection to that exact endpoint;
4. negotiate the protocol era;
5. run a fresh bounded `tools/list` on the same client instance;
6. locate the exact selected tool;
7. require the fresh input-schema SHA-256 to match the approved proposal;
8. require the fresh risk class to match the approved proposal;
9. require the fresh protocol era/handshake to match the approved lifecycle;
10. recover the exact process-local validated arguments;
11. create a short-lived execution permit;
12. consume that permit synchronously immediately before the tool call.

Any endpoint, protocol-era, schema, selected-tool or risk drift fails closed
before tool execution.

## Exactly one governed call

M3 may perform exactly one `Client.callTool()` per approved lifecycle state.

FuryPipe does not implement automatic retries or replay. The approved lifecycle
state is process-locally marked as used for an execution attempt before the
wire call. A timeout or thrown SDK/protocol error therefore produces an
**unknown execution outcome** and the same approval cannot be replayed.

The official v2 client may perform a one-refresh retry for SEP-2243
`HEADER_MISMATCH` only when `toolDefinition` is omitted. M3 passes the fresh
same-session tool definition explicitly, so that SDK recovery path is disabled
for the governed execution call.

## Output validation

The fresh `tools/list` definition is passed to `Client.callTool()`.

The official v2 client therefore:

- validates the MCP `CallToolResult` wire shape;
- validates `structuredContent` against the tool's fresh `outputSchema`
  when one is advertised;
- fails before the tool request if that output schema cannot be compiled.

FuryPipe then canonicalizes the returned result under a bounded JSON size/depth
policy and records only SHA-256 execution evidence.

A normal returned result with `isError: true` is:

```text
executed = true
succeeded = false
verified = false
```

A normal non-error result whose SDK validation completed is:

```text
executed = true
succeeded = true
verified = true
verification_kind = schema
```

A thrown transport/SDK/protocol error after permit consumption is not relabeled
as success or failure of the remote tool. Its execution outcome is unknown and
must not be automatically retried.

## Privacy and evidence

Execution receipts may contain:

- source id;
- endpoint fingerprint;
- tool name;
- input-schema digest;
- input digest;
- policy-decision digest;
- approval kind;
- hashed permit id;
- result digest;
- protocol version;
- executed/succeeded/verified booleans.

Execution receipts must not persist:

- raw tool arguments;
- raw tool results;
- HTTP authorization headers;
- stdio environment secrets;
- raw MCP server stderr.

Raw arguments and the raw returned result may exist only in the live
process-local execution path.

## Connection and cache posture

M3 creates a fresh client instance for each governed execution attempt. It does
not inject or share an external response cache. The SDK's per-instance cache is
populated by the fresh `tools/list` immediately before the call.

This prevents one principal/server session from lending cached tool authority to
another and keeps:

```text
connected != healthy
listed != trusted
selected != approved
approved != executed
executed != succeeded
succeeded != verified
```

## Bounds

The runtime must keep explicit bounds for:

- connection timeout;
- list timeout;
- call timeout;
- protocol probe timeout;
- list pagination;
- stdio read buffer;
- HTTP response bytes;
- canonical result bytes;
- canonical JSON depth;
- execution-permit lifetime.

No bound may be weakened relative to M1/M2.

## Required evidence before merge

M3 is not mergeable until all of the following are true:

- unit tests cover permit consumption and no-replay behavior;
- schema/risk/protocol drift is proven to block the call;
- a thrown call proves one attempt only and returns unknown execution outcome;
- a tool-level error remains executed but not succeeded;
- receipt serialization contains no raw argument/result canaries;
- a real official v2 stdio server proves exactly one governed `callTool()`;
- the public package surface exposes the governed executor but no raw permit,
  lifecycle mutation, internal SDK factory or raw-argument resolver;
- exact-head CI is green on Windows, Linux and macOS across Node 22/24/26;
- CodeQL, Secret Scan, Supply Chain, Provenance and existing security workflows
  remain green.

No release, tag, npm publish or deploy is part of M3.
