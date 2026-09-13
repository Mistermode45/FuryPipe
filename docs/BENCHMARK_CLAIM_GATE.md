# FuryPipe Benchmark Claim Gate

## Purpose

The Benchmark Claim Gate is the release-facing safety layer above the existing
`bench/v5` repeated-suite contract.

The repeated suite answers:

> Is this set of executed benchmark runs comparable and complete enough to
> inspect as measured evidence?

The Claim Gate answers a stricter question:

> Can FuryPipe describe an improvement for one exact measured metric without
> hiding a quality regression or missing evidence?

These are deliberately separate contracts.

## Pipeline

```text
executed benchmark runs
        ↓
bench/v5 result validation
        ↓
repeated comparable suite
        ↓
CLAIM_ELIGIBLE / METRICS_ONLY
        ↓
Benchmark Anti-Regression Gate
        ↓
metric-specific Claim Gate
        ↓
scoped descriptive claim eligibility
```

The gate performs no provider call and grants no execution authority.

## Why a second gate exists

`bench/v5/suite.mjs` requires:

- comparable provider/model/fixture/prompt/toolset/context/cache state;
- equal repetition counts;
- a minimum number of repetitions;
- passing exactness;
- zero benchmark errors;
- scored quality.

That is necessary but not sufficient for a performance claim.

A suite can contain fully scored quality evidence while FuryPipe's quality is
lower than RAW or pxpipe. An efficiency-only statement based on that suite can
therefore hide a regression.

The Anti-Regression Gate closes that gap.

## Anti-Regression Gate

`assessBenchmarkAntiRegression()` validates the suite artifact again and
requires all of the following:

- suite schema is `furypipe-benchmark-suite/v1`;
- `comparability = VERIFIED`;
- `claim_status = CLAIM_ELIGIBLE`;
- the suite reports no claim blockers;
- repetitions meet the suite's declared minimum;
- every variant has complete quality observations;
- FuryPipe median quality is not below RAW;
- FuryPipe median quality is not below pxpipe;
- every comparable run has passing exactness;
- exactness mismatch count is zero;
- benchmark error count is zero.

The result is either:

```text
PASS
BLOCKED
```

A PASS is not proof that FuryPipe is generally superior. It means only that the
provided exact-scope suite satisfies this local non-regression contract.

## Metric-specific Claim Gate

`evaluateBenchmarkClaim()` requires the caller to specify:

- baseline: `raw` or `pxpipe`;
- exact metric;
- explicit direction: `LOWER_IS_BETTER` or `HIGHER_IS_BETTER`;
- optional minimum absolute improvement;
- optional minimum relative improvement ratio.

FuryPipe does not infer whether a metric should be minimized or maximized.

For example, fewer input tokens can be evaluated with:

```ts
evaluateBenchmarkClaim({
  suite,
  baseline: 'raw',
  metric: 'input_tokens',
  direction: 'LOWER_IS_BETTER',
  minimumRelativeImprovementRatio: 0.10,
});
```

The selected metric must be present for every repetition for both the baseline
and FuryPipe.

A median that is equal or worse is blocked.

If the caller requests a relative threshold and the baseline median is zero,
the gate fails closed because a meaningful relative ratio is unavailable.

## Scope binding

Every decision preserves the exact benchmark scope:

- provider;
- model;
- fixture digest;
- prompt digest;
- toolset digest;
- context digest;
- cache state;
- repetitions per variant.

A decision for one scope must not be generalized to another model, provider,
fixture, prompt, toolset, context, or cache state.

## Structured output

A claim decision includes:

- selected baseline;
- FuryPipe as the candidate;
- metric and direction;
- baseline median;
- FuryPipe median;
- measured delta;
- measured improvement;
- measured improvement ratio when defined;
- threshold values;
- full anti-regression decision;
- explicit blocker codes;
- exact evidence scope;
- fixed limitations.

Every result states:

```text
providerCallExecuted = false
executionAuthorized = false
```

## Fixed limitations

Even a `CLAIM_ELIGIBLE` decision always carries:

```text
DESCRIPTIVE_ONLY
NO_STATISTICAL_SIGNIFICANCE_CLAIM
NO_CAUSALITY_CLAIM
NO_CROSS_SCOPE_GENERALIZATION
```

The gate does not establish statistical significance.

It does not establish causality.

It does not prove FuryPipe is generally better.

It only permits a bounded description of the exact measured comparison.

## Fail-closed validation

The TypeScript gate does not blindly trust a JSON object that merely says
`CLAIM_ELIGIBLE`.

It revalidates:

- suite format;
- comparability;
- bounded text identities;
- SHA-256 evidence identities;
- repetition counts;
- `known + missing` consistency;
- summary presence;
- min/max/mean/median/p95 consistency;
- quality scores within `[0, 1]`;
- exactness totals;
- error totals.

Malformed evidence throws instead of being converted into a positive decision.

## Relationship to Model Adapters

The Model Adapter Registry has its own exact provider/model/workload
qualification contract.

The Benchmark Claim Gate does not activate model adapters.

A public performance claim and runtime model-adapter eligibility are separate
decisions with separate scopes.

## Current boundary

This module is an internal TypeScript primitive in this track.

It does not:

- execute benchmarks;
- contact providers;
- publish marketing copy;
- publish npm packages;
- create releases;
- modify runtime routing;
- authorize model adapters;
- authorize tools or capabilities.

Public package export, release reporting, and UI surfaces should be separate
tracks after this contract is proven by CI.
