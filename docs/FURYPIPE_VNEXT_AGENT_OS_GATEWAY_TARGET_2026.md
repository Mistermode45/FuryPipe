# FuryPipe VNext — Agent OS / Gateway Product Target (2026)

> Status: product architecture only. No runtime implementation in this document.
>
> VNext Phase 0 branch: `vnext-phase0-architecture-research`.
>
> This document supersedes any interpretation of VNext as a coding-only product.

## 1. Product definition

FuryPipe VNext should be an **open, self-hostable AI Agent OS / Gateway**.

Coding remains a first-class capability, but it is one capability among many.

The product should be able to live continuously on a user's machine or server and expose the same agent runtime through:

- terminal / TUI;
- web dashboard;
- desktop application;
- mobile companion/node;
- Discord;
- Telegram;
- WhatsApp;
- Slack / Teams-class channels;
- webhooks/API;
- ACP-compatible editors;
- future A2A-compatible agent services.

The product thesis becomes:

> **One Fury Gateway. One persistent agent identity and evidence plane. Many channels, devices, models, tools, skills, MCP servers, automations and specialist agents.**

FuryPipe should make the complexity automatic while keeping sensitive authority explicit.

---

## 2. Reference class

VNext should be compared primarily against **general agent runtimes** such as OpenClaw, Letta-class stateful agents, durable agent frameworks and related personal-agent projects.

Coding products such as OpenCode, Pi, Codex CLI, Claude Code, Cline and Cursor remain important references only for the **coding subsystem**.

This distinction matters:

```text
OpenCode-class product
= coding agent

OpenClaw-class product
= persistent agent gateway / personal AI runtime

FuryPipe VNext target
= persistent agent gateway / Agent OS
  + premium coding subsystem
  + FuryPipe context optimization
  + FuryPipe governance/evidence
```

---

## 3. OpenClaw architectural signals

Current OpenClaw architecture provides several useful product signals:

- one long-lived Gateway owns channels and routing;
- control-plane clients connect to that Gateway;
- device nodes connect with explicit capabilities;
- sessions are persistent and channel-aware;
- tools, skills and plugins are separate capability surfaces;
- automations can wake agents later;
- a managed browser gives the agent an isolated browsing lane;
- subagents run in isolated sessions;
- multi-agent fan-out has hard concurrency and lifetime limits;
- provider/model harnesses can be swapped;
- web UI, native apps and chat channels front the same underlying runtime.

FuryPipe should learn from those product boundaries, not copy OpenClaw implementation wholesale.

---

## 4. Key FuryPipe differentiation

FuryPipe should not win by having more integrations alone.

Its differentiators should remain:

### Automatic minimum-capability selection

```text
discover everything
index outside model context
select minimum useful set
load lazily
unload / compact
```

### Visual Context Engine

Keep text/context -> image as a first-class context codec when:

- the target model supports vision;
- measured token/cost economics justify it;
- fidelity is preserved;
- ExactGuard approves the transformation.

### Evidence-first execution

Never collapse:

```text
configured
connected
authorized
executed
succeeded
verified
```

into one vague "working" state.

### Strong durable recovery

Long-lived agent systems must survive:

- process restarts;
- transient provider failures;
- channel reconnects;
- automation restarts;
- interrupted tool calls.

Durability must preserve evidence without inventing replay authority.

### Model/provider freedom

The same Fury agent identity should work with:

- cloud models;
- local models;
- different provider APIs;
- external ACP/A2A coding agents where allowed.

---

## 5. Top-level architecture

```text
+------------------------------------------------------------+
|                    Fury Experience Layer                   |
| Web | Desktop | Mobile | TUI | CLI | IDE/ACP | API        |
+-----------------------------+------------------------------+
                              |
+-----------------------------v------------------------------+
|                       Fury Gateway                         |
| sessions | routing | auth | channels | nodes | events     |
| automations | notifications | config | health | RPC       |
+-----------------------------+------------------------------+
                              |
+-----------------------------v------------------------------+
|                        Fury Kernel                         |
| task loop | intent | permissions | budgets | cancellation |
+-----------------------------+------------------------------+
                              |
                   Capability Autopilot V2
       +--------------+------+-------+---------------+
       |              |              |               |
     Tools          Skills          MCP           Plugins
       |              |              |               |
       +--------------+------+-------+---------------+
                              |
       +----------------------+----------------------+
       |                      |                      |
  Context Engine         Memory Engine        Agent Fabric
  CodeGraph/RAG          short/long term      subagents/ACP
  Visual Engine          evidence-bound       A2A/specialists
       |                      |                      |
       +----------------------+----------------------+
                              |
                        Model Fabric
                              |
+-----------------------------v------------------------------+
|                    Execution Runtime                       |
| files | shell | git | browser | web | code | apps | MCP  |
+-----------------------------+------------------------------+
                              |
                 Sandbox / Worktree / Device Nodes
                              |
+-----------------------------v------------------------------+
|                Fury Governance & Evidence                  |
| policy | approvals | receipts | recovery | provenance      |
+------------------------------------------------------------+
```

