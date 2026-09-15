# Provider Attempt Adapter Planner

## Purpose

A model adapter belongs to one concrete provider attempt, not to a prepared
task. The task prompt must remain model-neutral until the caller has chosen an
exact provider and model. The planner then asks the existing Model Adapter
Registry to apply only an adapter with matching provider, model, workload,
digest, and FuryBench qualification evidence.

```text
FuryPreparedTask.furyPrompt (BASE)
        ↓
provider routing / availability and compatibility assessment
        ↓
selected provider attempt: exact provider + exact model + workload
        ↓
Provider Attempt Adapter Planner
        ↓
Model Adapter Registry and its existing qualification gates
        ↓
attempt-specific FuryPrompt
```

`prepareFuryTask()` intentionally remains model-neutral. `selectFallback()`
selects an eligible candidate using caller-supplied local evidence and returns
`networkCallExecuted: false`; it does not make a provider request. The adapter
planner is composed after a concrete candidate is selected. It does not
independently prove current provider availability.

## API and lifecycle

Create one planner from the original task-level `basePrompt`, the model adapter
registry, and the available qualifications:

```ts
const attemptPlanner = createProviderAttemptAdapterPlanner({
  basePrompt: preparedTask.furyPrompt,
  registry: modelAdapterRegistry,
  qualifications,
});

const attemptPlan = attemptPlanner.plan({
  providerId: selected.providerId,
  model: selected.model,
  workloadId,
});
```

The planner captures immutable snapshots of the base prompt, registry
definitions, and qualifications. Every call to `plan()` starts from a fresh
copy of that same base prompt. Its returned prompt is branded as
attempt-specific in TypeScript and cannot be supplied as a new planner's base
without an explicit unsafe cast.

## Fallback recomposition

Every fallback is planned independently from `BASE`:

```text
BASE
├─ Attempt OpenAI
│   └─ BASE + qualified OpenAI adapter (if any)
└─ Attempt Anthropic
    └─ BASE + qualified Anthropic adapter (if any)
```

The planner never accepts Attempt A's prompt as the input for Attempt B.
Therefore an OpenAI-specific instruction cannot accumulate into an Anthropic
fallback. If Attempt B has no qualified adapter, its prompt is the unchanged
base prompt, even if Attempt A had an adapter applied.

## Exact scope and qualification

The planner passes the attempt identity to `FuryModelAdapterRegistry.resolve()`
without prefix, family, alias, or semantic matching. Provider, model, and
workload identifiers must be bounded, printable, and unpadded. It does not
invent model-specific instructions.

The registry remains the only authority for adapter qualification. It enforces
the existing requirements, including exact provider/model/workload and adapter
digest, verified comparability, claim eligibility, at least five repetitions,
non-regressed quality, complete exactness, and zero benchmark errors. Its safe
sections and limits on additions remain in force. The planner also bounds its
snapshots to 256 adapter definitions and 256 qualification records, and validates
the base prompt with the canonical FuryPrompt compiler (8 MiB maximum).

`IDENTITY` means no adapter was applied; missing qualification alone stays
identity-only. `BLOCKED` means a matching adapter was rejected by a gate other
than a missing qualification. `APPLIED` means the registry selected a
qualified adapter. All registry block reasons remain in the result. A blocked
higher-priority adapter does not prevent the registry from selecting a lower
priority adapter with its own valid qualification.

## Authority and execution boundary

These are separate facts:

- adapter qualification **does not** establish provider availability;
- adapter qualification **does not** authorize execution;
- provider selection **does not** execute a provider;
- attempt planning **does not** make a network request;
- benchmark `verified` evidence **does not** mean the generated response is
  runtime-verified.

The plan always reports `networkCallExecuted: false` and
`providerRequestExecuted: false`. It does not assert `authorized`, `safe`,
`trusted`, or `providerAvailable`. Policy authorization, provider execution,
receipts, and result verification remain separate later boundaries.

## Testing and current wiring

`tests/provider-attempt-adapter.test.ts` covers identity behavior, exact
qualification, provider/model/workload mismatch, digest mismatch, fallback
contamination, missing fallback qualification, mutation isolation, and the
registry's unsafe-section and size bounds.

The module is a pure composition primitive. It is not wired into
`ProviderRuntimeState`, `Task Orchestrator`, or a provider executor. The host
that creates an actual provider attempt must call the planner with that
attempt's exact identity and use the returned prompt for that attempt only.

## Public package surface

The planner is available from the installed package through:

```ts
import { createProviderAttemptAdapterPlanner } from 'furypipe/provider-attempt-adapter';
```

The package smoke test validates this subpath from a packed and freshly
installed tarball. Public export does not add execution authority.
