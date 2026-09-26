# FuryPipe — Gap Analysis 2026-09-26

Status: ACTIVE PRODUCT GAP LEDGER  
Repository: `Mistermode45/FuryPipe`  
Track: PR #233 — `claude/furypipe-studio-autopilot-extensions`  
Audit input HEAD: `e1a084be6216b107e787e2037e68af7f69776211`  
Product source: `docs/product/FURYPIPE_ULTIMATE_MASTER_CONTINUATION_PROMPT_2026-09-26.md`

## Scope and evidence rule

This document reconciles the 2026-09-26 continuation specification with the current FuryPipe implementation. It does **not** convert undocumented assumptions into DONE states. Existing completion evidence remains valid only for the exact capability it proves.

The 2026-09-25 Completion Spec remains the closure ledger for its original Studio/Foundation track. It is no longer the complete product vision after the 2026-09-26 continuation specification.

Status vocabulary:

- `DONE`: implementation and evidence already exist for the stated target.
- `PARTIAL`: a real primitive exists, but the new target is broader.
- `NOT_VERIFIED`: likely related code may exist, but this audit has not proved the full target.
- `NOT_STARTED`: the current tracked spec explicitly records no implementation.
- `HUMAN_GATE`: automated evidence exists but a required human validation remains.

## Architecture finding

FuryPipe already has a real Capability Catalog/Registry, Capability Router, governed Capability Activation path, FuryPrompt compiler, Instruction Fabric and the newer Fury Autopilot. The correct architecture is **convergence**, not a second parallel registry/router.

Primary evidence:

- `src/capability-catalog.ts`
- `src/ecosystem/types.ts`
- `src/ecosystem/registry.ts`
- `src/capability-router.ts`
- `src/capability-activation.ts`
- `src/fury-prompt.ts`
- `src/instruction-fabric.ts`
- `src/fury-autopilot.ts`
- `src/studio/studio-autopilot.ts`

## Gap matrix