---

## 6. Fury Gateway

The Gateway should be a long-lived service.

Responsibilities:

- persistent sessions;
- account/identity mapping;
- incoming message routing;
- outgoing delivery;
- automation scheduler;
- webhook/API ingress;
- device-node registry;
- provider/model connection registry;
- plugin/channel lifecycle;
- runtime health;
- events and notifications;
- authentication and pairing;
- configuration snapshots;
- observability.

The Gateway should **not** become an unrestricted monolith.

Agent execution, browser automation and high-risk actions should remain behind explicit capability and policy boundaries.

### Local-first default

Recommended default:

```text
127.0.0.1 / local-only
```

Remote access should require explicit configuration and authenticated transport.

---

## 7. Channels

Channels are transport adapters, not agents.

Example targets:

- Discord;
- Telegram;
- WhatsApp;
- Slack;
- Microsoft Teams;
- Matrix;
- WebChat;
- email connectors;
- SMS/device messaging where supported.

A channel adapter should normalize:

- sender identity;
- conversation/thread;
- attachments;
- reactions/events;
- permissions;
- delivery receipts.

Then route to an agent/session.

### Channel-specific policy

A Discord group conversation must not automatically receive the same authority as a private desktop session.

Authority can depend on:

- channel;
- account;
- sender;
- group;
- workspace;
- device;
- current authentication;
- requested capability.

---

## 8. Persistent sessions

FuryPipe needs explicit session types:

```text
main personal session
channel session
group session
project session
automation session
subagent session
coding workspace session
external-agent session
```

Sessions should preserve structured state outside the LLM context.

The chat transcript is not the sole source of truth.

---

## 9. Memory

VNext needs multiple memory classes.

### Working memory

Current task/session state.

### Episodic memory

What happened previously:

- tasks;
- decisions;
- outcomes;
- failures;
- user corrections.

### Semantic/profile memory

Stable useful preferences/facts that are allowed to persist.

### Project memory

Repository/workspace facts.

### Evidence memory

Receipts and provenance.

Memory remains:

```text
memory != instruction
memory != authority
memory != truth without evidence
```

Retrieval should be selective and source-aware.

---

## 10. Automations

FuryPipe should support persistent scheduled and event-triggered work.

Examples:

- morning brief;
- monitor a GitHub repository;
- summarize overnight server logs;
- check CI status;
- monitor Minecraft server health;
- remind the user;
- periodically research a topic;
- execute a bounded business workflow.

Triggers:

```text
cron
one-shot timestamp
interval
webhook
message event
file/repo event
external connector event
condition watch
```

Automations must persist across Gateway restarts.

### Critical invariant

An automation stores a requested policy scope, not eternal unrestricted authority.

At each execution:

```text
scheduled != authorized forever
```

Current policy, capability availability and credential state must still be checked.

---

## 11. Browser and Computer Use

FuryPipe should eventually expose at least two browser lanes.

### Managed browser

Dedicated isolated browser profile for the agent.

Use for:

- browsing;
- research;
- web forms;
- testing;
- repetitive workflows.

### User-session browser

Optional connection to the user's signed-in browser/session.

This is higher risk and should require stronger policy/approval.

### Browser evidence

Actions should record bounded receipts:

- origin;
- page identity;
- action type;
- outcome;
- screenshot/snapshot digest when needed.

Do not rely only on model narration.

---

## 12. Device nodes

The Gateway should be able to pair remote/local nodes.

Potential nodes:

- Windows PC;
- Linux server;
- macOS;
- iPhone/iPad;
- Android;
- headless worker;
- Minecraft host;
- developer workstation.

A node advertises capabilities.

Example:

```text
node: gaming-pc
caps:
  filesystem.read
  filesystem.write
  shell
  browser
  gpu
```

Another:

```text
node: iphone
caps:
  camera
  microphone
  notifications
  location (only if explicitly granted)
```

Capability advertisement does not equal permission.

```text
available != authorized
```

---

## 13. Voice and multimodal

FuryPipe VNext should plan for:

- speech-to-text;
- text-to-speech;
- realtime voice;
- images;
- documents;
- audio;
- video;
- camera/device input.

These should be plugin/provider surfaces rather than hardcoded dependencies.

The Visual Engine remains responsible for representation planning where appropriate.

---

## 14. Plugins

Plugins should be the primary code-extension unit.

