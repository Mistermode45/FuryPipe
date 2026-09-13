# FuryPipe Context Optimizer Profile Qualification

## Purpose

Context Optimizer already provides deterministic, bounded context selection with
important safety properties:

- required items outrank optional items;
- exact context is not silently downgraded;
- secret context is blocked by default;
- byte and item budgets are enforced;
- token counts are estimates unless measured elsewhere.

This module adds a separate evidence layer for optimization **profiles**.

A profile is a reusable set of non-authority Context Optimizer options such as:

- global byte budget;
- item budget;
- discovery relevance threshold;
- cache-friendly ordering policy;
- per-kind byte budgets.

The core rule is:

```text
configured profile
  ≠ measured profile
  ≠ qualified profile
  ≠ automatically applied profile
```

The module never runs Context Optimizer and never changes a task by itself.

## Why qualification exists

A smaller context is not automatically a better context.

For example:

```text
input tokens: -40%
quality:      -12%
```

must not be treated as a successful optimization.

The qualification flow therefore composes the existing Benchmark Claim Gate:

```text
profile definition
      ↓
stable profile digest
      ↓
executed comparable benchmark suite
      ↓
Benchmark Claim Gate
      ↓
input_tokens / LOWER_IS_BETTER
      ↓
Anti-Regression Gate
      ↓
exact provider + model + workload qualification
```

A profile can qualify only when the measured token comparison is claim-eligible
and the quality/exactness/error gates remain satisfied.

## Profile contract

A profile can configure only:

```text
maxBytes
maxItems
discoveryMinRelevance
strictOrdering
maxBytesByKind
```

A profile cannot configure:

```text
allowSecret
items
credentials
permissions
provider execution
tool execution
runtime authorization
```

This is intentional.

Benchmark evidence must never become a path for enabling secret material or
granting authority.

Unknown profile fields and unsupported optimizer fields fail closed.

## Stable digest

`digestContextOptimizerProfile()` canonicalizes the profile and hashes:

- profile ID;
- priority;
- optimizer options;
- sorted per-kind budgets.

Changing a measured profile after qualification changes its digest.

A qualification for:

```text
maxBytes = 24576
```

cannot be reused for:

```text
maxBytes = 12288
```

The registry reports a digest mismatch instead.

## Qualification

`qualifyContextOptimizerProfile()` requires:

- exact provider;
- exact model;
- workload ID;
- benchmark suite evidence;
- caller-provided benchmark suite SHA-256 reference;
- profile definition;
- optional raw/pxpipe baseline;
- optional minimum absolute token improvement;
- optional minimum relative token improvement ratio.

The qualification always evaluates:

```text
metric    = input_tokens
direction = LOWER_IS_BETTER
```

It does not infer or invent a different optimization objective.

## Evidence requirements

A profile qualification requires:

- `comparability = VERIFIED`;
- Claim Gate status `CLAIM_ELIGIBLE`;
- at least 5 repetitions per variant;
- positive median input-token improvement;
- FuryPipe median quality non-regressive against RAW;
- FuryPipe median quality non-regressive against pxpipe;
- complete passing exactness;
- zero benchmark errors.

The Benchmark Claim Gate remains the canonical implementation of quality,
exactness, metric completeness, and claim threshold logic.

This module composes that gate rather than reproducing weaker rules.

## Exact benchmark scope

The generated qualification records the benchmark scope:

- provider;
- model;
- fixture digest;
- prompt digest;
- toolset digest;
- context digest;
- cache state;
- repetitions.

It also records the supplied workload ID.

The registry later requires exact equality for:

```text
provider
model
workloadId
profileDigest
```

There is no model-family matching, provider-family matching, fuzzy workload
matching, or profile similarity matching.

## Workload boundary

`workloadId` is an explicit host-provided classification.

This module can verify that the same literal workload ID is used when resolving
a qualification, but it cannot prove that the host classified a real-world task
correctly.

The exact benchmark fixture/prompt/toolset/context digests remain attached to
the qualification for auditability.

A future broader benchmark policy can define when multiple benchmark fixtures
are sufficient to generalize a workload claim. V1 does not invent such a rule.

## Benchmark suite SHA-256 boundary

`benchmarkSuiteSha256` is a caller-provided evidence reference.

This module validates its SHA-256 shape and preserves it, but it does not open a
file or hash external bytes itself.

Therefore:

```text
recorded digest
≠ independently verified artifact bytes
```

Hosts that persist benchmark artifacts must verify the digest at their storage
boundary.

## In-process provenance

Generated qualifications are tracked in-process.

A copied or hand-built object that merely looks like:

```text
furypipe-context-optimizer-profile-qualification/v1
```

is not accepted by the registry.

This prevents callers from constructing a positive qualification by copying the
JSON shape.

The current provenance marker is process-local, not a signature and not a
persistence format.

Persistent/signed qualification receipts are a separate future track.

## Registry

`createContextOptimizerProfileRegistry()` stores bounded immutable profiles.

Resolution order is deterministic:

1. lower numeric priority first;
2. profile ID as tie-breaker.

For each profile the registry checks the exact qualification.

If the highest-priority profile is blocked or lacks evidence, resolution can
continue to a lower-priority profile with valid evidence.

If no profile qualifies:

```text
profileId = undefined
options   = undefined
evidence  = none
```

No aggressive default is silently applied.

## Plan output

A successful profile plan includes:

- exact provider;
- exact model;
- workload ID;
- profile ID;
- profile digest;
- qualified optimizer options;
- prior blocked-profile diagnostics;
- `evidence = verified`.

Every plan also states:

```text
optimizerExecuted     = false
providerCallExecuted  = false
executionAuthorized   = false
```

A profile plan is still planning data.

## Relationship to Context Optimizer

Current intended flow:

```text
benchmark suite
      ↓
Claim Gate
      ↓
Profile Qualification
      ↓
Profile Registry
      ↓
qualified profile options
      ↓
separate host/orchestrator integration
      ↓
Context Optimizer
```

This track intentionally does **not** modify `optimizeContext()` or
`prepareFuryTask()`.

That integration should happen only after this qualification contract is proven
by CI and reviewed for precedence rules between:

- explicit caller options;
- profile options;
- security policy;
- provider-specific requirements.

## Relationship to Model Adapter qualification

The Model Adapter Registry and Context Optimizer Profile Registry solve related
but separate problems.

Model Adapter:

```text
provider/model-specific prompt guidance
```

Context Optimizer Profile:

```text
measured context selection budgets and thresholds
```

Neither qualification authorizes provider execution.

Neither qualification authorizes tools or secrets.

## Non-goals

V1 does not:

- execute a benchmark;
- contact a provider;
- run Context Optimizer;
- modify Task Orchestrator;
- auto-apply a profile;
- infer workload IDs;
- enable secrets;
- sign benchmark artifacts;
- establish statistical significance;
- generalize evidence across providers/models/workloads;
- publish performance claims.

These boundaries keep token optimization evidence-driven without turning
benchmark metadata into execution authority.
