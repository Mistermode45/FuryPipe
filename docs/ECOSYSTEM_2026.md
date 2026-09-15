# FuryPipe — Ecosystem Research 2026

Research date: 2026-09-12

This document is the curated integration plan for external skills, MCP servers,
plugins, agent harnesses, code-context tools, browser tooling and provider
routers that are relevant to FuryPipe V5.

The rule is intentionally strict: **discover broadly, execute narrowly**.
Nothing becomes executable merely because it is popular or listed here.

## Decision vocabulary

- **ADOPT** — integrate as a supported FuryPipe capability or official connector.
- **ADAPT** — reuse the workflow/pattern through FuryPipe-native contracts; do not
  copy the external implementation blindly.
- **WRAP** — support the external tool as an optional adapter/connector while
  keeping FuryPipe core independent.
- **REFERENCE_ONLY** — useful architectural/instruction reference; never executed
  or vendored by default.
- **REJECT** — do not integrate into the current baseline.

Every external executable source still needs:

1. exact repository/source identity;
2. immutable version or commit SHA;
3. license review;
4. threat-boundary review;
5. permission/network declaration;
6. health check;
7. tests against the FuryPipe adapter;
8. explicit opt-in where credentials, network or write access are required.

---

# Executive shortlist

## Tier A — integrate first

| Source | Decision | FuryPipe use |
| --- | --- | --- |
| Context7 | ADOPT / WRAP | current library/API docs for coding agents; MCP + skill |
| Microsoft Playwright CLI | ADOPT / WRAP | Web Studio browser QA adapter, screenshots, flows |
| GitHub MCP Server | ADOPT / WRAP | repo/PR/CI/security evidence connector |
| Supabase AI Tools Plugin | WRAP | optional database/Auth/Edge Functions plugin bundle |
| Codebase Memory MCP | WRAP | persistent code graph / impact / trace backend |
| OmniRoute | WRAP | provider gateway, OpenAI-compatible route, MCP/A2A, scoped routing |
| Firecrawl MCP | WRAP | web search/scrape/deep-research connector |
| Addy Osmani agent-skills | ADAPT | selected engineering workflows: spec/TDD/review/API/frontend |
| Ponytail | ADAPT | YAGNI/minimalism review mode |
| UI Skills + HorizonX UI Specification | ADAPT | Web Studio design constraints and frontend acceptance gates |

## Tier B — valuable optional integrations

| Source | Decision | FuryPipe use |
| --- | --- | --- |
| Graft | WRAP | context graph/cache; optional alternative to Codebase Memory |
| Agency Agents | ADAPT | selected specialist agent profiles only |
| OneWave AI claude-skills | ADAPT / REFERENCE_ONLY | selected orchestration/research skills; never bulk agent-army |
| Zoetrope | ADAPT / REFERENCE_ONLY | read-only agent-run graph/observability pattern |
| Sentry MCP | WRAP | production error/trace inspection |
| Cloudflare MCP / Code Mode | WRAP | Cloudflare deploy/observability/API control |
| Notion MCP + skills | WRAP | specs, tasks, release docs, knowledge capture |
| ScrapeGraphAI | WRAP / REFERENCE_ONLY | structured scraping when Firecrawl is insufficient |
| OpenMontage | REFERENCE_ONLY / optional extension | video-production skill architecture |
| VoltAgent | REFERENCE_ONLY | agent framework/observability/eval patterns |
| Claude Squad | REFERENCE_ONLY | worktree-isolated parallel-agent UX/architecture |

## Tier C — sandbox/reference only

| Source | Decision | Reason |
| --- | --- | --- |
| Strix Claude Code | REFERENCE_ONLY | offensive-security surface; Docker/Kali/MCP must never be enabled by default |
| Tons of Skills Marketplace | REFERENCE_ONLY | excellent discovery corpus, but bulk install is incompatible with FuryPipe trust policy |
| Large generic skill marketplaces | REFERENCE_ONLY | every skill must be individually pinned/licensed/reviewed |

