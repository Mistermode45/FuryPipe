# Governed Provider Retry / Fallback Orchestrator

## Purpose

The Provider Retry / Fallback Orchestrator is the FuryPipe layer that may sequence more than one governed provider attempt.

It sits **above** the single-attempt pipeline:

```text
Provider Attempt Planner
-> Context Runtime
-> Provider Request Envelope
-> Provider Execution Gate
-> single-use Permit
-> Governed Provider Executor
-> exact Provider Transport
```

The executor and provider transports remain single-attempt components. They do not retry, discover alternatives, sleep, or fall back.

## Absolute BASE reconstruction invariant

The orchestrator is constructed with the existing `FuryProviderAttemptPlannerInput`.

That planner captures one model-neutral BASE FuryPrompt. Every loop iteration independently calls `planner.plan()` for the exact provider/model/workload attempt.

Therefore every attempt is rebuilt as:

```text
captured BASE FuryPrompt
-> exact Model Adapter resolution
-> exact Context Optimizer Profile resolution
-> fresh Context Runtime execution
-> fresh Request Envelope
-> exact predeclared host Execution Policy
-> fresh single-use Permit
-> exact registered Transport
```

FuryPipe never feeds attempt N's adapted prompt, optimized context result, request envelope or permit into attempt N+1.

A repeated exact provider/model attempt may produce the same request digest when its rebuilt prompt is byte-identical. It is still a fresh request object with a distinct policy identity and a fresh permit.

## Explicit host sequence

The caller supplies an ordered list of 1–32 attempts.

Each attempt contains:

- exact `providerId`;
- exact `model`;
- complete `FuryProviderExecutionPolicy`.

Policies are validated before the first provider-capable operation:

- exact provider/model/workload must match the attempt;
- `expiresInMs` must remain inside the existing gate bound;
- policy IDs must be unique across the sequence.

Repeating the same exact provider/model is how a caller explicitly requests a retry.

Changing model and/or provider is an explicit fallback candidate.

FuryPipe never appends, discovers, reorders, aliases or fuzzily selects a candidate.

## Continuation policy

Listing a second attempt is necessary but **not sufficient** to continue after attempt #1.

The caller must also provide a bounded continuation policy:

```ts
{
  format: 'furypipe-provider-retry-fallback-continuation-policy/v1',
  retryOn: [...],
  fallbackOn: [...],
  retryHttpStatuses: [...],
  fallbackHttpStatuses: [...],
  allowCrossProviderFallback: boolean
}
```

This separates:

```text
candidate exists
!=
continuation is allowed
!=
candidate is execution-authorized
```

### Safe non-HTTP continuation reasons

Only these reasons may appear in `retryOn` / `fallbackOn`:

- `provider-not-registered`;
- `provider-health-not-fresh`;
- `provider-unavailable`;
- `model-not-supported`;
- `model-family-mismatch`;
- `transport-not-registered`;
- `network-not-executed`.

The first six are pre-transport eligibility/registration failures.

`network-not-executed` is accepted only when the governed transport explicitly reports that network execution did not occur and does not simultaneously report contradictory provider/HTTP evidence.

The following are deliberately **not continuable**:

- `transport-error`;
- `transport-result-invalid`;
- `response-too-large`;
- unknown network/provider outcome;
- contradictory transport evidence;
- permit integrity failures;
- execution policy denial.

Those outcomes may occur after a callback was invoked, so automatically retrying could duplicate provider work or cost.

## Exact HTTP allowlists

A transport-reported provider rejection can continue only when it contains an exact HTTP rejection status and that status is allowlisted for the actual transition.

Example:

```text
fallbackHttpStatuses = [429, 503]
```

allows an explicit fallback after 429/503, but does not turn 401/403 into fallback.

Likewise:

```text
retryHttpStatuses = [429, 503]
```

only applies when the next listed attempt is the same exact provider/model.

There is no generic `provider-rejected -> fallback` rule.

This prevents credential, authorization, account-policy or malformed-request failures from silently changing provider.

## Retry versus fallback

The transition is determined from the current and next explicit attempt:

- same provider + same model -> `retry`;
- different model and/or provider -> `fallback`.

If the provider changes, `allowCrossProviderFallback` must also be `true`.

A same-provider different-model transition is a fallback, not a retry.

## Retry-After

`retryAfterMs` remains transport/provider-reported metadata.

FuryPipe never sleeps or schedules a delayed retry.

When continuation would otherwise be allowed and the next attempt uses the **same provider**, a positive `retryAfterMs` stops immediate execution with:

```text
RETRY_DELAY_REQUIRED
```

This applies to:

- same provider + same model retry;
- same provider + different model fallback.

A different explicitly authorized provider may continue when its exact fallback status/reason is allowlisted.

The host may later start a new orchestration run after the delay. That later run is new authority, not an implicit continuation.

## Provider acceptance

The orchestrator returns `SUCCEEDED` only when:

```text
providerRequest.status == accepted
AND
providerRequest.evidence == transport-reported
```

It does not infer acceptance from:

- transport callback invocation;
- HTTP 2xx alone;
- network execution alone;
- presence of a response buffer;
- provider selection.

The successful `execution` object is the existing process-local `GovernedProviderExecutionResult`.

It may contain application response bytes. It is intentionally **not** a plaintext-free receipt.