| Capability | Current state | Target state | Gap | Priority | Dependencies | Risk | Verification |
|---|---|---|---|---|---|---|---|
| Evidence kernel / FuryJudge / FuryIR | DONE | Evidence-first kernel for all new surfaces | Extend receipts/contracts only when new surfaces require it | P0 guardrail | CORE-01/02/03 | High if bypassed | Existing unit/property tests + new contract tests |
| Universal Capability Registry | DONE CORE | One registry for MODEL/PROVIDER/SKILL/SKILL_PACK/INSTRUCTION/PLUGIN/MCP/CONNECTOR/TOOL/AGENT/WORKFLOW/AUTOMATION/media/runtime providers | Master taxonomy is represented by the existing catalog + Capability Index projection path; runtime stores remain authoritative and the index remains routing-metadata-only | P1 | capability catalog, trust, score | High | schema/index/adapters tests + exact-head CI |
| Capability Router + Fury Autopilot | DONE CORE | One explainable request router selecting model, skills, instructions, MCP, plugins, tools, agents and budgets | Studio consumes the shared Capability Index/Autopilot and emits an attested Request Blueprint. MCP/model candidates blocked by missing runtime authority remain advisory-only; executable selection stays in the governed runtime instead of being widened by routing metadata. | P1 | registry, prompt, dispatcher | High | routing/index/blueprint tests + exact-head CI |
| Capability Graph / Mesh | DONE CORE / PARTIAL FRONTIER | Request→Agent→Skill→MCP→Tool→Provider→Model plus Project→Repository→Files→Memory→Decision→Artifact | Capability Graph projects request decisions; Workspace Graph composes project/repository/files/memory/decisions/artifacts while FuryGraph/Memory/artifact stores remain authoritative. Advanced cross-workspace mesh remains a later frontier layer. | P1/P4 | registry, FuryGraph | Medium | capability/workspace graph tests + Studio browser QA |
| Skills | DONE CORE / PARTIAL EXTENDED | Auto routing, composition, packs, creator, registry, SDK, effectiveness analytics | Shared Capability Autopilot routes skills; Skill Hub supports discovery/import/enable/disable/pin/governance/version snapshots/rollback/compare and now a validated project-local Skill Creator. Creator emits bounded SKILL.md only; declared tools remain metadata with executionAuthorized=false. Public SDK, richer pack lifecycle and effectiveness analytics remain P2. | P1/P2 | registry, trust, eval | Medium | skill hub/API/security tests + browser QA + eval |
| Instructions | DONE CORE / PARTIAL UX | Registry + router + deterministic conflict resolver + layered precedence | Instruction Fabric + explicit Base→User→Workspace→Project→Domain→Task→Skill→Security→Runtime precedence now resolve deterministically and fail closed on same-precedence scalar conflicts; broader instruction-library UX remains | P1/P2 | FuryPrompt, registry | High | precedence/conflict tests + Studio rendering |
| FuryPrompt Engine | IMPLEMENTED_PENDING_EXACT_HEAD | Raw/Auto/Enhanced/Professional/Coding/Research/Creative/Strict/Fast + analyzer + compiled-prompt inspection | Nine official modes and deterministic prompt analysis are implemented; Studio renders recommended mode, ambiguity, missing context, conflict indicators, risk, expected output and complexity without silently changing authority | P1 | instruction fabric | Medium | prompt analyzer/compiler tests + Studio/browser QA + exact-head CI |
| FuryContext | IMPLEMENTED_PENDING_EXACT_HEAD | Retrieval + budget + inspector + compaction + diff-aware context | Context compiler remains core; bounded Context Inspector exposes loaded/available-not-loaded/not-present/unknown categories and explicit byte/token-estimate basis; deterministic Context Diff compares added/removed/changed entries and hard constraints. Advanced semantic compaction/history UX remains P2. | P1/P2 | memory, graph | High | context compiler/inspector/diff tests + FuryBench + Studio/browser QA + exact-head CI |
| FuryMemory | DONE core / PARTIAL target | Multi-layer memory graph, provenance, management, time machine | Memory VNext + Studio memory exist; advanced management/time-machine/cross-project graph remain broader | P2 | graph, storage | High | recall/false-memory eval + migration tests |
| Model Hub | IMPLEMENTED_PENDING_EXACT_HEAD | Unified local/cloud providers with real capability detection and per-model power controls | Studio now exposes a governed Model Hub snapshot combining Provider Fabric registration, safe AI connection discovery and reachable local Model Fabric entries. Truth states distinguish AVAILABLE_VERIFIED / CONFIGURED_UNVERIFIED / RUNTIME_DETECTED / NOT_CONFIGURED / UNKNOWN; unregistered connections remain visible but never executable. Cloud model catalog breadth and provider-specific power controls remain P2 and must stay unknown until provider evidence proves them. | P1/P2 | provider runtime, model fabric, secrets | High | model hub/unit/API/browser QA + live opt-in verification |
| Provider architecture | DONE CORE / PARTIAL SDK/UX | Stable ProviderAdapter/SDK, health routing, retries/fallback/circuit breakers | Existing governed provider boundary already includes exact request envelopes, fresh-health execution gates, process-local single-use permits, production OpenAI/Anthropic/Google transports, conservative transport-health promotion, bounded retry/fallback orchestration, cancellation, Retry-After handling and explicit cross-provider fallback authority. Remaining gap is a higher-level extension SDK/Studio configuration surface, not execution governance. | P1/P2 | model hub, observability | High | existing provider executor/transport/health/retry-fallback suites + installed package smoke + optional live verification |
| Image Studio | PARTIAL / NOT_VERIFIED | text/image editing, history, controls, artifacts | Visual engine primitives exist in foundation; complete Studio target not evidenced here | P2 | provider adapters, artifacts | Medium | provider-optional E2E |
| Video Studio | NOT_VERIFIED | provider-backed generation + storyboard/timeline | Helios is cataloged; production Studio integration not proven | P2 | queue, media providers, GPU | Medium | provider-optional E2E + queue recovery |
| Audio / Voice | PARTIAL | STT/TTS/realtime duplex with interruption and permissions | Current spec records media-realtime-voice primitive; Studio adds progressive dictation | P2 | permissions, model fabric | High | microphone/STT/TTS/realtime E2E |
| Studio shell / adaptive UX | HUMAN_GATE | Professional adaptive workspace with progressive disclosure | Fury Lux automated QA exists; human visual/screen-reader retest remains | P0 gate | UX-01 | Medium | human retest + a11y |
| FuryCode | DONE read-only / PARTIAL target | repo/editor/terminal/diff/problems/tests/git/GitHub/Graphify | Current Code view intentionally excludes editing/terminal; master target is broader | P2 | sandbox, permissions | High | browser QA + terminal security E2E |
| Browser / Research | DONE core / PARTIAL target | search/fetch/extract/crawl/browser interaction with citations and provenance | FuryWeb core DONE; full browser-agent interaction breadth not reconciled | P2 | browser runtime, security | High | SSRF/injection + browser E2E |
| MCP | DONE CORE / PARTIAL OAUTH UX/LIVE | auto router, manager, stdio/HTTP/SSE/streamable HTTP/OAuth, security | MCP Hub + Direct already provide multi-harness discovery, redaction, trust/policy, inventory probing, exact tool/schema binding, operator/governed approval, bounded execution receipts and durable replay. 2026 reconciliation adds explicit deprecated SSE compatibility and host-owned OAuthClientProvider support without token persistence. Remaining gap is interactive OAuth account UX/live certification, not transport authority. | P1/P2 | trust, secrets | High | protocol conformance + malicious MCP tests + optional OAuth live verification |
| Plugins / SDK | NOT_VERIFIED | FuryPlugin architecture + manifest + SDK + UI extensions/providers/connectors | Existing plugin bundles exist; new public SDK/manifest lifecycle target not proven | P2 | registry, permissions | High | extension compatibility + crash isolation tests |
| Agents / execution | DONE core / PARTIAL target | specialized agents, graph, message bus, parallel coordination, replay | Dispatcher/Run/Mission Control/Replay DONE; universal agent graph/message bus UX broader | P2 | FuryIR, registry | Medium | deterministic DAG tests + replay verification |
| Workflows / automations | DONE core / PARTIAL target | richer builder, schedules/events/webhooks, reusable workflows | FuryFlow Studio exists; full automation breadth requires reconciliation | P2 | execution engine | Medium | DAG + persistence + E2E |
| Artifacts | PARTIAL | first-class artifact graph, versioning, restore/export/search | Current master sync already records Artifact Graph as a gap | P2 | storage, graph | Medium | history/diff/restore tests |
| Graphify lifecycle | PARTIAL | safe automatic recommendation/refresh after relevant changes | Explicit bounded `refreshGraphify` exists; auto refresh after merge/checkout not wired | P2 | FuryGraph, integrator | Medium | incremental integrity tests + fallback behavior |
| Marketplace | NOT_STARTED | signed metadata, trust levels, install/update/rollback | Explicitly NOT_STARTED in Completion Spec | P2 | registry, trust, signatures | High | signature/tamper tests |
| Security / Zero Trust | DONE core / PARTIAL target | zero-trust extension/runtime policy across every new capability | Strong current controls; each new media/plugin/provider surface must inherit them | P0 continuous | FuryProof, trust | Critical | negative tests + SAST/dependency/secret scans |
| Supply chain | PARTIAL | scanner, hashes/signatures, SBOM, license/dependency ledger | Registry already tracks provenance/license/checksums; signed marketplace/SBOM breadth not fully proven | P1/P2 | registry | High | tamper/license/security fixtures |
| Observability / diagnostics | PARTIAL | trace tree, provider/tool/MCP latency, health, self-diagnostics | Existing control plane/evidence exists; unified FuryObservability target not audited complete | P2 | execution/provider layers | Medium | telemetry contract tests, no-secret logging |
| Cost / budgets | DONE core / PARTIAL UX | per-request/daily/monthly/workspace costs and budgets | Dispatch budget profiles DONE; complete cost accounting/display not in Studio | P2 | providers, observability | Medium | accounting tests + UI QA |
| Performance / recovery | DONE foundation / PARTIAL expanded | startup, streaming, queues, cancellation, backpressure, recovery, large-scale budgets | Many gates exist; new media/indexing/background workloads add unverified scale paths | P2/P3 | queue/storage | Medium | perf/chaos/restart suites |
| Personalization / i18n / accessibility | PARTIAL | appearance studio, profiles/layouts, FR/EN, keyboard/a11y | modes and automated a11y exist; full new customization target not reconciled | P3 | Studio | Low/Medium | browser/a11y/visual regression |
| FuryEval | PARTIAL | router/skill/memory/agent evals and regression datasets | FuryBench exists; master target adds broader per-capability effectiveness analytics | P1/P2 | observability | Medium | reproducible benchmark datasets |
| CLI/API/headless/desktop | PARTIAL | shared services across CLI/UI/API/headless/desktop | CLI/runtime foundation exists; desktop and complete headless/API parity not proven | P3 | stable service contracts | Medium | installed-package + API contract tests |
| Collaboration | NOT_VERIFIED | architecture-ready roles/shared workspaces without weakening permissions | Not a current release-critical implementation | P3 | identity/permissions | High | authorization matrix tests |
| Frontier differentiators | FRONTIER_BET | Capability Mesh, Context Diff, Memory Time Machine, Self-Healing, etc. only when measurable | Some primitives exist; most are intentionally not release criteria | P4 | core maturity + FuryEval | High if marketed early | benchmark before any differentiator claim |

