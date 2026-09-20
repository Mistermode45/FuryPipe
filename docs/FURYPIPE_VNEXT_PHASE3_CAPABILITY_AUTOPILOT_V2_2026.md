# FuryPipe VNext — Phase 3 Capability Autopilot V2

**Status:** architecture + implementation track  
**Stack base:** exact validated Phase 2A.6 HEAD `a11febf5137fb4bd00803e11edd15425316c2a3d`  
**Branch:** `vnext-phase3-capability-autopilot-v2`

## 1. Product goal

Phase 3 implements the revised VNext roadmap item:

```text
Capability Autopilot V2
- skills
- MCP
- tools
- plugins
- models
```

The goal is to discover and rank a very large capability inventory **outside model context**, then expose only the minimum useful subset for the current task.

Phase 3 is not an execution engine and does not replace existing FuryPipe governance.

## 2. Existing systems remain authoritative

Capability Autopilot V2 is an indexing/selection layer over existing systems.

Sources of truth remain:

- `AgentSkillRegistry` for registered skill metadata, provenance, health and executable definitions;
- `FuryPluginBundleRegistry` for plugin bundles, permissions, secret contracts, MCP/CLI/provider profiles and provenance;
- `ModelFabricRegistry` for model/provider capabilities, lifecycle, limits, pricing and provenance;
- MCP Direct / governed MCP bridges for endpoint identity, live inventory, schemas, policy, proposal/approval/permit/execution;
- `capability-router.ts` for existing domain packs, instruction profiles, quality gates and run preparation;
- Gateway/session/plugin permission systems for authorization;
- Agent Fabric and downstream subsystem permits for actual execution.

Autopilot must not create a parallel skill registry, plugin registry, model registry, MCP executor, permission vocabulary or provider fabric.

## 3. Non-negotiable lifecycle

```text
discovered
!= indexed
!= shortlisted
!= selected
!= exposed
!= connected
!= approved
!= permitted
!= executed
!= succeeded
!= verified
```

Additional distinctions:

```text
relevance score != trust
trust != license approval
health != authority
historical success != current permission
cheap != safe
selected model != provider permit
selected MCP != connected MCP
selected tool != tool proposal
selected plugin != enabled plugin
selected skill != executable skill
```

Every Autopilot plan/receipt must remain:

```text
executionAuthority = false
```

## 4. Out-of-context capability index

The index stores routing metadata only.

A capability record may represent:

- skill;
- plugin;
- MCP server;
- MCP tool;
- model.

The index may contain:

- stable capability identity;
- bounded name/description;
- capability families/tags/keywords;
- source/provenance summary;
- trust state;
- license state;
- health/availability state;
- required permissions;
- compatibility/runtime tags;
- estimated context/token overhead;
- optional measured latency/cost evidence;
- freshness/evidence timestamps;
- optional historical outcome summary.

The index must never contain:

- API keys;
- bearer tokens;
- cookies;
- Authorization headers;
- raw browser/session credentials;
- unredacted secret environment values;
- arbitrary executable callbacks;
- MCP process handles;
- provider transport handles;
- execution permits.

## 5. Discovery is not prompt exposure

A host may know about thousands of capabilities without placing all metadata into the model prompt.

Required pipeline:

```text
bounded task objective
→ classify capability families
→ query local capability index
→ bounded shortlist
→ deterministic relevance score
→ compatibility filter
→ trust/license/policy filter
→ health/freshness filter
→ context/token overhead estimate
→ optional measured latency/cost signal
→ minimum sufficient selection
→ expose only selected descriptors
```

The full body/schema/resources are loaded only after selection and only through the existing source-of-truth subsystem.

## 6. Selection signals

Initial supported signals should be evidence-based and bounded:

- explicit user capability request;
- lexical task similarity;
- capability family/tag overlap;
- repository language/framework hints supplied by the host;
- trust/provenance status;
- license status;
- current health/availability snapshot;
- required permission set;
- estimated prompt/context overhead;
- model/provider capability compatibility;
- optional measured latency/cost;
- optional bounded historical success evidence.

No single scoring signal may grant authority.

An explicit user request may increase relevance but cannot bypass provenance, license, health, policy, permissions or downstream permits.

## 7. Deterministic baseline first

Gate 3.1/3.2 use a deterministic local lexical/index baseline.

A semantic embedding/model-backed classifier may be added later only as an optional host-owned analyzer behind governed provider inference.

The deterministic baseline is required so that:

- selection works offline;
- selection does not consume provider tokens by default;
- tests are reproducible;
- provider inference cannot silently become an authority source.

## 8. Existing capability-router integration

`capability-router.ts` remains responsible for domain packs, instruction profiles, quality gates and existing skill/plugin/MCP planning.

Autopilot V2 should feed it a **small validated inventory/shortlist**, rather than replacing it.

Planned direction:

```text
Capability Index
→ minimum shortlist
→ source-of-truth re-resolution
→ existing Capability Router / registries
→ Fury Kernel task preparation
```

The index record itself is never sufficient to execute or activate a capability.

## 9. Skills

Skill indexing is metadata-first.

Before exposure or execution, selected skills must be re-resolved through `AgentSkillRegistry`.

