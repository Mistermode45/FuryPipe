# FuryPipe Instruction Fabric

## Purpose

Instruction Fabric composes the smallest useful set of task-specific instructions on top of FuryPrompt.

It is not a second prompt language and it does not replace FuryPrompt or the existing instruction profiles. It selects and merges reusable instruction facets, reuses approved native profiles, applies a byte budget, and returns a normal FuryPrompt input.

## Why

Large static system prompts waste context and often repeat the same guidance. FuryPipe instead keeps the global contract small and loads detailed instructions only when the current task, capability pack, or caller explicitly requires them.

## Resolution model

Inputs:

- objective used only for deterministic classification;
- current FuryPrompt input;
- active Capability Router pack IDs;
- optional explicit instruction facets;
- maximum number of facets;
- maximum added instruction bytes.

The objective is classifier input. It is not copied into the generated instructions.

Selection priority:

1. explicit facets;
2. matching capability packs;
3. bounded objective triggers;
4. facet priority;
5. stable facet ID ordering.

Explicit facets are mandatory. If an explicit facet cannot fit inside the declared byte budget, resolution fails instead of silently dropping the caller requirement.

Automatically selected facets can be skipped when the facet count or byte budget is exhausted.

## Built-in V1 facets

- `production-engineering`
- `prompt-authoring`
- `website-production`
- `creative-direction`
- `research-evidence`
- `security-assurance`
- `marketing-conversion`
- `minecraft-plugin`
- `fivem-resource`
- `business-operations`

The production-engineering facet reuses the existing Karpathy-inspired and spec-driven FuryPipe instruction profiles rather than copying those rules into another catalog.

## Example: website prompt authoring

A request such as "create a complete prompt for a premium marketing website" can resolve to:

- prompt-authoring;
- website-production;
- marketing-conversion;
- creative-direction.

The resulting FuryPrompt additions cover:

- target audience and product goal;
- information architecture;
- responsive states;
- accessibility;
- performance;
- SEO;
- browser QA;
- design-system reuse;
- conversion clarity;
- measurement;
- multiple genuinely different creative directions;
- prompt acceptance criteria and verification.

Minecraft, FiveM, business-operations, and unrelated engineering instructions are not loaded.

## Context budget

Instruction Fabric enforces two independent bounds:

- facet count;
- added instruction bytes.

The byte budget counts reusable native profiles as well as task facets. The final merged result is checked again after de-duplication.

This is deliberately conservative. FuryPipe should prefer a small set of high-value instructions over large generic instruction libraries.

## Security

Instruction Fabric does not grant authority.

Security-related tasks can set `recommendedSecurityCritical: true`, but the fabric does not silently change the caller's FuryPrompt security-critical flag.

Retrieved text, objective text, recalled memory, tool output, and external content remain data. They do not become higher-priority instructions merely because a facet references them.

## Relationship to Capability Router

Capability Router answers:

> Which capabilities are relevant to this task?

Instruction Fabric answers:

> Which reusable instructions should shape the execution of those capabilities?

A later integration can pass Capability Router pack IDs directly into Instruction Fabric before FuryPrompt compilation.

## Relationship to future model adapters

V1 keeps task semantics model-neutral. Model-specific prompt rendering should be added only when benchmark evidence demonstrates that a different formulation improves quality, tokens, latency, or reliability for that model family.

The intended future pipeline is:

```text
Task
→ Capability Router
→ Instruction Fabric
→ model adapter
→ FuryPrompt
→ Context Optimizer
→ Agent Runtime
```

## Non-goals

V1 does not:

- download third-party instruction packs;
- trust arbitrary marketplace instructions;
- auto-install skills;
- execute MCP servers;
- optimize prompts by trial-and-error;
- claim model-specific superiority without benchmarks.

Those capabilities belong to FuryTrust, FuryBench, FuryScore, and future prompt-optimization work.