---

# 1. Skills and instruction systems

## 1.1 Addy Osmani — agent-skills

Repository:
https://github.com/addyosmani/agent-skills

Pinned research commit:
`be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39`

Decision: **ADAPT**

Why it matters:

- production-oriented engineering workflows rather than persona prompts;
- native support for Claude Code and Codex;
- step-by-step process, verification and exit criteria;
- explicit focus on minimal, verifiable skills;
- useful candidates include spec-driven development, test-driven development,
  code review/quality, API/interface design and frontend engineering.

FuryPipe integration:

- do not clone all skills into the package;
- import selected skill metadata through `AgentSkillRegistry`;
- pin each adopted skill to an exact commit;
- translate tool permissions into FuryPipe read/scoped-write/network policies;
- store a local FuryPipe-native adaptation rather than relying on mutable
  marketplace state at runtime.

Priority: **very high**.

## 1.2 Ponytail

Repository:
https://github.com/DietrichGebert/ponytail

Pinned research commit:
`356918eba965ee1eac64bd3a7f0dd02108350de5`

License observed: MIT.

Decision: **ADAPT**

Best idea to bring into FuryPipe:

`need it? -> stdlib -> native platform -> installed dependency -> smallest code`

This is useful as a review/planning skill, not as a global rule that may override
security, accessibility or correctness.

Proposed FuryPipe skills:

- `minimal-solution-review`
- `dependency-yagni`
- `complexity-budget-review`

Do not copy benchmark claims into FuryPipe release claims.

Priority: **high**.

## 1.3 Agency Agents

Repository:
https://github.com/msitarzewski/agency-agents

Pinned research commit:
`6d29a9b08785a0e49ffc9818bbdd381164c2df5f`

License observed: MIT.

Decision: **ADAPT selected roles**

Useful concepts:

- specialist agent profiles;
- deliverable-first definitions;
- conversions for Claude Code, Codex, OpenCode, Gemini, Cursor and others;
- clear distinction between roles.

Recommended FuryPipe profiles:

- architecture reviewer;
- frontend specialist;
- security reviewer;
- test/QA specialist;
- reality-check/release reviewer;
- documentation specialist.

Do not import hundreds of personas. FuryPipe should own a small tested role set
and treat the upstream repository as a source of patterns.

Priority: **high**.

## 1.4 OneWave AI claude-skills

Repository:
https://github.com/OneWave-AI/claude-skills

Pinned research commit:
`82859c0ebaff803889be6ca2efa0834ba8787773`

License observed: MIT.

Decision: **ADAPT selected skills / REFERENCE_ONLY for large swarms**

Useful:

- sub-agent orchestration;
- A2A/handoff patterns;
- scout / skill navigation;
- multi-agent decomposition.

FuryPipe rule:

- never copy the “50+ agents” execution posture directly;
- FuryPipe's bounded runtime remains the authority;
- current FuryPipe hard cap on simultaneous subagents must remain enforced;
- use wave/audit/propagate as a planning pattern only.

Priority: **medium-high**.

## 1.5 Tons of Skills Marketplace

Repository:
https://github.com/jeremylongshore/tons-of-skills-marketplace

Pinned research commit:
`a58233ed4b9a9fda3ff0d37a304a570f4cc98083`

Decision: **REFERENCE_ONLY discovery source**

Strengths:

- very large searchable corpus;
- explicit SKILL.md metadata conventions;
- provenance/lockfile concepts;
- per-plugin licensing;
- certification/governance ideas.

FuryPipe should borrow:

- progressive disclosure;
- required frontmatter;
- allowed/disallowed tools;
- compatibility field;
- source locks;
- audit trail.

FuryPipe must not bulk install the marketplace.

Priority: **high as research, low as runtime dependency**.

## 1.6 UI Skills

Website:
https://www.ui-skills.com

Decision: **ADAPT**

