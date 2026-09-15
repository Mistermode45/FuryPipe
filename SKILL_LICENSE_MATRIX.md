# Skills — matrice licence et confiance

Aucune Skill tierce n'est vendored ou activée par ce checkpoint.

| Source / skill | SHA/version | Licence vérifiée | État | Justification |
|---|---|---|---|---|
| Skills locales Codex/Caveman | versions locales de l’environnement | non applicable au code FuryPipe | référence interne uniquement | utilisées pour le workflow, pas vendored |

Toute future source externe doit être résolue vers un SHA, lue, scannée et classée avant copie ou exécution.


## Runtime registry rule

`src/skill-registry.ts` is now the executable trust gate for host-provided skills.

- `REFERENCE_ONLY` and `REJECT` sources cannot become executable.
- External executable sources require a credential-free HTTPS repository, an exact 40-character commit SHA and `VERIFIED` license status.
- The registry does not fetch source code.
- The registry currently contains no bundled third-party registration.
- Local callbacks still pass through Agent Runtime permission/network/health/budget enforcement.

The existence of a source in `SOURCE_LEDGER.md` or in this matrix is not authorization to execute it.


## Sources requested 2026-09-12

| Source | Pinned SHA / version | Licence status | Runtime decision |
|---|---|---|---|
| Ponytail | `356918eba965ee1eac64bd3a7f0dd02108350de5` | MIT verified | reference only |
| Addy Osmani Agent Skills | `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39` | MIT verified | reference only until per-skill review |
| Agency Agents | `6d29a9b08785a0e49ffc9818bbdd381164c2df5f` | MIT verified | reference only |
| OneWave Claude Skills | `82859c0ebaff803889be6ca2efa0834ba8787773` | MIT verified | reference only until per-skill review |
| Tons of Skills Marketplace | `a58233ed4b9a9fda3ff0d37a304a570f4cc98083` | MIT verified | reference only; marketplace entries do not inherit trust |
| UI Skills | live catalogue | mixed/unknown by individual skill | reference only |
| Supabase AI plugin | official docs | external service/plugin | explicit opt-in only |
| Context7 | official docs | external service/plugin | explicit opt-in only |
| HorizonX | commercial | commercial | reference only |
| OpenMontage | `08e2151fa02de28a5d6a312b3d575692bf147ad7` | AGPL-3.0 verified | reference only |
| Claude Squad | `ce1ffb4392b01f38e2c4599c7c84d2a93973b138` | AGPL-3.0 verified | reference only |

No entry above is automatically registered as executable. The runtime registry still requires a separate host-provided definition plus provenance, permission, network and health gates.


## 2026 candidate sources

These are research candidates, not installed skills.

| Source | Pinned reference | License status | FuryPipe decision | Runtime status |
|---|---|---|---|---|
| Addy Osmani agent-skills | `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39` | MIT observed | ADAPT selected engineering skills | NOT_INSTALLED |
| Ponytail | `356918eba965ee1eac64bd3a7f0dd02108350de5` | MIT observed | ADAPT minimalism/review skills | NOT_INSTALLED |
| Agency Agents | `6d29a9b08785a0e49ffc9818bbdd381164c2df5f` | MIT observed | ADAPT a small specialist set | NOT_INSTALLED |
| OneWave AI claude-skills | `82859c0ebaff803889be6ca2efa0834ba8787773` | MIT observed | ADAPT selected orchestration skills | NOT_INSTALLED |
| Tons of Skills Marketplace | `a58233ed4b9a9fda3ff0d37a304a570f4cc98083` | marketplace-level MIT; plugin licenses vary | REFERENCE_ONLY discovery | NOT_EXECUTABLE |
| OpenMontage | `08e2151fa02de28a5d6a312b3d575692bf147ad7` | AGPLv3 observed | REFERENCE_ONLY core | NOT_EXECUTABLE |
| Strix Claude Code | `55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2` | verify before any reuse | REFERENCE_ONLY / sandbox | NOT_EXECUTABLE |
| Agent Skills standard | public standard | code Apache-2.0 / docs CC-BY-4.0 observed | ADOPT portable package format | FORMAT_ONLY |

No row in this table bypasses `AgentSkillRegistry`. Before execution, a
source-specific manifest must still declare exact provenance, license state,
permissions, network posture, health policy and version.


## Research wave — 2026-09-13

