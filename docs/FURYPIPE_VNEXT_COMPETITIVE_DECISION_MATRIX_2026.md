# FuryPipe VNext — Competitive Decision Matrix (2026)

> Research companion to `FURYPIPE_VNEXT_PHASE0_ARCHITECTURE_RESEARCH_2026.md`.
>
> This document records architectural signals, not vendor rankings. "Not verified" means this research pass did not establish the capability from a sufficiently reliable current source.

## Matrix

| Product / project | Minimal core | Skills | MCP | ACP / agent protocol | Isolated subagents | Worktree isolation | LSP / code intelligence | Sandbox | Multi-provider | Hooks / lifecycle extensions | Main lesson for FuryPipe |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| OpenCode | Medium | Yes | Yes | Yes / ACP ecosystem | Yes | Ecosystem-dependent | Yes / editor-dependent | Policy-dependent | Yes | Plugins | Surface simplicity + provider freedom |
| Pi | **Strong** | Yes | Extension-based | ACP adapter available | Extension-based | Extension-based | Extension-based | Extension-based | Yes | **Strong extension API** | Keep kernel tiny and move sophistication to extensions/services |
| mini-SWE-agent | **Strong** | No central skills layer | No central MCP dependency | No central ACP dependency | No | Environment-dependent | Minimal by design | Environment-dependent | Model adapter | Minimal | Complexity is not automatically capability |
| Cline | Medium | Yes | Yes | Not central | **Yes, separate read-only research context** | Not primary signal | Repo tools | Host/editor controls | Yes | Extensible | Read-only research subagents should be isolated and non-recursive |
| Cursor | Large IDE surface | Rules/skills ecosystem | Yes | Not central | Yes | **Yes** | **Strong IDE intelligence** | Cloud/local controls | Yes | Yes | Parallel writing agents need isolated worktrees |
| Continue | Medium | Rules/prompts/tools | Yes | Not central | Varies | Not primary | **LSP + imports + recent-file context** | Host-dependent | Yes | Extensible | Code context should use language intelligence, not only grep/read |
| Crush | Medium-small | **Agent Skills** | **Yes** | Not central | Agent definitions | Not primary | **LSP** | Permissions | **Yes** | **Hooks** | Terminal UX + LSP + lazy extensibility is a strong baseline |
| Gemini CLI | Medium | **Agent Skills** | **Yes** | **ACP server mode** | **Yes** | Not primary | Tool-dependent | Permissions | Google + extensions | Extensions/hooks | ACP + MCP can compose cleanly |
| Qwen Code | Medium | **Agent Skills** | **Yes** | Can delegate to external agents / ACP adapters | **Yes** | Not primary | Tool-dependent | Permissions | Yes | Plugins | Portable skills/plugins are becoming ecosystem standards |
| GitHub Copilot CLI | Large harness | **Agent Skills** | **Yes** | Not primary | **Built-in specialized agents** | Cloud agent/workspace dependent | Editor/service intelligence | Policy / environment | BYOM supported | **Hooks + plugins** | Skills/MCP/agents are table stakes; harness efficiency matters more |
| Kiro | Large product surface | **Yes** | **Yes** | Not central in this pass | **Yes** | Product-dependent | IDE intelligence | Permissions | Configurable | **Hooks** | Same runtime concepts across IDE/CLI/Web is desirable |
| OpenHands | Large autonomous stack | Extension ecosystem | Integrations | Agent server APIs | Agent/runtime architecture | Runtime-dependent | Agent tools | **Docker/runtime isolation** | Yes | Automation services | High-risk execution needs real sandboxing |
| Warp | Large ADE | Not central | Integrations | Third-party CLI support | Cloud/local agents | Agent workflows | **LSP/editor integrated** | Platform controls | Multiple agents | Automation | Terminal + agent + editor can be one experience |
| Replit Agent | Large hosted product | Internal capabilities | Integrations | Hosted APIs | Internal | Hosted branches/projects | Hosted IDE context | **Hosted isolation** | Service-selected | Internal automation | End users value idea->working artifact, not framework concepts |
| Agent Skills spec | N/A | **Standard** | N/A | N/A | N/A | N/A | N/A | N/A | Harness-neutral | N/A | FuryPipe should be compatible but avoid dumping huge metadata catalogs into prompts |
| ACP ecosystem | N/A | N/A | Can bridge MCP tools | **Standardizing editor<->agent** | N/A | Client-dependent | Editor-provided | Client-dependent | Agent-neutral | Protocol-level | Implement FuryPipe once, expose to multiple editors |

## Market convergence

The 2026 coding-agent market is converging on:

```text
Skills
MCP
custom agents / subagents
hooks
memory / steering
multi-provider
context compaction
permissions
```

