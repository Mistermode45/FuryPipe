# FuryPipe Skill Ecosystem 2026

## Purpose

This document records the September 2026 ecosystem review used to expand FuryPipe's external-reference catalogue and native instruction profiles.

The goal is **not** to maximize the number of installed skills. FuryPipe treats external skills as potentially useful procedural knowledge, not as trusted executable packages.

The governing distinction remains:

```text
discovered != reviewed != license-cleared != approved != installed != executable != executed != verified
```

A popular registry entry, GitHub star count, social ranking, signed registry record, or editor recommendation is discovery evidence only.

## Research inputs

The review included:

- requested repositories:
  - https://github.com/api-evangelist/api-layer
  - https://github.com/benjaminasterA/antigravity-awesome-skills
- agent-skill registry:
  - https://skills.re/
- 2026 ecosystem/editorial surveys:
  - https://www.camilleroux.com/top-skills-plugins-claude-code-2026-v3/
  - https://www.maketime.fr/articles/meilleurs-skills-claude-2026
  - https://www.limpida.com/blog/catalogue-skills-claude-entreprise
  - https://www.apsodia.com/blog/top-10-des-meilleurs-skills-claude
- pinned GitHub sources from official vendors and selected community projects.

Editorial lists are treated as **discovery signals**, not technical or benchmark authority.

## Selection hierarchy

FuryPipe evaluates candidates in this order:

1. official/open-standard source with immutable version and clear licence;
2. official vendor skill repository with clear licence;
3. focused community source with clear scope, maintenance and licence;
4. curated registry/aggregator used only to discover upstream artifacts;
5. editorial/social popularity used only to identify candidates worth auditing.

The lower levels never inherit trust from the higher levels.

## Intake dimensions

Every candidate is reviewed across:

- provenance — exact source, immutable commit/version, upstream/original source;
- licence — verified root/artifact terms rather than README assumptions;
- safety — read-only vs write/network/offensive behavior;
- authority — whether the artifact can grant tools, MCP, network or account actions;
- maintenance — activity and archived status;
- portability — Agent Skills compatibility and model/provider coupling;
- overlap — whether FuryPipe already owns a native equivalent;
- context cost — whether adding the skill would increase prompt/context load;
- product value — benefit to developers, creators, marketers, entrepreneurs or operators;
- evidence quality — whether claimed performance/token/cost gains are independently verified.

## Registry policy

### skills.re

skills.re is useful for discovery, version history and ecosystem search. FuryPipe does not treat a registry result as an executable dependency.

A skills.re record must still resolve to an upstream source and pass:

```text
source provenance
-> licence review
-> static skill review
-> risk/permission classification
-> overlap analysis
-> FuryTrust approval
-> explicit host registration
```

No `skills-re install` command is run automatically.

### Antigravity Awesome Skills

The reviewed repository provides useful patterns:

- explicit risk classification;
- trigger requirements;
- examples and limitations;
- role-oriented bundles;
- offensive-skill authorization guardrails;
- source attribution.

However, its own attribution ledger demonstrates that individual skills have mixed upstream licences and terms. FuryPipe therefore catalogs the repository as `REFERENCE_ONLY` and does **not** apply its root MIT licence to third-party artifacts.

### VoltAgent Awesome Agent Skills

Likewise treated as a discovery catalogue. The aggregator repository licence does not replace individual upstream licences.

## Requested API Layer repository

`api-evangelist/api-layer` is archived and describes itself as an independent third-party public profile of APILayer, not APILayer itself.

FuryPipe records it as:

- `REFERENCE_ONLY`;
- `api-discovery`;
- licence `UNKNOWN`;
- not an official API status/security/certification source.

Its ratings must never be promoted into provider trust or health evidence.

## Official skill sources

The review added pinned references for:

| Source | Pin | Licence | FuryPipe decision |
|---|---|---|---|
| Microsoft Skills | `903dc62b1e4c833235b54db918a9a51cb6d3cc8f` | MIT verified | adapter candidate, per-skill review |
| Google Gemini Skills | `80dd31dda25bbe1410207df0adb3e0d591c2c634` | Apache-2.0 verified | adapter candidate, per-skill review |
| Supabase Agent Skills | `8331f910845103c08d51f6ca1d86ebb7d1f745e3` | MIT verified | adapter candidate, per-skill review |
| OpenAI Skills | `49f948faa9258a0c61caceaf225e179651397431` | root licence unresolved by this audit | reference only |
| Remotion Skills | `bd566b65d521b40fe92e1f26766e82de9e291693` | root licence unresolved by this audit | reference only |