This wave expands discovery and native instruction profiles. It does **not** install or register third-party executable code.

| Source | Pin | Licence state | FuryPipe mode | Runtime state |
|---|---|---|---|---|
| API Evangelist API Layer | `549115d70ebd9f0163810b1e5fc3a1b264c53df6` | UNKNOWN; no root licence resolved; archived | REFERENCE_ONLY | NOT_EXECUTABLE |
| Antigravity Awesome Skills | `fa724b5e12b4e77870ab8a85e5e587474d6cee91` | root MIT, individual upstream terms mixed | REFERENCE_ONLY catalogue | NOT_EXECUTABLE |
| skills.re | live registry | per-artifact / service terms vary | REFERENCE_ONLY discovery | NOT_EXECUTABLE |
| OpenAI Skills | `49f948faa9258a0c61caceaf225e179651397431` | root licence unresolved by this audit | REFERENCE_ONLY | NOT_INSTALLED |
| Microsoft Skills | `903dc62b1e4c833235b54db918a9a51cb6d3cc8f` | MIT VERIFIED | ADAPTER_CANDIDATE | NOT_INSTALLED |
| Google Gemini Skills | `80dd31dda25bbe1410207df0adb3e0d591c2c634` | Apache-2.0 VERIFIED | ADAPTER_CANDIDATE | NOT_INSTALLED |
| Supabase Agent Skills | `8331f910845103c08d51f6ca1d86ebb7d1f745e3` | MIT VERIFIED | ADAPTER_CANDIDATE | NOT_INSTALLED |
| Remotion Skills | `bd566b65d521b40fe92e1f26766e82de9e291693` | root licence unresolved by this audit | REFERENCE_ONLY | NOT_INSTALLED |
| VoltAgent Awesome Agent Skills | `8873794bcb26ff5dcf9cd518c87cf5638ca44b92` | aggregator MIT; individual source terms independent | REFERENCE_ONLY catalogue | NOT_EXECUTABLE |
| Caveman | `15581d14007fd01fb3f132016741962f34936ca2` | mixed MIT / BSL-1.1 | REFERENCE_ONLY | NOT_EXECUTABLE |
| Context Mode | `ba5f5dfd1a0cd3e8a8f812c219d50390ed0a61c8` | Elastic-2.0 VERIFIED | REFERENCE_ONLY | NOT_EXECUTABLE |
| Tech Debt Skill | `5a15c1ca4a929b2759461c218478de391a8bda0f` | README-declared MIT; no root licence resolved | REFERENCE_ONLY; native adaptation only | NOT_EXECUTABLE |
| UI UX Pro Max | `7f69fed6a2717900085f1bc3b263721f8ba025e2` | MIT VERIFIED | ADAPTER_CANDIDATE | NOT_INSTALLED |
| Hallmark | `13ac0ec7e148655948100b6396439e481361d690` | MIT VERIFIED | ADAPTER_CANDIDATE; native design discipline adapted | NOT_INSTALLED |
| MarketingSkills | `5b2c0007766c6a1cf1d53fd8fc73e979e0821022` | MIT VERIFIED | ADAPTER_CANDIDATE; native product-context discipline adapted | NOT_INSTALLED |
| Code Review Graph | `b58668751ab0c7670c078cf7cbd4d1f5b8e54f81` | MIT VERIFIED | ADAPTER_CANDIDATE | NOT_INSTALLED |
| Superpowers systematic-debugging | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT VERIFIED | native instruction adaptation | NO_EXTERNAL_RUNTIME |

### Native adaptations produced by this wave

The following are FuryPipe-owned instruction profiles, not copied third-party skill runtimes:

- `systematic-debugging`;
- `codebase-audit-discipline`;
- `ui-design-discipline`;
- `product-marketing-context-discipline`.

They are bounded FuryPrompt additions and cannot grant filesystem, tool, MCP, network, provider or account authority.

### Performance-claim rule

Claims found in external READMEs, social rankings or articles — including token/cost reductions or speed multipliers — remain `UNVERIFIED_EXTERNAL_CLAIM` unless a FuryPipe Benchmark Contract run records:

- exact source/version;
- workload corpus;
- baseline;
- repetitions;
- quality/non-regression criteria;
- measured tokens/cost/latency;
- errors/abstentions.

No external claim in this research wave changes FuryPipe's benchmark claims.
