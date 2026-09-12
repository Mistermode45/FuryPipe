# FuryPipe — 2026 Agent / MCP / Skill / Plugin Ecosystem Audit

Snapshot: 2026-09-12

## Goal

This audit identifies 2026-era external projects worth integrating with FuryPipe without turning the runtime into an unreviewed marketplace loader.

Every source is classified as one of:

- `ADOPT`: FuryPipe should expose a first-class compatible boundary or builtin manifest.
- `ADAPT`: use the engineering pattern or build a FuryPipe-native adapter; do not copy wholesale.
- `WRAP`: keep the external runtime/package separate and expose a bounded opt-in connector.
- `REFERENCE_ONLY`: useful design/workflow reference, not an executable dependency.
- `REJECT`: do not integrate into the production baseline.

A source is never trusted merely because it is popular, recently updated, listed in a marketplace or installed by another agent.

## Non-negotiable FuryPipe rules

1. External executable source must be pinned to an immutable commit/package version.
2. GitHub URL alone is not executable provenance.
3. Licences are checked before code reuse.
4. Secrets stay host-owned and are represented only by environment-variable names in manifests.
5. Builtins never use `@latest`.
6. Plugin/skill catalogues are metadata until an explicit operator enables them.
7. Read-only is the default permission for MCP/database/repository connectors.
8. Browser/process/network/database-write/repository-write/provider-management are explicit permissions.
9. Remote HTTP requires HTTPS except explicit loopback development boundaries.
10. Third-party benchmark claims are not FuryPipe evidence.
11. AGPL/commercial sources remain external/reference-only unless a deliberate licensing decision is made.
12. Marketplace scale does not bypass per-artifact review.

---

# Tier A — integrate as FuryPipe first-class opt-in boundaries

## Context7

Source:

- docs: https://context7.com/docs/clients/claude-code
- source: `upstash/context7@6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e`
- licence: MIT verified

Decision: `ADOPT / WRAP`

Use:

- current library documentation;
- context lookup before library/framework implementation;
- remote MCP or CLI/plugin mode.

FuryPipe posture:

- builtin plugin bundle;
- network permission;
- OAuth or host-owned `CONTEXT7_API_KEY`;
- read-only;
- no implicit network call.

## GitHub MCP

Source:

- `github/github-mcp-server@7d13a7ad6f2a17f351a6d77ce280c85ae1821f4d`
- licence: MIT verified

Decision: `ADOPT / WRAP`

Use:

- repository/issue/PR/workflow evidence;
- source and release automation under explicit permissions.

FuryPipe posture:

- builtin plugin bundle;
- OAuth;
- repository-read default;
- repository-write requires a separate explicit profile;
- never grant broad write because a task only needs reading.

## Microsoft Playwright CLI

Source:

- `microsoft/playwright-cli@655530f6d0dc71a0d6bf46ae165877d3c7311099`
- licence: Apache-2.0 verified

Decision: `ADOPT / WRAP`

Reason:

The 2026 Playwright CLI explicitly targets coding agents and presents CLI + skills as a token-efficient alternative to loading large MCP schemas for high-throughput coding workflows.

Use:

- Web Studio browser QA;
- screenshots;
- browser sessions;
- app verification.

FuryPipe posture:

- builtin CLI bundle;
- pinned package version;
- `autoInstall=false`;
- browser/process/network permissions;
- isolated session/workspace;
- user approves actual install/execution.

## Supabase AI tools

Source:

- docs: https://supabase.com/docs/guides/ai-tools/plugins

Decision: `ADOPT / WRAP`

Supabase now exposes a combined AI-development model:

- MCP for live project access;
- Agent Skills for procedural guidance;
- plugins bundling MCP + skills;
- static prompts for clients without those capabilities.

FuryPipe posture:

- builtin project-scoped bundle;
- database-read default;
- OAuth;
- database-write/migrations/deployments require a separate scoped-write profile;
- never infer access from local Supabase config.

## OmniRoute

Source:

- service: https://www.omniroute.online/
- source: `diegosouzapw/OmniRoute@152d95108c9c3d557562311ffed63240a511eb31`
- licence: MIT verified

Decision: `ADOPT / WRAP`

Use:

- multi-provider gateway;
- OpenAI-compatible routing;
- Anthropic/Gemini compatible surfaces;
- provider fallback/quota routing.

