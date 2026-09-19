# FuryPipe VNext — Phase 0 Architecture & Competitive Research (2026)

> Status: architecture/research only. No VNext runtime code is introduced by this document.
>
> Source checkpoint: FuryPipe M5.1 exact head `023a80169e0667b4b57e35be3e6d76bc224460a7`.
>
> Date: 2026-09-19.

## 1. Executive direction

FuryPipe VNext should stop presenting itself primarily as a large orchestration framework and become a **simple, universal coding/general agent** with a deliberately small permanent kernel.

The sophisticated systems FuryPipe already owns remain valuable, but they move behind a capability-selection boundary and become **lazy, evidence-bearing services** instead of permanent prompt/runtime weight.

The product direction is:

```text
OpenCode / Pi-class simplicity at the surface
+
FuryPipe automatic capability selection
+
FuryPipe context and Visual Engine
+
FuryPipe governance/evidence/recovery
+
ACP/MCP/Agent Skills interoperability
```

The user should normally start with:

```bash
furypipe
```

and ask for the task directly.

The user should not have to decide up front:

- which skill to load;
- which MCP server to expose;
- which subagent to create;
- which model/provider should handle each phase;
- whether a worktree is needed;
- whether the task should use read-only, workspace-write, or sandboxed execution;
- how much repository context to load;
- whether a visual representation is cheaper or more useful than text.

FuryPipe should make those choices conservatively, make them observable, and preserve explicit authority boundaries.

---

## 2. What must survive VNext

VNext is **not** a clean-room rewrite.

The following FuryPipe systems are strategic assets and should be preserved or evolved:

### Context and token systems

- Context Optimizer;
- ExactGuard;
- Visual Engine, including text/context -> image representations where measurably useful;
- model-aware context planning;
- source-bound exact-value protection;
- bounded context budgets.

### Capability systems

- Capability Router;
- Instruction Fabric;
- skill registry and trust metadata;
- MCP discovery/routing;
- Model / Provider Fabric;
- automatic capability relevance scoring.

### Governance and evidence

- M1-M5.1 Direct MCP governance and durable evidence work;
- explicit lifecycle truth states;
- RecoveryStore;
- FuryTrust;
- receipts/evidence;
- fail-closed semantics;
- source/provenance boundaries.

### Memory and recovery

- Continuous Memory;
- explicit recall boundaries;
- memory as data, not authority;
- durable recovery and maintenance governance.

These systems should become implementation services behind a smaller Fury Kernel.

---

## 3. What should change

### Current weakness

The current product surface exposes too much of the underlying platform model:

```text
context
skills
MCP
instructions
agents
provider routing
memory
policy
evidence
control plane
```

That is powerful for framework authors, but it creates cognitive load for a user who simply wants:

```text
fix this bug
build this feature
review this PR
understand this repository
```

### VNext rule

The default user experience should be **task-first, not component-first**.

Internal sophistication remains available through inspection and advanced configuration, but should not be required to start productive work.

---

## 4. Competitive research summary

This research used current 2026 public documentation, repositories, community discussions, and recent videos. Claims from vendors/projects are treated as project claims unless independently verified.

### OpenCode

Useful ideas:

- terminal-first user experience;
- multi-provider operation;
- primary agents and subagents;
- MCP and skills;
- progressive disclosure;
- simple invocation;
- composability.

Takeaway for FuryPipe:

**copy the simplicity, not the architecture wholesale.**

FuryPipe should provide a similarly direct surface while retaining stronger internal evidence/governance and more aggressive automatic capability selection.

Reference:
- https://opencode.ai/docs/

### Pi coding agent

Pi is especially important architecturally.

Its core intentionally remains small and delegates richer behavior to:

- TypeScript extensions;
- skills;
- prompt templates;
- packages;
- SDK/RPC integrations.

This strongly supports the VNext decision to keep the kernel small.

Reference:
- https://github.com/botiverse/pi-coding-agent
- https://github.com/botiverse/pi-coding-agent/blob/main/docs/index.md

### mini-SWE-agent

mini-SWE-agent is another important signal: a deliberately tiny agent loop can remain highly capable when the model, environment and harness are well designed.

Its public benchmark claims should not be treated as an independent FuryPipe comparison, but its architecture demonstrates that complexity in the harness is not automatically quality.

Reference:
- https://github.com/SWE-agent/mini-swe-agent

