# FuryPipe Proxy Capability Runtime — 2026 Architecture

## Status

`DESIGN + IMPLEMENTATION TRACK / NOT MERGED / NOT RELEASED`

This track starts from the exact live-validated Visual Engine / ExactGuard head
`aef734ce70f103bd625c7c2a73e73e2417befb86`.

It does not change the lifecycle rules:

```text
discovered != reviewed != approved != registered != connected
!= selected != activated != executable != executed != verified
```

## Goal

Make the normal FuryPipe proxy path used by Claude Code and other clients actually
benefit from Capability Router, Agent Skills, MCP, instruction profiles and
execution evidence without loading the whole ecosystem into every request.

The design must keep three independent concepts separate:

1. **instruction activation** — a trusted SKILL.md/profile is selected and loaded
   into the model context;
2. **tool/MCP execution** — a real callback/server method ran and returned;
3. **provider inference** — the upstream model produced the user-facing answer.

A skill being selected or loaded is not a tool execution receipt.

## 2026 research inputs

### Agent Skills open format

Pinned research source:

- `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`

The current Agent Skills format uses a small mandatory frontmatter surface
(`name`, `description`) and recommends progressive disclosure:

```text
startup      -> metadata only
activation   -> SKILL.md instructions
on demand    -> references / scripts / assets
```

FuryPipe adopts that architecture, not bulk prompt loading.

### MCP runtime patterns

2026 MCP/agent runtimes increasingly expose:

- tool filtering;
- deferred tool loading / tool search;
- list-tools caching;
- per-tool approval;
- tracing;
- read-only/destructive/idempotent/open-world annotations.

FuryPipe treats MCP annotations as hints only. A server that is not trusted does
not gain authority by self-declaring `readOnlyHint: true`.

Hard policy remains host-owned:

```text
trusted server
+ allowed method
+ stage/permission policy
+ approval state
+ replay/idempotency policy
-> execution
```

### Compact human communication

Research reference:

- `JuliusBrussee/caveman@542442bab314973709f95b85b1ac0b3f6f5b5dc6`

FuryPipe does not vendor or copy Caveman instructions. It adopts the product
principle that terse output must yield to clarity where ambiguity is dangerous.

The FuryPipe-native contract is:

- compact natural-language prose by default;
- normal explicit prose for security warnings, irreversible-action approvals,
  ambiguous multi-step instructions, or when the user asks for more clarity;
- never rewrite code, diffs, patches, shell commands, JSON/JSON-RPC, schemas,
  protocol payloads, tool calls/results, exact-response contracts, citations,
  identifiers or other ExactGuard-sensitive material.

This is a generation instruction, not a lossy response post-processor.

## Target architecture

```text
client request
   |
   v
Proxy Task Extractor
   |-- latest user objective only
   |-- connected tool/MCP metadata
   |-- no tool-result text promoted to instructions
   v
Capability Router
   |-- small relevant pack set
   |-- native instruction profiles
   |-- progressive Agent Skill candidates
   |-- connected MCP candidates
   v
Governance
   |-- provenance / license / trust
   |-- health / permission / network
   |-- MCP risk + approval
   |-- context budget
   v
Activation / execution
   |-- load selected SKILL.md only
   |-- auto-run only explicitly executable governed callbacks
   |-- MCP call only when connected + authorized
   v
Receipts
   |-- activation receipts != execution receipts
   |-- plaintext-free digests
   v
Stable prompt augmentation
   v
Visual Engine / ExactGuard
   v
provider
```

## Agent Skills integration

### Discovery

Node host discovers metadata only from configured roots. Initial compatibility
roots should support the open Agent Skills ecosystem while remaining explicit:

- project `.claude/skills/*/SKILL.md`;
- project `.github/skills/*/SKILL.md`;
- configured user-level roots.

Discovery never executes scripts.

### Validation

At minimum:

- directory/name agreement;
- name <= 64 characters and open-standard naming rules;
- description <= 1024 characters;
- bounded SKILL.md size;
- no NUL/control-path tricks;
- provenance record;
- explicit trust/license state before executable adapters are exposed.

Experimental `allowed-tools` metadata can inform routing but is never authority.

### Progressive disclosure

The global index stores only bounded metadata. Full SKILL.md bodies are opened
only after routing selects them. References/assets are loaded only when requested.

This keeps hundreds of discovered skills from consuming every provider request.

## MCP integration

### Connected inventory

FuryPipe distinguishes plugin catalog metadata from connected runtime MCP tools.

A bundle in `plugin-bundles.ts` is not connected merely because it has a URL.

### Risk vocabulary

For trusted servers, tool annotations can improve policy:

- read-only tools may be eligible for automatic read paths;
- destructive tools require approval;
- non-idempotent writes are not automatically replayed;
- open-world tool output is treated as untrusted data.

For untrusted servers, annotations are display/routing hints only.

### Deferred tools

The runtime should prefer metadata/tool search over eagerly injecting every tool
schema. Connected large MCP surfaces should expose only the task-relevant subset.

## Normal proxy integration

The existing `prepareFuryTask()` and `runPreparedFuryTask()` are real governed
APIs, but the normal `src/node.ts -> createProxy()` path does not call them.

This track closes that gap in stages:

1. extract a bounded task envelope from normal provider requests;
2. build a capability plan against the **real connected host inventory**;
3. activate relevant instruction skills/profiles using progressive disclosure;
4. execute only governed callbacks/MCP calls for which the host has real authority;
5. inject their results as untrusted context data;
6. persist activation/execution receipts separately;
7. expose the state in dashboard/Control Room.

No fake no-op callback may be recorded as an executed skill.

## Human output policy

A stable provider instruction will request compact human-facing prose only.

It must explicitly yield to:

- exact output requirements;
- structured response formats;
- code or data fidelity;
- security/approval clarity;
- tool/protocol traffic.

The proxy must never mutate a completed provider response merely to make it
"caveman". That would break signatures, exact strings, code, citations and
structured output.

## Implementation waves

### Wave A — substrate

- Agent Skills manifest parser + bounded metadata model;
- progressive discovery API;
- human-output policy module;
- task-envelope extractor;
- activation receipt type distinct from execution receipt.

### Wave B — normal proxy planning

- wire task extraction into Anthropic Messages first;
- then OpenAI Responses/Chat and Gemini adapters;
- Capability Router runs on every eligible user task;
- only stable compact routing instructions are injected.

### Wave C — governed execution

- host-supplied executable skills;
- connected MCP adapters;
- trusted annotation/risk normalization;
- read-only auto-execution policy;
- approval interrupts for writes/destructive actions;
- execution receipts.

### Wave D — observability

Dashboard shows:

```text
discovered
selected
activated
connected
approved
executed
verified
```

without collapsing states.

### Wave E — benchmark

Compare against baseline on representative workloads:

- coding/debugging;
- research;
- marketing website;
- business;
- Minecraft plugin;
- large MCP inventories.

Measure:

- task quality;
- tool/MCP success;
- false activations;
- prompt tokens;
- cache behavior;
- latency;
- approvals;
- failures;
- exactness regressions.

No performance claim becomes public until Benchmark Contract evidence exists.

## Non-goals

This track does not:

- auto-install arbitrary marketplace skills;
- trust a skill because it is popular;
- execute third-party scripts from SKILL.md automatically;
- trust MCP annotations from an untrusted server;
- silently approve writes/deletes/deployments;
- call a selected capability "executed" without a receipt;
- rewrite machine-sensitive provider output into terse prose.