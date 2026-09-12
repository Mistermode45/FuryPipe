# FuryPipe

**Production-grade context, capability, memory, MCP and agent orchestration for AI workflows.**

FuryPipe is a Node.js runtime and toolkit for building AI workflows that need more than a single prompt: context control, exact-value preservation, provider routing, skills, MCP, governed memory, multi-stage agents, policy enforcement and verifiable execution receipts.

> Français : [README.fr.md](README.fr.md)

## Why FuryPipe

Modern AI systems fail when every instruction, tool schema, memory item and provider integration is loaded into one unbounded prompt. FuryPipe separates those concerns into explicit runtime layers:

```text
request
  ↓
Capability Router
  ↓
Instruction Fabric
  ↓
Context Optimizer
  ↓
FuryPrompt / Context Fabric / ExactGuard
  ↓
Provider + MCP + Agent Fabric
  ↓
verification / receipts / governed memory
```

The goal is not to make every context smaller at any cost. The goal is to load the **right** context, preserve exact data when exactness matters, execute only authorized capabilities, and retain enough evidence to verify what happened.

## Core capabilities

| Area | FuryPipe capability |
|---|---|
| Context | Context IR, Content Classifier, Context Fabric, cache planning, exactness classes |
| Prompting | FuryPrompt, Instruction Profiles, task-aware Instruction Fabric |
| Capability selection | Universal Capability Router for skills, plugins, MCP and domain packs |
| Context efficiency | Deferred Context Optimizer with metadata / summary / full / executable levels |
| Memory | Long-Term Memory, Recovery-backed Continuous Memory, governed turn orchestration |
| Agents | Agent Fabric, staged Agent Runtime, subagents, automatic skill/MCP execution |
| MCP | Modern MCP runtime, stdio + HTTP surfaces, bounded method/server policies |
| Providers | Provider Fabric, runtime health evidence, deterministic fallback planning, OmniRoute adapter |
| Security | ExactGuard, Recovery verification, least-privilege policies, bounded inputs, secret-aware memory |
| Operations | Control Room evidence, Web Studio surfaces, doctor, stats, export, warp |
| Packaging | Typed public entrypoints, package-smoke checks, multi-OS CI, CodeQL and supply-chain gates |

## Requirements

- Node.js **>= 22.14**
- pnpm **10.21.0** for repository development
- Git for source-based workflows
- Optional provider credentials only when a chosen provider requires them

The CI matrix validates Node 22, 24 and 26 on Linux, macOS and Windows.

## Repository setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:smoke
```

The package exposes the main `furypipe` CLI plus `furypipe-mcp` and `furypipe-mcp-http`.

## CLI

```text
furypipe
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [--route PATTERN=TARGET]... -- <agent>
```

Run:

```bash
furypipe --help
```

for the complete runtime configuration surface.

### Proxy

`furypipe` starts the local proxy. The default bind is loopback-only.

Typical local Anthropic-compatible use:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude
```

The default model scope is intentionally bounded. The runtime and documentation are contract-tested against this exact zero-config value:

default `FURYPIPE_MODELS=claude-fable-5,gemini`

Set `FURYPIPE_MODELS=off` to disable model transformation, or provide an explicit comma-separated model list.

### Doctor

```bash
furypipe doctor
furypipe doctor --json
furypipe doctor --locale=fr
```

Doctor inspects the local FuryPipe runtime and reports unavailable tools honestly. It does not auto-install missing software and does not print credentials.

### Stats

```bash
furypipe stats
furypipe stats --json
furypipe stats --file /path/to/events.jsonl
```

New installations default to `~/.furypipe/events.jsonl`. Existing installations with an older compatible event file are detected automatically when the new path does not exist.

## Offline export (no proxy)

`furypipe export` renders source material into compact PNG pages **without running the proxy**.

Examples:

```bash
furypipe export src/
furypipe export --include "*.ts" src/
furypipe export --git
furypipe export --diff HEAD~3
cat large-context.txt | furypipe export --stdin
```

Each run creates a fresh `furypipe-export-*` directory containing:

```text
page-*.png
factsheet.txt
manifest.json
prompt.txt
```

The generated `prompt.txt` is suitable for an agent workflow, while the rendered pages can also be attached manually in tools such as **Cursor**. `factsheet.txt` keeps precision-sensitive values such as paths, identifiers, SHAs and numbers outside lossy summarization.

## Capability Router

The Capability Router resolves what a task actually needs instead of loading every available capability.

