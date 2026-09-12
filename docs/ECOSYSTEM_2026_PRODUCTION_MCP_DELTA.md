# FuryPipe 2026 — Production MCP delta: observability, security, infrastructure and data

Date: 2026-09-12

## Scope

This research track extends the existing 2026 ecosystem audit with production-facing MCP surfaces that were not yet represented in the current FuryPipe source ledger.

This document is intentionally **research/provenance only**.

It does **not**:
- vendor third-party source;
- install packages or CLIs;
- connect credentials;
- execute remote tools;
- enable network access;
- change FuryPipe runtime permissions;
- change the default branch or release state.

The runtime policy remains fail-closed. A source being listed here never makes it executable.

## Decision model

- **ADOPT**: use the standard/interface directly when it matches FuryPipe's trust model.
- **ADAPT**: port a bounded design principle into native FuryPipe code without copying the implementation.
- **WRAP**: expose the external service/server only through an explicit FuryPipe adapter and permission boundary.
- **REFERENCE_ONLY**: useful architecture/source evidence, but not a runtime dependency.
- **REJECT**: do not integrate the current artifact.

## New candidates

| Source | Immutable source pin / evidence | Licence | Activity / state | FuryPipe decision | Default permission posture |
|---|---|---|---|---|---|
| HashiCorp Terraform MCP Server | `hashicorp/terraform-mcp-server@140e3c81fc9c0fc3b4eecd637a54d637a56f9f2e` | MPL-2.0 | Active 2026; Terraform MCP 1.0 GA announced 2026-06-11 | **WRAP** | `infra-read` only; apply/create/update/delete require explicit `infra-write` |
| Grafana MCP | `grafana/mcp-grafana@ffd90536d160ff4f3eb4a4fa79217455b8f22f0c` | Apache-2.0 | Active; v1.4.1 release commit observed 2026-09-11 | **WRAP** | `observability-read` default; dashboard/alert/annotation mutation separated |
| Grafana Docs MCP | `grafana/mcp-doc-server@2333a8e90063956649949fe08c7566ecb62066ec` | Apache-2.0 | Active 2026 | **ADOPT / WRAP** | read-only documentation retrieval only |
| Datadog MCP Server | `datadog-labs/mcp-server@83f1dc96150c74dfc783e8d855bf7515e225637c` | MIT | Active 2026; managed MCP endpoint | **WRAP** | `observability-read` default; incident/notification writes separate |
| Sentry MCP | `getsentry/sentry-mcp@858d9727916879d86db62f13977bb9063ae111aa` | FSL-1.1-Apache-2.0 future licence | Highly active 2026 | **WRAP + ADAPT auth model** | hosted remote preferred; `inspect`/read default; write skills explicit |
| SonarQube MCP Server | `SonarSource/sonarqube-mcp-server@d73e8b52b0ad54dd94c2360bff5956ba1380814d` | SONAR Source-Available License v1.0 | Active 2026 | **WRAP / REFERENCE_ONLY source** | code-quality/security read/scan only; no vendoring into FuryPipe |
| Snyk Studio MCP | `snyk/studio-mcp@f9756fa80e8a6426cb2efd66ffa49b7652173ee8` | Apache-2.0 | Active 2026 | **WRAP** | local security scanning only; auth/trust remains host-controlled |
| Semgrep MCP | `semgrep/mcp@cade782501e611373844696edc2ceef31eb7e1f7` | MIT | Repository archived; last observed commit 2025-10-28 | **REJECT current MCP / REFERENCE_ONLY patterns** | do not register as a current MCP runtime source |
| MongoDB MCP Server | `mongodb-js/mongodb-mcp-server@d1ff5d0e3a10e57ed12a08955d7f8ab69deef4ac` | Apache-2.0 | Active 2026; 2.0.0 released 2026-08-04 | **WRAP + ADAPT security patterns** | `database-read` default; CRUD/admin/Atlas mutation explicit |
| Neon MCP Server | `neondatabase/mcp-server-neon@857028feebcb4cae94dfe4fa67a23b5b066c2989` | MIT | Active 2026; official remote MCP v1 surface | **ADOPT / WRAP** | server-supported read-only mode by default; write scopes explicit |
| PostHog MCP | `PostHog/posthog@6fafbb9081bd15e79448af5650e02a4f9ea435cc`, current implementation under `services/mcp` | mixed repository terms; MCP path falls under repository terms, verify per-path before reuse | Active 2026; old standalone `PostHog/mcp` archived and implementation moved to monorepo | **WRAP** | analytics/error/session read default; feature flags/CDP/experiments writes explicit |