### VS Code / GitHub Copilot harness

Microsoft's 2026 engineering posts are highly relevant.

They explicitly treat the **coding harness** as a first-class system covering:

- context assembly;
- tool exposure;
- agent loop;
- language/editor services;
- validation;
- token efficiency;
- latency.

They also report testing harness changes to reduce exploration and tokens while preserving or improving task success.

Takeaway:

FuryPipe needs its own **Harness Bench** and should tune harness behavior per model based on evidence, not assumptions.

References:
- https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode
- https://code.visualstudio.com/blogs/2026/06/17/improving-token-efficiency-in-github-copilot
- https://code.visualstudio.com/blogs/2026/07/06/optimizing-vscode-coding-harness-model-providers

### Cline

Cline's research subagents demonstrate a useful isolation model:

- separate context;
- explicit token budgets;
- parallel research;
- read-only tools;
- no nested subagents;
- result returned to the main context.

Takeaway:

FuryPipe should distinguish **exploration subagents** from **writing agents**.

Exploration subagents should usually be read-only, short-lived, non-recursive and context-isolated.

Reference:
- https://github.com/cline/cline/blob/main/docs/features/subagents.mdx

### Cursor / worktrees

Cursor documents worktrees as isolated checkouts for parallel agents.

Takeaway:

Any FuryPipe agent that can write in parallel should normally receive an isolated worktree or sandbox rather than share a mutable checkout.

Reference:
- https://prod.cursor.com/docs/configuration/worktrees

### OpenHands

OpenHands reinforces the value of sandboxed execution for arbitrary code.

Takeaway:

Logical permissions alone are not sufficient for all tasks. FuryPipe should support a real isolation tier using containers or equivalent sandbox runtimes.

Reference:
- https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/runtime.mdx

### Continue

Continue's context selection uses signals including:

- nearby file content;
- LSP definitions;
- imports;
- recent file history.

Takeaway:

FuryPipe needs a first-class **CodeGraph / Code Intelligence** service rather than relying primarily on file reads and textual search.

Reference:
- https://docs.continue.dev/ide-extensions/agent/context-selection

### Kiro

Kiro's 2026 surface combines:

- steering;
- hooks;
- MCP;
- permissions;
- custom agents;
- skills;
- subagents;
- checkpoints/rewind;
- compaction.

Its skills use progressive disclosure and automatic activation.

Takeaway:

FuryPipe should remain compatible with this emerging ecosystem vocabulary, but should hide most of the manual mode switching behind Capability Autopilot.

References:
- https://kiro.dev/docs/
- https://kiro.dev/docs/skills/
- https://kiro.dev/docs/hooks/actions/

### GitHub Copilot CLI

Copilot CLI now exposes:

- Agent Skills;
- custom agents;
- MCP;
- hooks;
- plugins;
- memory;
- context compaction;
- BYOM options.

It also includes separate agents for quick repository exploration, command execution and more complex general work.

Takeaway:

The market is converging on **skills + MCP + hooks + agents + memory**, so FuryPipe's advantage cannot simply be that these components exist.

The advantage must be **better selection, governance, context efficiency, observability and interoperability**.

References:
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/overview
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills

### Warp

Warp combines a modern terminal, agent workflows, editor/LSP surfaces and support for third-party coding agents.

Takeaway:

The user should not have to choose between "terminal product" and "agent product." FuryPipe should eventually offer both through the same runtime.

Reference:
- https://docs.warp.dev/

### ACP

The Agent Client Protocol is strategically important.

Zed's ACP Registry currently exposes many agents through a common protocol, including major coding-agent CLIs. ACP-compatible clients include editors beyond Zed.

Takeaway:

FuryPipe VNext should strongly target:

1. **ACP server mode** — FuryPipe as an agent usable from compatible editors.
2. Later, optionally, **ACP client/orchestrator mode** — FuryPipe can delegate bounded tasks to another installed agent when evidence shows that is useful.

References:
- https://zed.dev/acp
- https://zed.dev/blog/acp-registry

### Agent Skills specification

The Agent Skills format defines a portable `SKILL.md` package with progressive disclosure.

Important observation:

The standard still expects metadata for discovered skills to be available to the harness. That can become expensive at very large skill counts.

Takeaway:

FuryPipe should support Agent Skills **without exposing every discovered skill directly to the model**.

Reference:
- https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx

---

## 5. Community signals

