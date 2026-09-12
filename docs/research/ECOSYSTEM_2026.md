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


---

# 2026 follow-up — portable standards and current official integrations

This section records the second 2026 pass performed on 2026-09-12. It extends the earlier repository audit with current official standards and active skill ecosystems. The decisions below do not replace FuryPipe's provenance, licence, permission or explicit-opt-in gates.

## Karpathy-inspired coding discipline

Source:

- `multica-ai/andrej-karpathy-skills@2c606141936f1eeef17fa3043a72095b4765b9c2`
- reviewed source file: `CLAUDE.md` (blob `daced9bd64f25908ebedeb4701fb406985dc8366`)
- plugin metadata version: `1.0.0`
- licence posture: MIT is declared in README/plugin metadata, but no root `LICENSE` file was found during this audit.

Decision: `ADAPT`

High-value principles:

- surface material ambiguity rather than silently selecting assumptions;
- prefer the smallest implementation that satisfies the requested behavior;
- keep diffs surgical and avoid unrelated cleanup;
- define observable success criteria and verify them.

FuryPipe integration:

- implemented as the native `karpathy-coding-discipline` instruction profile;
- profile is paraphrased into FuryPipe-owned wording rather than copying upstream `CLAUDE.md`;
- source commit/path/licence state remain inspectable;
- profile augments FuryPrompt constraints/plan/acceptance/verification sections;
- it does not grant tools, network access, skills or MCP permissions.

## Agent Skills open standard

Sources:

- Agent Skills official standard / Anthropic engineering documentation;
- `anthropics/skills@34040c9c568585f6929bedeaad110ad08f079624`.

Decision: `ADOPT_STANDARD / PER_SKILL_REVIEW`

2026 relevance:

- Agent Skills is a cross-platform portable format built around `SKILL.md`;
- progressive disclosure keeps name/description cheap and loads deeper instructions/resources only when relevant;
- skills may contain scripts/references and therefore must not be treated as harmless Markdown.

FuryPipe posture:

- align native skill metadata with the portable standard where practical;
- never bulk-import `anthropics/skills` as a trusted catalogue;
- Anthropic's repository has no single root licence file in the audited state, so every executable/copied artifact needs its own licence/provenance review;
- FuryPipe Skill Registry remains the execution trust gate.

## Agent Plugins 1.0

Source:

- <https://agent-plugins.org/specification>
- specification version: `1.0.0`.

Decision: `ADOPT_STANDARD`

Why it matters:

Agent Plugins provides a vendor-neutral package floor combining:

- `plugin.json`;
- `skills/` using Agent Skills;
- `mcp.json`;
- namespaced client-specific extensions.

FuryPipe plan:

1. export FuryPipe bundles toward Agent Plugins-compatible metadata where lossless;
2. future importer must enforce the standard's root/path-containment rules;
3. imported components still pass FuryPipe provenance/licence/permission/health review;
4. discovery/import never implies installation or execution;
5. secret values remain outside manifests.

A partial importer is intentionally not shipped in this checkpoint because the containment and component-discovery requirements are security-relevant and should be implemented against the full normative schema, not guessed from examples.

## Superpowers

Source:

- `obra/superpowers@b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- MIT verified;
- active plugin version observed: `6.3.0`.

Decision: `ADAPT`

Strong 2026 patterns:

- multi-harness skill portability;
- systematic debugging;
- TDD and verification-before-completion;
- skills themselves are pressure-tested/evaluated instead of being accepted because their prose looks good;
- context-specific tool mappings per harness;
- evidence over completion claims.

FuryPipe plan:

- adapt systematic-debugging / verification / skill-evaluation methodology into native skills and tests;
- do not auto-install the whole plugin;
- do not make Superpowers a dependency of Agent Runtime.

## Vercel skills CLI/ecosystem

Source:

- `vercel-labs/skills@d667282815248da03a08a18272b5d2eef9caf77c`
- MIT verified;
- current repository commit identifies release `v1.5.26`.

Decision: `ADAPT_DISCOVERY`

Use:

- cross-agent skill discovery;
- interactive and machine-oriented search/update UX;
- broad harness support.

FuryPipe posture:

- borrow discovery/update UX and metadata concepts;
- do not invoke `npx skills ...` automatically;
- discovery results remain untrusted until Skill Registry review;
- updates must be explicit and re-pin provenance.

## Figma MCP

Official endpoint:

- `https://mcp.figma.com/mcp`
- OAuth authentication.