The `attempts` metadata array remains body-free.

## Ambiguous-stop rule

After transport invocation, uncertainty is terminal.

Examples:

- transport throws;
- transport result is malformed;
- response exceeds the byte limit;
- network is executed but provider status is unknown;
- network/provider statuses are both unknown;
- transport reports `network=not-executed` while also reporting provider acceptance/rejection, request ID or HTTP response;
- transport reports accepted with non-2xx HTTP status;
- transport reports rejected with 2xx HTTP status.

The result is:

```text
AMBIGUOUS_STOP
```

No later attempt starts.

This is stricter than a generic retry library by design.

## Execution policy denial

Every attempt already contains its exact `FuryProviderExecutionPolicy`.

The existing Provider Execution Gate remains authoritative.

If a policy denies the request or does not match exact scope, orchestration returns `BLOCKED`.

Fallback is never interpreted as permission to bypass a denied provider request.

## Context snapshot

The context inventory is copied and structurally validated before the first network-capable operation.

Bounds remain aligned with Context Optimizer:

- max 4096 items;
- max four representations per item;
- max 256 KiB per representation;
- max 16 MiB total source representations.

Transport callbacks cannot mutate the caller's inventory to alter later fallback attempts.

Each provider attempt still runs Context Optimizer independently, so a qualified provider/profile may choose different representations from the same captured inventory.

## Cancellation

If the supplied `AbortSignal` is already aborted before the first attempt, FuryPipe returns:

```text
CANCELLED
attemptsProcessed = 0
transportInvocations = 0
```

If cancellation happens after transport invocation and no trustworthy provider outcome is returned, FuryPipe uses `AMBIGUOUS_STOP`, because local cancellation does not prove that the remote provider did no work.

If a transport returns an explicit rejection/non-execution and the signal becomes aborted before a next attempt, FuryPipe records the completed attempt and stops with `CANCELLED`.

## Result states

`FuryProviderRetryFallbackResult.outcome` is one of:

- `SUCCEEDED` — explicit transport-reported provider acceptance;
- `STOPPED` — a valid result/failure was not authorized by continuation policy;
- `EXHAUSTED` — no further listed attempt exists;
- `BLOCKED` — authority/integrity/preparation failure;
- `AMBIGUOUS_STOP` — transport may have executed but outcome is unsafe to retry;
- `RETRY_DELAY_REQUIRED` — continuation would be allowed, but same-provider Retry-After blocks immediate execution;
- `CANCELLED` — cancellation observed before a new provider attempt may begin.

## Metadata privacy

Each attempt record may include:

- index;
- provider/model/workload;
- stage;
- decision;
- request/prompt digests;
- model-adapter/profile IDs and states;
- sanitized executor error code;
- transport-reported network/provider status;
- HTTP status;
- retry delay.

It does **not** include:

- BASE prompt text;
- final provider prompt;
- context text;
- credentials;
- authorization headers;
- permit IDs;
- execution policy IDs;
- raw provider exceptions;
- response bytes.

Successful application response bytes live only in the top-level `execution` value.

## Process-local provenance

`isGeneratedProviderRetryFallbackResult()` is backed by process-local object identity.

A serialized or cloned result deliberately fails that check.

Therefore:

```text
process-local provenance != durable provenance
process-local provenance != signed provenance
transport-reported != independently verified
```

## Example

```ts
import {
  createProviderRetryFallbackOrchestrator,
} from 'furypipe/provider-retry-fallback-orchestrator';

const orchestrator = createProviderRetryFallbackOrchestrator({
  planner: {
    basePrompt,
    modelAdapters: {
      registry: modelAdapterRegistry,
      qualifications: modelAdapterQualifications,
    },
    contextProfiles: {
      registry: contextProfileRegistry,
      qualifications: contextProfileQualifications,
    },
  },
  providerRuntime,
  transports,
});

const result = await orchestrator.run({
  workloadId: 'coding',
  attempts: [
    {
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      policy: openAiPolicy,
    },
    {
      providerId: 'anthropic',
      model: 'claude-opus-5',
      policy: anthropicPolicy,
    },
  ],
  continuationPolicy: {
    format: 'furypipe-provider-retry-fallback-continuation-policy/v1',
    retryOn: [],
    fallbackOn: ['provider-unavailable', 'transport-not-registered'],
    retryHttpStatuses: [429, 503],
    fallbackHttpStatuses: [429, 503],
    allowCrossProviderFallback: true,
  },
  items: contextInventory,
});
```

Both execution policies must independently authorize their exact attempt.

## Evidence semantics

```text
attempt listed != attempt executed
candidate exists != continuation allowed
continuation allowed != execution authorized
transport invoked != network verified
network executed != provider accepted
HTTP 2xx != provider accepted unless the transport reports acceptance
transport-reported acceptance != independently verified acceptance
Retry-After metadata != delay executed
fallback selected != fallback executed
process-local provenance != durable/signed provenance
```

## No hidden automation

This module does not:

- call `setTimeout` or sleep;
- schedule future retries;
- perform provider discovery;
- invoke tools/MCP/subagents;
- change provider credentials;
- add provider SDKs;
- weaken provider health checks;
- weaken single-use permit semantics;
- write provider response bodies to audit receipts.

Future durable orchestration/audit layers must preserve these distinctions rather than infer stronger evidence.