## Security and permission conclusions

### 1. Read and write must be separate capability classes

FuryPipe should not expose these services through broad generic `network` or `write` permissions.

Recommended new permission classes for future runtime work:

- `observability-read`
- `observability-write`
- `security-scan`
- `infra-read`
- `infra-write`
- `database-read`
- `database-write`
- `database-admin`
- `analytics-read`
- `analytics-write`

No new class should imply deployment, deletion, payment, cluster administration or production mutation.

### 2. Tool-level allowlisting is required

External MCP registration should be deny-by-default.

A connector profile must be able to:
- permit named read-only tools;
- reject unknown tools after a server update;
- bind the approved tool list to source/service provenance;
- fail closed when the remote tool list expands unexpectedly;
- separate discovery from invocation.

This is especially important for Terraform, Grafana, MongoDB, Neon and PostHog because their servers expose both inspection and mutation surfaces.

### 3. Hosted service != trusted write authority

Official/vendor-managed services still require FuryPipe policy gates.

Required controls:
- OAuth/API key owned by host, never FuryPipe-generated implicitly;
- credentials never persisted in receipts;
- HTTPS remote endpoints;
- no ambient bearer forwarding;
- tenant/project/org binding where available;
- explicit write escalation;
- source/service identity visible in Control Room;
- remote health does not imply permission.

### 4. Licence handling

- MPL-2.0 (Terraform) is compatible with external wrapping, but vendoring/modification would create file-level obligations.
- Apache-2.0/MIT sources remain candidates for bounded adapters but are not automatically trusted.
- Sentry's FSL source should remain external/reference for FuryPipe; no source vendoring is needed.
- SonarQube MCP uses SONAR Source-Available License v1.0; keep it external and do not copy it into FuryPipe.
- Archived Semgrep MCP should not be presented as an actively maintained 2026 integration.

## Native FuryPipe patterns worth adapting

### Sentry: skill-based authorization

Sentry exposes user-facing capability groups rather than forcing clients to reason only in raw API scopes.

FuryPipe should adapt this concept as:
- named capability packs;
- explicit read/write split;
- deterministic expansion to concrete tool IDs;
- policy inspection before execution;
- no automatic enablement of newly introduced tools.

### MongoDB: strict tool input and sensitive-output hardening

MongoDB 2.x release notes show useful defensive patterns:
- strict unknown-argument rejection;
- sensitive configuration redaction;
- path-traversal validation;
- server-side JavaScript disabled by default;
- explicit connection identifiers.

These are suitable **ADAPT** targets for FuryPipe's generic MCP adapter validator.

### Neon: server-declared scope/read-only metadata

Neon exposes read-only mode and tool scope metadata.

FuryPipe should consume such metadata only as **advisory evidence**:
- host policy remains authoritative;
- server metadata can reduce the visible tool set;
- server metadata must never grant a permission FuryPipe policy did not already authorize.

### Grafana Docs MCP: deterministic non-embedding documentation retrieval

Grafana's standalone docs MCP uses deterministic lexical retrieval without an embedded LLM.

This is a useful pattern for FuryPipe documentation connectors:
- lower privacy risk;
- predictable cost;
- source URLs remain citable;
- no hidden model invocation.

## Proposed runtime follow-up

A future implementation PR should remain separate from this research PR and should only start after overlap with Codex is checked.

Recommended first runtime slice:

1. extend plugin permission taxonomy with the read-only classes only;
2. add a generic external MCP tool allowlist contract;
3. implement one low-risk profile first:
   - Grafana Docs MCP **or**
   - Neon read-only mode;
4. add tests proving:
   - unknown tools fail closed;
   - write tools are invisible under read profiles;
   - credentials are not serialized;
   - no process/network call occurs during registry inspection;
5. only then add high-impact services such as Terraform/MongoDB/PostHog.

## Explicit non-claims