Decision: `ADOPT / WRAP`

FuryPipe integration:

- new builtin opt-in `figma` bundle;
- default permission: `design-read` + network;
- `readOnlyPreferred=true`;
- no default `design-write`;
- design creation/update must use a separate future scoped-write profile;
- useful for Web Studio design context, variables, components and Code Connect.

## Cloudflare MCP + Skills

Sources:

- MCP: `cloudflare/mcp@1027dbd2865fc1932120db42ed53749bc30d2af0`;
- skills: `cloudflare/skills@b052c32bab7dd493513260228a36c88294f343f1`;
- skills licence: Apache-2.0 verified;
- official MCP endpoint: `https://mcp.cloudflare.com/mcp`.

Decision: `ADOPT / WRAP`

FuryPipe integration:

- new builtin opt-in `cloudflare` bundle;
- OAuth;
- `cloud-read` by default;
- no implicit deployment/configuration mutation;
- `cloud-write` must be a separate explicit profile;
- product-specific Cloudflare MCPs should be selected only when they reduce tool/schema scope.

## Exa MCP / Agent Plugin

Source:

- `exa-labs/exa-mcp-server@15ffb50519e719dc791cdc750ce5ed1934c0a1ed`;
- MIT verified;
- hosted MCP: `https://mcp.exa.ai/mcp`.

Decision: `WRAP`

FuryPipe integration:

- new builtin opt-in `exa` research bundle;
- OAuth/read-only network profile;
- default research profile should still choose one primary search provider;
- advanced Exa Agent tools are not silently enabled.

## Official MCP Registry

Source:

- <https://registry.modelcontextprotocol.io/docs>
- registry API `v1.0.0` observed.

Decision: `ADOPT_DISCOVERY_ONLY`

FuryPipe plan:

- use the registry for discovery/version metadata;
- never treat registry membership as licence/security/execution trust;
- never auto-install;
- discovered servers must be converted to bounded FuryPluginBundle candidates and revalidated.

## MCP Apps

Source:

- official MCP extension announced production-ready on 2026-01-26.

Decision: `ADAPT_FUTURE`

Potential FuryPipe use:

- interactive Control Room panels returned by MCP tools;
- forms/visualizations for configuration and evidence review;
- app-building previews.

Boundary:

- UI resources must not bypass tool permissions or origin/content isolation;
- no production claim until a supported client/browser surface is exercised.

## Docker MCP Toolkit

Source:

- official Docker MCP Toolkit/Catalog docs for Docker Desktop 4.62+;
- current status in docs: beta.

Decision: `REFERENCE_ONLY / WRAP`

Useful pattern:

- containerized local MCP execution;
- catalog/profile grouping;
- OAuth handling;
- signed local server distribution.

FuryPipe should not depend on Docker Desktop. A future optional container-runtime adapter can reuse the isolation/profile ideas when Docker is explicitly available.

## Sources not promoted to builtins

### Anthropic public skills repository

Keep as `PER_SKILL_REVIEW`; high quality and official does not make every skill suitable or licence-compatible for FuryPipe redistribution.

### Sentry MCP prototype

Keep `REFERENCE_ONLY` for now. The current official repository describes itself as a prototype. FuryPipe should wait for a mature supported contract before adding it to the builtin set.

### Full marketplace imports

Remain rejected. Current standards make portable installation easier, not safer by default.

---

# Revised recommended profiles

## Default development

- Context7;
- GitHub MCP read-only;
- native `karpathy-coding-discipline` instruction profile.

## App building

- Context7;
- GitHub MCP read-only;
- Playwright CLI;
- Figma MCP read-only;
- Supabase read-only;
- optional Cloudflare read-only when the target stack uses Cloudflare;
- optional 21st.dev component discovery.

## Research

Select one primary:

- Exa;
- Firecrawl;
- Tavily.

Add ScrapeGraphAI only for specialized extraction workflows.

## UI/debugging

- Playwright CLI for functional QA;
- Chrome DevTools MCP for deep diagnostics;
- Figma MCP for design context.

## Cloud application

- Cloudflare MCP read-only;
- Context7;
- GitHub MCP read-only;
- explicit separate mutation/deploy approval when required.

---

# Updated native skill roadmap

In addition to the twelve previously listed skills, prioritize:

## 13. skill-authoring-evals

Patterns:

- Agent Skills progressive disclosure;
- Superpowers skill pressure tests;
- Vercel skill discovery/update UX.

Behavior:

- define trigger/description first;
- test a baseline without the skill;
- test with the skill under pressure/ambiguity;
- inspect tool/network needs;
- pin source and licence;
- publish only after the skill changes behavior in the intended direction.

## 14. portable-plugin-review

Backed by Agent Plugins 1.0.

Behavior:

- validate package root;
- validate contained component paths;
- enumerate skills and MCP servers;
- classify permissions;
- strip secret values;
- reject implicit installs;
- produce a FuryPipe registry candidate only.

## 15. design-to-code

Backed by Figma MCP + Web Studio.

Behavior:

- obtain explicit design context;
- reuse components/tokens where available;
- preserve accessibility semantics;
- verify responsive/browser output with Playwright;
- do not enable Figma writes unless explicitly requested.

## 16. cloud-deploy-review

Backed by Cloudflare MCP patterns.

Behavior:

- read current configuration first;
- diff intended changes;
- separate read/plan from mutation;
- require explicit scoped write/deploy approval;
- capture post-change evidence and rollback identifiers.


---

# 2026 official production pass — cloud, billing, workspace and component ecosystems

This pass focuses on official vendor-maintained sources that are actively relevant to application creation in 2026. These integrations are intentionally classified by **blast radius**, not popularity.

A connector that can create resources, deploy code, modify billing/customer records or mutate project-management state is not eligible for a default FuryPipe profile merely because it is official.

## AWS Agent Toolkit / AWS MCP

Sources:

- `aws/agent-toolkit-for-aws@68d9e8541c45afd2510662bcea69fe1e433ea9db`;
- Apache-2.0 root licence verified;
- official AWS MCP documentation/catalog.

Current 2026 signals:

- AWS provides a production MCP/agent toolchain rather than only examples;
- IAM remains the correct authorization boundary;
- CloudTrail/CloudWatch-style auditability and account/role scoping are central;
- AWS has continued hardening skill implementations. A recent source commit fixed a predictable global S3 bucket ownership risk by requiring explicit owner verification.

Decision: `PER_SKILL_REVIEW / REFERENCE_ONLY_DEFAULT`

Why not a default builtin:

The AWS surface can reach broad infrastructure APIs. A generic “AWS enabled” switch would violate FuryPipe's least-privilege model.

Recommended FuryPipe design:

1. discover/account-read profile first;
2. plan/diff profile second;
3. resource mutation/deployment only in a separate `cloud-write` bundle;
4. exact account/region/role evidence exposed before every write-capable run;
5. host IAM remains authoritative;
6. capture rollback/resource identifiers;
7. never embed AWS credentials in plugin/skill metadata.

High-value skill patterns to adapt:

- ownership/identity verification before resource writes;
- architecture planning from current account state;
- infrastructure security review;
- explicit account + region context;
- deterministic preflight checks.

## Microsoft Azure Skills

Source:

- `microsoft/azure-skills@9d46511c1828eee052d6d0ef4652dcd548565e27`;
- MIT root licence verified.

Decision: `ADAPT_SELECTED_SKILLS`

Recommended use:

- Azure architecture/readiness planning;
- service selection;
- deployment-plan generation;
- diagnostics and verification methodology.

Boundary:

- native FuryPipe adaptations should be read/plan first;
- Azure resource creation or deployment must map to a separate `cloud-write` permission;
- do not bulk-copy the entire upstream skill set merely because the repository is official/MIT.

## Azure DevOps MCP

Source:

- `microsoft/azure-devops-mcp@9a81b90b67623ebc68c25b281d7fbf4f6e791eb0`;
- MIT verified.

Decision: `FUTURE_EXTERNAL_OPT_IN`

Recommended first profile:

- repositories/work items/build status read;
- no default work-item edits, branch mutation, pipeline mutation or release action.

This belongs beside GitHub MCP as an enterprise SCM/project-management connector, not inside Provider Fabric.

## Netlify MCP

Sources:

- `netlify/netlify-mcp@7bbb718b182fc77b34aaae3b2d575aef9163cf8b`;
- official remote endpoint documented as `https://netlify-mcp.netlify.app/mcp`;
- no root licence file was found during the source audit.

Decision: `FUTURE_EXTERNAL_OPT_IN / HIGH_WRITE_RISK`

Why useful:

