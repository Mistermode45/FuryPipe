# FuryPipe VNext — Phase 2A.5 Governed Tool Bridge

**Status:** implementation present — exact-HEAD evidence pending  
**Stack base:** exact Phase 2A.4 HEAD `85637af0e329cd2363c59e1825869151d90ba16c`  
**Branch:** `vnext-phase2a5-governed-tool-bridge`

## 1. Goal

Expose governed MCP tool use to the local FuryPipe WebChat without weakening the existing FuryPipe MCP Direct lifecycle, Gateway admission model, Agent Runtime boundaries, or evidence semantics.

This gate does **not** turn model output, browser state, a WebSocket command, or serialized approval data into tool execution authority.

## 2. Non-negotiable lifecycle

```text
configured
  != connected
  != healthy
  != listed
  != selected
  != proposed
  != policy-eligible
  != operator-approved
  != execution-permitted
  != executed
  != succeeded
  != verified
```

Existing MCP Direct process-local evidence remains the source of authority:

- lifecycle state;
- catalog handle;
- tool proposal;
- policy decision;
- operator intent;
- approved lifecycle;
- execution permit;
- execution receipt.

Serialized copies never become executable authority.

## 3. Boundaries

### Browser / WebChat

The browser may:

- inspect a sanitized inventory;
- request creation of a bounded tool proposal;
- see the proposal digest, source/tool identity, risk class and policy outcome;
- explicitly approve a proposal that policy marked `require_operator`;
- request execution only after approval exists;
- receive sanitized lifecycle/receipt information and a bounded display result.

The browser may not:

- choose arbitrary MCP runtime credentials;
- define endpoint fingerprints;
- forge trust labels;
- forge risk annotations;
- supply a policy decision ID as authority;
- supply an execution permit;
- replay a prior execution by resending JSON;
- convert provider text into an approved tool call.

### Gateway

Gateway command admission is necessary but never sufficient.

Tool commands use the asynchronous execution boundary, not the state-only dispatcher. At minimum, tool-network operations require:

- a live operator session;
- dedicated MCP scopes;
- `capability.process` + declared `process` permission for stdio probing/execution;
- `capability.network` + declared `network` permission for Streamable HTTP probing/execution.

The two transport capability paths are deliberately separate; configuring one transport does not grant the other capability.

Gateway admission remains `executionAuthority:false`.

### MCP Direct

The bridge must call existing MCP Direct primitives:

1. `probeMcpDirectInventory`;
2. `recordMcpDirectSelection`;
3. `createMcpDirectToolProposal`;
4. `evaluateMcpDirectPolicy`;
5. `createMcpDirectOperatorApprovalIntent` when required;
6. `approveMcpDirectPolicyDecision`;
7. `executeMcpDirectApprovedTool`.

The executor remains responsible for exact fresh-inventory checks, schema/risk/protocol drift checks, permit creation/consumption, replay governance and execution receipts.

## 4. Host-owned source configuration

Phase 2A.5 foundation accepts MCP runtime sources and policies from the host runtime as process-local configuration.

The browser cannot create or mutate:

- command / argv;
- HTTP URL;
- allowlisted hosts;
- headers / credentials;
- principal binding;
- source trust;
- endpoint fingerprint;
- policy allowlists.

The implemented local operator adapter loads these values from the strict file referenced by `FURYPIPE_WEBCHAT_MCP_CONFIG`. Credential-bearing stdio environment variables and HTTP headers are represented in that file only by **host environment variable names**; values are resolved process-locally.

The file is a bounded, regular, non-symlink JSON file using `furypipe-gateway-local-tool-config/v1`. Source fingerprints are derived from the resolved runtime configuration rather than accepted from the browser or config file.

Raw MCP application-result display is host-owned and defaults to disabled. It is enabled only when the file explicitly sets `allowDisplayResult:true`.

## 5. Bridge state

The bridge owns bounded ephemeral records:

- source inventory cache;
- pending proposals;
- pending operator approvals;
- approved executions.

Each pending record is keyed by a server-generated opaque ID and stores the exact process-local evidence objects required later.

Bounds are mandatory for:

- configured sources;
- inventory tools;
- pending proposals;
- proposal TTL;
- raw argument bytes;
- concurrent probes/executions;
- result display bytes.

Expiration removes process-local authority. An expired proposal must be recreated from a fresh inventory.

## 6. Policy behavior

Policy outcomes map to WebChat states:

### `deny`

- no approval intent;
- no execution;
- safe denial code only.

### `allow_governed_policy`

Allowed only when MCP Direct itself proves the tool is a trusted closed-world read candidate on the exact governed allowlist.

The bridge may approve with `governed_policy`, but execution remains a separate action and exact permit creation remains inside the MCP Direct executor.

### `require_operator`

The bridge returns a sanitized pending proposal.

A later explicit `tool.approve` command creates a process-local operator intent and consumes it into an approved lifecycle. The browser never receives the operator intent object.

## 7. Result semantics

A successful bridge response must preserve the exact execution receipt distinctions:

```text
executed=true, succeeded=false, verified=false
executed=true, succeeded=true, verified=false
executed=true, succeeded=true, verified=true
```

A result is never labelled verified unless the MCP Direct executor's receipt says `verified:true`.