Use it as a Web Studio/frontend instruction source, especially around reusable
procedural UI knowledge across Claude Code, Cursor, Codex, Copilot, Windsurf
and Gemini.

FuryPipe should convert useful guidance into its own versioned
`web-studio` skill modules rather than depending on mutable web content at
runtime.

Priority: **high for Web Studio**.

## 1.7 HorizonX Vibe Coding UI Specification

Specification:
https://horizonx.so/resources/vibe-coding-ui-specification

Decision: **ADAPT**

The strongest idea is to replace vague aesthetic prompts with explicit,
testable constraints:

- design tokens;
- component variants and states;
- responsive rules;
- accessibility;
- motion;
- acceptance criteria.

This maps directly onto FuryPipe M14 Web Studio.

Recommended FuryPipe change:

`WebStudioSpecification` should eventually expose typed fields for tokens,
component states, responsive constraints, accessibility and acceptance gates.

Priority: **very high for Web Studio**.

---

# 2. MCP and live external context

## 2.1 Official MCP Registry

Registry:
https://registry.modelcontextprotocol.io/

Decision: **ADOPT for discovery metadata, never auto-trust**

FuryPipe should use the official Registry as a discovery source for:

- server identity;
- versions;
- packages;
- transports;
- repository provenance.

A registry listing is not execution authorization.

Recommended architecture:

`McpRegistryDiscovery -> provenance scan -> permission policy -> health probe -> operator approval -> runtime registration`.

Priority: **very high**.

## 2.2 Context7

Repository:
https://github.com/upstash/context7

Pinned research commit:
`6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e`

Remote MCP:
`https://mcp.context7.com/mcp`

License observed for MCP package: MIT.

Decision: **ADOPT / WRAP**

Why:

- current version-specific library docs;
- tiny tool surface;
- MCP, CLI and skill modes;
- OAuth/API-key support;
- explicit instruction pattern: use for library/framework/API/version questions.

Proposed FuryPipe integration:

- optional `context7` MCP profile;
- `docs-current` skill that auto-routes library/API questions;
- isolated `docs-researcher` subagent mode to keep main context small;
- no API key stored in FuryPipe manifests.

Priority: **top 3**.

## 2.3 GitHub MCP Server

Repository:
https://github.com/github/github-mcp-server

Decision: **ADOPT / WRAP**

Best uses for FuryPipe:

- repository search;
- issues/PRs;
- Actions/CI;
- code security;
- Dependabot;
- release evidence.

Security posture:

- prefer toolset allowlists;
- read-only by default;
- narrow write scopes;
- keep tokens in host environment/OAuth;
- never persist PATs in Recovery or Control Room.

This complements FuryPipe's current GitHub evidence workflows.

Priority: **top 5**.

## 2.4 Supabase AI Tools Plugin

Docs:
https://supabase.com/docs/guides/ai-tools
https://supabase.com/docs/guides/ai-tools/plugins

Decision: **WRAP as optional product plugin**

Supabase's current model is especially relevant to FuryPipe because it combines:

- MCP live project access;
- Agent Skills procedural knowledge;
- plugin packaging;
- fallback copy/paste prompts.

Recommended FuryPipe support:

`PluginBundle = MCP profile + Skill pack + permission manifest + project scope`.

Supabase must be project-scoped and read-only by default. Migrations, writes,
Edge Function deployment and admin actions require explicit scoped-write
approval.

Priority: **very high for app creation**.

## 2.5 Codebase Memory MCP

Repository:
https://github.com/DeusData/codebase-memory-mcp

Pinned research commit:
`b790be3d15d44f0d4629a2c97ddf76c104d80d22`

License observed: MIT.

Decision: **WRAP**

Strong fit for FuryPipe:

- persistent structural code graph;
- tree-sitter + LSP semantics;
- call paths;
- impact analysis;
- architecture queries;
- multi-language coverage;
- MCP transport;
- no LLM embedded in the server.

Recommended role:

`CodeIntelligenceBackend`.