- No endpoint in this document was connected from FuryPipe.
- No credential was used.
- No remote tool invocation was executed.
- No production write path is VERIFIED.
- No performance or security claim is inferred from repository activity.
- No source listed here is approved for vendoring merely because its licence is permissive.


## User-required source coverage — do not drop

The following sources were explicitly required by the project owner. They are already represented by the merged ecosystem work or by PR #56, but they remain a **coverage invariant** for future ledger synchronization. They must not disappear when Codex or ChatGPT regenerates research documentation.

| Required source | Current inspected pin / evidence | Licence state | FuryPipe decision / rule |
|---|---|---|---|
| `furkankly/zoetrope` | `b1f31dd26bd4e9e513885e39edb78d0850a5d1fe` (2026-09-11) | MIT verified | **ADAPT / REFERENCE_ONLY** session-observability patterns; never ingest transcripts by default |
| `dietrichgebert/ponytail` | `356918eba965ee1eac64bd3a7f0dd02108350de5` (2026-09-07) | MIT verified | **ADAPT** simplicity/YAGNI/benchmark discipline |
| `addyosmani/agent-skills` | `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39` (2026-09-12) | MIT verified | **ADAPT PER_SKILL**; never bulk-trust the repository |
| `trailhq/Graft` | `f9e65396e638e517aecae0d731017f53084d70ed` (2026-09-10) | MIT verified | **WRAP / ADAPT** codebase graph and context patterns |
| `calesthio/OpenMontage` | `08e2151fa02de28a5d6a312b3d575692bf147ad7` (2026-09-06) | AGPL-3.0 verified | **REFERENCE_ONLY**; no vendoring into FuryPipe |
| `DeusData/codebase-memory-mcp` | `042a58bb1f34f725b4e5c64f1e1f966c1b1130fc` (2026-09-12) | MIT verified | **WRAP / ADAPTER_CANDIDATE**; compare against native Recovery/Knowledge/LTM first |
| `msitarzewski/agency-agents` | `6d29a9b08785a0e49ffc9818bbdd381164c2df5f` (2026-09-09) | MIT verified | **ADAPT** bounded role decomposition only |
| `ScrapeGraphAI/Scrapegraph-ai` | `c75c8084fae2d4f5ba01a8c218bc1168b67e3569` (2026-09-07, v2.2.4 release commit) | MIT verified | **WRAP** research/scraping behind explicit network, robots, rate-limit and telemetry policy |
| `VoltAgent/voltagent` | `44b4c8e4998ce56095b2f0e4eaf1a988f5e6d0de` (2026-08-27) | MIT verified | **REFERENCE_ONLY / ADAPT** selected orchestration patterns; do not replace Agent Runtime wholesale |
| `OneWave-AI/claude-skills` | `82859c0ebaff803889be6ca2efa0834ba8787773` (2026-08-11) | MIT verified | **PER_SKILL_REVIEW**; no bulk execution trust |
| `jeremylongshore/tons-of-skills-marketplace` | `e76800b6800a699de40373976ac0729886d603d0` (2026-09-12) | marketplace tooling MIT; individual artifacts retain own terms | **REFERENCE_ONLY** discovery; marketplace presence is never trust evidence |
| `smtg-ai/claude-squad` | `ce1ffb4392b01f38e2c4599c7c84d2a93973b138` (2026-08-20, v1.0.20) | AGPL-3.0 verified | **REFERENCE_ONLY / ADAPT** worktree ownership ideas; no source copy |
| `microsoft/playwright-cli` | `655530f6d0dc71a0d6bf46ae165877d3c7311099` (2026-09-03) | Apache-2.0 verified | **WRAP / ADOPT** optional Web Studio browser CLI adapter, version pinned |
| Supabase AI Tools / Plugin | official docs revalidated 2026-09-12 | hosted service + separately licensed skills/server | **ADOPT architecture / WRAP runtime**; project-scoped read-only MCP by default |
| `tghastings/strix-claude-code` | `55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2` (2026-08-13, Strix 1.3.0 compatibility) | unresolved in current audit | **REFERENCE_ONLY** until licence and offensive-tool containment are proven |
| `ui-skills.com` | live catalogue, revalidate individual source at use time | mixed authors/licences | **REFERENCE_ONLY** discovery; every selected skill needs its own provenance |
| Context7 Claude Code / MCP / plugin | current official docs revalidated 2026-09-12 | hosted service/docs | **WRAP** documentation-only profile; OAuth/API key host-owned |
| `horizonx.so` | current commercial service | commercial | **REFERENCE_ONLY**; no copying/vendoring without explicit rights |
| `diegosouzapw/OmniRoute` | `152d95108c9c3d557562311ffed63240a511eb31` (2026-09-12) | MIT verified | **WRAP**; FuryPipe adapter already merged in PR #55, do not reimplement |
| `multica-ai/andrej-karpathy-skills` | repo `2c606141936f1eeef17fa3043a72095b4765b9c2`; `CLAUDE.md` blob `daced9bd64f25908ebedeb4701fb406985dc8366` | MIT declared in README/plugin metadata; no root LICENSE resolved | **ADAPT / REFERENCE_ONLY**; native `karpathy-coding-discipline`, never copy the file verbatim |

