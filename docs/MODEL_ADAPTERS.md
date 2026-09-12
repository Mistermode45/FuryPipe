# FuryBench Model Adapters

## Purpose

FuryBench Model Adapters provide a fail-closed way to add model-specific prompt guidance without turning benchmark folklore into runtime behavior.

The default remains model-neutral.

A model adapter is eligible only when FuryPipe receives a qualification tied to:

- the exact adapter content digest;
- the exact provider;
- the exact model identifier;
- the exact workload identifier;
- comparable benchmark evidence;
- passing quality, exactness and error gates.

V1 deliberately does not generalize evidence from one model, provider, or workload to another.

## Pipeline

```text
candidate adapter
      ↓
benchmark execution
      ↓
benchmark suite assessment
      ↓
adapter qualification
      ↓
exact scope + digest verification
      ↓
Model Adapter Registry
      ↓
additive FuryPrompt guidance
```

These are separate stages.

A benchmark result does not automatically activate an adapter.

A qualification does not grant tools, network, filesystem, deployment, or other authority.

## Relationship to bench/v5

The existing `bench/v5` harness remains the canonical FuryPipe benchmark contract for comparable executed runs.

It records:

- provider/model identity;
- fixture, prompt, toolset and context digests;
- cache state;
- tokens;
- latency / TTFT;
- request / response bytes;
- cost when known;
- quality;
- exactness;
- errors;
- Recovery state.

The repeated-suite gate can return `CLAIM_ELIGIBLE` only when repetitions, exactness, quality and zero-error requirements pass.

Its own contract correctly states that `CLAIM_ELIGIBLE` does not establish statistical significance, causality, or general superiority.

Model Adapter V1 keeps that limitation.

## Adapter definition

An adapter declares:

- stable ID;
- exact provider;
- exact model;
- exact workload ID;
- bounded priority;
- additive prompt instructions.

Allowed additive sections are:

- role;
- constraints;
- plan;
- output contract;
- acceptance criteria;
- verification.

Adapters cannot replace or delete the caller's existing FuryPrompt sections.

They cannot write directly into objective, task, context, tools, skills, MCP, subagents, or input sections.

## Qualification

A `furypipe-model-adapter-qualification/v1` record includes:

- adapter ID;
- SHA-256 digest of the exact adapter definition;
- SHA-256 digest of the underlying benchmark suite artifact;
- exact provider/model/workload;
- comparability status;
- claim status;
- repetition count;
- baseline and candidate median quality;
- exactness run counts and mismatch count;
- benchmark error count.

Automatic eligibility requires:

- `comparability = VERIFIED`;
- `claimStatus = CLAIM_ELIGIBLE`;
- at least 5 repetitions;
- candidate median quality >= baseline median quality;
- all declared exactness runs passing;
- zero exactness mismatches;
- zero benchmark errors;
- exact adapter digest match;
- exact provider/model/workload match.

## Why exact scope only

A result measured on one model does not prove another model behaves the same way.

A result measured for a marketing website workload does not prove the same prompt tuning improves Minecraft plugin engineering, research, or business automation.

V1 therefore performs no:

- model-prefix matching;
- provider-family extrapolation;
- semantic workload guessing;
- automatic evidence transfer;
- cross-model inheritance.

Broader qualification can be added later only with an explicit multi-workload / multi-model evidence contract.

## Priority

Multiple qualified adapters may exist for the same exact scope.

FuryPipe selects the highest-priority adapter. Ties are resolved by stable adapter ID ordering.

A blocked higher-priority adapter does not prevent a lower-priority adapter from being selected if the lower adapter has valid independent qualification.

## Digest binding

Qualification evidence is bound to the exact adapter definition.

Changing:

- provider;
- model;
- workload;
- priority;
- any adapter instruction

changes the adapter digest and invalidates the old qualification.

This prevents benchmark evidence for one prompt treatment from silently authorizing a modified treatment.

## Security

Model Adapter V1 changes prompt guidance only.

It does not:

- enable a plugin;
- run a skill;
- connect MCP;
- grant network access;
- grant filesystem writes;
- expose secrets;
- change FuryPrompt security-critical authority;
- execute deployments or external side effects.

Those capabilities remain governed by the existing FuryPipe router/runtime/policy layers.

## Current status

The registry and qualification gate are runtime primitives.

FuryPipe does not ship a built-in model-specific adapter as verified merely because a model is known.

A built-in adapter should be added only after real benchmark evidence exists for its exact scope and the corresponding qualification artifact is reviewable.
