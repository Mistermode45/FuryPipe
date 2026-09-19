# FuryPipe VNext — OpenClaw-like Ecosystem Research (2026)

> Status: Phase 0 research only. No runtime code changes.
>
> Scope: products and open-source projects that overlap with OpenClaw's "always-on personal agent / gateway / Agent OS" model rather than coding-only agents.

## 1. Why this category matters

FuryPipe VNext is now targeting a broader product class than a coding assistant.

The closest market category is:

```text
persistent personal/work agent
+ gateway
+ messaging channels
+ memory
+ automations
+ tools / MCP / plugins
+ browser/computer use
+ subagents
+ device or remote execution
+ self-hosting / provider freedom
```

No single competitor provides every desirable property perfectly. The useful strategy is to decompose the landscape by architectural idea, keep FuryPipe's existing evidence/security advantages, and avoid copying a competitor wholesale.

---

## 2. Closest OpenClaw-class systems

### OpenClaw

Reference role: product-class baseline.

Important concepts:

- long-lived Gateway;
- channel adapters;
- persistent sessions;
- plugins and skills;
- MCP/tools;
- cron/webhooks;
- browser and computer-use lanes;
- device nodes;
- subagents/swarm;
- provider/model abstraction;
- local/self-hosted operation.

FuryPipe should treat OpenClaw as a UX/product reference, not as an implementation template.

### Hermes Agent — Nous Research

Hermes is one of the strongest references for FuryPipe.

Current public capabilities include:

- persistent memory across sessions;
- skills that can be created/improved from experience;
- messaging gateway across many chat platforms;
- cron / scheduled tasks;
- background completion notifications;
- MCP;
- multi-instance profiles;
- multiple model providers;
- gateway sessions;
- durable multi-agent Kanban-style work;
- self-hosting from VPS to larger infrastructure;
- desktop/TUI surfaces.

Architectural ideas worth examining:

#### A. Learning loop

Hermes treats procedural knowledge as reusable skills rather than endlessly growing conversation state.

Potential FuryPipe adaptation:

```text
observed successful workflow
-> candidate reusable skill
-> offline evaluation
-> trust/review
-> versioned skill
```

FuryPipe should not allow an agent to silently promote its own behavior into trusted instructions.

#### B. No-agent scheduled jobs

Hermes supports scheduled jobs that can run a script without paying for an LLM turn.

This is especially valuable for FuryPipe:

```text
cheap deterministic task
!=
LLM task
```

Examples:

- health check;
- disk usage;
- HTTP probe;
- CI polling;
- file rotation;
- Minecraft server ping.

Only wake an LLM when interpretation is necessary.

#### C. Durable multi-agent task board

Hermes' task-board direction highlights an important distinction:

```text
agent spawning
!=
work coordination
```

FuryPipe should persist task ownership, leases, progress, blocking reasons and handoffs independently from chat context.

---

### NanoClaw — Qwibit

NanoClaw is intentionally much smaller than OpenClaw and emphasizes OS-level isolation.

Important ideas:

- small understandable core;
- agent jobs in separate containers;
- filesystem isolation;
- messaging integrations;
- scheduled tasks;
- memory/context management;
- approval dialogs for sensitive actions;
- local-model additions through skills.

The most important FuryPipe lesson is **sandbox-first agent isolation**.

Instead of:

```text
one huge trusted process
+ application-level checks
```

prefer:

```text
Gateway / control plane
+
isolated executor
+
minimum mounts
+
minimum network
+
explicit credentials
```

This aligns well with FuryPipe's existing authority/evidence work.

---

### ZeroClaw

ZeroClaw explores the opposite end of the runtime spectrum: a small Rust binary designed to run widely while still supporting providers, channels, tools, browser access and MCP.

Key lesson:

**The Gateway does not need to be heavyweight just because it is extensible.**

For FuryPipe this suggests separating:

```text
small always-on Gateway
from
heavy optional execution workers
```