### Current ledger drift detected

The hardening `SOURCE_LEDGER.md` is correct in policy but two immutable pins have already moved since its last synchronization:

- `SRC-020 codebase-memory-mcp`: ledger has `b790be3d...`; current inspected HEAD is `042a58bb1f34f725b4e5c64f1e1f966c1b1130fc`.
- `SRC-025 tons-of-skills-marketplace`: ledger has `8871797e...`; current inspected HEAD is `e76800b6800a699de40373976ac0729886d603d0`.

Do not update the shared ledger from this PR while Codex owns the ecosystem/source-ledger track. The next owner of `SOURCE_LEDGER.md` should reconcile these exact pins rather than silently treating the old references as current.

## Karpathy CLAUDE.md — retained principles

The exact inspected file is:

- repository: `multica-ai/andrej-karpathy-skills`
- repository commit: `2c606141936f1eeef17fa3043a72095b4765b9c2`
- `CLAUDE.md` blob SHA: `daced9bd64f25908ebedeb4701fb406985dc8366`

The useful principles remain:

1. expose assumptions and trade-offs before implementation;
2. prefer the smallest sufficient solution;
3. make surgical changes and avoid unrelated cleanup;
4. turn work into explicit, verifiable success criteria;
5. verify bugs with reproduction tests where practical;
6. stop speculative abstraction and configuration;
7. keep project-specific security, provenance, CI and evidence rules above generic coding advice.

FuryPipe should keep these as **native paraphrased policy**, not as copied upstream text. PR #56 already implements the provenance side of this decision.

## Additional 2026 high-value delta

These sources were revalidated after the earlier FuryPipe ecosystem passes and should be considered by the owner of the next registry/ledger synchronization.