A plugin may add:

- channel;
- tool;
- MCP integration;
- skill bundle;
- provider/model adapter;
- voice/TTS/STT;
- browser capability;
- media generation;
- hook;
- node command;
- automation trigger;
- UI panel.

Plugins require:

- manifest;
- version;
- source;
- permission declarations;
- trust information;
- compatibility metadata;
- lifecycle hooks;
- optional credentials schema.

Installation is never equivalent to trust.

---

## 15. Skills

Skills remain instruction/workflow packages.

Support Agent Skills / `SKILL.md` compatibility.

FuryPipe-specific improvement:

Do not put the whole skill catalog in the prompt.

Use Capability Autopilot:

```text
skill registry
 -> out-of-context index
 -> shortlist
 -> trust/compatibility check
 -> load selected SKILL.md
```

---

## 16. MCP

MCP remains a first-class tool/integration protocol.

FuryPipe should:

- discover MCPs;
- health-check where appropriate;
- classify tools;
- index schemas outside prompt context;
- expose only relevant tools;
- preserve M1-M5.1 governance;
- support stdio and network transports;
- maintain exact endpoint/tool/schema provenance.

Automatic MCP selection remains a core product requirement.

---

## 17. Tool Search

At very large scale, the model should not receive every tool definition.

Add a tool index/search layer.

```text
task
 -> needed capability
 -> tool search
 -> candidate schemas
 -> policy filter
 -> expose minimum tools
```

This applies to:

- native tools;
- MCP tools;
- plugin tools;
- device-node tools.

---

## 18. Coding subsystem

Coding is a **first-class native domain**, not the whole product.

Coding capabilities include:

- repository understanding;
- AST/LSP/CodeGraph;
- Git;
- shell;
- tests/build;
- browser QA;
- worktrees;
- sandboxes;
- PR review;
- CI interaction;
- ACP coding agents;
- coding-specific skills.

OpenCode, Codex CLI, Claude Code, Cline, Pi, Cursor and similar projects remain references here.

### External coding agents

Later, FuryPipe may delegate a bounded coding/review task to an ACP-compatible external agent.

External result:

```text
agent output != verified result
```

FuryPipe still validates evidence.

---

## 19. Subagents

Subagents are background specialist sessions.

Types:

### Research

- read-only by default;
- isolated context;
- bounded;
- non-recursive by default.

### Coding

- isolated worktree/sandbox;
- exact base commit;
- validation required.

### Operational

- bounded tools;
- explicit environment/node.

### Review

- independent context;
- no inherited conclusion from implementer.

Budgets:

- max concurrent;
- max total per task;
- max nesting;
- max token cost;
- max wall time;
- max tool calls.

---

## 20. Swarm / parallelism

Large fan-out should use bounded programmatic coordination rather than asking a model to invent an unbounded swarm.

FuryPipe should support:

- concurrency limits;
- group limits;
- lifetime spawn limits;
- structured results;
- cancellation;
- progress;
- cost budget.

No recursive agent explosion.

---

## 21. ACP and A2A

### ACP

Use ACP primarily for:

```text
IDE / client <-> FuryPipe agent
```

and optionally for external coding-agent delegation.

### A2A

Evaluate A2A for:

```text
Fury Gateway <-> remote agent service
```

Remote agents remain separate trust domains.

Agent discovery does not grant execution authority.

---

## 22. Durable execution

A persistent Agent OS requires true durability for long-running work.

Research from current durable-agent frameworks reinforces separating:

```text
durable execution
from
conversation/session storage
```

The system needs both.

Potential future architecture can learn from engines such as:

- Temporal;
- DBOS;
- Restate;
- Prefect;
- AWS durable functions;

without requiring FuryPipe to depend on one engine.

FuryPipe RecoveryStore/M5 durability work remains relevant.

### Principle

Every external side effect needs a stable execution identity.

Never re-run an uncertain side effect simply because the process restarted.

---

## 23. Notifications

FuryPipe should have a notification plane independent of chat delivery.

Examples:

- task completed;
- approval requested;
- automation failed;
- CI failed;
- server offline;
- agent blocked;
- security warning.

Destinations:

- desktop;
- mobile;
- Discord/Telegram/etc.;
- email;
- webhook.

Delivery status is distinct from task execution status.

---

## 24. Control UI

The web dashboard should eventually become a true Agent OS control center.

Primary surfaces:

### Chat

Conversations with the agent.

### Work

Active/recent tasks and long-running jobs.

### Automations

Schedules/triggers and execution history.

### Agents

Main agent, specialists and external agents.

### Skills

Installed/discovered/active skills.

### MCP & Tools

Servers, tools, health, permissions and usage.

### Plugins

Installed plugins and updates.