Built-in packs include:

- software engineering;
- marketing websites;
- web applications;
- research;
- learning/coaching;
- business launch and operations;
- automation;
- data analytics;
- Minecraft plugins;
- Minecraft mods;
- FiveM resources;
- generic game-server extensions.

The router can also use a host-owned universal analyzer for domains that do not have a built-in pack. Returned capabilities are still validated against the **real registered inventory**.

A capability can be:

- selected;
- available;
- approval-required;
- blocked;
- unavailable.

FuryPipe never equates “selected” with “executed”.

See [docs/CAPABILITY_ROUTER.md](docs/CAPABILITY_ROUTER.md).

## Instruction Fabric

Instruction Fabric adds only the task-specific rules that matter for the current request.

Built-in facets cover:

- production engineering;
- prompt authoring;
- website production;
- creative direction;
- evidence-driven research;
- security assurance;
- marketing/conversion;
- Minecraft plugin engineering;
- FiveM resource engineering;
- business operations.

It reuses native FuryPipe instruction profiles, de-duplicates rules, and enforces both facet-count and byte budgets.

`prepareCapabilityRun()` automatically composes Capability Router output with Instruction Fabric, so callers do not need to manually select those facets for ordinary runs.

See [docs/INSTRUCTION_FABRIC.md](docs/INSTRUCTION_FABRIC.md).

## Context Optimizer

Context Optimizer chooses among caller-provided representations:

```text
metadata → summary → full → executable
```

This enables progressive disclosure:

- discovery-only capabilities can stay at metadata level;
- selected capabilities can load summaries or full context;
- exact context is never silently downgraded;
- secret context is blocked by default;
- global and per-kind byte budgets are enforced;
- stable context can be ordered before dynamic context when the provider contract allows it.

The optimizer does **not** invent summaries and does **not** execute tools.

See [docs/CONTEXT_OPTIMIZER.md](docs/CONTEXT_OPTIMIZER.md).

## FuryPrompt

FuryPrompt is the structured prompt contract used by higher-level FuryPipe components.

Sections include:

- intent;
- role;
- objective;
- context;
- inputs;
- constraints;
- task;
- plan;
- tools;
- skills;
- MCP;
- subagents;
- output contract;
- acceptance criteria;
- verification.

Levels range from `TRIVIAL` to `SECURITY_CRITICAL`. A security-critical level is explicit; FuryPipe does not infer authority from prompt text.

See [docs/FURY_PROMPT.md](docs/FURY_PROMPT.md).

## Continuous Memory

Continuous Memory builds governed cross-session learning on top of Recovery and Long-Term Memory.

It supports:

- bounded recall before a turn;
- semantic memory keys;
- corrections as revisions;
- logical forget;
- hard purge;
- explicit, confirmed, verified and inferred evidence classes;
- sensitivity policy;
- scope-aware memory;
- byte-bounded recall.

Raw conversation transcripts are not stored as durable memories. Secrets are never stored. Sensitive memory is disabled by default.

Recalled content is marked as **data, not instructions** and cannot override current system, developer, repository, security or user instructions.

The host-facing Continuous Memory Turn Runtime adds the safe conversational lifecycle:

```text
recall
→ execute host turn exactly once
→ learn from completed turn
```

If post-execution memory learning fails, FuryPipe returns a failure receipt and does **not** replay the external action.

See:

- [docs/CONTINUOUS_MEMORY.md](docs/CONTINUOUS_MEMORY.md)
- [docs/CONTINUOUS_MEMORY_TURN.md](docs/CONTINUOUS_MEMORY_TURN.md)
- [docs/LONG_TERM_MEMORY.md](docs/LONG_TERM_MEMORY.md)

## Agent Fabric

Agent Fabric provides a deterministic staged contract:

```text
research → plan → implement → review → verify
```

The runtime owns:

- stage sequencing;
- context budget accounting;
- read/scoped-write permissions;
- skill health checks;
- automatic skills selected by Capability Router;
- bounded MCP calls;
- subagent concurrency;
- evidence requirements;
- handoff snapshots;
- runtime receipts.

It does not provide ambient shell, network or credentials.

See [docs/AGENT_FABRIC.md](docs/AGENT_FABRIC.md).

## Skills and plugins

The Skill Registry evaluates registered skills using:

- category;
- stage;
- priority;
- provenance;
- license status;
- health;
- permission;
- network requirements.

