<div align="center">

# FuryPipe

### Governed AI orchestration for context, agents, skills, MCP, memory and providers.

**Build AI workflows that stay explicit about what is available, what is allowed, what actually ran, and what was verified.**

[![npm](https://img.shields.io/npm/v/furypipe?logo=npm&label=npm)](https://www.npmjs.com/package/furypipe)
[![GitHub release](https://img.shields.io/github/v/release/Mistermode45/FuryPipe?logo=github&label=release)](https://github.com/Mistermode45/FuryPipe/releases/latest)
[![CI](https://github.com/Mistermode45/FuryPipe/actions/workflows/ci.yml/badge.svg)](https://github.com/Mistermode45/FuryPipe/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.14-339933?logo=node.js&logoColor=white)](package.json)

[Quick start](#quick-start) · [Why FuryPipe](#why-furypipe) · [Architecture](#architecture) · [Security](#security-model) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md) · [Français](#french-version)

</div>

---

## What is FuryPipe?

FuryPipe is a **production-oriented runtime and toolkit for governed AI workflows**.

It brings context preparation, task-aware capability selection, instructions, agents, MCP, provider execution, memory, policy and evidence into one composable system instead of treating them as unrelated layers.

FuryPipe is designed around a simple rule:

> **Configuration is not execution, and execution is not verification.**

That distinction is enforced throughout the project through explicit lifecycle states, receipts, source-bound evidence and fail-closed behavior.

**Current public release:** [`v0.13.2`](https://github.com/Mistermode45/FuryPipe/releases/tag/v0.13.2) · [`furypipe@0.13.2`](https://www.npmjs.com/package/furypipe)

FuryPipe is pre-1.0. Public APIs can still evolve. Package publication also remains distinct from production deployment and from optional hosted-integration verification.

---

## Why FuryPipe

Modern AI projects often accumulate separate prompt builders, context compressors, agent frameworks, MCP clients, memory stores and provider adapters. The result is powerful but difficult to reason about: capabilities may be installed but unavailable, connected but unauthorized, or wired but never actually executed.

FuryPipe provides one governance model across those boundaries.

| Problem | FuryPipe approach |
|---|---|
| Too much context | Select the minimum sufficient representation instead of loading everything |
| Tool / skill sprawl | Route only capabilities relevant to the current task |
| Prompt instruction overload | Compose bounded task/domain instructions through Instruction Fabric |
| Exact values lost during optimization | Protect sensitive exact spans through ExactGuard and explicit recovery |
| Provider fallback becomes opaque | Keep attempts, authorization, health and execution receipts explicit |
| Agent actions are hard to audit | Use bounded permissions, budgets and evidence-bearing execution |
| Memory silently becomes instruction | Treat recalled memory as untrusted data, not privileged instruction |
| “Configured” is reported as “working” | Preserve lifecycle truth states all the way to verification |

### Designed for real workflows

FuryPipe includes task families and primitives useful for:

- software engineering and code-generation workflows;
- websites and web applications;
- research and evidence-heavy work;
- business and automation workflows;
- analytics and structured data tasks;
- Minecraft plugins/mods and game-server extensions;
- FiveM resources;
- multi-provider and agentic orchestration.

The project does **not** claim that every optional integration is automatically installed, connected or verified. Capabilities remain subject to their actual runtime state and evidence.

---

## Quick start

### Install

```bash
npm install --global furypipe
```

Or run directly:

```bash
npx furypipe doctor
```

### Verify your environment

```bash
furypipe doctor
```

### Start the Node runtime

```bash
furypipe start
```

The Node runtime is loopback-oriented by default. Read [SECURITY.md](SECURITY.md) before exposing FuryPipe beyond the local machine.

## Offline export (no proxy)

FuryPipe can prepare context artifacts without running the proxy:

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Depending on the input, export can produce artifacts such as `page-*.png`, `factsheet.txt` and `prompt.txt` for inspection or handoff.

### Default model scope

Default model scope: `FURYPIPE_MODELS=claude-fable-5,gemini`

The default is a runtime contract, not a benchmark claim. Override it explicitly when a workflow needs a different provider/model scope.

---

## Architecture

```text
                         ┌──────────────────────┐
                         │    User objective    │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Capability Router   │
                         │ skills · MCP · packs │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Instruction Fabric   │
                         │ rules · budgets      │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Context Optimizer   │
                         │ metadata → executable│
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │      FuryPrompt      │
                         └──────────┬───────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
       ┌─────────────────────┐             ┌─────────────────────┐
       │    Agent Runtime    │             │  Provider Runtime   │
       │ permissions/budgets │             │ routing/execution   │
       └──────────┬──────────┘             └──────────┬──────────┘
                  └─────────────────┬─────────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │ Evidence & Receipts  │
                         │ verify what happened │
                         └──────────────────────┘
```

Supporting systems include Continuous Memory, Recovery, Policy Runtime, FuryTrust, MCP runtimes, provider transports, Control Room and Web Studio.

For the detailed component model and boundaries, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Core capabilities

### Capability Router

Selects task-relevant capabilities instead of assuming every registered skill, plugin or MCP integration should be loaded or executed.

### Instruction Fabric

Composes domain/task instructions under an explicit instruction budget. User-requested rules remain authoritative; automatic guidance can be omitted when necessary to stay within budget.

### Context Optimizer

Uses a bounded representation ladder:

```text
metadata → summary → full → executable
```

Exact values are not silently degraded, secrets are blocked by default, and global/per-type budgets stay independent.

### ExactGuard + Recovery

ExactGuard protects identifiers and sensitive exact spans from unsafe lossy transformations. Recovery primitives provide explicit restoration paths without turning hidden state into implicit truth.

### Agent Runtime

Provides governed execution stages with explicit permissions, budgets and side-effect boundaries. Network/write capability is not granted merely because an agent exists.

### MCP

FuryPipe includes modern MCP surfaces, an HTTP Node transport and compatibility primitives. Local protocol support and hosted interoperability are tracked as separate evidence states.

### Provider execution

Provider Fabric, Provider Runtime, OmniRoute, provider transports, governed executors and retry/fallback orchestration keep provider selection, authorization, health and execution separate.

### Continuous Memory

Supports bounded recall and governed learning with revisions, scoped persistence and separate logical-forget / physical-purge semantics. Recalled memory remains data, never higher-priority instruction.

### Control Room + Web Studio

Expose operational and evidence-oriented surfaces without promoting missing evidence to success.

---

## Truth-state model

FuryPipe intentionally preserves lifecycle distinctions:

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

When evidence is missing, the correct state is `UNKNOWN`, `NOT_EXECUTED`, `PARTIAL` or `BLOCKED` — not an inferred success.

This is a core product contract, not just documentation style.

---

## Security model

FuryPipe is built around explicit trust boundaries and fail-closed defaults.

Key principles include:

- loopback-first Node runtime;
- bounded read/write/network permissions for agent execution;
- no implicit third-party plugin installation;
- no arbitrary MCP server treated as trusted by default;
- external content, memory and tool output treated as untrusted data;
- secret context blocked from unsafe paths;
- source-bound release evidence;
- frozen installs in privileged release workflows;
- npm Trusted Publishing for automated releases after the initial bootstrap publication.

Security documentation:

- [Security policy](SECURITY.md)
- [Threat/security model](docs/SECURITY_MODEL.md)
- [Release security](docs/RELEASE_SECURITY.md)

Report vulnerabilities through GitHub private vulnerability reporting, **not** a public issue.

---

## CLI

Common entry points:

```text
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [...] -- <agent>
```

See [docs/CLI.md](docs/CLI.md) for the authoritative public CLI contract.

---

## Package entry points

FuryPipe exposes focused modules for composition instead of forcing consumers through one monolithic API.

Examples:

```text
furypipe/capability-router
furypipe/instruction-fabric
furypipe/context-optimizer
furypipe/task-orchestrator
furypipe/continuous-memory
furypipe/agent-runtime
furypipe/skill-registry
furypipe/fury-prompt
furypipe/provider-runtime
furypipe/provider-transports
furypipe/provider-stream-transports
furypipe/governed-provider-executor
furypipe/omniroute
furypipe/mcp-modern
furypipe/mcp-http-node
furypipe/context-fabric
furypipe/exact-guard
```

The authoritative list is [`package.json#exports`](package.json).

---

## Developer setup

Requirements:

- Node.js **>= 22.14**
- pnpm **10.21.0**

```bash
git clone https://github.com/Mistermode45/FuryPipe.git
cd FuryPipe
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:smoke
```

Additional repository gates cover security, supply chain, licenses, static analysis, browser QA, provenance and release-readiness evidence.

A local green build does not replace required GitHub Actions checks.

---

## Release status

| Surface | Status |
|---|---|
| npm package | **Released — `furypipe@0.13.2`** |
| GitHub Release | **Released — `v0.13.2`** |
| Core release gates | **Verified for the release candidate** |
| Hosted MCP conformance | **Verified for the release candidate** |
| Hosted Web Studio conformance | **Verified for the release candidate** |
| OAuth authorization-server flow | **NOT_EXECUTED** |
| External Figma connectivity | **NOT_EXECUTED** |
| Provider performance claims | **NOT_EXECUTED / no release performance claim** |
| Production deployment | **Separate lifecycle state; not implied by publication** |

Release details belong in [CHANGELOG.md](CHANGELOG.md) and [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md).

---

## Documentation

### Start here

| Topic | Document |
|---|---|
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| CLI | [docs/CLI.md](docs/CLI.md) |
| Security | [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) |
| Capability routing | [docs/CAPABILITY_ROUTER.md](docs/CAPABILITY_ROUTER.md) |
| Instruction composition | [docs/INSTRUCTION_FABRIC.md](docs/INSTRUCTION_FABRIC.md) |
| Context optimization | [docs/CONTEXT_OPTIMIZER.md](docs/CONTEXT_OPTIMIZER.md) |
| Task orchestration | [docs/TASK_ORCHESTRATOR.md](docs/TASK_ORCHESTRATOR.md) |
| Continuous Memory | [docs/CONTINUOUS_MEMORY.md](docs/CONTINUOUS_MEMORY.md) |
| Agents | [docs/AGENT_FABRIC.md](docs/AGENT_FABRIC.md) |
| Providers | [docs/PROVIDER_FABRIC.md](docs/PROVIDER_FABRIC.md) |
| MCP | [docs/MCP.md](docs/MCP.md) |
| FuryTrust | [docs/FURYTRUST.md](docs/FURYTRUST.md) |
| Compatibility | [COMPATIBILITY.md](COMPATIBILITY.md) |

---

## Compatibility and upstream history

**FuryPipe is the product name. `furypipe` and `FURYPIPE_*` are the public interfaces for new integrations.**

A small number of historical aliases remain for backward compatibility with the upstream codebase. They are not the recommended public identity and must not be used for new FuryPipe APIs or documentation.

See [COMPATIBILITY.md](COMPATIBILITY.md), [UPSTREAM.md](UPSTREAM.md), [SOURCE_LEDGER.md](SOURCE_LEDGER.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and migration details.

---

## Contributing

Contributions are welcome when they preserve FuryPipe's evidence-first, fail-closed semantics.

Before opening a PR:

1. read [CONTRIBUTING.md](CONTRIBUTING.md);
2. keep one cohesive root cause / feature per PR;
3. include reproducible evidence;
4. preserve lifecycle truth states;
5. never include credentials, private prompts or sensitive logs.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md).

---

## French version

### Français

**FuryPipe est un runtime et une boîte à outils pour construire des workflows IA gouvernés, composables et vérifiables.**

Il orchestre le contexte, les instructions, les agents, les skills, MCP, la mémoire et les providers avec des états de vérité explicites et des preuves d'exécution.

### Installation

```bash
npm install --global furypipe
furypipe doctor
```

Version publique actuelle : **v0.13.2**.

Principes principaux :

- sélectionner uniquement les capacités utiles à la tâche ;
- réduire le contexte sans dégrader silencieusement les valeurs exactes ;
- séparer disponibilité, autorisation, exécution et vérification ;
- gouverner les agents avec permissions et budgets ;
- rappeler/apprendre via Continuous Memory sans transformer la mémoire en instruction privilégiée ;
- rester fail-closed lorsque la preuve manque.

Pour contribuer : [CONTRIBUTING.md](CONTRIBUTING.md). Pour la sécurité : [SECURITY.md](SECURITY.md).

---

## License

FuryPipe is distributed under the [MIT License](LICENSE).

Third-party attribution and upstream provenance are tracked separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) and [SOURCE_LEDGER.md](SOURCE_LEDGER.md).