| Source | 2026 evidence | Decision | Why it matters to FuryPipe |
|---|---|---|---|
| Atlassian Rovo MCP v2 | GA announced 2026-09-08; OAuth 2.1; tool groups include read/write/search/delete/manage | **WRAP** | Strong model for on-demand tool discovery and intent-based permission groups; default FuryPipe profile should expose read/search only |
| GitLab MCP server | GitLab 19.2; Beta; OAuth 2.0 Dynamic Client Registration; GitLab.com/Self-Managed/Dedicated | **WRAP** | Complements GitHub; repository/MR/issue read first, mutation separately approved |
| Redis MCP | official Redis MCP; read/write/query plus server-management commands | **WRAP** | Useful data/cache adapter, but requires `database-read` / `database-write` / `database-admin` separation |
| Elastic Agent Builder MCP | current Kibana Agent Builder endpoint; API key or OAuth; tool health and external MCP import | **WRAP / ADAPT** | Useful search/observability integration and a strong reference for MCP health; external tool output is fed to the LLM, so prompt-injection policy is mandatory |
| Microsoft Playwright MCP | official `@playwright/mcp`; package evidence observed at v0.0.80 with Chromium/Firefox/WebKit tests | **WRAP** | Separate from Playwright CLI; structured accessibility snapshots are useful for Web Studio QA |
| AWS Agent Toolkit for AWS | 2026 successor to older AWS Labs MCP/skills; Apache-2.0; IAM agent condition keys and audit logging | **REFERENCE_ONLY / PER_SKILL_REVIEW** | Strong cloud permission/audit reference; do not grant cloud-write by default |
| Supabase Plugin | official 2026 plugin bundles MCP + Agent Skills; remote MCP supports project scope, read-only mode and feature groups | **ADOPT architecture / WRAP runtime** | Very strong reference for FuryPipe plugin bundles and least-privilege profiles |
| Context7 Plugin | current plugin bundles MCP tools, automatic skill, docs-researcher agent and command | **ADAPT architecture / WRAP runtime** | Good example of progressive disclosure and keeping documentation lookup out of the primary agent context |
| 21st MCP / MCP Apps | 2026 component catalogue + interactive MCP Apps UI | **WRAP / ADAPT** | Useful for Web Studio component discovery and future Control Room rich MCP UI; install/publish remain write operations |
| GitHub Spec Kit 1.0 | current 2026 SDD workflow: Spec → Plan → Tasks → Implement; multi-agent integrations | **ADAPT** | Reinforces native FuryPrompt spec-driven profile without importing the toolkit runtime |
| Agent Skills open standard | `SKILL.md` portable format; Apache-2.0 code / CC-BY-4.0 docs | **ADOPT** | FuryPipe should stay compatible with the format while applying stricter trust/provenance gates |
| OpenAI Codex plugins model | 2026 plugins bundle skills, connected tools/apps, instructions and workflows | **REFERENCE / ADAPT** | Confirms FuryPipe's plugin-bundle direction instead of treating every integration as one-off code |
| Cloudflare managed MCP | 2026-07-28 MCP support, OAuth, managed remote servers | **WRAP** | Revalidate current Cloudflare bundle against the new protocol generation before expanding permissions |
| GitHub MCP v1.7 generation | 2026-07-28 spec support and lockdown improvements observed in v1.7.0 release | **ADOPT / WRAP** | Current FuryPipe GitHub source pin should be refreshed by the ledger owner when that work lands |

## 2026 architecture conclusions

### Portable capability packaging

FuryPipe should converge on a bundle model where one integration can declare:

- Agent Skills-compatible `SKILL.md` capabilities;
- MCP endpoints/toolsets;
- optional UI/MCP Apps surfaces;
- instructions/workflows;
- permission classes;
- exact source/version provenance;
- host-owned auth requirements;
- health metadata;
- explicit install/update policy.

A bundle is metadata until the host explicitly enables it.

### Progressive disclosure

2026 ecosystems increasingly avoid loading every tool/skill into context.

FuryPipe should preserve:
- lightweight discovery metadata first;
- full skill/tool schema only when selected;
- on-demand tool search;
- bounded context contribution;
- deterministic capability IDs.

Atlassian's primary/on-demand tool model, Agent Skills progressive disclosure and Context7's dedicated docs-researcher are all useful patterns.

### Supply-chain rule

Never use `@latest`, marketplace popularity or registry membership as a trust decision.

Runtime-capable external artifacts require:
- immutable version or commit;
- licence state;
- install/lifecycle script review;
- transitive dependency review;
- permission declaration;
- network declaration;
- secret declaration;
- update policy;
- explicit host approval.

### New native skills worth implementing instead of importing whole repositories

High-value FuryPipe-native candidates:

- `dependency-install-review`
- `mcp-tool-diff-review`
- `prompt-injection-boundary-review`
- `browser-evidence-review`
- `database-change-review`
- `infra-plan-review`
- `observability-triage`
- `security-scan-triage`
- `migration-safety`
- `accessibility-evidence-review`
- `seo-technical-review`
- `source-provenance-review`

These should be adapted from multiple sources, not copied wholesale from one marketplace.

## Coordination with Codex

The project owner assigned Codex the broad ecosystem/source-ledger, OmniRoute, memory, MCP registry, browser/app and multi-agent tracks.

Therefore this PR intentionally:
- records new evidence in one isolated document;
- does not modify `SOURCE_LEDGER.md`;
- does not modify `MCP_REGISTRY.md`;
- does not modify `SKILL_LICENSE_MATRIX.md`;
- does not modify `TASKS.md` or `WORKLOG.md`;
- does not change runtime code.

After Codex publishes its branch/PR, reconcile this delta against its work and keep only non-duplicated evidence.
