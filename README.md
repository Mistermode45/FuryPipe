# FuryPipe

<p align="center">
  <strong>Governed orchestration for context, agents, skills, MCP, memory and AI providers.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/furypipe"><img alt="npm" src="https://img.shields.io/npm/v/furypipe?logo=npm"></a>
  <a href="https://github.com/Mistermode45/FuryPipe/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Mistermode45/FuryPipe"></a>
  <a href="https://github.com/Mistermode45/FuryPipe/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Mistermode45/FuryPipe/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.14-339933?logo=node.js&logoColor=white">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#core-capabilities">Capabilities</a> ·
  <a href="#security-model">Security</a> ·
  <a href="#franais">Français</a> ·
  <a href="docs/CLI.md">CLI</a>
</p>

FuryPipe is a production-oriented runtime and toolkit for building **governed AI workflows**. It combines task-aware capability routing, instruction composition, context optimization, agents, MCP, provider routing, memory, policy and evidence into one composable system.

The project is public and installable from npm. The current public release is **v0.13.2**. FuryPipe is still pre-1.0: APIs can evolve, and a published package does not imply that every optional hosted integration has been externally verified.

> **Release status**
> - npm: [furypipe](https://www.npmjs.com/package/furypipe)
> - GitHub: [v0.13.2](https://github.com/Mistermode45/FuryPipe/releases/tag/v0.13.2)
> - package version: `0.13.2`
> - production deployment is a separate lifecycle state from package publication

---

## Why FuryPipe

Most AI stacks treat prompts, tools, memory, providers and agents as separate concerns. FuryPipe is designed around the opposite assumption: they form one execution graph and should share the same security, budgeting, provenance and verification model.

| Area | FuryPipe modules | Purpose |
|---|---|---|
| Orchestration | FuryPrompt, Capability Router, Instruction Fabric, Task Orchestrator | Turn an objective into bounded, task-aware execution |
| Context | Context IR, Context Fabric, Context Optimizer, ExactGuard | Minimize context without silently degrading exact data |
| Agents | Agent Fabric, Agent Runtime, skill registry | Execute governed stages with explicit permissions and budgets |
| MCP | modern MCP runtime, HTTP Node transport, compatibility runtime | Expose and consume MCP capabilities with explicit boundaries |
| Providers | Provider Fabric, Provider Runtime, OmniRoute, governed executors | Route providers without confusing availability, authorization and execution |
| Memory | Learning, Knowledge, Long-Term Memory, Continuous Memory | Recall and learn with revisions, scopes and explicit forgetting semantics |
| Policy | Policy Engine, Policy Fabric, Policy Runtime | Centralize policy decisions, refusals and fallback behavior |
| Operations | Doctor, Control Room, Web Studio | Diagnose runtime state and expose evidence without inventing success |

## Quick start

### Install globally

```bash
npm install --global furypipe
furypipe doctor
```

### Run without a global install

```bash
npx furypipe doctor
```

### Start the Node runtime

```bash
furypipe start
```

The default Node listener is loopback-oriented. Read [SECURITY.md](SECURITY.md) before exposing FuryPipe beyond the local machine.

### Developer checkout

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

## Default model scope

Default model scope: `FURYPIPE_MODELS=claude-fable-5,gemini`

`gemini` is a family base. New integrations can override the scope explicitly with `FURYPIPE_MODELS`; legacy `PXPIPE_MODELS` remains a fallback only when the FuryPipe-native value is absent.

## Architecture

```text
User objective
      │
      ▼
Capability Router
  ├─ capability packs
  ├─ eligible skills
  ├─ registered plugins / MCP
  └─ quality gates
      │
      ▼
Instruction Fabric
  ├─ task/domain instructions
  ├─ instruction budget
  └─ explicit rules > automatic rules
      │
      ▼
Context Optimizer
  ├─ metadata
  ├─ summary
  ├─ full
  └─ executable
      │
      ▼
FuryPrompt
      │
      ▼
Agent Runtime / Provider Runtime
      │
      ├─ execution receipts
      ├─ evidence
      └─ verification
```

Continuous Memory operates at the host turn boundary: bounded recall before execution, governed learning after successful execution. Recalled memory remains **data**, never a higher-priority instruction.

## Core capabilities

### Task-aware capability routing

FuryPipe can select only the capabilities relevant to a task instead of loading every skill, plugin and MCP server into every request.

Native task families include software engineering, websites, web applications, research, learning, business operations, automation, analytics, Minecraft plugins/mods, FiveM resources and game-server extensions.

### Instruction Fabric

Instruction Fabric composes only the instructions relevant to the current task and budget. Explicitly requested rules are mandatory; automatic guidance can be omitted when the context budget requires it.

### Context Optimizer

Context can move through a bounded representation ladder:

```text
metadata → summary → full → executable
```

Key invariants:

- exact values are not silently degraded;
- secrets are blocked by default;
- global and per-type budgets are independent;
- unselected capabilities can stay metadata-only;
- provider cache behavior does not override correctness.

### ExactGuard and receipts

FuryPipe separates transformations from proof. ExactGuard protects exact identifiers and other sensitive spans from unsafe lossy paths, while receipts and evidence record what was actually selected, executed and verified.

### Continuous Memory

Continuous Memory builds on Recovery and Long-Term Memory with bounded recall, versioned corrections, stable semantic keys, logical forgetting and physical purge as separate operations.

Raw transcripts are not automatically treated as durable memory, and recalled memory does not gain instruction priority.

### MCP and provider execution

FuryPipe exposes modern MCP surfaces and governed provider execution primitives. Provider routing is intentionally separate from authorization and health evidence.

A configured or discoverable capability is not automatically executable.

## Truth-state model

FuryPipe deliberately keeps lifecycle states distinct:

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

This distinction is part of the product contract. Unknown or unexecuted evidence stays unknown or unexecuted instead of being promoted to success.

## Security model

Security defaults include:

- loopback-first Node runtime;
- read-only or bounded-write agent permissions;
- network disabled by default in Agent Runtime unless explicitly allowed;
- no implicit third-party plugin installation;
- no arbitrary MCP server treated as trusted;
- external content, memory and tool output treated as untrusted data;
- exact source/evidence binding for release claims;
- frozen dependency installation in privileged release jobs;
- npm Trusted Publishing for automated release publishing.

For vulnerability reporting and deployment guidance, see:

- [SECURITY.md](SECURITY.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Release security](docs/RELEASE_SECURITY.md)

## CLI

Primary commands:

```text
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [...] -- <agent>
```

Offline export is available without starting the proxy:

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

See [docs/CLI.md](docs/CLI.md) for the public CLI contract.

## Offline export (no proxy)

FuryPipe can prepare context artifacts **without running the proxy**.

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Depending on the input, the export can produce `page-*.png`, `factsheet.txt` and `prompt.txt`. This path is useful for inspecting or handing off generated context while keeping proxy execution out of the workflow.

## Package exports

The package exposes focused entry points, including:

```text
furypipe/capability-router
furypipe/instruction-fabric
furypipe/context-optimizer
furypipe/task-orchestrator
furypipe/continuous-memory
furypipe/continuous-memory-turn
furypipe/agent-runtime
furypipe/skill-registry
furypipe/plugin-bundles
furypipe/fury-prompt
furypipe/long-term-memory
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

The authoritative list is `package.json#exports`.

## Compatibility and legacy names

**FuryPipe is the public product name and `furypipe` is the documented CLI.**

The package currently keeps the `pxpipe` binary and selected `PXPIPE_*` environment variables as **legacy compatibility fallbacks**. New integrations should use FuryPipe-native names.

When both a FuryPipe-native and legacy environment variable are present, the FuryPipe-native value is authoritative, including an explicitly empty value.

See [COMPATIBILITY.md](COMPATIBILITY.md) and [UPSTREAM.md](UPSTREAM.md).

## Documentation

Recommended starting points:

- [CLI](docs/CLI.md)
- [Capability Router](docs/CAPABILITY_ROUTER.md)
- [Instruction Fabric](docs/INSTRUCTION_FABRIC.md)
- [Context Optimizer](docs/CONTEXT_OPTIMIZER.md)
- [Task Orchestrator](docs/TASK_ORCHESTRATOR.md)
- [Continuous Memory](docs/CONTINUOUS_MEMORY.md)
- [Agent Fabric](docs/AGENT_FABRIC.md)
- [Provider Fabric](docs/PROVIDER_FABRIC.md)
- [Production provider transports](docs/PRODUCTION_PROVIDER_TRANSPORTS.md)
- [MCP](docs/MCP.md)
- [Hosted MCP conformance](docs/MCP_HOSTED_CONFORMANCE.md)
- [Security model](docs/SECURITY_MODEL.md)
- [FuryTrust](docs/FURYTRUST.md)

## Release and verification

FuryPipe release decisions are evidence-driven. CI, static analysis, secret scanning, supply-chain checks, license compliance, provenance, package smoke and the repository's release-readiness contract are separate gates.

A green check does not automatically upgrade unrelated lifecycle states. In particular, the v0.13.2 package release does not by itself claim that optional OAuth authorization-server flows, external Figma connectivity, provider performance benchmarks or a production deployment were executed.

See [CHANGELOG.md](CHANGELOG.md) and [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md).

## Contributing

Contributions are welcome when they preserve FuryPipe's evidence-first and fail-closed contracts.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security issues must use the private process in [SECURITY.md](SECURITY.md).

---

## Français

FuryPipe est un runtime et une boîte à outils pour orchestrer des workflows IA **gouvernés, composables et vérifiables** : contexte, agents, skills, MCP, mémoire, providers, politiques et preuves.

### Installation

```bash
npm install --global furypipe
furypipe doctor
```

Version publique actuelle : **v0.13.2**.

### Principes essentiels

- sélection des capacités selon la tâche ;
- composition bornée des instructions ;
- optimisation du contexte sans dégrader silencieusement les valeurs exactes ;
- Agent Runtime avec permissions et budgets explicites ;
- mémoire continue avec rappel/apprentissage gouvernés ;
- routage provider séparé de l'autorisation et de l'exécution ;
- états de vérité explicites : connecté n'est pas exécuté, exécuté n'est pas vérifié ;
- sécurité fail-closed et preuves liées à la source.

### Compatibilité pxpipe

`furypipe` est l'interface publique à utiliser. L'alias CLI `pxpipe` et certaines variables `PXPIPE_*` restent uniquement pour compatibilité historique. Toute nouvelle configuration doit utiliser les noms `FURYPIPE_*`.

### Documentation française

La majorité des documents d'architecture détaillés conservent leur terminologie technique et leurs preuves source-bound. Commencez par [docs/CLI.md](docs/CLI.md), [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md), [COMPATIBILITY.md](COMPATIBILITY.md) et [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License and upstream provenance

FuryPipe is distributed under the repository's [MIT license](LICENSE). Upstream provenance and compatibility history are documented in [UPSTREAM.md](UPSTREAM.md), [SOURCE_LEDGER.md](SOURCE_LEDGER.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
