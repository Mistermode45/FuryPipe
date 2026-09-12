# FuryPipe V5 benchmark harness

M17 compares three variants under an identical experiment contract:

1. `raw` — no FuryPipe/pxpipe transformation;
2. `pxpipe` — pinned upstream pxpipe;
3. `furypipe` — the FuryPipe commit under test.

The harness is intentionally strict: it refuses to compare results when the provider, model, fixture, prompt, toolset, context digest, or cache state differ.

## Status

The contract/harness is implemented. Hosted benchmark execution is still `BENCHMARK_NON_EXECUTED` until real provider runs are performed with explicit authorization and recorded evidence.

## Files

- `result.schema.json` — canonical result envelope.
- `contract.mjs` — validation and comparability rules.
- `compare.mjs` — RAW/pxpipe/FuryPipe comparison CLI.
- `self-test.mjs` — offline contract regression test.

## Required metrics

Each executed run records, when the provider exposes them:

- input/output tokens;
- cache read/write tokens;
- vision tokens;
- latency and TTFT;
- local transform duration;
- request/response bytes;
- USD cost or `null` when unknown;
- error count;
- quality score status;
- exactness status/mismatch count;
- Recovery handle/verification state.

Unknown values stay `null`; they are never inferred.

## Comparison

```bash
node bench/v5/compare.mjs raw.json pxpipe.json furypipe.json > comparison.json
```

The CLI fails closed if any run is invalid, non-executed, duplicated by variant, or not comparable.

A lower token count does not establish better quality. Publish quality, exactness, errors, and recovery evidence beside efficiency metrics, including cases where FuryPipe loses.


## Repeated suite / claim gate

A single comparable triplet is useful evidence, but it is not enough for a release performance claim.

`suite.mjs` accepts multiple executed result envelopes and enforces:

- exactly the same provider/model/fixture/prompt/toolset/context/cache state across the whole suite;
- unique `run_id` values;
- equal repetition counts for raw, pxpipe and FuryPipe;
- at least 5 comparable repetitions per variant by default (configurable in the library from 3 to 100);
- passing exactness evidence for every run;
- zero benchmark errors;
- scored quality for every run.

The output reports descriptive min/max/mean/median/p95 per metric and variant. Missing provider metrics remain missing; no value is inferred.

`claim_status: CLAIM_ELIGIBLE` means only that the local evidence contract is complete enough to discuss the measured comparison. It **does not** establish statistical significance, causality, general superiority, or a valid claim across other models/providers/workloads.

If repetition, exactness, error, or quality evidence is incomplete, the suite returns `METRICS_ONLY` with explicit blockers.

Example:

```bash
node bench/v5/suite.mjs runs/*.json > suite.json
```

Hosted provider execution is still separate. GitHub CI runs only the offline contract self-test and must not be cited as a provider benchmark.
