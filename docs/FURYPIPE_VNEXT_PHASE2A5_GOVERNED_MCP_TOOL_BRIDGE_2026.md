# FuryPipe VNext — Phase 2A.5 Governed MCP Tool Bridge

**Status:** implementation track  
**Stack base:** exact PR #210 head `67fdd63fae28b0c03ab367d62603b04de566658d`  
**Branch:** `vnext-phase2a5-governed-mcp-tool-bridge`

## 1. Goal

Phase 2A.5 adds a governed tool lifecycle for local WebChat without turning a browser, WebSocket command, provider response, or model tool request into execution authority.

The implementation must reuse FuryPipe's existing MCP Direct governance:

```text
configured
!= connected
!= healthy
!= listed
!= selected
!= proposed
!= policy-eligible
!= operator-approved
!= permit-issued
!= executed
!= succeeded
!= verified
```

No shortcut may collapse these states.

## 2. Non-negotiable boundaries

The following remain distinct:

```text
browser authenticated != tool authorized
tool requested != tool selected
tool selected != proposal validated
proposal validated != policy allowed
policy allowed != operator approved
approved != permit issued
permit issued != executed
executed != succeeded
succeeded != verified
raw tool result != verified evidence
serialized receipt != process-local authority
```

A provider/model tool-call payload is untrusted application data. It may become a proposal input only after the host maps it to an exact configured source/tool and MCP Direct validates the arguments against the current tool schema.

## 3. Existing FuryPipe components to reuse

Phase 2A.5 MUST reuse, not duplicate:

- `probeMcpDirectInventory(...)`
- `selectMcpDirectTool(...)`
- `createMcpDirectToolProposal(...)`
- `evaluateMcpDirectPolicy(...)`
- `createMcpDirectOperatorApprovalIntent(...)`
- `approveMcpDirectPolicyDecision(...)`
- `executeMcpDirectApprovedTool(...)`
- MCP Direct lifecycle provenance and one-shot execution permit
- endpoint/schema/risk drift checks
- bounded result hashing and verification
- durable replay governance when enabled by a later host integration

The Agent Runtime may consume successful tool outcomes in a later orchestration layer, but it must not replace MCP Direct's stronger proposal/policy/permit lifecycle.

## 4. 2A.5a scope

The first implementation gate is a host-owned MCP tool bridge.

It accepts a bounded registry of exact MCP sources and one host-owned MCP Direct policy. It provides four lifecycle operations:

1. `propose`
2. `approve`
3. `execute`
4. `inspect`

### 4.1 Propose

`propose`:

1. resolves a host-owned source by exact `sourceId`;
2. probes a fresh inventory;
3. selects the exact requested tool;
4. validates exact arguments against the current input schema;
5. evaluates the host-owned policy;
6. stores only process-local proposal authority;
7. returns a redacted lifecycle receipt.

If policy says `deny`, no execution authority is created.

If policy says `require_operator`, the bridge returns `approval_required`.

If policy says `allow_governed_policy`, the bridge may create the existing short-lived governed-policy approval, but still does **not** execute the tool.

### 4.2 Approve

`approve` is a separate explicit operator action.

The bridge:

1. resolves the process-local pending proposal;
2. creates a fresh `McpDirectOperatorApprovalIntent`;
3. consumes it through `approveMcpDirectPolicyDecision`;
4. records an approved lifecycle.

A caller-supplied approval object, copied serialized intent, or policy decision must never be accepted as authority.

### 4.3 Execute

`execute`:

1. resolves an approved process-local proposal;
2. invokes `executeMcpDirectApprovedTool`;
3. lets MCP Direct re-probe inventory and detect endpoint/schema/risk drift;
4. lets MCP Direct create and synchronously consume its one-shot permit;
5. returns only a redacted receipt to the browser-facing layer.

Raw tool output stays process-local. It is not automatically inserted into chat history and is not automatically evidence.

### 4.4 Inspect

`inspect` exposes bounded metadata only:

- proposal identifier;
- source ID;
- endpoint fingerprint;
- tool name;
- input schema digest;
- input digest;
- risk class;
- policy outcome;
- approval kind when present;
- `executed`;
- `succeeded`;
- `verified`;
- result digest when execution produced one;
- expiry timestamps.

It never exposes raw arguments, credentials, raw tool results, command-line environment values, HTTP headers, or process-local permit objects.

## 5. Source authority

MCP source definitions are host-owned.

The browser cannot define:

- stdio commands;
- stdio args/env/cwd;
- HTTP URLs;
- HTTP headers;
- remote host allowlists;
- trust labels;
- endpoint fingerprints;
- MCP policies.

The bridge snapshots the configured source identities and derives/validates endpoint fingerprints with the existing MCP Direct runtime.

## 6. Transport authority

A future Gateway layer MUST preserve transport-specific capability scopes.

For stdio MCP:

```text
mcp.manage
+ capability.process
```

For Streamable HTTP MCP:

```text
mcp.manage
+ capability.network
```

A generic `mcp.execute` scope must not be invented as a shortcut around the actual transport capability.

State-only Gateway dispatch is forbidden for all operations that probe, connect, approve capability execution, or call a tool.

## 7. Operator approval

Only exact policy-allowlisted, trusted, closed-world read-only tools may use existing governed-policy approval.

Everything else must either:

- be explicitly operator-allowlisted and receive a fresh process-local operator intent; or
- be denied.

A WebChat button can trigger the approve command, but the serialized browser payload is only a request to create intent; it is not the intent itself.

## 8. Result semantics

UI/status language must remain exact:

- **Requested** — an application/model requested a tool.
- **Proposed** — exact arguments validated against the current schema.
- **Eligible** — policy evaluation permits an approval path.
- **Approval required** — operator intent is required.
- **Approved** — exact proposal received bounded approval.
- **Executed** — MCP call returned or reached a known executed terminal state.
- **Succeeded** — MCP result did not report tool error.
- **Verified** — FuryPipe verification evidence exists.

The UI must never render "verified" from `succeeded:true` alone.

## 9. Bounds and lifecycle

The bridge must bound:

- configured sources;
- pending proposals;
- proposal lifetime;
- concurrent proposal probes;
- concurrent executions;
- result bytes through the existing MCP executor;
- retained terminal receipts.

Expired pending proposals are removed and cannot be approved or executed.

Terminal proposal handles cannot be replayed for a second execution. MCP Direct one-shot permits and replay governance remain authoritative.

## 10. Provider tool calls

Automatic provider tool calling is **not** part of 2A.5a.

Current Phase 2A.4 provider request envelopes/transports do not yet expose a governed tool-definition channel. The strict provider response decoder therefore continues to reject provider tool/function-call output.

A later sub-gate may add provider tool definitions and decode tool requests, but only if:

1. tool definitions come from host-owned governed inventory;
2. model output remains an untrusted request;
3. every requested call re-enters this MCP proposal/policy/approval lifecycle;
4. the provider never receives or creates a tool execution permit.

## 11. Required tests

2A.5a must prove:

- unknown source rejected before network/process execution;
- unknown tool rejected;
- invalid arguments rejected by current schema;
- denied policy creates no approval;
- operator-required policy cannot execute before explicit approval;
- copied/forged proposal IDs or authority objects cannot execute;
- governed-policy approval only works for exact trusted closed-world read allowlist;
- stdio/HTTP runtime config remains host-owned;
- endpoint/schema/risk drift blocks execution;
- one proposal cannot execute twice;
- receipt preserves `executed != succeeded != verified`;
- raw tool output is not exposed by inspect/receipt;
- capacity/TTL bounds fail closed;
- existing MCP Direct tests remain green.

## 12. Exit criteria

Gate 2A.5a is proven only when the exact tested HEAD passes:

- typecheck;
- unit/integration tests;
- full CI matrix;
- package smoke;
- Secret Scan;
- Benchmark Contract;
- existing browser gates when affected.

No PASS claim may be inherited from another SHA.
