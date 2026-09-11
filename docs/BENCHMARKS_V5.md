# M17 — Benchmark methodology

## Goal

Measure FuryPipe against both an unmodified request path (RAW) and the pinned pxpipe upstream without changing experimental conditions between variants.

Pinned pxpipe reference for this V5 programme:

`8ba82b713a1e823bc1c09b7a68e47f63caa7b426`

## Invariants

A comparison is invalid unless all three variants use the same:

- provider;
- model and model revision when observable;
- fixture and fixture SHA-256;
- prompt and prompt SHA-256;
- toolset and toolset SHA-256;
- context and context SHA-256;
- cache state;
- provider-facing configuration that can affect generation.

The machine-readable harness enforces the fields available in `bench/v5/result.schema.json`. Provider settings that cannot be normalized must be stored with the fixture/run evidence and treated as an external comparability gate.

## Variants

| Variant | Meaning |
|---|---|
| RAW | request bypasses pxpipe/FuryPipe transformations |
| pxpipe | pinned upstream commit |
| FuryPipe | exact FuryPipe commit recorded in the result |

No result may use a floating branch name as source evidence; the result contains a full 40-character commit SHA.

## Measurements

Record:

- input tokens;
- output tokens;
- cache read/write tokens;
- visual/vision tokens;
- latency;
- time to first token;
- local transform time;
- request/response bytes;
- cost when known;
- errors;
- quality;
- exactness;
- Recovery state.

`cost_usd: null` means cost is unknown. It must not be estimated silently.

## Quality and exactness

Efficiency alone cannot pass M17.

Quality must either be objectively scored by a fixture-specific scorer or explicitly remain `NOT_SCORED`. If a model judge is used later, its provider/model/prompt must be versioned as benchmark evidence.

Exact-value fixtures must run exactness checks. A transformation that saves tokens but corrupts a protected exact value is a failed benchmark for that fixture.

## Execution policy

Paid/provider runs require explicit authorization. Dry/offline tests may validate schemas, fixtures and scoring logic but cannot be reported as provider benchmark evidence.

Statuses remain distinct:

- `BENCHMARK_NON_EXECUTED`
- `EXECUTED`
- `INVALID`
- `FAILED`

No claim such as “500×”, “best”, or “faster” is permitted without stored comparable evidence.

## Reporting

Publish all comparable results, including regressions and cases where FuryPipe loses.

A comparison output is evidence only for its exact:

- commits;
- provider/model;
- fixtures;
- prompts;
- toolset;
- context;
- cache state.

It is not a universal performance claim.