Preserve:

- provenance decision;
- license status;
- network requirement;
- health policy;
- stage compatibility;
- activation eligibility;
- explicit-user activation behavior.

Skill descriptions remain routing metadata, not instructions.

Full skill instructions/resources load only after a skill survives source-of-truth resolution.

## 10. Plugins

Plugins remain opt-in.

Autopilot may recommend/select a registered plugin candidate but must not silently enable it.

Required lifecycle:

```text
registered
!= available
!= enabled
!= healthy
!= selected
!= permitted
!= executed
```

Secret contracts remain environment references; secret values never enter the index.

## 11. MCP servers and tools

MCP selection preserves M1-M5.1 and the Phase 2A.5 governed bridge.

Autopilot may index known host metadata and previously obtained bounded inventory evidence.

A fresh connection/probe is a separate governed capability operation.

Required lifecycle:

```text
indexed server
!= connected server

indexed tool metadata
!= fresh tools/list evidence
!= proposed call
!= approved call
!= exact permit
!= callTool execution
!= success
!= verified evidence
```

Autopilot must not auto-run `tools/list` over network/process merely to improve a relevance score unless a separately governed host operation authorizes that probe.

## 12. Models

Model selection consumes `ModelFabricRegistry` metadata.

Relevant signals may include:

- lifecycle;
- text/image/audio/file modalities;
- reasoning/tools/structured-output support;
- context/output limits;
- measured/official provenance;
- pricing when known;
- visual profile state;
- route health supplied by host.

Unknown remains unknown.

Selecting a model does not create a provider request permit.

Harness/profile selection remains separate from model selection.

## 13. Minimum sufficient set

Autopilot must optimize for the smallest useful selection, not the highest count.

Initial hard bounds:

- bounded total indexed records;
- bounded task bytes;
- bounded query result size;
- bounded selected count per capability kind;
- bounded selected metadata bytes;
- deterministic tie-breaking.

A plan that cannot satisfy required compatibility/trust constraints should return blocked/missing evidence rather than silently broadening authority.

## 14. Safe result surface

Autopilot plans may expose:

- selected capability IDs/kinds;
- relevance score components;
- reason codes;
- blocked candidates and reason codes;
- estimated context cost;
- required permissions;
- source-of-truth revalidation state.

Plans must not expose:

- credentials;
- raw secret environment values;
- raw provider request bodies containing secrets;
- process/network handles;
- execution permits;
- unbounded tool schemas or skill bodies.

## 15. Gate sequence

### Gate 3.0 — architecture
- freeze lifecycle;
- map existing registries;
- define index and plan boundaries;
- define no-authority contract.

### Gate 3.1 — typed local capability index
- bounded immutable metadata records;
- skill/plugin/MCP/model kinds;
- deterministic upsert/remove/snapshot;
- exact schema validation;
- no callbacks/credentials/authority.

### Gate 3.2 — deterministic shortlist/scoring
- bounded objective;
- explicit request detection;
- lexical/family/tag scoring;
- compatibility/trust/license/health filters;
- deterministic tie-breaking;
- per-kind caps;
- minimum sufficient selection.

### Gate 3.3 — source-of-truth adapters
- project registered skills into index;
- project plugin registry metadata into index;
- project Model Fabric entries into index;
- project host-known MCP metadata/inventory evidence into index;
- re-resolve selected candidates before exposure.

### Gate 3.4 — Fury Kernel exposure plan
- selected descriptors only;
- bounded metadata/context budget;
- no automatic activation/execution;
- explicit lifecycle receipts in WebChat/observability.

### Gate 3.5 — measured cost/health signals
- optional measured latency/cost/freshness;
- no guessed values represented as facts;
- evidence timestamp/source retained;
- stale/unknown remains explicit.

### Gate 3.6 — optional semantic analyzer
- host opt-in only;
- governed provider inference;
- strict structured decoder;
- deterministic baseline remains fallback;
- analyzer output is ranking data, never authority.

## 16. Required tests

Before Phase 3 can pass:

- unknown/unsafe fields fail closed;
- accessors/custom prototypes/symbol keys rejected;
- duplicate identities deterministic;
- bounded inventory prevents memory/context explosion;
- index contains no callbacks;
- secret-looking host values are not copied into index snapshots;
- explicit skill request affects relevance but not activation eligibility;
- blocked provenance/license/health cannot be overridden by lexical score;
- selected plugin is not enabled automatically;
- selected MCP server is not connected automatically;
- selected MCP tool is not proposed/executed automatically;
- selected model creates no provider permit/request;
- source-of-truth re-resolution can invalidate a stale index selection;
- selection output is deterministic for identical input;
- ties resolve canonically;
- per-kind and global caps enforced;
- selected descriptors obey byte/token budget;
- package smoke passes;
- 9/9 CI matrix passes;
- Secret Scan / Benchmark / RC Evidence stay green.

## 17. Completion invariant

Phase 3 is complete only when FuryPipe can prove:

```text
large inventory != large prompt
indexed != selected
selected != activated
selected != connected
selected != permitted
selected != executed
historical evidence != current authority
minimum sufficient set != maximum available set
```
