# FuryPipe Provider Attempt Planner

## Purpose

The Provider Attempt Planner composes two independently qualified, attempt-scoped
planning systems:

1. Provider Attempt Model Adapter planning.
2. Context Optimizer Profile planning.

The exact attempt identity is shared by both:

```text
providerId + model + workloadId
```

This avoids applying provider/model-specific prompt guidance or token-optimization
profiles before the provider attempt is known.

## Architecture

```text
model-neutral BASE FuryPrompt
        │
        ├──────── exact provider/model/workload ────────┐
        │                                               │
        ↓                                               ↓
Provider Attempt Adapter                    Context Optimizer Profile Registry
        │                                               │
        ↓                                               ↓
attempt-specific prompt                     qualified profile options
        └──────────────────┬────────────────────────────┘
                           ↓
                Provider Attempt Plan
```

The result remains planning-only.

It does not execute a provider and it does not run Context Optimizer.

## Why this layer exists

Task Orchestrator runs before a concrete provider attempt is necessarily known.
Applying model-specific tuning inside `prepareFuryTask()` would create a
fallback-contamination risk:

```text
prepare task for model A
→ inject model-A tuning
→ provider A fails
→ fallback to model B with model-A assumptions still present
```

The Provider Attempt Planner avoids that architecture.

Every call to `plan()` starts from the same captured model-neutral base prompt
and resolves both subsystems again for the exact attempt.

## Model Adapter composition

The planner delegates prompt adaptation to
`createProviderAttemptAdapterPlanner()`.

That subsystem remains authoritative for:

- immutable BASE prompt capture;
- exact provider/model/workload matching;
- Model Adapter Registry qualification;
- FuryBench adapter evidence;
- safe prompt sections;
- adapter size bounds;
- fallback prompt isolation.

The composite planner does not weaken or duplicate those gates.

## Context Profile composition

The planner snapshots the Context Optimizer Profile Registry at construction.

This prevents a later registry mutation from changing the meaning of an already
created planner.

Generated Context Optimizer qualifications are **not cloned**.

Their in-process provenance is identity-based, so cloning them would correctly
invalidate them. The planner freezes only the qualification array while
preserving the original immutable qualification objects.

The Context Optimizer Profile Registry remains authoritative for:

- profile digest;
- provider/model/workload scope;
- benchmark qualification;
- token-reduction evidence;
- anti-regression;
- profile priority;
- blocked-profile diagnostics.

## Context profile states

The composite plan exposes:

```text
IDENTITY
QUALIFIED
BLOCKED
```

### IDENTITY

No qualified profile is selected and all matching blockers are only
`missing-qualification`.

No optimizer options are silently invented.

### QUALIFIED

The Context Optimizer Profile Registry selected a profile with verified
evidence for the exact provider/model/workload scope.

### BLOCKED

A matching profile exists but failed a substantive gate such as:

- scope mismatch;
- digest mismatch;
- invalid qualification;
- insufficient repetitions;
- quality regression;
- exactness failure;
- benchmark errors;
- no measured token improvement.

## Fallback behavior

Every provider attempt is recomputed independently.

Example:

```text
BASE
├─ OpenAI / gpt-5.6-sol / coding
│  ├─ OpenAI adapter
│  └─ OpenAI-qualified context profile
│
└─ Anthropic / claude-opus-5 / coding
   ├─ Anthropic adapter
   └─ Anthropic-qualified context profile
```

An OpenAI adapter cannot leak into the Anthropic attempt.

An OpenAI context-profile qualification cannot authorize an Anthropic profile.

The same anti-transfer rule applies across model and workload boundaries.

## Output contract

`createProviderAttemptPlanner().plan()` returns:

- exact provider ID;
- exact model;
- exact workload ID;
- attempt-specific FuryPrompt;
- full Provider Attempt Adapter plan;
- full Context Optimizer Profile plan;
- derived context-profile state;
- explicit non-execution flags.

Every plan states:

```text
networkCallExecuted     = false
providerRequestExecuted = false
optimizerExecuted       = false
executionAuthorized     = false
```

These flags are invariants, not recommendations.

## What this module does not do

V1 does not:

- call a provider;
- select provider availability;
- run Context Optimizer;
- inject optimized context;
- mutate Task Orchestrator;
- authorize execution;
- enable secret context;
- create benchmark evidence;
- generalize qualification across models/providers/workloads;
- publish or deploy.

## Next integration boundary

The next runtime layer can consume:

```text
Provider Attempt Plan
        ↓
exact attempt prompt
+
qualified context profile options
        ↓
host-owned context inventory
        ↓
Context Optimizer
        ↓
provider request preparation
```

That future layer must define explicit precedence between:

- host security policy;
- qualified profile options;
- exact context requirements;
- provider-specific ordering constraints;
- caller-requested limits.

It must not label an altered set of options as benchmark-qualified unless the
altered profile has its own qualification.