- app/project discovery;
- Netlify configuration;
- site creation/deployment workflows;
- framework/deployment context.

Why not builtin yet:

The same connector can cross from “inspect app” into deployment/infrastructure mutation. FuryPipe needs tool-level capability filtering or a safe read-only profile before including it in the built-in list.

Target split:

- `netlify-read`: project/site/config/deploy status inspection;
- `netlify-deploy`: explicit `cloud-write` + deployment approval.

## Stripe AI / Stripe MCP

Sources:

- `stripe/ai@583467aab18cc7113dcd2c2e20028fe73c26eaa3`;
- MIT root licence verified;
- official remote MCP documented at `https://mcp.stripe.com`.

Decision: `PER_SKILL_REVIEW / REFERENCE_ONLY_DEFAULT`

Useful app-building capabilities:

- Stripe SDK/API integration guidance;
- billing architecture;
- product/pricing/subscription setup guidance;
- test-mode debugging.

Reason for conservative connector posture:

Customer, billing, product and payment tools can have direct financial impact.

FuryPipe should first adapt **instructional/diagnostic skills**. A future live Stripe connector must:

- prefer test mode;
- expose account/mode before action;
- split read vs mutation;
- deny payment/customer mutation in the default profile;
- require explicit user authorization for financially consequential operations.

## Notion MCP

Official source:

- Notion MCP developer documentation.

Decision: `REFERENCE_ONLY / FUTURE_SCOPED_PROFILE`

Notion's official MCP is useful for:

- product requirements;
- architecture docs;
- knowledge retrieval;
- task/project context.

It is also write-capable. A FuryPipe default workspace connector must not silently create/update pages.

Future profile split:

- `notion-read`;
- `notion-write` separately approved.

## Linear MCP

Official source:

- Linear MCP documentation.

Decision: `REFERENCE_ONLY / FUTURE_SCOPED_PROFILE`

Useful for:

- issue/project context;
- planning;
- status lookup;
- implementation traceability.

Risks:

- creating/updating issues/projects/comments changes the external source of truth.

Recommended boundary:

- read-only planning profile first;
- mutations only after explicit workspace + action approval;
- never let an autonomous subagent silently close/change project state.

## shadcn MCP / registry ecosystem

Source:

- `shadcn-ui/ui@7bc5604869dedd6f63975da6bf326bc966deac9c`;
- MIT `LICENSE.md` verified.

Decision: `ADAPT_APP_BUILDING / FUTURE_WRITE_PROFILE`

High-value use:

- component discovery;
- registry browsing;
- UI composition;
- project-specific component installation.

Important distinction:

shadcn MCP/CLI is not merely documentation retrieval: installing a component modifies the repository.

FuryPipe should therefore model:

- component search/inspect as read;
- installation/update as explicit `repository-write`;
- CLI version pinned rather than invoking an unbounded `@latest`;
- diff inspection + tests after every installed component.

## Updated app-building profile — 2026 production

### Safe default

- native `karpathy-coding-discipline`;
- Context7;
- GitHub MCP read-only;
- Figma MCP design-read;
- Playwright CLI;
- Web Studio local QA;
- Supabase read-only when backend context is needed.

### Optional research

Choose one primary:

- Exa;
- Firecrawl;
- Tavily.

### Stack-specific read profiles

Enable only when relevant:

- Cloudflare read;
- AWS read/discovery;
- Azure read/plan;
- Netlify read;
- Notion read;
- Linear read;
- Azure DevOps read.

### Explicit write/deploy profiles

Never automatic:

- GitHub repository-write;
- Supabase database-write/migrations/deploy;
- Figma design-write;
- Cloudflare cloud-write/deploy;
- AWS/Azure/Netlify cloud-write/deploy;
- shadcn repository-write/component installation;
- Notion/Linear workspace mutation;
- Stripe billing/customer/payment mutation.

## New native skill priorities

### 17. cloud-identity-preflight

Before any cloud write:

- provider/account/tenant/project;
- region;
- role/principal;
- resource ownership;
- current state;
- target state;
- rollback identifiers.

Inspired by AWS's current production-hardening patterns but implemented natively.

### 18. billing-safety

Before any billing/payment/customer mutation:

- environment/test/live mode;
- account;
- exact object IDs;
- idempotency/duplicate risk;
- financial effect;
- explicit authorization.

### 19. workspace-change-review

For Notion/Linear/project systems:

- read current object;
- show exact intended mutation;
- preserve immutable IDs;
- require write permission;
- verify post-change state;
- never infer permission from connector availability.

### 20. component-install-review

For shadcn/component registries:

- pin source/version;
- inspect target files;
- require repository-write;
- capture diff;
- run typecheck/tests/browser QA;
- reject unrelated package churn.


---

# 2026 second-pass: standards, memory and spec-driven engineering

## Agent Skills open standard

Source:

- `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`;
- Apache-2.0 root licence verified.

Decision: `ADOPT_FORMAT`

FuryPipe should accept the portable Agent Skills structure as an interchange format, but format validity is not execution trust. Imported skills still pass FuryPipe's provenance, pinned-source, licence, permission, health and network gates.

This is intentionally different from bulk-installing `anthropics/skills` or a marketplace.

## GitHub Spec Kit

Source:

- `github/spec-kit@d848fb4e18f44640ad6b42e60a280551ee90cdce`;
- MIT root licence verified.

Decision: `ADAPT_NATIVE`

FuryPipe now exposes a native `spec-driven-development` instruction profile instead of importing Spec Kit as a runtime dependency.

The profile enforces:

- specification/intent before implementation;
- architecture/technical plan before executable task breakdown;
- explicit assumptions, risks, dependencies and non-functional requirements;
- tasks mapped to observable acceptance criteria;
- verification against the specification;
- unmet criteria reported as blockers rather than hidden completion claims.

## Memory ecosystem

FuryPipe now has a native Recovery-backed Long-Term Memory track. External memory systems are therefore optional backends/research references, not baseline dependencies.

### Mem0

Source: `mem0ai/mem0@c7ee362aff94a369af70f13f2b4f853f6793ff4c`, Apache-2.0.

Decision: `ADAPTER_CANDIDATE`

Useful patterns:

- explicit memory consolidation;
- add/update/delete/no-op style lifecycle;
- optional managed/external semantic retrieval.

Boundary: do not silently upload FuryPipe memory to an external service.

### Letta

Source: `letta-ai/letta@5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a`, Apache-2.0.

Decision: `ADAPTER_CANDIDATE / REFERENCE`

Useful patterns:

- stateful agents;
- separation between active and durable/archival memory;
- agent memory management.

Boundary: FuryPipe Agent Fabric and Recovery remain authoritative unless an operator explicitly selects a Letta-backed profile.

### Zep Graphiti

Source: `getzep/graphiti@c035afb7990b6077331a81e98b04efcfd9bf8184`, Apache-2.0.

Decision: `ADAPTER_CANDIDATE`

Use:

- future temporal knowledge graph;
- time-aware entity/relationship retrieval;
- optional semantic backend for Knowledge/Long-Term Memory.

Boundary: Graphiti is not required for basic FuryPipe long-term memory and does not become an implicit network/database dependency.

## Vercel MCP

Official endpoint:

- `https://mcp.vercel.com`;
- OAuth;
- hosted official Vercel MCP.

Decision: `ADOPT / WRAP`

A builtin FuryPipe bundle now exposes it as:

- external opt-in only;
- `cloud-read` + `network`;
- OAuth;
- read-only preferred;
- no embedded token;
- no default `cloud-write`.

Future Vercel write/deployment actions require a separate scoped-write bundle rather than silently expanding this profile.

## Resulting integration policy

The preferred FuryPipe 2026 stack is now:

1. **portable skill format:** Agent Skills standard;
2. **native trust/execution:** FuryPipe Skill Registry;
3. **spec-first workflow:** native Spec Kit-inspired instruction profile;
4. **fresh docs:** Context7;
5. **repo evidence:** GitHub MCP read-only;
6. **browser QA:** Playwright CLI, Chrome DevTools specialist;
7. **app backends/cloud:** Supabase, Cloudflare, Vercel opt-in read-only profiles;
8. **design:** Figma MCP and optional 21st.dev reference;
9. **research:** one primary provider (Exa/Tavily/Firecrawl) plus specialist ScrapeGraphAI only when required;
10. **memory:** native Long-Term Memory by default, external Mem0/Letta/Graphiti only through explicit adapters;
11. **provider routing:** native Provider Fabric/fallback plus optional OmniRoute gateway;
12. **release:** exact-SHA Control Room evidence + provenance attestation + RC gates.

The goal is not the largest plugin count. The goal is a small default surface with high-value opt-in integrations and explicit trust boundaries.