FuryPipe should consume it as an optional MCP/backend and preserve its own
Recovery/Knowledge contracts. Do not make FuryPipe storage depend on its SQLite
database format.

Priority: **top 5**.

## 2.6 Graft

Repository:
https://github.com/trailhq/Graft

Pinned research commit:
`f9e65396e638e517aecae0d731017f53084d70ed`

License observed: MIT.

Decision: **WRAP**

Useful differences from Codebase Memory:

- context graph represented as regenerable files;
- deep Claude Code hooks/instructions;
- context injection before prompts;
- monorepo/multi-repo orientation.

Recommendation:

- support Graft as an alternative `ContextGraphBackend`;
- do not enable both Graft and Codebase Memory automatically;
- let project policy select one primary code-context backend.

Priority: **high**.

## 2.7 Firecrawl MCP

Repository:
https://github.com/firecrawl/firecrawl-mcp-server

Pinned research commit:
`4db752ee00910e17ec73f28b40796f0830fe86da`

License observed: MIT.

Decision: **WRAP**

Useful tools:

- web search;
- scrape;
- mapping URLs;
- structured extraction;
- browser interaction;
- deep research.

Recommended FuryPipe role:

`ResearchWebBackend`.

Security:

- fetched content is untrusted data;
- prompt-injection boundary required;
- credentials remain host-owned;
- browsing actions must remain capability scoped.

Priority: **high**.

## 2.8 ScrapeGraphAI

Repository:
https://github.com/ScrapeGraphAI/Scrapegraph-ai

Pinned research commit:
`c75c8084fae2d4f5ba01a8c218bc1168b67e3569`

Decision: **WRAP / REFERENCE_ONLY**

Use when FuryPipe needs LLM-oriented structured extraction pipelines that are
more specialized than Firecrawl.

Default preference:

1. Firecrawl MCP for generic search/scrape;
2. ScrapeGraphAI optional for extraction graphs.

Do not make both mandatory dependencies.

Priority: **medium**.

## 2.9 Cloudflare MCP / Code Mode

Repositories:
https://github.com/cloudflare/mcp
https://github.com/cloudflare/mcp-server-cloudflare

Decision: **WRAP**

Strong 2026 pattern:

- large API surface compressed into a tiny code-mode tool surface;
- OAuth-first;
- product-specific MCP servers also available.

FuryPipe should study the token-efficient `search + execute` design for huge
tool catalogs.

Optional connector use:

- Workers;
- Pages;
- R2/KV/D1;
- AI Gateway;
- deployment/observability.

Priority: **high architectural reference; medium optional connector**.

## 2.10 Sentry MCP

Repository:
https://github.com/getsentry/sentry-mcp

Decision: **WRAP**

Use for:

- issue inspection;
- traces;
- errors;
- production debugging.

Recommended FuryPipe skill:

`production-incident-investigation`.

Write/remediation actions must stay separate from read-only diagnosis.

Priority: **high for production engineering**.

## 2.11 Notion MCP + official skills

Hosted MCP:
https://mcp.notion.com/mcp

Repositories:
https://github.com/makenotion/notion-mcp-server
https://github.com/makenotion/claude-code-notion-plugin

Decision: **WRAP**

Strong fit for:

- spec-to-implementation;
- task planning;
- knowledge capture;
- research docs;
- release notes.

Security warning:

Notion content is untrusted external text. A read/write MCP combination can
amplify prompt injection. FuryPipe should use read-only by default and require a
separate explicit approval boundary for mutation.

Priority: **medium-high**.

---

# 3. Browser and app-building tooling

## 3.1 Microsoft Playwright CLI

Repository:
https://github.com/microsoft/playwright-cli

Pinned research commit:
`655530f6d0dc71a0d6bf46ae165877d3c7311099`

Package:
`@playwright/cli`

License observed: Apache-2.0.

Decision: **ADOPT / WRAP**

This should become FuryPipe's preferred Web Studio browser adapter.