Raw tool result is process-local application data. Browser display is disabled by default. When the host explicitly enables it, the UI receives only a bounded plain-JSON representation; durable evidence remains receipt/digest based.

Unknown execution outcome is terminal for automatic retry.

Fresh-inventory identity/protocol drift, tool disappearance, input-schema drift, risk-class drift, invalid fresh tool definition and missing governed `callTool` capability are typed as **pre-call rejections**. They preserve:

```text
executed=false
succeeded=false
verified=false
retrySafe=false
```

A transport failure after `callTool` has been invoked preserves the different state:

```text
executed=unknown
succeeded=unknown
verified=false
retrySafe=false
```

The bridge must never rewrite one state into the other.

## 8. Provider/model interaction

Phase 2A.4 plain model inference continues to reject provider tool/function-call content.

Phase 2A.5 does not silently reinterpret rejected model tool calls as authority.

A future model-tool planner may produce a **request to propose** a tool call, but it must still traverse the full MCP Direct proposal/policy/approval/execution lifecycle defined here.

## 9. Implemented bridge API

The process-local bridge exposes:

```ts
inspectSources()
inspectSource(sourceId)
propose({ sourceId, toolName, arguments })
approve({ proposalId })
execute({ proposalId })
discard({ proposalId })
```

No public API accepts a lifecycle, catalog, proposal, policy decision, operator intent, permit or receipt object from the caller.

## 10. Gateway commands

Implemented state-only commands:

- `tools.sources.inspect`
- `tools.discard`

Implemented async execution-boundary commands:

- `tools.source.inspect.stdio`
- `tools.source.inspect.http`
- `tools.propose.stdio`
- `tools.propose.http`
- `tools.approve`
- `tools.execute.stdio`
- `tools.execute.http`

The transport-specific names are security-relevant: the adapter checks the real configured source transport before inspect/propose, and checks the process-local proposal transport before execution. A stdio proposal cannot be rerouted through the HTTP command or vice versa.

All commands remain admission-only until the bridge creates/uses exact process-local MCP evidence.

`tools.approve` represents explicit local operator intent only after the user activates the corresponding WebChat control for the exact pending proposal.

## 11. WebChat UX

The UI must clearly display:

- source and tool;
- risk class;
- proposal created;
- policy outcome;
- operator approval required / approved;
- execution started;
- executed;
- succeeded;
- verified / unverified;
- blocked / outcome unknown.

No generic green "success" state may collapse these distinctions.

The implemented Tools panel keeps tool activity outside the assistant transcript. The operator must explicitly:

1. refresh a selected source inventory;
2. choose a listed tool and submit bounded JSON arguments;
3. create a proposal;
4. approve it when policy returns `require_operator`;
5. request execution separately.

A Gateway/backpressure rejection does not synthesize a new proposal or permit; the UI only re-enables actions that remain valid according to the server-held proposal state.

## 12. Tests required

Implemented tests already cover the following; final PASS still requires all checks to be green on one exact final SHA:

Two execution-boundary cases are proven with real stdio MCP fixtures at the bridge level:

- fresh schema drift between proposal and execution is rejected before `callTool` with `MCP_DIRECT_EXECUTION_PRE_CALL_REJECTED`, preserving `executed=false / succeeded=false / verified=false`;
- transport loss after the MCP server receives `tools/call` is surfaced as `MCP_DIRECT_EXECUTION_OUTCOME_UNKNOWN`, preserving `executed=unknown / succeeded=unknown / verified=false`, `retrySafe=false`, and the consumed proposal cannot be re-executed.

- forged/copied proposal IDs cannot create authority;
- invalid tool args fail schema validation before execution;
- source/tool/schema/risk drift fails closed **before callTool** and is exposed as `executed=false`;
- transport loss after invocation is exposed as non-retriable `outcome-unknown` and does not replay the proposal;
- denied policy never executes;
- operator-required proposal never executes before explicit approval;
- operator intent is one-shot and proposal-bound;
- governed-policy auto-approval is restricted to exact trusted closed-world read allowlist;
- execution receipt preserves executed/succeeded/verified distinctions;
- unknown outcome is non-retriable;
- result bounds prevent oversized browser output;
- no runtime credentials appear in Gateway/WebChat responses or evidence;
- state-only Gateway dispatcher cannot execute tools;
- async execution allowlist is explicit and independently backpressured;
- full CI/package smoke/Secret Scan/Benchmark/Cross-Browser gates remain green.

## 13. Browser QA

The existing Cross-Browser workflow now includes **12 real browser cases**:

- 6 conversation lifecycle cases: Chromium / Firefox / WebKit × desktop/mobile;
- 3 governed model cases: one per engine;
- 3 governed MCP tool cases: one per engine using the real stdio MCP fixture.

The tool cases exercise the real UI sequence:

```text
source metadata
→ refresh inventory
→ propose
→ require_operator
→ approve
→ execute
→ executed=true
→ succeeded=true
→ verified=true
```

They also assert that the MCP result is rendered only in the Tools panel and never inserted into assistant chat.

## 14. Gate completion

2A.5 is complete only when the local authenticated operator can inspect, propose, explicitly approve where required, execute and inspect MCP tool receipts while FuryPipe still proves the following on one exact final HEAD:

```text
browser session != tool authority
Gateway eligible != MCP approved
MCP approved != execution permit
execution permit != executed
executed != succeeded
succeeded != verified
```
