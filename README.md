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

**Current public release:** [Latest GitHub Release](https://github.com/Mistermode45/FuryPipe/releases/latest) · [npm package](https://www.npmjs.com/package/furypipe)

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
furypipe setup
```

The guided setup opens FuryPipe's custom terminal onboarding. It remains an explicit command so npm installation never blocks on an interactive lifecycle script.

Or run directly without a global install:

```bash
npx furypipe setup
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

### Default model policy

Default policy: **dynamic discovery + evidence-first AUTO**.

Model Fabric discovers/observes models independently from visual authorization. In `AUTO`, quality-verified **or calibrated** visual readers transform without an explicit model override, so measured Claude/Grok readers do not fall back to plain text merely because their stronger quality-verification gate is still pending. Configured provider catalogs can surface newly released models without a FuryPipe release, but `discovered != vision-capable != calibrated != quality-verified`.

`FURYPIPE_VISUAL_POLICY=max_savings` broadens automatic eligibility to models whose image-input capability is positively proven **and** whose image-token pricing/profile is provider-appropriate. Discovery alone never causes an unknown provider to inherit OpenAI tile economics. ExactGuard, protocol-state protection, image/byte limits and profitability checks still apply. `safe_exact` is stricter than AUTO and accepts only quality-verified profiles; `text_only` disables visual transformation globally.

`FURYPIPE_MODELS` remains an explicit backward-compatible operator scope override. A CSV selects model bases; `off` disables visual compression.

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

### FuryPipe Control Plane

FuryPipe is a governed context runtime rather than a single-purpose proxy. Its public surface combines Context Fabric, FuryLink agent connectivity, adaptive visual optimization, provider routing, MCP, memory, agent/skill orchestration and evidence-first runtime receipts behind one FuryPipe-native control plane.

The visual engine uses provider-priced geometry planning and lossless rendering safeguards; transformations remain gated by profitability and fidelity checks rather than being applied blindly. See [Visual Engine](docs/VISUAL_ENGINE.md) for the pipeline and release invariants.
## CLI

Common entry points:

```text
furypipe setup [--lang=fr|en] [--plain] [--no-color] [--yes]
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe link [--route PATTERN=TARGET]... [--] <agent> [args...]
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
| npm package | **Published — current package on npm** |
| GitHub Release | **Published — latest GitHub release** |
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
| Model Fabric | [docs/MODEL_FABRIC.md](docs/MODEL_FABRIC.md) |
| Visual Engine | [docs/VISUAL_ENGINE.md](docs/VISUAL_ENGINE.md) |
| Task orchestration | [docs/TASK_ORCHESTRATOR.md](docs/TASK_ORCHESTRATOR.md) |
| Continuous Memory | [docs/CONTINUOUS_MEMORY.md](docs/CONTINUOUS_MEMORY.md) |
| Agents | [docs/AGENT_FABRIC.md](docs/AGENT_FABRIC.md) |
| Providers | [docs/PROVIDER_FABRIC.md](docs/PROVIDER_FABRIC.md) |
| MCP | [docs/MCP.md](docs/MCP.md) |
| FuryTrust | [docs/FURYTRUST.md](docs/FURYTRUST.md) |
| Compatibility | [COMPATIBILITY.md](COMPATIBILITY.md) |

---

## Runtime identity and upstream history

**FuryPipe is operationally independent. `furypipe` and `FURYPIPE_*` are the only supported runtime identity for new and existing integrations.**

The current runtime does not consult legacy command aliases, legacy environment namespaces, legacy config paths or the former default listener port. Historical upstream references are retained only where needed for provenance, licensing and benchmark traceability; they do not participate in runtime behavior.

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

# FuryPipe — version française

### Orchestration IA gouvernée pour le contexte, les agents, les skills, MCP, la mémoire et les providers.

**Construisez des workflows IA qui distinguent clairement ce qui est disponible, ce qui est autorisé, ce qui a réellement été exécuté et ce qui a été vérifié.**

**Version publique actuelle :** [Dernière release GitHub](https://github.com/Mistermode45/FuryPipe/releases/latest) · [package npm](https://www.npmjs.com/package/furypipe)

FuryPipe est encore en pré-1.0. Les API publiques peuvent évoluer. La publication du package reste également distincte d’un déploiement en production et de la vérification des intégrations externes optionnelles.

---

### Qu’est-ce que FuryPipe ?

FuryPipe est un **runtime et une boîte à outils orientés production pour construire des workflows IA gouvernés**.

Il réunit la préparation du contexte, la sélection des capacités selon la tâche, les instructions, les agents, MCP, l’exécution provider, la mémoire, les politiques et les preuves dans un système composable unique, au lieu de traiter chacune de ces couches comme un composant isolé.

FuryPipe repose sur une règle simple :

> **La configuration n’est pas l’exécution, et l’exécution n’est pas la vérification.**

Cette distinction est appliquée dans tout le projet grâce à des états de cycle de vie explicites, des receipts, des preuves liées à la source et un comportement fail-closed.

---

### Pourquoi FuryPipe ?

Les projets IA modernes accumulent souvent des générateurs de prompts, des compresseurs de contexte, des frameworks d’agents, des clients MCP, des mémoires et des adapters providers séparés. L’ensemble peut être puissant mais devient difficile à auditer : une capacité peut être installée mais indisponible, connectée mais non autorisée, ou câblée sans avoir jamais été réellement exécutée.

FuryPipe fournit un modèle de gouvernance commun à toutes ces frontières.

| Problème | Approche FuryPipe |
|---|---|
| Trop de contexte | Sélectionner la représentation minimale suffisante au lieu de tout charger |
| Trop de tools / skills | Router uniquement les capacités utiles à la tâche courante |
| Trop d’instructions dans le prompt | Composer des instructions tâche/domaine bornées via Instruction Fabric |
| Perte de valeurs exactes pendant l’optimisation | Protéger les spans exacts sensibles via ExactGuard et Recovery |
| Fallback provider opaque | Garder explicites les tentatives, l’autorisation, la santé et les receipts |
| Actions d’agents difficiles à auditer | Utiliser des permissions, budgets et preuves d’exécution bornés |
| La mémoire devient silencieusement une instruction | Traiter la mémoire rappelée comme une donnée non fiable, pas comme une instruction privilégiée |
| « Configuré » devient « fonctionnel » | Préserver les états de vérité jusqu’à la vérification |

#### Conçu pour des workflows réels

FuryPipe fournit des familles de tâches et des primitives utiles pour :

- l’ingénierie logicielle et la génération de code ;
- les sites web et applications web ;
- la recherche et les workflows orientés preuves ;
- les opérations business et l’automatisation ;
- l’analytics et les tâches de données structurées ;
- les plugins/mods Minecraft et extensions de serveurs de jeu ;
- les ressources FiveM ;
- l’orchestration agentique et multi-provider.

Le projet **ne prétend pas** que chaque intégration optionnelle est automatiquement installée, connectée ou vérifiée. Chaque capacité reste soumise à son état runtime réel et à ses preuves disponibles.

---

### Démarrage rapide

#### Installation

```bash
npm install --global furypipe
furypipe setup
```

Le setup guidé ouvre l'onboarding terminal custom de FuryPipe. Il reste volontairement explicite afin que l'installation npm ne puisse jamais rester bloquée sur un script interactif.

Ou sans installation globale :

```bash
npx furypipe setup
```

#### Vérifier l’environnement

```bash
furypipe doctor
```

#### Démarrer le runtime Node

```bash
furypipe start
```

Le runtime Node est orienté loopback par défaut. Consultez [SECURITY.md](SECURITY.md) avant d’exposer FuryPipe au-delà de la machine locale.

### Export hors ligne sans proxy

FuryPipe peut préparer des artefacts de contexte **sans exécuter le proxy** :

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Selon l’entrée, l’export peut produire des artefacts comme `page-*.png`, `factsheet.txt` et `prompt.txt` pour inspection ou handoff.

#### Politique modèles par défaut

La politique par défaut combine **découverte dynamique + AUTO evidence-first**.

Le Model Fabric découvre/observe les modèles indépendamment de l'autorisation de compression. En `AUTO`, les profils visuels dont la qualité est vérifiée **ou calibrée** peuvent être transformés sans surcharge explicite. Les catalogues providers peuvent faire apparaître de nouveaux modèles sans nouvelle release, mais `découvert != vision-capable != calibré != qualité vérifiée`.

`FURYPIPE_VISUAL_POLICY=max_savings` élargit l'éligibilité aux modèles dont l'entrée image est positivement prouvée **et** dont le pricing image est connu via une preuve adaptée au provider. ExactGuard, la protection de l'état protocolaire, les budgets image/octets et la rentabilité restent obligatoires. `safe_exact` est plus strict qu'AUTO et exige un profil quality-verified ; `text_only` coupe globalement la transformation visuelle.

`FURYPIPE_MODELS` reste une surcharge de portée rétrocompatible. Un CSV sélectionne les bases de modèles ; `off` désactive la compression visuelle.

---

### Architecture

```text
                         ┌──────────────────────┐
                         │  Objectif utilisateur│
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
                         │ règles · budgets     │
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
       │ permissions/budgets │             │ routing/exécution   │
       └──────────┬──────────┘             └──────────┬──────────┘
                  └─────────────────┬─────────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │ Preuves & Receipts   │
                         │ vérifier le réel     │
                         └──────────────────────┘
```

Les systèmes de support incluent Continuous Memory, Recovery, Policy Runtime, FuryTrust, les runtimes MCP, les transports providers, Control Room et Web Studio.

Pour le modèle détaillé des composants et leurs frontières, consultez [ARCHITECTURE.md](ARCHITECTURE.md).

---

### Capacités principales

#### Capability Router

Sélectionne les capacités pertinentes pour la tâche au lieu de supposer que chaque skill, plugin ou intégration MCP enregistrée doit être chargée ou exécutée.

#### Instruction Fabric

Compose les instructions domaine/tâche sous un budget d’instructions explicite. Les règles demandées explicitement restent prioritaires ; le guidage automatique peut être omis si nécessaire pour respecter le budget.

#### Context Optimizer

Utilise une échelle de représentation bornée :

```text
metadata → summary → full → executable
```

Les valeurs exactes ne sont pas silencieusement dégradées, les secrets sont bloqués par défaut, et les budgets globaux / par type restent indépendants.

#### ExactGuard + Recovery

ExactGuard protège les identifiants et spans exacts sensibles contre des transformations lossless/lossy inadaptées. Recovery fournit des chemins de restauration explicites sans transformer un état caché en vérité implicite.

#### Agent Runtime

Fournit des étapes d’exécution gouvernées avec permissions, budgets et frontières d’effets de bord explicites. L’accès réseau ou l’écriture n’est pas accordé simplement parce qu’un agent existe.

#### MCP

FuryPipe inclut des surfaces MCP modernes, un transport HTTP Node et des primitives de compatibilité. Le support protocolaire local et l’interopérabilité hosted restent suivis comme des états de preuve distincts.

#### Exécution provider

Provider Fabric, Provider Runtime, OmniRoute, les transports providers, les governed executors et l’orchestration retry/fallback séparent la sélection du provider, l’autorisation, la santé et l’exécution.

#### Continuous Memory

Prend en charge un rappel borné et un apprentissage gouverné avec révisions, persistance scopée et distinction entre oubli logique et purge physique. La mémoire rappelée reste une donnée et ne gagne jamais une priorité d’instruction supérieure.

#### Control Room + Web Studio

Exposent les surfaces opérationnelles et les preuves sans transformer une preuve absente en succès.

---

### Modèle des états de vérité

FuryPipe préserve volontairement les distinctions de cycle de vie :

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

Lorsque la preuve manque, l’état correct reste `UNKNOWN`, `NOT_EXECUTED`, `PARTIAL` ou `BLOCKED` — jamais un succès déduit.

Cette séparation fait partie du contrat produit FuryPipe.

---

### Modèle de sécurité

FuryPipe est conçu autour de frontières de confiance explicites et de valeurs par défaut fail-closed.

Principes principaux :

- runtime Node loopback-first ;
- permissions lecture/écriture/réseau bornées pour l’exécution des agents ;
- aucune installation implicite de plugin tiers ;
- aucun serveur MCP arbitraire considéré comme fiable par défaut ;
- contenu externe, mémoire et sortie des tools traités comme données non fiables ;
- contexte secret bloqué sur les chemins non sûrs ;
- preuves de release liées à leur source ;
- installations figées dans les workflows privilégiés de release ;
- npm Trusted Publishing pour les publications automatisées après le bootstrap initial.

Documentation sécurité :

- [Politique de sécurité](SECURITY.md)
- [Threat model / modèle de sécurité](docs/SECURITY_MODEL.md)
- [Sécurité des releases](docs/RELEASE_SECURITY.md)

Les vulnérabilités doivent être signalées via le système privé de GitHub, **pas** dans une issue publique.

---

### CLI

Commandes principales :

```text
furypipe setup [--lang=fr|en] [--plain] [--no-color] [--yes]
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe link [--route PATTERN=TARGET]... [--] <agent> [args...]
```

Consultez [docs/CLI.md](docs/CLI.md) pour le contrat CLI public de référence.

---

### Points d’entrée du package

FuryPipe expose des modules ciblés pour permettre la composition au lieu d’imposer une API monolithique.

Exemples :

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

La liste de référence est définie dans [`package.json#exports`](package.json).

---

### Environnement de développement

Prérequis :

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

Les gates supplémentaires du dépôt couvrent la sécurité, la supply chain, les licences, l’analyse statique, la QA navigateur, la provenance et les preuves de release-readiness.

Un build local vert ne remplace pas les checks GitHub Actions requis.

---

### État de la release

| Surface | Statut |
|---|---|
| Package npm | **Publié — package actuel sur npm** |
| GitHub Release | **Publiée — dernière release GitHub** |
| Gates principales de release | **Vérifiées pour le release candidate** |
| Conformance Hosted MCP | **Vérifiée pour le release candidate** |
| Conformance Hosted Web Studio | **Vérifiée pour le release candidate** |
| Flux OAuth Authorization Server | **NOT_EXECUTED** |
| Connectivité Figma externe | **NOT_EXECUTED** |
| Revendications de performance provider | **NOT_EXECUTED / aucune revendication de performance pour la release** |
| Déploiement production | **État de cycle de vie séparé ; non déduit de la publication** |

Les détails de release sont documentés dans [CHANGELOG.md](CHANGELOG.md) et [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md).

---

### Documentation

#### Commencer ici

| Sujet | Document |
|---|---|
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| CLI | [docs/CLI.md](docs/CLI.md) |
| Sécurité | [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) |
| Routage des capacités | [docs/CAPABILITY_ROUTER.md](docs/CAPABILITY_ROUTER.md) |
| Composition des instructions | [docs/INSTRUCTION_FABRIC.md](docs/INSTRUCTION_FABRIC.md) |
| Optimisation du contexte | [docs/CONTEXT_OPTIMIZER.md](docs/CONTEXT_OPTIMIZER.md) |
| Model Fabric | [docs/MODEL_FABRIC.md](docs/MODEL_FABRIC.md) |
| Visual Engine | [docs/VISUAL_ENGINE.md](docs/VISUAL_ENGINE.md) |
| Orchestration des tâches | [docs/TASK_ORCHESTRATOR.md](docs/TASK_ORCHESTRATOR.md) |
| Continuous Memory | [docs/CONTINUOUS_MEMORY.md](docs/CONTINUOUS_MEMORY.md) |
| Agents | [docs/AGENT_FABRIC.md](docs/AGENT_FABRIC.md) |
| Providers | [docs/PROVIDER_FABRIC.md](docs/PROVIDER_FABRIC.md) |
| MCP | [docs/MCP.md](docs/MCP.md) |
| FuryTrust | [docs/FURYTRUST.md](docs/FURYTRUST.md) |
| Compatibilité | [COMPATIBILITY.md](COMPATIBILITY.md) |

---

### Identité runtime et historique upstream

**FuryPipe est opérationnellement indépendant. `furypipe` et `FURYPIPE_*` sont la seule identité runtime prise en charge pour les intégrations nouvelles comme existantes.**

Le runtime actuel ne consulte plus d’alias de commande legacy, d’espace de variables d’environnement legacy, d’anciens chemins de configuration ni l’ancien port d’écoute par défaut. Les références upstream historiques sont conservées uniquement lorsqu’elles sont nécessaires à la provenance, aux licences ou à la traçabilité des benchmarks ; elles ne participent pas au comportement runtime.

Consultez [COMPATIBILITY.md](COMPATIBILITY.md), [UPSTREAM.md](UPSTREAM.md), [SOURCE_LEDGER.md](SOURCE_LEDGER.md) et [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour la provenance et la migration.

---

### Contribuer

Les contributions sont bienvenues lorsqu’elles préservent les sémantiques evidence-first et fail-closed de FuryPipe.

Avant d’ouvrir une PR :

1. lire [CONTRIBUTING.md](CONTRIBUTING.md) ;
2. garder une cause racine ou une feature cohérente par PR ;
3. fournir des preuves reproductibles ;
4. préserver les états de vérité du lifecycle ;
5. ne jamais inclure de credentials, prompts privés ou logs sensibles.

Les vulnérabilités doivent suivre [SECURITY.md](SECURITY.md).

---

### Licence et provenance

FuryPipe est distribué sous [licence MIT](LICENSE).

Les attributions tierces et la provenance upstream sont suivies séparément dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) et [SOURCE_LEDGER.md](SOURCE_LEDGER.md).

---

## License

FuryPipe is distributed under the [MIT License](LICENSE).

Third-party attribution and upstream provenance are tracked separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [UPSTREAM.md](UPSTREAM.md) and [SOURCE_LEDGER.md](SOURCE_LEDGER.md).