A low-resource Gateway can remain online while browser/code/sandbox workloads start only when needed.

---

### NullClaw

NullClaw pushes the lightweight architecture even further using Zig and a single compact runtime.

Relevant design signal:

- aggressive memory/startup minimization;
- provider-agnostic architecture;
- channels;
- tools;
- memory backends;
- sandboxing;
- MCP;
- voice;
- subagents;
- hardware-oriented portability.

FuryPipe does not need to chase binary-size marketing numbers, but should establish explicit idle-resource targets for the long-lived Gateway.

Recommended future FuryBench metrics:

```text
gateway idle RSS
cold startup
warm startup
idle CPU
database footprint
per-session overhead
per-connected-channel overhead
```

---

### PicoClaw

PicoClaw targets inexpensive/edge hardware and now includes Android support, hooks, steering and an event bus.

Important FuryPipe lesson:

**Device/edge deployment should be an architectural contract, not an afterthought.**

FuryPipe could eventually have:

```text
Fury Gateway
  on VPS / home server

Fury Node
  on desktop / Android / small ARM hardware
```

The node should advertise capabilities without receiving authority automatically.

---

### nanobot — HKUDS

nanobot explicitly describes its future as a lightweight personal agent companion spanning:

- terminal;
- browser;
- local files;
- web;
- memory;
- automations;
- chat delivery.

This is close to the desired FuryPipe experience.

Useful lesson:

A personal Agent OS does not need to expose every infrastructure detail to the user. A wizard plus a browser workbench can get the runtime running quickly.

FuryPipe onboarding should therefore target:

```text
install
-> choose provider
-> start Gateway
-> connect first channel
-> agent ready
```

before exposing advanced governance/configuration.

---

### QwenPaw

QwenPaw targets a personal AI companion with:

- proactive workflows;
- evolving memory;
- chat integrations;
- scheduled tasks;
- local files;
- research/news summaries;
- creative automation;
- a coding mode with IDE-style UI.

Important product signal:

**Coding can be embedded as a dedicated workspace inside a broader personal agent.**

This supports the FuryPipe direction:

```text
Agent OS
  -> Coding workspace
  -> Research workspace
  -> Automations
  -> Browser
  -> Personal assistant
```

rather than making coding the top-level identity of the entire product.

---

## 3. Agent OS / autonomous-worker references

### OpenFang

OpenFang explicitly positions itself as an "Agent Operating System" rather than a chatbot framework.

Its product framing includes autonomous agents that:

- run on schedules;
- monitor targets;
- build knowledge;
- perform recurring business tasks;
- report through a dashboard.

FuryPipe should borrow the **Agent OS mental model**, but avoid letting autonomous scheduling blur authority.

FuryPipe invariant:

```text
autonomous
!=
unbounded authority
```

Long-lived permissions must remain scoped, revocable and auditable.

---

### Kortix / Suna

Kortix/Suna is a strong reference for "agents doing real work on computers" rather than only tool-calling inside chat.

Notable ideas:

- self-hostable control plane;
- separate sandbox provider for agent execution;
- Git-backed configuration;
- real cloud computer execution;
- persistent agent sessions;
- deployable projects;
- explicit self-host vs cloud host targets.

Important FuryPipe lesson:

### Separate control plane from execution plane

```text
Fury Gateway
  sessions/config/events

       !=

Fury Worker
  browser/code/computer/sandbox
```

Workers should be replaceable and remotely addressable.

That gives FuryPipe flexibility to execute:

- locally;
- on a VPS;
- in Docker;
- in a remote sandbox service;
- on a paired workstation.

---

### Agent Zero

Agent Zero remains relevant as a general autonomous agent environment with Docker-first installation.

Useful FuryPipe lesson:

A complicated agent runtime still needs a **friendly launcher/onboarding surface**.

The VNext technical architecture should not force normal users to understand:

- Docker;
- MCP transport;
- provider endpoints;
- vector stores;
- worker topology.

Advanced users can inspect those layers later.

---

### OpenManus

OpenManus is a general-agent framework rather than a persistent personal Gateway, but it is useful for its browser/computer-work patterns.

Current architecture includes Browser Use integration as an MCP capability.

FuryPipe lesson:

Browser/computer capabilities should be standardized behind a runtime boundary rather than tightly coupled to the reasoning agent.

---

## 4. Memory-centric systems

### Letta

Letta is one of the most important references for persistent agent identity and memory.

Its product now includes:

- stateful agents;
- persistent memory/identity;
- app server;
- terminal UI;
- desktop/web access;
- Slack/Telegram/Discord/custom channels;
- SDK integration.

FuryPipe should study Letta's separation between:

```text
agent identity/state
conversation history
memory
runtime process
channel client
```

The Fury Gateway should not equate "conversation transcript" with "agent state."

---

### memU

memU is specifically designed for always-on proactive agent memory and reducing the token cost of long-lived context.

This directly overlaps FuryPipe's strengths.

Potential FuryPipe architecture:

```text
raw history
-> memory extraction
-> source/provenance binding
-> relevance index
-> compact semantic memory
-> task-scoped recall
```

Never inject all memory every turn.

This combines well with FuryPipe's existing Context Optimizer.

---

### Khoj

Khoj is a strong "personal second brain" reference:

- self-hosting;
- user documents;
- internet access;
- desktop/web/Obsidian/Emacs surfaces;
- local/private deployment.

FuryPipe lesson:

Agent OS memory should include **user knowledge and project knowledge**, not only agent trajectory/history.

---

## 5. Workflow / business-agent platforms

These are not direct OpenClaw replacements, but they solve important pieces FuryPipe will need.

### Dify

Dify provides:

- agent runtime;
- visual workflows;
- knowledge pipelines;
- plugin marketplace;
- model/tool support;
- self-hosting;
- API/web-app/MCP publication;
- workflow error branches;
- deployment versions;
- observability integrations.

FuryPipe should learn from Dify's **visual execution model**.

A future FuryPipe Control Plane could display a task as:

```text
Trigger
 -> Research
 -> Human approval
 -> Browser action
 -> Validate
 -> Notify
```

without forcing the runtime itself to become a no-code graph engine.

---

### n8n

n8n remains stronger for deterministic business workflows than free-form autonomous agents.

Important FuryPipe lesson:

Use a deterministic workflow engine when the process is deterministic.

```text
LLM decision
only where needed
```

not:

```text
LLM controls every step
```

FuryPipe could eventually integrate with n8n via MCP/API instead of rebuilding thousands of SaaS connectors.

---

### Lindy

Lindy is a useful commercial reference for the integration experience: users want Gmail, Calendar, Slack, CRM and thousands of app integrations without managing infrastructure.

FuryPipe cannot reasonably hand-build every connector.

Therefore VNext should support three integration lanes:

```text
native high-value plugins
MCP
external connector platforms / OAuth brokers
```

Each lane must preserve provenance and permission scope.

---

### TrustClaw — Composio

Composio's TrustClaw is particularly relevant because it combines:

- personal assistant;
- recurring tasks;
- Telegram/web;
- vector memory;
- large OAuth tool catalog;
- sandboxed execution.

This reinforces two FuryPipe decisions:

1. OAuth connector management is a major product capability.
2. Third-party action execution should be isolated from the long-lived Gateway.

---

## 6. Chat / agent hubs

### LibreChat

LibreChat is not an autonomous Agent OS, but it is an important reference for:

- self-hosted multi-provider chat;
- user-created agents;
- MCP;
- granular MCP tool selection;
- code interpreter sandbox;
- multi-user environments;
- runtime MCP settings.

Especially interesting: LibreChat's Programmatic Tool Calling lets code running in a sandbox orchestrate registered MCP tools.