Reasons:

- maintained by Microsoft/Playwright;
- agent-friendly CLI;
- snapshots and screenshots;
- skills installer;
- lower-context path than a giant browser MCP schema;
- explicit support for coding-agent workflows.

Recommended M14 implementation:

`PlaywrightCliStudioQaAdapter` implementing FuryPipe's existing
`StudioBrowserQaAdapter`.

Keep the current FuryPipe rule that local structural QA is not equivalent to
full production WCAG/Web-Vitals/deployment proof.

Priority: **top 3**.

## 3.2 Strix Claude Code

Repository:
https://github.com/tghastings/strix-claude-code

Pinned research commit:
`55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2`

Decision: **REFERENCE_ONLY / optional sandbox security profile**

Useful patterns:

- isolated Docker/Kali environment;
- MCP security tools;
- explicit report generation;
- security-focused system instructions.

Do not enable by default. Pen-testing tools are powerful and require explicit
authorization, target allowlists and isolation.

FuryPipe should reuse the **sandbox boundary pattern**, not silently import an
offensive toolchain.

Priority: **medium as security architecture reference**.

---

# 4. Multi-agent orchestration and observability

## 4.1 Claude Squad

Repository:
https://github.com/smtg-ai/claude-squad

Pinned research commit:
`ce1ffb4392b01f38e2c4599c7c84d2a93973b138`

Decision: **REFERENCE_ONLY**

Best idea for FuryPipe:

- isolated git workspaces/worktrees per agent task;
- parallel execution without file conflicts;
- review changes before application.

FuryPipe should bring the isolation pattern into its multi-agent scheduler
rather than embedding Claude Squad.

Priority: **high architectural reference**.

## 4.2 Zoetrope

Repository:
https://github.com/furkankly/zoetrope

Pinned research commit:
`b1f31dd26bd4e9e513885e39edb78d0850a5d1fe`

License observed: MIT.

Decision: **ADAPT / REFERENCE_ONLY**

Useful:

- read-only live session graph;
- subagent/tool timeline;
- replay;
- local-only observation.

Important caveat:

Claude Code's transcript JSONL is undocumented. FuryPipe should not make a core
contract depend on that format.

Recommended implementation:

- native FuryPipe event graph in Control Room;
- optional Zoetrope transcript importer with graceful degradation.

Priority: **medium-high**.

## 4.3 VoltAgent

Repository:
https://github.com/VoltAgent/voltagent

Pinned research commit:
`44b4c8e4998ce56095b2f0e4eaf1a988f5e6d0de`

License observed: MIT.

Decision: **REFERENCE_ONLY**

VoltAgent covers memory, RAG, guardrails, tools, MCP, workflows, observability
and deployment. That overlaps heavily with FuryPipe's own core.

Use it to compare:

- workflow abstractions;
- observability;
- guardrails;
- evaluation;
- provider interfaces.

Do not add VoltAgent as a core dependency unless FuryPipe intentionally abandons
its own runtime layer.

Priority: **medium architectural reference**.

## 4.4 Horizon-style long-horizon harness concepts

Public research around long-horizon execution in 2026 consistently emphasizes:

- persistent goal state;
- bounded sessions;
- validators between sessions;
- retry/fork;
- spin detection;
- resource budgets;
- durable handoffs;
- operator/HITL gates.

FuryPipe already has pieces of this in Agent Runtime, Recovery, Control Room and
Release Readiness. The next improvement should be a durable **Goal Graph +
anti-cycle detector**, not more persona prompts.

Decision: **ADAPT concepts**.

Priority: **very high**.

---

# 5. Provider routing

## 5.1 OmniRoute

Repository:
https://github.com/diegosouzapw/OmniRoute

Pinned research commit:
`152d95108c9c3d557562311ffed63240a511eb31`

Docs:
https://www.omniroute.online/fr/
https://github.com/diegosouzapw/OmniRoute/wiki