### Memory

Inspectable memory classes and sources.

### Devices

Paired nodes and capabilities.

### Channels

Discord/Telegram/WhatsApp/etc.

### Models

Providers/models/routing.

### Evidence

Receipts, approvals, tests, provenance.

### Settings

Security, permissions, budgets and connectivity.

---

## 25. Marketplace / registry

A future FuryHub/FuryRegistry could catalog:

- skills;
- plugins;
- MCP servers;
- agents;
- FuryPacks;
- channel integrations.

Do not build a marketplace before trust/install boundaries are stable.

Registry entry states:

```text
listed
reviewed
signed
installed
enabled
connected
authorized
verified
```

must remain distinct.

---

## 26. Personal and team modes

The same Gateway architecture should eventually support:

### Personal

One user, personal memory, private devices/channels.

### Team

Multiple principals with:

- isolated identities;
- roles;
- channels;
- workspaces;
- approvals;
- audit logs;
- shared/isolated memory.

Do not build team mode by simply sharing a personal agent session.

---

## 27. FuryPipe vs OpenClaw

FuryPipe should **not** attempt to be OpenClaw with another logo.

Useful OpenClaw ideas:

- long-lived Gateway;
- multichannel;
- device nodes;
- browser;
- automations;
- plugins;
- skills;
- subagents;
- sessions;
- web control plane.

FuryPipe-specific direction:

- stronger automatic capability minimization;
- Visual Context Engine;
- ExactGuard;
- explicit evidence lifecycle;
- durable MCP governance;
- CodeGraph;
- model/harness benchmarking;
- stricter provenance;
- provider-agnostic context optimization;
- advanced coding subsystem.

---

## 28. Problems observed in the OpenClaw class

Community reports around always-on personal agents highlight risks:

- configuration complexity;
- brittle upgrades;
- channel reconnect failures;
- unpredictable model behavior;
- token/cost growth;
- unclear reliability;
- too much tuning burden.

These reports are anecdotal, but they are valid product risks.

FuryPipe VNext should therefore optimize for:

- stable configuration schema;
- migrations with backups;
- health checks;
- dry-run upgrades;
- rollback;
- bounded automation failures;
- explicit model/provider health;
- deterministic policy;
- clear failure states;
- evidence-first status.

---

## 29. Product UX target

The user should be able to install FuryPipe and quickly get:

```text
Fury Gateway running
↓
choose provider/model
↓
connect Discord/Telegram/Web UI
↓
agent ready
```

Then say:

```text
"Surveille mon repo FuryPipe et préviens-moi si la CI casse."

"Corrige ce bug dans mon plugin Minecraft."

"Tous les matins, donne-moi les changements importants."

"Va vérifier mon panel et dis-moi si le serveur est en panne."

"Recherche les meilleures nouvelles libraries pour ce projet."

"Crée-moi le site, teste-le, puis montre-moi les preuves."
```

The user should not have to manually design the runtime topology for normal tasks.

---

## 30. Revised VNext phases

### Phase 0 — Agent OS architecture

Research and freeze:

- Gateway contract;
- session model;
- channel interface;
- plugin interface;
- node/device contract;
- automation contract;
- memory boundaries;
- capability indexing;
- security model.

### Phase 1 — Fury Gateway foundation

Long-lived local-first daemon with:

- typed RPC;
- health;
- config;
- sessions;
- events;
- authentication.

### Phase 2 — Fury Kernel + WebChat

One persistent agent through Gateway.

### Phase 3 — Capability Autopilot V2

Lazy:

- skills;
- MCP;
- tools;
- plugins;
- models.

### Phase 4 — Channels + notifications

Start with a small number of well-tested channels.

### Phase 5 — Automations + webhooks

Persistent schedules/events with durable execution semantics.

### Phase 6 — Browser + coding runtime

Managed browser, CodeGraph, worktrees, sandbox.

### Phase 7 — Memory VNext

Selective memory with provenance and user control.

### Phase 8 — ACP + external agent interoperability

ACP server first; governed ACP/A2A delegation later.

### Phase 9 — Devices + voice/multimodal

Paired nodes and plugin-based media/voice capabilities.

### Phase 10 — VNext beta

Task-first Agent OS becomes the recommended FuryPipe experience.

---

## 31. Gate before implementation

Before writing the Gateway, Phase 0 must specify:

1. Gateway protocol and security;
2. persisted session schema;
3. channel adapter contract;
4. identity/principal model;
5. plugin manifest/permission model;
6. automation durability semantics;
7. node pairing/capability model;
8. memory boundaries;
9. Capability Autopilot index contract;
10. migration path from existing FuryPipe.

Do not perform a destructive rewrite before these contracts are frozen and benchmarked.