## First architectural milestone

**P1-CAPABILITY-CONVERGENCE**

Goal: evolve the existing capability catalog/registry and router so Fury Autopilot consumes a single governed capability representation and emits one explainable request blueprint. No parallel registry, no duplicated authority model.

Acceptance criteria:

1. Existing capability candidate data remains backward compatible or has a tested migration.
2. Master capability types and metadata are represented without weakening current provenance/license/trust fields.
3. Fury Autopilot consumes registry/router outputs rather than maintaining an independent semantic decision path where equivalent information exists.
4. Selection remains metadata-only; execution authority stays in the existing policy/runtime layer.
5. Routing output exposes model/skills/instructions/MCP/tools/agents/budget/context decisions with reasons.
6. Conflict resolution is deterministic and tested.
7. No new capability receives implicit network/filesystem/credential/execution privileges.
8. Unit, integration, security and regression tests pass on the exact final HEAD.

## Deferred gates

- UX-01 human visual/screen-reader retest cannot be self-certified by automated tests.
- Live paid/cloud provider checks require explicit credentials/authorization and are not implied by contract tests.
- Merge/release/tag/publish/deploy remain forbidden without explicit operator authorization.


## P1 convergence checkpoint — 2026-09-26

Implementation checkpoint audited at `42d33f472eaa590bf399521a167c13c5adc96ed6`.