Decision: **WRAP**

OmniRoute exposes several useful integration surfaces:

- OpenAI-compatible `/v1/*`;
- model/provider routing;
- MCP;
- A2A;
- webhooks;
- remote CLI;
- scoped access tokens;
- provider combos/fallback strategies.

Recommended FuryPipe architecture:

`OmniRouteProviderAdapter` should be optional and must use the existing
Provider Runtime/Provider Fabric rather than bypass it.

First supported path:

1. explicit base URL (default loopback only);
2. health/readiness probe;
3. exact model list discovery;
4. OpenAI-compatible request adapter;
5. no credentials persisted by FuryPipe;
6. scoped host token;
7. map OmniRoute health/model evidence into `ProviderRuntimeState`;
8. preserve FuryPipe `COST_UNKNOWN` unless explicit trustworthy prices exist;
9. keep FuryPipe's fallback planner authoritative unless operator selects
   OmniRoute-managed routing mode.

Never enable process-spawning/admin routes through a generic provider token.

Priority: **top 5**.

---

# 6. Media / creative extensions

## 6.1 OpenMontage

Repository:
https://github.com/calesthio/OpenMontage

Pinned research commit:
`08e2151fa02de28a5d6a312b3d575692bf147ad7`

License observed: GNU AGPLv3.

Decision: **REFERENCE_ONLY / optional separate extension**

Strong ideas:

- production pipelines;
- style playbooks;
- Remotion/video skills;
- contract tests;
- structured creative stages.

Because of AGPLv3 and the project's large media/tool surface, do not copy or
vendor OpenMontage code into FuryPipe core.

Possible future:

`furypipe-media-openmontage` as a separately reviewed external adapter/process.

Priority: **low for core, high for future media mode**.

---

# 6.5 Canonical Agent Skills open standard

Specification:
https://agentskills.io/
https://github.com/agentskills/agentskills

Decision: **ADOPT the format contract**

The Agent Skills standard is now vendor-neutral and supported across a broad
agent ecosystem. FuryPipe should align its portable on-disk skill packaging
with the standard directory shape:

- `SKILL.md` required;
- optional `scripts/`;
- optional `references/`;
- optional `assets/`.

FuryPipe-specific provenance, permission, health and priority data should be an
extension layer around that portable package, not an incompatible replacement.

This gives FuryPipe a clear split:

- **portable skill package** = Agent Skills-compatible folder;
- **execution trust** = FuryPipe `AgentSkillRegistry` metadata/policy.

Priority: **foundational**.

# 6.6 2026 harness/instruction practices

Anthropic's current engineering guidance reinforces several patterns FuryPipe
should encode as defaults:

- use subagents for genuinely parallel/independent tracks or isolated context;
- do not spawn subagents for trivial single-file/sequential work;
- persistent state and milestone validators matter more than repeatedly making
  prompts larger;
- long-running app development needs bounded sessions, verification and
  recovery;
- project instructions, hooks, skills and MCP should be layered rather than
  collapsed into one giant system prompt.

FuryPipe should therefore add a native subagent damping policy:

`direct work -> subagent only when parallelism/isolation pays for itself`.

This matches the existing bounded multi-subagent runtime and prevents a
marketplace skill from exploding one task into dozens of agents.

# 6.7 Plugin bundle architecture

Current 2026 ecosystems increasingly package workflow capabilities as a bundle
of reusable instructions plus connected tools. Supabase does this directly
with MCP + skills, and modern Codex/ChatGPT plugin architecture similarly
separates reusable skills from connected external apps.

Recommended FuryPipe abstraction:

```text
FuryPluginBundle
  manifest
  skills[]
  mcpProfiles[]
  providerProfiles[]
  appConnectors[]
  requiredPermissions[]
  secretsContract
  healthChecks[]
  uninstallPlan
```

A plugin bundle is configuration/provenance; it is never permission escalation.
Every included connector must pass the same runtime policy it would pass if
installed independently.