Community reports are anecdotal and must not be treated as benchmark evidence, but several recurring pain points are useful product signals.

### Multi-agent coordination is becoming the hard problem

Developers report that launching many agents is easy; coordinating:

- task ownership;
- worktrees;
- shared state;
- handoffs;
- reviews;
- merge gates;

is harder.

FuryPipe can differentiate with a governed coordination layer instead of simply increasing the number of agents.

### Worktree state is easy to get wrong

Users report failures where:

- an agent operated in the wrong checkout;
- environment state was not copied into the worktree;
- agents started from different or stale commits.

FuryPipe worktrees therefore need exact provenance:

```text
repo
baseCommitSha
branch
worktreePath identity/digest
taskDigest
agent identity
model
environment profile
createdAt
```

### Context and token usage remain major pain points

Users report:

- excessive skill metadata;
- repeated repository exploration;
- repeated handoff context;
- subagent context explosion;
- duplicated research across agents.

FuryPipe should treat context cost as a runtime resource governed mechanically, not merely by prompt instructions.

### Independent review remains valuable

A recurring workflow is:

```text
one agent implements
another agent reviews
CI/tests provide objective gates
human decides whether to land
```

FuryPipe should make this workflow easy without claiming that multiple agents automatically improve correctness.

---

## 6. VNext target architecture

```text
+------------------------------------------------------+
|                   Fury Experience                    |
| TUI | CLI | Desktop | ACP | IDE | Web | Headless    |
+---------------------------+--------------------------+
                            |
                       Fury Kernel
                  minimal agentic harness
                            |
                 Intent / Task Classifier
                            |
                 Capability Autopilot V2
          +-----------------+------------------+
          |                 |                  |
        Skills             MCP               Agents
      indexed/lazy      indexed/lazy       isolated/lazy
          |                 |                  |
          +-----------------+------------------+
                            |
                      Context Engine
          +-----------------+------------------+
          |                 |                  |
      Fury CodeGraph     Memory/RAG       Visual Engine
    LSP/AST/Git/refs      documents       text -> image
          |                 |                  |
          +-----------------+------------------+
                            |
                       Model Fabric
       classify | plan | code | summarize | vision | review
                            |
                     Execution Runtime
      files | shell | browser | git | MCP | external agents
                            |
                  Sandbox / Worktrees
                            |
                   Fury Governance
                    M1-M5.1 + policy
                            |
                    Evidence Engine
             receipts | tests | provenance | CI
```

---

## 7. Fury Kernel

### Goal

The kernel must remain small enough that:

- default startup is fast;
- initial context is small;
- local/smaller models remain usable;
- a model is not forced to reason about systems irrelevant to the current task.

### Permanent primitive capabilities

A practical minimal set is:

```text
read
edit
write
search
shell
task
```

The exact public tools can evolve, but the rule is:

> Kernel tools should be universal primitives. Domain capabilities belong behind lazy services.

### Kernel responsibilities

The kernel owns:

- session loop;
- user intent;
- tool-call protocol;
- cancellation;
- bounded budget accounting;
- authority checks;
- evidence emission;
- interaction with Capability Autopilot.

It should not own thousands of skills, MCP tool schemas, provider-specific prompts or large workflow definitions.

---

## 8. Capability Autopilot V2

This should become one of VNext's defining components.

### Discovery is not prompt exposure

FuryPipe may discover:

```text
10,000 skills
100 MCP servers
2,000 tools
30 agents
20 models
```

without putting those objects into the model context.

### Proposed pipeline

```text
task
 -> classify capability families
 -> query local capability index
 -> shortlist candidates
 -> score relevance
 -> check compatibility
 -> check trust/license/policy
 -> estimate token/context cost
 -> estimate execution cost/latency
 -> select minimum sufficient set
 -> expose only selected capabilities
```

### Scoring signals

Potential signals:

- task semantic similarity;
- repository language/framework;
- explicit user constraints;
- capability historical success;
- trust level;
- freshness;
- provider/tool health;
- required permissions;
- token overhead;
- latency;
- monetary cost;
- risk classification.

No single heuristic should silently grant authority.

---

## 9. Skill architecture

FuryPipe should be compatible with Agent Skills while adding an indexing layer.

### Problem

Progressive disclosure solves full-body loading but not necessarily huge metadata catalogs.

### VNext skill index

Store metadata outside the model context:

```text
skillId
name
description embedding / lexical index
domain tags
runtime requirements
trust
license
version
source
token estimate
required tools
risk
historical evidence
```

At task time:

```text
global index
 -> family shortlist
 -> top candidates
 -> minimum useful set
 -> load full SKILL.md only when selected
 -> load referenced resources only when needed
```

### Compatibility

Support:

- `.agents/skills`;
- common Claude/Codex skill directories where safe;
- FuryPipe-native registry;
- project-local skills;
- user-global skills;
- pinned packages.

---

## 10. MCP architecture

Use the same lazy-selection principle.

### Do not expose every tool

Instead:

```text
MCP registry
 -> capability family
 -> server shortlist
 -> health/trust/policy
 -> connect if needed
 -> tools/list
 -> expose only relevant tools
```

### Preserve FuryPipe governance

VNext must keep:

```text
discovered != relevant
relevant != connected
connected != approved
approved != executable
executable != executed
executed != verified
```

M5/M5.1 durable evidence remains evidence, never authority.

---

## 11. Fury CodeGraph

A new core service should provide code intelligence.

### Inputs

- AST;
- LSP definitions/references;
- imports;
- call/dependency graph;
- symbol ownership;
- Git history;
- recent edits;
- diagnostics;
- tests touching symbols/files;
- semantic retrieval.

### Goal

Return the smallest useful representation:

```text
symbol
 -> relevant declaration
 -> relevant references
 -> relevant fragments
 -> full file only when justified
```

### Why

Repeated grep/read loops waste:

- tokens;
- time;
- model attention.

CodeGraph should reduce exploration while keeping evidence inspectable.

---

## 12. Visual Context Engine

The existing text/context -> image work should remain a FuryPipe differentiator.

VNext should treat it as a **context codec**.

Possible representations:

```text
raw text
exact snippets
structured AST
summary
table
visual rendering
image
```

A planner chooses based on:

- model vision capability;
- measured image token economics;
- task;
- exact-value requirements;
- visual density;
- profitability;
- fidelity.

ExactGuard remains mandatory.

No content is transformed to image simply because the target model accepts images.

---

## 13. Model and harness routing

VNext should separate:

```text
model selection
from
harness profile selection
```

Different models may need different:

- system prompts;
- tool descriptions;
- tool-call patterns;
- context order;
- reasoning budgets;
- edit strategies.

### Possible model roles

```text
classifier
search planner
summarizer
architect
coder
vision reader
reviewer
security reviewer
```

But role routing should only be enabled when benchmarks show a net benefit.

### Harness benchmark rule

A routing change ships only when it improves one or more of:

- correctness;
- token cost;
- latency;
- review acceptability;

without unacceptable regression elsewhere.

---

## 14. Subagents

### Exploration subagents

Default properties:

- isolated context;
- read-only;
- no write access;
- no nested subagents;
- bounded token/time/tool budgets;
- concise structured result.

### Writing agents

Writing agents should not share a mutable checkout by default.

Use:

- worktree;
- container;
- or another isolated workspace.

### Recursive spawning

Default:

```text
maxSubagentDepth = 1
```

unless an explicitly governed workflow proves a need for more.

All budgets are enforced by the runtime, not by natural-language requests.

---

## 15. Worktree Manager

Each isolated writing task records exact provenance.

Required metadata:

```text
repository identity
base commit SHA
worktree identity
branch
task digest
agent/runtime
model
permission profile
environment profile
creation time
result commit/diff digest
```

Environment bootstrap must be explicit.

A worktree is not considered ready merely because `git worktree add` succeeded.

VNext should support hooks/recipes for:

- dependencies;
- env templates;
- generated files;
- build caches;
- local service configuration.

Secrets must not be copied implicitly.

---

## 16. Sandbox tiers

Suggested tiers:

### READ_ONLY

- repository reads;
- safe search;
- code intelligence;
- no mutations.

### WORKSPACE_WRITE

- project writes;
- bounded shell;
- no unrestricted host mutation.

### SANDBOX

- container or equivalent isolated runtime;
- resource quotas;
- restricted mounts/network.

### PRIVILEGED

- explicit user/operator authorization;
- narrowly scoped action;
- strong receipt/evidence.

The task engine should request the minimum tier needed.

---

## 17. ACP strategy

### Phase A — ACP server

FuryPipe should be usable as an agent in ACP-compatible editors.

Goal:

```text
Fury runtime
 -> ACP
 -> Zed / VS Code / JetBrains / other ACP clients
```

This avoids rebuilding the same editor integration multiple times.

### Phase B — optional ACP client

Later, FuryPipe may invoke another installed ACP-compatible agent for a bounded role.

Examples:

- independent review;
- provider-specific specialist;
- alternate implementation experiment.

This must never become opaque authority delegation.

External-agent output remains untrusted evidence until verified.

---

## 18. Hooks and FuryPacks

The ecosystem is converging on:

- skills;
- hooks;
- agents;
- MCP;
- instructions;
- workflows.

FuryPipe should provide a portable bundle format, tentatively **FuryPack**.

Example conceptual content:

```yaml
name: minecraft-paper-plugin
skills:
  auto: true
capabilityFamilies:
  - java
  - gradle
  - minecraft-paper
validation:
  - build
  - tests
  - plugin-smoke
sandbox:
  preferred: workspace-write
modelHints:
  architecture: reasoning
  implementation: coding
```

A FuryPack is not injected wholesale into the prompt.

It is configuration/index material used by Capability Autopilot.

---

## 19. Evidence-first UX

VNext should keep one of FuryPipe's strongest differentiators.

Never collapse:

```text
agent said success
```

into:

```text
verified success
```

A task report should show evidence explicitly:

```text
files modified            verified
build executed            verified
tests                     118 passed
browser QA                not executed
security scan             not executed
deployment                not executed
```

No missing evidence is promoted to success.

---

## 20. User-visible modes

Avoid requiring users to understand a large taxonomy.

Internally FuryPipe can classify work into behaviors such as:

```text
FAST_EDIT
PAIR
AGENT
DEEP_AGENT
WORK
```

but the default interaction remains natural language.

The system may show the chosen behavior and let advanced users override it.

---

## 21. Token and budget governor

Tokens, time, money and concurrency become explicit runtime resources.

Possible hard bounds:

```text
maxInputTokens
maxOutputTokens
maxContextBytes
maxToolCalls
maxSubagents
maxSubagentDepth
maxConcurrentAgents
maxWallClock
maxEstimatedCost
maxMcpToolsExposed
maxSkillsLoaded
```

These limits are code-level constraints.

They are not advisory prompt text.

---

## 22. Session/context architecture

VNext should support:

- context compaction;
- branch/rewind semantics;
- source-aware summaries;
- handoff to a fresh context;
- preserved evidence outside conversational context.

The model's conversation is not the source of truth for task state.

Task state belongs in structured runtime/evidence stores.

---

## 23. Workflow vs agent separation

A strong community/product signal is that **agent runtime** and **development workflow** should be separable.

Example:

```text
workflow:
research -> plan -> implement -> test -> review

runtime assignment:
research -> cheap/read-only model
plan -> reasoning model
implement -> coding model
review -> independent model
```

The workflow defines:

- phases;
- gates;
- required artifacts;
- permissions;
- validation.

The runtime/model assignment can change independently.

This allows FuryPipe to benchmark:

```text
same workflow + different model/harness
```

instead of conflating model and process.

---

## 24. Benchmark contract

FuryPipe VNext must not claim superiority from architecture alone.

Create a reproducible **FuryBench Harness**.

### Metrics

At minimum:

- task resolution;
- build/test outcome;
- behavioral correctness;
- patch size;
- review acceptability;
- tool-call count;
- input/output tokens;
- context bytes;
- wall-clock latency;
- estimated/actual cost where known;
- retries;
- subagent count;
- duplicate exploration rate.

### Test classes

- small bug fix;
- repository exploration;
- cross-file refactor;
- frontend change with browser validation;
- backend change;
- dependency upgrade;
- failing CI diagnosis;
- security review;
- documentation task;
- Minecraft/Paper plugin task;
- large monorepo task.

### Repo-specific evals

Support users/teams defining local tasks from their own repositories.

A harness change should be measurable against the same task set before and after.

---

## 25. M6 disposition

PR #199 currently represents the M6 multi-call DAG workstream.

VNext Phase 0 must **not modify or invalidate it**.

However, M6 should no longer automatically be assumed to be the final center of FuryPipe orchestration.

Treat M6 as:

- a source of scheduler/concurrency primitives;
- a source of durability/evidence tests;
- an experimental orchestration substrate.

Before merging M6 into a VNext architecture, review whether its abstractions fit:

- the minimal Fury Kernel;
- workflow/runtime separation;
- lazy Capability Autopilot;
- worktree isolation;
- ACP external-agent boundaries.

Do not discard useful work, but do not let existing work force the VNext architecture.

---

## 26. Migration strategy

### Phase 0 — Architecture and evidence

Deliver:

- this architecture;
- competitive matrix;
- preserve/replace decisions;
- VNext benchmark contract;
- migration plan.

No runtime rewrite.

### Phase 1 — Fury Kernel facade

Build a minimal task-loop facade **around existing FuryPipe systems**.

Do not remove old APIs.

Goal:

```bash
furypipe
```

starts the new task-first experience.

### Phase 2 — Capability Autopilot V2

Add out-of-context indexes for:

- skills;
- MCP;
- agents;
- models.

Expose only the minimum selected subset.

### Phase 3 — Fury CodeGraph

Integrate:

- LSP;
- AST;
- references;
- imports;
- Git;
- diagnostics;
- semantic retrieval.

### Phase 4 — ACP server

Expose FuryPipe through ACP without duplicating the runtime.

### Phase 5 — Worktree + sandbox execution

Introduce:

- Worktree Manager;
- environment bootstrap;
- sandbox tiers;
- provenance receipts.

### Phase 6 — Harness profiles + FuryBench

Measure model-specific:

- prompt/harness profiles;
- context strategies;
- routing;
- token efficiency.

### Phase 7 — external-agent interoperability

Only after governance is stable:

- ACP client/delegation;
- independent external reviewers;
- bounded agent composition.

### Phase 8 — VNext beta

New task-first UX becomes recommended.

Legacy framework APIs remain available during a defined compatibility window.

---

## 27. Preserve / replace matrix

| Existing FuryPipe area | VNext disposition |
|---|---|
| Visual Engine | Preserve and elevate into Context Engine |
| ExactGuard | Preserve |
| Context Optimizer | Preserve/evolve |
| Capability Router | Evolve into Capability Autopilot V2 |
| Instruction Fabric | Preserve behind lazy selection |
| Skill registry | Preserve, add external index |
| MCP M1-M5.1 | Preserve as governance substrate |
| Provider Fabric | Preserve/evolve |
| Agent Runtime | Refactor behind Fury Kernel |
| Task Orchestrator | Re-evaluate against workflow/runtime split |
| RecoveryStore | Preserve |
| Continuous Memory | Preserve behind retrieval boundary |
| FuryTrust | Preserve |
| receipts/evidence | Preserve and elevate in UX |
| Control Plane | Keep as observability/advanced surface |
| Web Studio | Keep as optional surface |
| M6 DAG | Evaluate/extract; not automatically VNext core |
| large public component API | Maintain compatibility, reduce prominence |
| component-first onboarding | Replace with task-first onboarding |

---

## 28. Non-goals

VNext is not:

- a clone of OpenCode;
- a clone of Claude Code;
- a replacement for MCP;
- a requirement to run multiple agents;
- a requirement to run expensive models;
- a promise that routing always beats one strong model;
- an excuse to weaken FuryPipe evidence/governance;
- a clean rewrite that discards tested systems.

---

## 29. Product thesis

The VNext product thesis is:

> **Discover everything. Load almost nothing. Select the minimum useful capabilities. Execute in the smallest safe environment. Verify what actually happened.**

This combines the strongest 2026 coding-agent trends with FuryPipe's existing differentiators.

The target user experience is simple:

```text
User:
"Fix this bug."

FuryPipe:
- understands task;
- retrieves minimal code context;
- activates only relevant skills/tools;
- selects safe execution mode;
- optionally isolates work;
- executes;
- validates;
- reports evidence.
```

The internal implementation may be sophisticated.

The user should not have to manage that sophistication manually.

---

## 30. Gate before implementation

No major VNext runtime migration should begin until the following are agreed and tested:

1. minimal Fury Kernel responsibilities;
2. Capability Autopilot V2 index contract;
3. CodeGraph abstraction;
4. Agent Skills compatibility rules;
5. MCP lazy exposure rules;
6. ACP server boundary;
7. worktree/sandbox provenance contract;
8. budget governor;
9. FuryBench baseline;
10. compatibility plan for current FuryPipe public APIs.

Until then, VNext work should remain research, prototypes and benchmarkable experiments rather than destructive refactors.