FuryPipe posture:

- explicit Provider Fabric adapter;
- inbound provider credentials stripped before gateway credential application;
- loopback HTTP only; remote gateway requires HTTPS;
- no provider-health/pricing claims inferred from adapter presence;
- external probe/benchmark evidence remains separate.

## Chrome DevTools MCP

Source:

- `ChromeDevTools/chrome-devtools-mcp@d9a8cb6ec22aadf5cb964c5e97a8b047693046e2`
- licence: Apache-2.0 verified

Decision: `WRAP`

Use:

- browser console/network debugging;
- trace/performance analysis;
- DevTools inspection;
- live browser diagnostics.

FuryPipe posture:

- optional browser-debug bundle;
- prefer isolated/headless profiles;
- disable usage statistics/update checks in CI or hardened profiles when supported;
- keep distinct from Playwright CLI: Playwright is default app QA automation, Chrome DevTools is deeper debugging/performance.

## 21st.dev MCP / skills

Source:

- legacy/unified proxy: `21st-dev/magic-mcp@6b5299e8a83ceffa73d4fc4e148905bb3eeeeb55`
- current remote surface: https://21st.dev/api/mcp
- licence of compatibility proxy: ISC verified

Decision: `WRAP`

Use:

- component/theme discovery;
- UI generation/reference workflows.

FuryPipe posture:

- optional UI bundle;
- network + host-owned API-key secret;
- component code returned by the service is still reviewed by normal code/security gates;
- old Magic MCP identity is treated as compatibility only; use current 21st surface.

## Codebase Memory MCP

Source:

- `DeusData/codebase-memory-mcp@b790be3d15d44f0d4629a2c97ddf76c104d80d22`
- licence: MIT verified

Decision: `WRAP`

Use:

- persistent code graph;
- structural queries;
- cross-file/call graph exploration;
- codebase memory.

Important trust boundary:

The MCP reads source files deeply, writes agent configuration and can spawn background processes. Its security documentation states that indexing/querying are local but an update check can contact GitHub.

FuryPipe posture:

- external local MCP;
- repository-read + process permissions;
- no automatic install;
- opt out of network/update behavior where possible for hardened runs;
- do not replace FuryPipe Recovery/Knowledge storage with it automatically;
- use it as an optional structural-intelligence provider.

---

# Tier B — high-value patterns to adapt into FuryPipe-native skills/runtime

## Addy Osmani Agent Skills

Source:

- `addyosmani/agent-skills@be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39`
- licence: MIT verified

Decision: `ADAPT`

Strength:

Production-grade engineering workflows across spec, plan, build, test, review and ship.

FuryPipe plan:

- do not import all skills blindly;
- review skill-by-skill;
- translate selected workflows into FuryPipe skill registry metadata;
- preserve source attribution and pinned commit;
- start with spec-driven development, debugging, testing, code review, architecture and documentation/ADR workflows.

## wshobson/agents

Source:

- `wshobson/agents@a30778f8c4e6b0a87567941b7cca4f534bf642b6`
- licence: MIT verified

Decision: `ADAPT`

High-value 2026 patterns:

- one source of truth transformed to multiple harnesses;
- native outputs for Claude Code, Codex, Cursor, OpenCode, Antigravity and Copilot;
- progressive-disclosure skills;
- explicit trigger phrases;
- generated-registry drift checks;
- recent hardening around treating `$ARGUMENTS` as data rather than trusted instructions.

FuryPipe plan:

- adopt multi-harness compilation principles;
- add prompt/input framing checks to FuryPrompt/skill validation;
- do not copy the whole 183-skill/202-agent catalogue.

## Ponytail

Source:

- `DietrichGebert/ponytail@356918eba965ee1eac64bd3a7f0dd02108350de5`
- licence: MIT verified

Decision: `ADAPT`

Use:

- minimal-code discipline;
- YAGNI;
- prefer platform primitives;
- benchmark methodology comparing real agent edits rather than isolated answer length.

FuryPipe plan:

- create a FuryPipe-native `minimal-change` / `avoid-overengineering` skill;
- keep validation/security/accessibility safeguards mandatory;
- do not copy marketing performance claims into FuryPipe benchmarks.

## UI Skills

Source:

- https://www.ui-skills.com
- root skill currently points to `ibelick/ui-skills`