Observed changes:

- Capability Index taxonomy covers the master capability families and projects Skill Hub, MCP Hub, harnesses, providers, Model Fabric and the catalog through bounded adapters.
- Capability Autopilot emits process-local, selection-only plans with deterministic digests, trust/license/health/permission gates and no execution authority.
- Studio bypasses the legacy Skill Hub semantic selector for routed skill choice and derives skill activation from Capability Autopilot output.
- Fury Request Blueprint records model/skills/instructions/MCP/tools/agents/context/budget decisions and explicitly marks unresolved families.
- Request blueprints are process-local attested objects; serialized/forged blueprints are rejected by the runtime capability graph.
- Fury Capability Graph projects Request → Decision → Capability/Advisory/Blocked relationships, is bounded/deterministic and remains visualization-only.
- Studio Autopilot renders the capability graph and blocked/unresolved capability families.
- Repository/code dependency relationships remain owned by FuryGraph; no parallel code graph was introduced.

P1 Capability Convergence closure state at this audit:

1. MCP/model routing contract is explicit: candidates without runtime authority are advisory-only; routing metadata never widens permissions.
2. Real local Model Fabric discovery feeds Studio selection and explicit model requests remain planning-only until provider authority exists.
3. Workspace Graph composes Project → Repository → Files → Memory → Decision → Artifact using existing authoritative stores.
4. Instruction precedence/conflict reporting is explicit, deterministic and fail-closed.
5. Capability Convergence is therefore closed at the code-contract level; exact-head hosted evidence must still be attached to the final documentation SHA.

## Next architectural milestone

**P1-PROMPT-CONTEXT-INSPECTION**

Implemented on the continuation branch and pending final exact-head evidence:

- nine FuryPrompt modes: RAW / AUTO / ENHANCED / PROFESSIONAL / CODING / RESEARCH / CREATIVE / STRICT / FAST;
- deterministic prompt analysis for ambiguity, missing context, constraint conflicts, security risk, expected output and complexity;
- Studio prompt-analysis rendering;
- bounded FuryContext Inspector with loaded / available-not-loaded / not-present / unknown truth states;
- explicit byte budget and approximate token basis rather than fabricated exact token counts;
- deterministic Context Diff for added/removed/changed context and hard-constraint changes.