# 7. Recommended FuryPipe-native instruction standard

The best 2026 skill systems converge on the same pattern. FuryPipe should make
this its canonical instruction contract.

## Required metadata

Every FuryPipe skill should define:

- stable `id`;
- human name;
- precise description/trigger;
- semantic version;
- category;
- source/provenance;
- license status;
- allowed stages;
- permission: read / scoped-write;
- network: disabled / explicit;
- health policy;
- priority;
- compatibility;
- input/output evidence expectations.

## Body structure

1. **Use when**
2. **Do not use when**
3. **Inputs required**
4. **Procedure**
5. **Security/trust boundaries**
6. **Verification**
7. **Exit criteria**
8. **Failure/rollback**
9. **Evidence returned**
10. **Known limitations**

## Runtime rules

- skills are procedural workflows, not vague personas;
- progressive disclosure: only selected skill instructions enter context;
- external instructions are untrusted until provenance/permission review;
- code, commands, URLs, hashes, IDs and configs remain ExactGuard-protected;
- no skill can bypass Agent Runtime permissions;
- no skill can silently enable network;
- no skill can silently add dependencies;
- every destructive/write action must be stage-scoped;
- failed verification means the skill did not complete.

---

# 8. Recommended MCP bundle for FuryPipe app development

Default development profile should remain opt-in and least privilege.

## Core recommended

1. **Context7** — current docs.
2. **GitHub MCP** — repository/PR/CI.
3. **Codebase Memory MCP OR Graft** — code context backend.
4. **Playwright CLI adapter** — browser QA.
5. **Supabase MCP/plugin** — only when project declares Supabase.
6. **Sentry MCP** — only for configured production projects.
7. **Cloudflare MCP** — only when project deploys on Cloudflare.
8. **Firecrawl MCP** — only for web research/scrape tasks.
9. **Notion MCP** — only when project workflow uses Notion.

The default profile should never automatically connect every server.

---

# 9. What FuryPipe should not do

- Do not clone 3,000 skills into the repository.
- Do not auto-execute a skill because a marketplace labels it popular.
- Do not make third-party MCP servers trusted merely because they appear in the
  official registry.
- Do not persist third-party API keys in Recovery, Knowledge, Control Room or
  generated documentation.
- Do not expose all MCP tools by default; use tool/permission allowlists.
- Do not run offensive-security tools against arbitrary targets.
- Do not mix multiple code-graph backends automatically.
- Do not let OmniRoute or another gateway silently override FuryPipe provider
  evidence/cost policy.
- Do not use mutable `latest` as provenance for executable plugins.
- Do not make unverified benchmark claims from upstream README marketing.

---

# 10. Implementation order

## Wave 1 — immediate

1. Context7 MCP/skill adapter.
2. Playwright CLI Web Studio adapter.
3. OmniRoute Provider Adapter.
4. GitHub MCP profile/evidence adapter.
5. Codebase Memory MCP adapter.
6. selected Addy/Ponytail skill manifests.

## Wave 2

7. Supabase plugin bundle contract.
8. Firecrawl research adapter.
9. Sentry connector.
10. Cloudflare Code Mode connector.
11. selected Agency roles.
12. worktree-isolated multi-agent execution inspired by Claude Squad.

## Wave 3

13. Graft alternative context backend.
14. Notion spec/task plugin.
15. native Control Room flow graph inspired by Zoetrope.
16. UI Skills / HorizonX typed UI specification.
17. optional ScrapeGraph extraction adapter.
18. optional media extension informed by OpenMontage.

---

# 11. Source posture

This research document records useful public sources and integration decisions.
It does not grant execution permission.

The authoritative execution gate remains FuryPipe's `AgentSkillRegistry`,
MCP policy, Provider Runtime, Agent Runtime and operator configuration.

Before any external skill/plugin is made executable, add or update its pinned
entry in `SOURCE_LEDGER.md` and `SKILL_LICENSE_MATRIX.md`.