Potential FuryPipe concept:

```text
model
-> generate bounded program
-> sandbox
-> approved tool SDK
-> execute many deterministic calls
-> return compact result
```

This can reduce repeated LLM round trips for data-processing/tool loops.

It must remain governed: the sandbox may invoke only tools explicitly admitted to the task.

---

## 7. Computer-use and local-first references

### Perplexity Portable Computer

Perplexity's 2026 local Windows agent is a useful product signal:

- local multistep agent;
- scheduled tasks;
- local MCP servers;
- desktop app integrations;
- local model downloads;
- cloud access only when needed/allowed.

FuryPipe should similarly support:

```text
local-first execution
+
optional cloud intelligence
```

rather than making every task cloud-dependent.

---

### Managed cloud computer products

Products such as Meta Muse and the broader computer-agent category show that users value agents that can operate websites/apps end-to-end, but broad account access creates a severe trust problem.

FuryPipe should therefore make computer-use permission explicit and narrow:

```text
view
interact
submit
purchase
send
delete
admin
```

should not be one undifferentiated "browser allowed" permission.

---

## 8. Strongest architectural ideas to take

### 8.1 Long-lived Gateway, short-lived workers

Inspired by OpenClaw, ZeroClaw, NanoClaw, Suna/Kortix.

```text
Gateway:
small
always on
sessions
channels
routing
events

Workers:
ephemeral
isolated
heavy capabilities
browser/code/computer
```

### 8.2 OS-level isolation by default for risky work

Inspired strongly by NanoClaw and sandbox-based agent products.

Do not rely solely on application-level allowlists.

### 8.3 Durable tasks separate from chat

Inspired by Hermes and workflow engines.

A task exists even if:

- the chat client disconnects;
- the process restarts;
- the provider fails temporarily.

### 8.4 Scheduled work without an LLM when possible

Inspired by Hermes.

A deterministic health check should cost approximately zero model tokens.

### 8.5 Persistent identity and structured memory

Inspired by Letta, Hermes, memU and Khoj.

### 8.6 Low idle resource budget

Inspired by ZeroClaw, NullClaw and PicoClaw.

Always-on does not justify a bloated always-on process.

### 8.7 Browser/computer executor as a replaceable backend

Inspired by Suna/Kortix and OpenManus.

### 8.8 Integrations through standards and brokers

Use:

- MCP;
- OAuth plugins;
- connector platforms;
- native plugins only for strategic integrations.

### 8.9 Coding as one workspace inside the Agent OS

Inspired by QwenPaw and the broader evolution of personal-agent products.

### 8.10 Explainability/evidence over "agent confidence"

This remains FuryPipe-native.

---

## 9. Ideas to avoid

### 9.1 Huge monolithic Gateway

Do not combine:

- all channels;
- browser runtime;
- shell;
- sandbox;
- vector DB;
- code execution;
- every provider SDK;

inside one highly privileged process.

### 9.2 Prompt-based permissions

"Do not delete files" is not a security mechanism.

### 9.3 Automatic skill self-modification into trust

An agent may propose a learned skill.

It must not silently promote it to trusted/global status.

### 9.4 Unbounded multi-agent trees

No recursive swarm without hard budgets.

### 9.5 LLM for deterministic automation

Avoid burning tokens for cron/system checks that ordinary code can perform.

### 9.6 Permanent broad credentials

Use scoped connector credentials, OAuth grants or brokered tokens.

### 9.7 Full-memory injection

Persistent memory should reduce repeated context, not create a larger permanent prompt.

### 9.8 "Connected = safe"

Preserve FuryPipe lifecycle truth states.

---

## 10. Revised FuryPipe Agent OS components

The research suggests these VNext components:

### Fury Gateway

- channels;
- RPC;
- sessions;
- identities;
- events;
- automations;
- notifications;
- node registry.

### Fury Kernel

