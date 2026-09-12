# External Reference Catalog

## Status

`AUDITED_REFERENCE_CATALOG_IMPLEMENTED`

FuryPipe keeps external projects and services in a metadata-only catalogue before any adapter, vendoring or execution is allowed.

The runtime catalogue is `src/external-reference-catalog.ts`.

## Requested engineering / agent references

| Source | Pinned source | Licence state | FuryPipe decision | Primary use |
|---|---|---|---|---|
| Zoetrope | `b1f31dd26bd4e9e513885e39edb78d0850a5d1fe` | MIT verified | adapter candidate | read-only Claude/Codex session observability |
| Ponytail | `356918eba965ee1eac64bd3a7f0dd02108350de5` | MIT verified | reference only | code simplification / YAGNI discipline |
| Addy Osmani Agent Skills | `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39` | MIT verified | reference only | production engineering skill workflows |
| Graft | `f9e65396e638e517aecae0d731017f53084d70ed` | MIT verified | adapter candidate | codebase context graph / MCP |
| OpenMontage | `08e2151fa02de28a5d6a312b3d575692bf147ad7` | AGPL-3.0 verified | reference only | agentic video-production workflows |
| Codebase Memory MCP | `b790be3d15d44f0d4629a2c97ddf76c104d80d22` | MIT verified | adapter candidate | local code graph / MCP |
| Agency Agents | `6d29a9b08785a0e49ffc9818bbdd381164c2df5f` | MIT verified | reference only | specialist agent role decomposition |
| ScrapeGraphAI | `c75c8084fae2d4f5ba01a8c218bc1168b67e3569` | MIT verified | adapter candidate | explicit web/data research |
| VoltAgent | `44b4c8e4998ce56095b2f0e4eaf1a988f5e6d0de` | MIT reported, root licence file not resolved in this audit | reference only | agent framework / orchestration |
| OneWave Claude Skills | `82859c0ebaff803889be6ca2efa0834ba8787773` | MIT verified | reference only | skills / multi-agent / design |
| Tons of Skills Marketplace | `a58233ed4b9a9fda3ff0d37a304a570f4cc98083` | MIT verified | reference only | large skill catalogue/packaging |
| Claude Squad | `ce1ffb4392b01f38e2c4599c7c84d2a93973b138` | AGPL-3.0 verified | reference only | isolated worktree/tmux multi-agent execution |
| Strix Claude Code | `55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2` | not verified in this audit | reference only | security-testing workflow patterns |

AGPL projects remain external/reference-only. FuryPipe does not copy their implementation into the MIT codebase.

## App-building references

### Microsoft Playwright CLI

Pinned repository: `microsoft/playwright-cli@655530f6d0dc71a0d6bf46ae165877d3c7311099`.

Licence: Apache-2.0 verified.

Decision: `ADAPTER_CANDIDATE`.

Use: browser QA, screenshots, session-based test automation and token-efficient coding-agent browser interaction. Web Studio remains adapter-based; installing Playwright CLI is optional.

### Supabase AI plugin

Official docs: <https://supabase.com/docs/guides/ai-tools/plugins>

Decision: `EXTERNAL_OPT_IN`.

Use: backend/database/Auth/Storage/Realtime workflows through Supabase MCP plus skills. FuryPipe must never configure a Supabase project or credential without explicit user authorization.

### UI Skills

Source: <https://www.ui-skills.com>

Decision: `REFERENCE_ONLY`.

Use: design-engineering discovery and UI QA ideas. The catalogue aggregates multiple authors; each individual skill needs its own provenance/licence review before execution.

### Context7

Official docs: <https://context7.com/docs/clients/claude-code>

Decision: `EXTERNAL_OPT_IN`.

Use: current library documentation through CLI/MCP/plugin. It remains an explicit external network dependency rather than hidden runtime behavior.

### HorizonX

Source: <https://horizonx.so>

Decision: `REFERENCE_ONLY`.

Use: Figma / React / Tailwind design reference and UI specification ideas.

HorizonX is commercial. FuryPipe must not vendor or reproduce paid components unless the user independently holds the required rights.

## Provider gateway

### OmniRoute

Pinned repository: `diegosouzapw/OmniRoute@152d95108c9c3d557562311ffed63240a511eb31`.

Licence: MIT verified.

Decision: `ADAPTER_CANDIDATE`.

OmniRoute exposes OpenAI-compatible, Anthropic-compatible and Gemini-compatible surfaces and is therefore a natural candidate for the Provider Fabric. The actual FuryPipe adapter belongs in the Provider track, not in the skills runtime.

## Trust rule

A catalogue entry means only:

- the source was intentionally recorded;
- its provenance state is explicit;
- a high-level purpose was assigned.

It does **not** mean:

- code was copied;
- a binary/package was installed;
- an MCP server was connected;
- credentials were granted;
- network access was enabled;
- the source is allowed to run automatically.

Any future executable integration must still pass the dedicated adapter/skill permission and security gates.


## Recommended 2026 integration set

The detailed audit is maintained in `docs/research/ECOSYSTEM_2026.md`.

### First-class opt-in candidates

- **Context7** — current library documentation; network/read-only.
- **GitHub MCP** — official repository/issue/PR/workflow connector; repository-read by default.
- **Microsoft Playwright CLI** — token-efficient browser QA for coding agents; explicit browser/process/network permission.
- **Chrome DevTools MCP** — deeper console/network/trace/performance diagnostics; optional and separate from Playwright.
- **Supabase AI tools** — project-scoped backend workflows; database-read by default.
- **Codebase Memory MCP** — optional local structural code intelligence; repository-read/process boundary.
- **OmniRoute** — optional multi-provider gateway through Provider Fabric.
- **21st.dev** — optional UI/component discovery.
- **Firecrawl / Tavily / Exa** — alternative primary research connectors; do not enable all by default.

### Skill source pools

The following are source pools, not trusted executable bundles:

- Addy Osmani Agent Skills;
- wshobson/agents;
- UI Skills;
- Ponytail methodology;
- Agency Agents;
- OneWave Claude Skills;
- Claude Code Templates;
- Tons of Skills Marketplace.

Every executable skill still requires immutable provenance, licence review, permission classification and its own registry decision.

### Explicit reference-only boundaries

- OpenMontage and Claude Squad remain external/reference-only because their audited source licence is AGPL.
- Strix remains reference-only/high-privilege; no automatic offensive tooling.
- HorizonX remains commercial/reference-only; no paid code/component reproduction without independently held rights.