Decision: `ADAPT / REFERENCE_ONLY`

Strong pattern:

- route by topic/intent;
- load the smallest useful UI skill;
- categories include accessibility, motion, systems, visual, interaction, performance, typography, color, frontend architecture, testing and tooling.

FuryPipe plan:

- adopt lazy skill routing for Web Studio;
- each selected skill still requires pinned source/licence audit;
- do not grant the whole catalogue execution permission.

## Agency Agents

Source:

- `msitarzewski/agency-agents@6d29a9b08785a0e49ffc9818bbdd381164c2df5f`
- licence: MIT verified

Decision: `ADAPT`

Use:

- role decomposition;
- specialist-agent taxonomy;
- handoff roles.

FuryPipe plan:

- reuse role taxonomy ideas for Agent Fabric presets;
- avoid importing hundreds of personalities into context;
- keep system roles concise and task/evidence oriented.

## Zoetrope

Source:

- `furkankly/zoetrope@b1f31dd26bd4e9e513885e39edb78d0850a5d1fe`
- licence: MIT verified

Decision: `ADAPT / WRAP`

Use:

- read-only live session graph;
- Claude Code/Codex transcript visualization;
- subagent/tool timeline.

FuryPipe plan:

- Control Room observability adapter candidate;
- metadata-only by default;
- no raw transcript ingestion into telemetry unless explicitly enabled;
- session display must not become a secret/prompt exfiltration path.

## Graft

Source:

- `trailhq/Graft@f9e65396e638e517aecae0d731017f53084d70ed`
- licence: MIT reported/verified in repository audit

Decision: `WRAP / COMPARE`

Use:

- context layer for large codebases;
- MCP/codebase graph;
- learned repository context.

FuryPipe plan:

- benchmark against Codebase Memory and native Knowledge/Recovery;
- do not deploy two persistent indexing systems by default;
- choose one external context backend per profile.

## VoltAgent

Source:

- `VoltAgent/voltagent@44b4c8e4998ce56095b2f0e4eaf1a988f5e6d0de`
- licence: MIT file exists (`LICENCE`)

Decision: `REFERENCE_ONLY / ADAPT`

Use:

- agent framework patterns;
- observability/orchestration ideas.

FuryPipe plan:

- Agent Fabric already exists; importing another orchestration framework would duplicate the core;
- only adapt specific patterns when they solve a measured gap.

## Claude Code Templates

Source:

- `davila7/claude-code-templates@45291d0c56fa0a5a96177f98573bacc12dc74774`
- licence: MIT verified

Decision: `REFERENCE_ONLY / ADAPT`

Use:

- catalogue schema for agents/commands/skills/MCP/settings/hooks;
- frontmatter validation;
- packaging UX ideas.

FuryPipe plan:

- borrow validation concepts;
- do not make its installer a FuryPipe dependency.

## OneWave Claude Skills

Source:

- `OneWave-AI/claude-skills@82859c0ebaff803889be6ca2efa0834ba8787773`
- licence: MIT verified

Decision: `REFERENCE_ONLY / PER_SKILL_REVIEW`

Use:

- broad skill catalogue;
- straightforward SKILL.md format.

FuryPipe plan:

- per-skill provenance/review;
- no bulk installation.

## Tons of Skills Marketplace

Source:

- `jeremylongshore/tons-of-skills-marketplace@8871797ea0602e1a5068441ac083c52467cb1604`
- repository tooling licence: MIT; individual mirrored plugin licences vary

Decision: `REFERENCE_ONLY`

High-value pattern:

- source-of-truth vs generated adapters;
- pinned upstream mirrors;
- explicit author/licence/commit metadata;
- certification must not be claimed before evidence exists.

FuryPipe plan:

- adopt provenance/governance ideas;
- never treat marketplace membership as execution trust;
- avoid importing thousands of artifacts into the default registry.

---

# Tier C — research / scraping connectors

FuryPipe should support multiple research providers through the same explicit plugin-bundle contract, but enable only the operator-selected provider(s).

## Firecrawl

Source:

- `firecrawl/firecrawl-mcp-server@4db752ee00910e17ec73f28b40796f0830fe86da`
- licence: MIT verified

Decision: `WRAP`

Good for:

- search;
- scrape;
- crawl/map;
- interactive extraction;
- deep research.