No merge, tag, release, npm publish or deploy is authorized by this checkpoint.

## Skills Creator checkpoint — 2026-09-26

Implemented on the continuation branch:

- project-local creator writes only a validated `SKILL.md` under `.furypipe/skills/<name>`;
- bounded name/description/instructions/version/author/license/runtime/tool/trigger/example/test fields;
- known-runtime allowlist for compatibility metadata;
- `allowed-tools` remains routing metadata and never grants tool authority;
- existing snapshots/version history are reused on replacement;
- Studio API requires explicit `confirm:true`;
- Studio UI exposes creation separately from local-folder import and states the no-authority boundary;
- unit/API tests cover successful creation, activation-as-instructions, confirmation, invalid names, unknown runtimes and oversized instructions.

Status remains `IMPLEMENTED_PENDING_EXACT_HEAD` until the final documentation/code SHA has all hosted gates green.



### Exact-head correction note

The first hosted validation of the Skill Creator documentation head exposed a real Prompt Analyzer classifier gap: an API/GitHub implementation request containing plural `tests` was classified as `PROFESSIONAL` instead of `CODING`. The classifier was corrected in `23164fbfd1a5d7d7ad7d11353a6f3730692fcc5c` by treating API/GitHub/implement/fix/testing vocabulary as coding evidence. The failed SHA is not reused as proof.


## Model Hub / Provider Architecture checkpoint — 2026-09-26

Code checkpoint audited at `e1a084be6216b107e787e2037e68af7f69776211`.

Implemented/reconciled:

- added `src/fury-model-hub.ts` as an inspection/routing-only projection over existing Provider Fabric, Model Fabric and safe AI Connection discovery;
- Studio exposes `GET /api/studio/models.json` and renders provider truth states in the Models view;
- configured credentials never imply live availability;
- runtime detection never implies provider invocation authority;
- detected providers without a registered adapter remain visible as `unregistered` / availability `unknown`;
- reachable local inference models are projected through the existing Model Fabric path;
- every Model Hub provider/model record carries `executionAuthorized:false`;
- existing provider architecture was re-audited rather than duplicated: `governed-provider-executor`, `provider-execution-gate`, `provider-request-envelope`, `provider-transport`, `provider-transport-health`, `provider-retry-fallback-orchestrator` and production provider transports remain authoritative.

Hosted evidence observed for the code checkpoint before this documentation update: Local Contracts, Secret Scan, Benchmark Contract, Web Studio Browser QA, Dashboard Browser QA, Accessibility, Upgrade/Rollback, Recovery/Restart and RC Preparation were green; CI/Cross-Browser/FuryBench/Clean Room were still completing. No earlier SHA is promoted as proof for the documentation head.

Status: `IMPLEMENTED_PENDING_EXACT_HEAD`.

No merge, tag, release, npm publish or deploy is authorized by this checkpoint.


## MCP transport / OAuth reconciliation checkpoint — 2026-09-26

Code checkpoint: `472ea62043e83cd9e2c28aa5194677849efaa925`.

Reconciled implementation:

- MCP Direct lifecycle now represents explicit `sse` sources in addition to `stdio` and `streamable_http`;
- legacy SSE is compatibility-only and is not silently preferred over Streamable HTTP;
- the installed MCP TypeScript SDK v2 transport is used rather than a custom wire implementation;
- Streamable HTTP and SSE may receive a host-owned `OAuthClientProvider`;
- OAuth/header credentials require a stable non-secret `principalId` binding;
- raw OAuth provider state, tokens, PKCE material and credential values remain outside endpoint fingerprints and serialized evidence;
- an OAuth provider and a static Authorization header cannot be combined ambiguously;
- remote URL HTTPS/allowlist/query/credential restrictions remain unchanged;
- FuryMcpHub can register/probe explicit SSE sources; new sources remain disabled + untrusted;
- Gateway `.http` commands treat Streamable HTTP and legacy SSE as the same governed network command family while `.stdio` remains strict;
- existing policy, proposal, approval, single-use execution and durable-replay boundaries remain authoritative.

Evidence already observed on the code checkpoint:
- exact-candidate build: PASS;
- Local Contracts including MCP/Gateway/durability: PASS.

Full hosted exact-head closure remains required on the final documentation SHA. No merge, release, tag, npm publish or deploy is authorized.