"Official" identifies upstream ownership. It does not bypass FuryTrust or host authorization.

## Engineering recommendations

### Default engineering

Use native:

- `karpathy-coding-discipline`;
- `spec-driven-development` for non-trivial features.

### Bugs and failures

Use native:

- `karpathy-coding-discipline`;
- `systematic-debugging`.

The debugging profile was adapted from the MIT-licensed `obra/superpowers` systematic-debugging skill. It enforces reproduce/evidence/root-cause/hypothesis/regression-proof behavior without importing upstream runtime or verbatim instructions.

### Codebase audit / production hardening

Use native:

- `codebase-audit-discipline`;
- plus spec/debug/minimal-change profiles where implementation follows the audit.

The audit discipline was adapted from `ksimback/tech-debt-skill`: orient before judging, cite repository evidence, review false positives, avoid rewrite recommendations.

## Context and token efficiency

FuryPipe already owns Context Optimizer, Context Fabric, cache ordering and benchmark-qualified optimizer profiles.

External candidates remain comparison references:

- Caveman: mixed MIT/BSL-1.1 repository; reference only;
- Context Mode: Elastic-2.0; reference only;
- Code Review Graph: MIT; adapter candidate for graph/context experiments.

Any external claim such as "63%", "65%", "6.8x" or "49x" token reduction remains **unverified** until FuryPipe's Benchmark Contract measures a defined workload, baseline, repetitions, quality outcome and exact version.

The correct optimization target is:

```text
less context / fewer tokens
WITHOUT quality, exactness, safety or task-completion regression
```

## UI / creator recommendations

FuryPipe adds native `ui-design-discipline`, adapted from the MIT Hallmark source.

Key native rules:

- preserve existing design-system contracts;
- decide page/component scope before broad redesign;
- never fabricate metrics/testimonials/logos;
- learn structural principles from references instead of pixel-cloning;
- treat responsiveness, keyboard focus, contrast and interaction states as acceptance criteria.

Additional catalog candidates:

- UI UX Pro Max — MIT adapter candidate;
- Hallmark — MIT adapter candidate;
- official/curated frontend skills — reviewed individually before use.

## Marketing / entrepreneur recommendations

FuryPipe adds native `product-marketing-context-discipline`, adapted from the MIT MarketingSkills product-marketing source.

It separates:

- product facts;
- audience/JTBD;
- pains and alternatives;
- differentiation;
- customer language;
- brand voice;
- proof points;
- conversion goals;
- assumptions and unknowns.

This follows an enterprise lesson visible across the 2026 research: reusable organization/product context should be separated from task-specific tactics, rather than duplicated across every skill.

Account-changing campaign operations remain outside an instruction profile and require an explicit connector/tool authority path.

## Security skills

Security/offensive catalogs are never bulk imported.

Defensive audit skills should default read-only. Offensive/pentest skills require explicit authorized scope, target confirmation, sandboxing and the existing FuryPipe safety/policy boundaries.

A disclaimer inside a third-party skill is not sufficient authority.

## Recommended activation model

FuryPipe should prefer a **small task-specific active set** rather than loading a broad marketplace.

Practical architecture:

```text
large discovery catalogue
-> metadata-only search
-> trust/licence filtering
-> task relevance
-> small selected profile/skill set
-> Context Optimizer
-> explicit execution authority if executable
```

This avoids the failure mode where hundreds of skill descriptions consume context and compete for activation.

## Workload recommendations

`recommendInstructionProfiles()` now provides deterministic native recommendations:

- general engineering -> minimal-change discipline;
- feature development -> minimal-change + spec-driven;
- bugfix -> minimal-change + systematic debugging;
- codebase audit -> evidence-first audit;
- production hardening -> combined engineering/audit/debug contract;
- UI development -> minimal-change + spec + UI discipline;
- marketing -> product marketing context;
- research -> no extra profile by default.

This mapping is explicit API input. FuryPipe does not infer it from secret heuristics or silently activate an external skill.

## What this review does not prove

This review does not prove:

- any external token/cost/performance claim;
- security of every file in a catalog;
- that a repository will remain safe after its pinned commit;
- that a registry signature is equivalent to FuryPipe approval;
- that an adapter candidate is installed or connected;
- that any external skill has been executed;
- that any third-party service is reachable.

Those states remain separate and evidence-driven.