Those capabilities alone are no longer a durable differentiator.

## FuryPipe differentiators to protect

### 1. Minimum-sufficient capability selection

FuryPipe should discover a huge ecosystem while exposing almost none of it by default.

```text
discover everything
index outside context
select minimum useful set
load lazily
unload/compact
```

### 2. Evidence-first lifecycle

Preserve:

```text
available != relevant
relevant != connected
connected != approved
approved != executable
executable != executed
executed != verified
```

This should remain visible in receipts and advanced UI.

### 3. Visual context codec

Text/context -> image is retained when the transformation is:

- model-compatible;
- economically useful;
- fidelity-safe;
- protected by ExactGuard.

### 4. CodeGraph

Use LSP/AST/Git/semantic signals so the model does not repeatedly rediscover code structure through expensive textual search.

### 5. Budget governor

Hard runtime limits for:

- tokens;
- context;
- tool calls;
- skills;
- MCP tools;
- subagents;
- recursion depth;
- concurrency;
- time;
- cost.

### 6. Worktree and environment provenance

Every writing agent gets an exact base SHA and explicit environment bootstrap.

### 7. ACP interoperability

FuryPipe should first become an ACP-compatible agent, then optionally gain governed external-agent delegation.

### 8. Harness benchmarking

Do not assume one prompt/tool arrangement works best for every model.

Measure:

```text
correctness
tokens
latency
cost
tool calls
patch footprint
review acceptability
```

per model/harness profile.

## Design rules derived from research

### Rule A — kernel simplicity

Do not put domain catalogs or large workflow logic into the permanent system prompt.

### Rule B — progressive disclosure is necessary but insufficient

Even skill descriptions can become expensive at extreme scale.

Use an out-of-context local index before model exposure.

### Rule C — read-only and write agents are different products internally

Research agents:

- separate context;
- narrow tools;
- usually read-only;
- no recursive spawning by default.

Writing agents:

- isolated worktree/sandbox;
- exact base SHA;
- stronger evidence and validation.

### Rule D — worktree creation is not environment readiness

Validate:

- dependencies;
- env requirements;
- generated files;
- services;
- toolchains.

Do not copy secrets implicitly.

### Rule E — workflow != runtime

Keep:

```text
research -> plan -> implement -> test -> review
```

separate from:

```text
which model/agent executes each phase
```

### Rule F — no benchmark, no superiority claim

Vendor benchmark claims and community reports are useful for hypotheses, not proof.

FuryPipe decisions should be validated by FuryBench/repository-specific evals.

## Near-term decisions

### Adopt / build

- Fury Kernel facade;
- Capability Autopilot V2;
- external skill/MCP indexes;
- Fury CodeGraph;
- Budget Governor;
- Worktree Manager;
- sandbox tiers;
- ACP server;
- FuryBench Harness.

### Preserve

- Visual Engine;
- ExactGuard;
- Context Optimizer;
- Instruction Fabric;
- Provider/Model Fabric;
- FuryTrust;
- RecoveryStore;
- Continuous Memory;
- M1-M5.1 governance/evidence.

### Re-evaluate

- M6 as the permanent central orchestration abstraction;
- component-heavy public onboarding;
- loading large capability catalogs into model context;
- manual mode proliferation;
- static one-size-fits-all model prompts.

### Avoid

- rewrite-from-zero;
- automatic recursive subagent trees;
- all-tools/all-skills exposure;
- shared mutable checkout for parallel writers;
- hidden retries;
- treating agent statements as verification;
- provider/model routing without benchmark evidence.

## Primary current sources

- OpenCode docs: https://opencode.ai/docs/
- Pi docs/repository: https://github.com/botiverse/pi-coding-agent
- mini-SWE-agent: https://github.com/SWE-agent/mini-swe-agent
- Agent Skills spec: https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
- ACP: https://zed.dev/acp
- ACP Registry: https://zed.dev/blog/acp-registry
- Continue context selection: https://docs.continue.dev/ide-extensions/agent/context-selection
- Cursor worktrees: https://prod.cursor.com/docs/configuration/worktrees
- OpenHands runtime: https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/runtime.mdx
- Cline subagents: https://github.com/cline/cline/blob/main/docs/features/subagents.mdx
- Gemini CLI skills/ACP/subagents: https://geminicli.com/docs/
- Qwen Code skills/subagents/MCP: https://qwenlm.github.io/qwen-code-docs/
- GitHub Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli
- Kiro: https://kiro.dev/docs/
- Warp: https://docs.warp.dev/
- Replit Agent: https://docs.replit.com/references/agent/overview
- VS Code harness/token-efficiency posts: https://code.visualstudio.com/blogs/2026/