Default FuryPipe posture:

- remote MCP opt-in;
- network permission;
- keyless/read-only profile can be separate from authenticated full profile;
- crawling limits are mandatory.

## Tavily MCP

Source:

- `tavily-ai/tavily-mcp@cf38d5cc5e25c6b0b2e3043974922ad1399b4879`
- licence: MIT verified

Decision: `WRAP`

Good for:

- real-time search;
- extract;
- map/crawl.

FuryPipe posture:

- research provider alternative;
- host-owned API key;
- explicit network/budget limits.

## Exa MCP

Source:

- `exa-labs/exa-mcp-server@15ffb50519e719dc791cdc750ce5ed1934c0a1ed`
- licence: MIT verified

Decision: `WRAP`

Good for:

- web search;
- code/research search;
- content fetching;
- multi-step research.

FuryPipe posture:

- optional research bundle;
- do not load simultaneously with every competing search MCP unless the task requests it.

## ScrapeGraphAI

Source:

- `ScrapeGraphAI/Scrapegraph-ai@c75c8084fae2d4f5ba01a8c218bc1168b67e3569`
- licence: MIT verified

Decision: `WRAP / SPECIALIZED`

Use:

- structured/LLM-assisted scraping;
- self-host/local LLM workflows;
- specialized extraction pipelines.

FuryPipe posture:

- not the default search connector;
- useful when graph/extraction pipelines are specifically requested;
- telemetry disabled in hardened/local runs where supported.

---

# Tier D — reference-only due scope, licence or risk

## OpenMontage

Source:

- `calesthio/OpenMontage@08e2151fa02de28a5d6a312b3d575692bf147ad7`
- licence: AGPL-3.0 verified

Decision: `REFERENCE_ONLY`

Reason:

Video-production agent architecture can inspire future media workflows, but implementation should not be copied into the MIT FuryPipe core without a deliberate licensing choice.

## Claude Squad

Source:

- `smtg-ai/claude-squad@ce1ffb4392b01f38e2c4599c7c84d2a93973b138`
- licence: AGPL-3.0 verified in repository audit

Decision: `REFERENCE_ONLY`

Use:

- isolated worktree/tmux multi-agent coordination patterns.

FuryPipe already has bounded local multi-subagent runtime, so use this only for worktree/process UX ideas.

## Strix Claude Code

Source:

- `tghastings/strix-claude-code@55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2`
- licence unresolved in the current audit

Decision: `REFERENCE_ONLY`

Reason:

It drives penetration-testing tooling inside a sandbox. This is high-privilege/offensive execution and must never become an automatically enabled FuryPipe plugin.

Possible safe use:

- security-test planning patterns;
- sandbox architecture reference;
- no automatic scanner/tool execution.

## HorizonX

Source:

- https://horizonx.so

Decision: `REFERENCE_ONLY`

Commercial design/code content. No reproduction/vendoring unless the operator independently owns the required rights.

---

# Recommended 2026 FuryPipe builtin bundle set

The builtin registry should stay deliberately small.

## Core development

1. Context7 — fresh docs.
2. GitHub MCP — repository/workflow evidence, read-only default.
3. Playwright CLI — token-efficient browser QA.
4. Chrome DevTools MCP — deep browser debugging/performance.
5. Supabase — app backend, project-scoped read-only default.
6. Codebase Memory MCP — optional local structural code intelligence.
7. OmniRoute — optional provider gateway.
8. 21st.dev — optional component/UI discovery.

## Research

Expose profiles, but do not enable all at once:

- Firecrawl;
- Tavily;
- Exa;
- ScrapeGraphAI specialized profile.

The profile chooses one primary search/research connector and optional specialist connectors.

## Skills

Curated source pools:

- Addy Osmani Agent Skills;
- wshobson/agents;
- UI Skills;
- Ponytail methodology;
- Agency Agents role taxonomy;
- OneWave skills per-skill only.

FuryPipe should compile selected audited skills into its own registry instead of loading entire upstream marketplaces.

---

# Native FuryPipe skills to create from the audit

These should be FuryPipe-native instructions, written from principles rather than copied verbatim.

## 1. spec-before-code

Sources/patterns:

- Addy Osmani Agent Skills;
- existing FuryPipe production-grade workflow.

Behavior:

- define acceptance criteria;
- architecture/flow first;
- implementation second;
- evidence at the end.

