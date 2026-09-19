# FuryPipe VNext — OpenHuman, agentmemory, CodeGraph and Academic Research Skills (2026)

Status: Phase 0 research only. No runtime code.

## Executive summary

Four external references were reviewed in September 2026:

- OpenHuman: personal Agent OS, desktop experience, integrations and proactive local memory.
- agentmemory: persistent cross-agent memory with confidence, lifecycle, graph and hybrid retrieval.
- CodeGraph: local pre-indexed code knowledge graph for coding agents.
- Academic Research Skills (ARS): staged research workflows with verification and human checkpoints.

Together they strengthen the FuryPipe VNext direction: Agent OS + selective memory + selective code intelligence + portable skills + explicit evidence/trust.

## OpenHuman

Canonical repository: tinyhumansai/openhuman.

Verified public project material describes a local Rust core, Tauri desktop shell, React UI, JSON-RPC between frontend and core, persistent local state, Memory Tree, Obsidian-compatible Markdown vault, 100+ OAuth integrations, periodic auto-fetch, coding tools, voice support, optional local models, and headless/remote core operation.

Important privacy nuance: local-first is not identical to fully local by default. Current OpenHuman documentation states that its managed experience can use hosted services for account sign-in, model routing, web-search proxying and managed OAuth/integration flows.

FuryPipe should therefore expose precise privacy/runtime states instead of a vague local label.

High-value ideas for FuryPipe:
- UI-first onboarding.
- Headless core plus desktop/web clients.
- Source sync with explicit freshness policy.
- Editable human-readable memory vault.
- Voice and multimodal as first-class capabilities.
- Strong separation between local state and managed/cloud services.

FuryPipe must preserve:
- memory != authority
- memory != verified truth
- summary != source

## agentmemory

Canonical repository: rohitg00/agentmemory.
License: Apache-2.0.

The project supports many agent runtimes through hooks, MCP and REST. Public architecture includes observation capture, consolidation, hybrid lexical/vector/graph retrieval, confidence, forgetting, project profiles, graph querying and audit.

Project-published benchmark claims currently include 95.2% retrieval R@5 and 92% fewer tokens. These are vendor/project claims, not independent FuryPipe evidence.

Strong ideas for Fury Memory:
- explicit confidence.
- source/provenance binding.
- merge/supersede/contradict lifecycle.
- hybrid retrieval instead of vector-only retrieval.
- audit and export.
- one governed memory service usable by multiple agent runtimes.

Recommended Fury memory record concepts:
- memory ID
- source and source digest
- kind
- creation and last-observed timestamps
- confidence
- verification state
- supersedes/contradicts relations
- retention class
- scope

Important implementation lesson: public OpenHuman material and an OpenHuman issue show that documentation around its agentmemory adapter has at times been ahead of the active implementation during refactors. FuryPipe must preserve documented != implemented != tested != shipped != enabled.

Recommendation: do not blindly vendor agentmemory into the FuryPipe core. Build the Fury Memory contract natively, then consider agentmemory as an optional backend after source/license/security review.

## CodeGraph

Canonical repository: colbymchenry/codegraph.
License: MIT.

CodeGraph pre-indexes code into a local knowledge graph and supports symbol/caller/callee/relationship exploration for multiple coding agents.

Its current project-published benchmarks report 62% fewer processed tokens and 44% lower cost on average across seven benchmark repositories.

Critical nuance from CodeGraph's own documentation: lower tool traffic can still leave substantially more retrieval material resident in the model context. Therefore retrieval efficiency != context-window efficiency.

This is highly relevant to FuryPipe.

Fury CodeGraph should return compact task-specific graph slices with drill-down handles rather than large dense payloads.

Proposed Fury CodeGraph layers:
- project manifest: languages, modules, build systems.
- symbol graph: definitions, types, imports, references.
- execution graph: callers, callees, events, tests.
- history/evidence: Git, recent edits, diagnostics, CI.
- semantic layer: embeddings and linked docs/issues/PRs.

Freshness must be explicit:
- repo HEAD
- working-tree digest
- index version
- parser/language-adapter version
- last complete scan
- incremental update state

CodeGraph is a VERY HIGH priority VNext reference.

## Academic Research Skills

Canonical repository: Imbad0202/academic-research-skills.
Current observed academic-pipeline version: 3.22.0 in September 2026.
License: CC BY-NC 4.0.

The project explicitly states that this license is noncommercial and not an OSI open-source license.

Therefore FuryPipe must not copy or vendor ARS workflow text, prompts, templates or skill content into a commercial-capable distribution without separate permission.

ARS remains a strong design reference because it uses:
- staged research workflows.
- deep research and systematic-review modes.
- citation/source verification.
- integrity gates.
- multiple reviewer roles.
- revision and re-review.
- human checkpoints.
- read-only review concepts.
- explicit human-in-the-loop positioning.

Useful independent FuryPipe concepts:
- skill = workflow + quality gates, not only a static prompt.
- checkpoint types such as AUTO, REVIEW, APPROVAL_REQUIRED and MANDATORY_VERIFY.
- claim -> evidence -> verification -> output.
- reviewer and implementer should be separate roles.
- reviewer should default to read-only.
- agent judgment != human decision authority.

Recommendation: independently build a generic Fury Research Pack/workflow engine. Do not copy ARS content.

## Combined VNext impact

These references strengthen four FuryPipe components.

### Fury Memory
Influences: OpenHuman Memory Tree + agentmemory.
Target qualities: source-aware, editable, hierarchical, hybrid-searchable, confidence-scored, auditable and selectively recalled.

### Fury CodeGraph
Influence: CodeGraph.
Target qualities: pre-indexed, incremental, local, symbol-aware, flow-aware, Git-aware, budget-aware and provenance-aware.

### Fury Skills
Influences: Agent Skills standard + ARS architecture.
Target qualities: portable Skill compatibility plus Fury indexing, stage gates, budgets, verification and permissions.

### Fury Experience
Influence: OpenHuman.
Target qualities: desktop/web first-class, headless Gateway, voice, integrations, memory browser and task/work views.

## Benchmark additions

Memory:
- retrieval recall and precision.
- stale-memory rate.
- contradiction detection.
- source traceability.
- token savings.
- false-memory injection.
- forgetting correctness.

CodeGraph:
- task correctness.
- retrieval tool calls.
- processed tokens.
- residual context footprint.
- time-to-answer.
- stale-index error rate.
- incremental-index latency.

Skills:
- routing accuracy.
- skill load overhead.
- checkpoint compliance.
- source-verification success.
- cost.
- hallucinated citation rate.

Agent OS:
- startup.
- idle CPU/RSS.
- connector sync.
- offline behavior.
- reconnect behavior.
- memory freshness.
- privacy-boundary correctness.

## Priority

- OpenHuman: HIGH.
- agentmemory: HIGH.
- CodeGraph: VERY HIGH.
- Academic Research Skills: HIGH design value, but no direct commercial integration under current license.

Final decision: FuryPipe VNext should treat Fury Memory and Fury CodeGraph as first-class local services behind the Gateway, selected through Capability Autopilot rather than blindly injected into every model turn.

Research broadly; copy only when the license and source ledger explicitly permit it.