- reasoning/action loop;
- task state;
- budget;
- cancellation;
- capability admission.

### Fury Worker

Replaceable isolated executor.

Worker profiles:

- browser;
- coding;
- desktop/computer;
- research;
- deterministic automation.

### Capability Autopilot V2

Indexes and lazily selects:

- skills;
- MCP;
- plugins;
- tools;
- agents;
- models;
- devices.

### Fury Memory

- working;
- episodic;
- semantic/profile;
- project;
- evidence.

### Fury Automation

- cron;
- condition watch;
- webhook;
- event;
- no-agent deterministic jobs;
- LLM jobs.

### Fury Connect

Integration plane:

- native plugins;
- MCP;
- OAuth brokers/connectors.

### Fury Nodes

Paired devices/workers.

### Fury Browser / Computer

Managed and user-session execution lanes.

### Fury Code

- CodeGraph;
- Git;
- worktrees;
- builds/tests;
- IDE/ACP.

### Fury Evidence

- receipts;
- provenance;
- approval;
- verification;
- durable outcomes.

---

## 11. Proposed product surfaces

### Dashboard

- Chat
- Work
- Automations
- Memory
- Channels
- Integrations
- Skills
- MCP
- Plugins
- Models
- Devices
- Browser
- Coding
- Evidence
- Settings

### CLI

```text
furypipe
furypipe gateway
furypipe doctor
furypipe channels
furypipe automation
furypipe skills
furypipe mcp
furypipe plugins
furypipe nodes
furypipe models
furypipe work
```

The CLI remains a client of the same Gateway rather than a second runtime.

---

## 12. Benchmark targets for this product class

FuryBench should add Agent OS metrics.

### Always-on runtime

- idle RSS;
- idle CPU;
- startup;
- reconnect time;
- per-channel overhead.

### Messaging

- delivery success;
- duplicate delivery;
- ordering;
- restart recovery.

### Automation

- trigger accuracy;
- exactly-once/at-least-once semantics by job class;
- duplicate side effects;
- missed jobs;
- restart behavior.

### Memory

- retrieval precision;
- stale-memory rate;
- token savings;
- contradiction detection.

### Tools

- relevant-tool selection;
- schemas exposed per task;
- token overhead;
- unauthorized-call rejection.

### Security

- container escape assumptions;
- cross-session leakage;
- credential isolation;
- channel identity spoofing;
- prompt-injection resistance.

### Cost

- tokens/task;
- tokens/idle automation;
- provider cost;
- model escalations;
- avoidable LLM calls.

---

## 13. Projects to track continuously

High priority:

- OpenClaw;
- Hermes Agent;
- NanoClaw;
- ZeroClaw;
- Letta;
- OpenFang;
- Kortix/Suna;
- nanobot;
- QwenPaw;
- Agent Zero.

Architecture/component priority:

- NullClaw;
- PicoClaw;
- memU;
- Khoj;
- OpenManus;
- LibreChat;
- Dify;
- n8n;
- TrustClaw/Composio.

Commercial-product signals:

- Lindy;
- Perplexity Computer / local agent products;
- emerging computer-use assistants.

Do not copy feature counts. Track architectural patterns, real user pain points and benchmarkable behavior.

---

## 14. Final Phase 0 conclusion

The research strengthens the revised FuryPipe target.

FuryPipe should become:

```text
a persistent self-hostable Agent OS / Gateway
+
small always-on control plane
+
isolated replaceable workers
+
automatic minimal capability selection
+
persistent source-aware memory
+
durable low-cost automations
+
browser/computer/coding workspaces
+
channels and devices
+
MCP / skills / plugins / ACP/A2A interoperability
+
FuryPipe Visual Context Engine
+
FuryPipe evidence/governance/recovery
```

The strongest differentiator should not be "more tools."

It should be:

> **FuryPipe discovers a large capability universe while exposing only the minimum safe, useful and cost-effective subset for the current task — and proves what actually happened.**