## 2. minimal-change

Sources/patterns:

- Ponytail;
- YAGNI;
- platform-native primitives.

Behavior:

- prefer deleting/avoiding code;
- no dependency for a platform primitive;
- preserve validation/security/a11y;
- minimize diff, not correctness.

## 3. systematic-debugging

Behavior:

- reproduce;
- trace actual execution;
- root cause;
- regression test;
- smallest safe fix.

## 4. security-review

Behavior:

- trust boundaries;
- secrets;
- input validation;
- SSRF/path traversal/command injection;
- dependency/provenance;
- least privilege.

## 5. browser-qa

Backed by:

- Playwright CLI;
- Chrome DevTools MCP when deeper debugging is required.

Behavior:

- functional path;
- console/network;
- responsive;
- accessibility structure;
- screenshots on failure;
- no production verification claim from local lab results.

## 6. current-docs

Backed by Context7.

Behavior:

- consult current library docs before relying on model memory for fast-moving frameworks.

## 7. codebase-intelligence

Backed by optional Codebase Memory/Graft.

Behavior:

- prefer structural graph queries before bulk file reads;
- source code remains local by default;
- no automatic external index upload.

## 8. ui-engineering-router

Pattern from UI Skills.

Behavior:

- classify UI task;
- load smallest useful design skill;
- avoid loading full UI catalogue;
- a11y/performance/testing always remain separate gates.

## 9. research-router

Behavior:

- select one primary research connector;
- bound crawl/search;
- track source URLs and retrieval time;
- never merge search output into trusted facts without provenance.

## 10. multi-agent-task-split

Patterns:

- FuryPipe Agent Fabric;
- Agency Agents;
- Claude Squad architecture reference.

Behavior:

- non-overlapping tracks;
- explicit ownership;
- bounded concurrency;
- parent budget;
- deterministic merge/evidence.

## 11. argument-is-data

Pattern highlighted by current wshobson/agents hardening.

Behavior:

- untrusted caller text is delimited as data;
- it cannot redefine the surrounding skill/command policy;
- tool permissions remain the security boundary.

## 12. release-evidence

Behavior:

- exact SHA;
- CI/security/provenance evidence;
- no release claim without authorization;
- no performance claim without executed benchmark.

---

# MCP / plugin selection policy

## Default minimal profile

- Context7
- GitHub MCP read-only

## App-building profile

- Context7
- GitHub MCP read-only
- Playwright CLI
- Supabase read-only
- optional 21st.dev

## Deep browser profile

- Playwright CLI
- Chrome DevTools MCP

## Large-codebase profile

- one of Codebase Memory MCP or Graft
- GitHub MCP read-only
- Context7

## Research profile

- one primary: Firecrawl / Tavily / Exa
- optional ScrapeGraphAI for structured extraction

## Provider-routing profile

- OmniRoute adapter
- Provider Runtime health/cost evidence

Never activate every connector in one session by default: tool-schema/context bloat, duplicate capabilities and larger attack surface are the opposite of FuryPipe's purpose.

---

# Explicit rejects for the default production baseline

- bulk import of 100/200/3000+ skills;
- `npx ...@latest` in pinned builtin manifests;
- silent package installation;
- external skill execution without pinned provenance/licence;
- auto-enabling database/repository writes;
- unrestricted browser profile reuse;
- raw session transcript telemetry by default;
- offensive security toolchains as automatic plugins;
- AGPL source copied into MIT FuryPipe core;
- commercial UI/code copied without independent rights;
- provider quota/pricing/speed claims imported from project marketing pages;
- multiple overlapping research MCPs enabled simultaneously without a task reason.

---

# Next implementation order

1. Finish and merge safe plugin-bundle contract.
2. Recreate OmniRoute adapter on current hardening HEAD and merge after full gates.
3. Add optional Chrome DevTools / Codebase Memory / 21st / research bundle manifests.
4. Add native curated skills listed above.
5. Add source import validator for SKILL.md:
   - immutable source;
   - licence state;
   - allowed tools/permissions;
   - argument framing;
   - no embedded secrets;
   - no hidden network/process requirement.
6. Add multi-harness exporter for FuryPipe skills.
7. Add optional Control Room connector health section.
8. Run external integration probes only with explicit credentials/environment authorization.