Plugin Bundles describe integrations without pretending they are connected. Capability Router activation state remains explicit.

FuryPipe does not auto-install or auto-execute third-party capabilities merely because they exist in a registry.

See [docs/PLUGIN_BUNDLES.md](docs/PLUGIN_BUNDLES.md).

## MCP

FuryPipe includes modern MCP support with bounded runtime surfaces.

Public binaries:

```text
furypipe-mcp
furypipe-mcp-http
```

The MCP layer validates server IDs, methods, request shape and runtime policy before execution.

See [docs/MCP.md](docs/MCP.md).

## Provider Fabric and OmniRoute

Provider Fabric separates:

- model/provider metadata;
- observed health;
- cost evidence;
- fallback planning;
- actual network execution.

Unknown or stale provider evidence remains unknown. It is not promoted to “healthy” by inference.

OmniRoute can be configured as an explicit gateway:

```bash
FURYPIPE_PROVIDER=omniroute
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=...
furypipe
```

Remote plaintext HTTP is rejected. Provider credentials received from callers are not silently forwarded as OmniRoute credentials.

See:

- [docs/PROVIDER_FABRIC.md](docs/PROVIDER_FABRIC.md)
- [docs/OMNIROUTE.md](docs/OMNIROUTE.md)

## ExactGuard and Recovery

ExactGuard protects precision-sensitive values such as:

- authentication headers and secrets;
- UUIDs;
- hashes and checksums;
- URLs and paths;
- line references;
- version strings;
- code symbols and literals;
- commands;
- permission nodes;
- coordinates;
- timestamps;
- amounts and quantities.

Recovery provides verified, content-addressed storage used by higher-level systems such as memory and agent persistence.

FuryPipe distinguishes:

- preserve exactly;
- redact;
- externalize.

Lossy transformation is not allowed to silently corrupt protected values.

## Security model

Core rules:

- loopback-first local services;
- least privilege;
- no implicit credentials;
- no hidden network enablement;
- no auto-install of third-party code;
- exact-value verification where required;
- fail-closed memory recall verification;
- explicit write scopes;
- bounded inputs and outputs;
- security-sensitive evidence must be observed, not assumed.

See [SECURITY.md](SECURITY.md) and [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Public modules

Representative package entrypoints include:

```text
furypipe/capability-router
furypipe/instruction-fabric
furypipe/context-optimizer
furypipe/fury-prompt
furypipe/agent-runtime
furypipe/skill-registry
furypipe/plugin-bundles
furypipe/mcp-modern
furypipe/provider-fabric
furypipe/provider-runtime
furypipe/omniroute
furypipe/continuous-memory
furypipe/long-term-memory
furypipe/recovery-store
furypipe/exact-guard
furypipe/context-fabric
furypipe/control-room
furypipe/web-studio
```

Use the package `exports` map as the source of truth for the complete supported list.

## Quality gates

Repository CI includes:

- TypeScript typecheck;
- unit/integration tests;
- Linux/macOS/Windows matrix;
- Node 22/24/26 matrix;
- package smoke tests;
- CodeQL;
- secret scan;
- license compliance;
- supply-chain checks;
- provenance validation;
- benchmark contract validation.

A green build proves the checks that ran. It does not prove external provider availability, external pricing, or a deployment that was not actually exercised.

## Documentation

- [CLI](docs/CLI.md)
- [Capability Router](docs/CAPABILITY_ROUTER.md)
- [Instruction Fabric](docs/INSTRUCTION_FABRIC.md)
- [Context Optimizer](docs/CONTEXT_OPTIMIZER.md)
- [Continuous Memory](docs/CONTINUOUS_MEMORY.md)
- [Long-Term Memory](docs/LONG_TERM_MEMORY.md)
- [Agent Fabric](docs/AGENT_FABRIC.md)
- [MCP](docs/MCP.md)
- [Context Fabric](docs/CONTEXT_FABRIC.md)
- [Provider Fabric](docs/PROVIDER_FABRIC.md)
- [OmniRoute](docs/OMNIROUTE.md)
- [Policy](docs/POLICY.md)
- [Receipts](docs/RECEIPTS.md)
- [Security model](docs/SECURITY_MODEL.md)

## Development rules

For repository changes:

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:smoke
```

Do not infer a successful external runtime from local compilation. Do not mark missing evidence as verified.

## License and third-party notices

FuryPipe is distributed under the repository license. Required third-party provenance and license information is kept in the dedicated legal/notice files, including [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
