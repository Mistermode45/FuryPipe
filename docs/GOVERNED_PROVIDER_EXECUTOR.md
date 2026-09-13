# Governed Provider Request Executor

## Scope and boundary

This track adds a local, host-governed boundary between an exact
`Provider Attempt Context Runtime Result` and one injected provider transport.
It does not add an HTTP client, provider SDK, credential store, retry loop, or
automatic failover. Tests use only local fake transports.

The path is:

```text
generated Context Runtime result
  -> immutable request envelope
  -> Provider Runtime eligibility + explicit host policy
  -> process-local single-use permit
  -> exact registered transport, once
  -> bounded transport-reported result
```

Each stage is distinct: `prepared != authorized != transport invoked != network
verified != provider accepted`. Provider selection, model qualification,
benchmark evidence and provider registration do not grant execution authority.

## Request envelope

`prepareProviderRequestEnvelope()` accepts only a Context Runtime result emitted
in the current process. `isGeneratedProviderAttemptContextResult()` uses
process-local `WeakSet` provenance; shallow copies, JSON round-trips and
hand-built lookalikes are rejected. This provenance is neither signed nor
portable across processes.

The envelope copies the exact `providerId`, `model` and `workloadId` from that
result. It compiles `result.prompt` using FuryPipe's canonical
`compileFuryPrompt()` path and stores the resulting final text, prompt digest,
source digest and UTF-8 byte length. It never substitutes the planner prompt,
task-level prompt or an earlier attempt. The envelope is frozen and process-
local, and contains no separate credential, header, provider-secret or
arbitrary-metadata fields. The prompt is the exact host-prepared payload and
may itself contain sensitive user content; the host remains responsible for
authorizing that content for the selected provider.

`requestDigest` is SHA-256 over the fixed-order JSON projection of exact
provider ID, model, workload ID, protocol and final compiled prompt, preceded
by the `furypipe-provider-request/v1` domain separator. Thus a change to any
execution-scope identity or prompt bytes changes the digest; input object key
insertion order is not part of the projection.

The request-preparation registry resolves protocol only. It does not establish
availability or authorize execution.

## Provider Runtime eligibility

Before issuing a permit, `createProviderExecutionGate()` reads the canonical
provider definition and calls `ProviderRuntimeState.selectFallback()` with one
candidate: the request's exact provider/model pair. This reuses the existing
health and model-family checks without selecting or executing another
provider. Eligibility requires registered exact provider identity, fresh
health evidence, `available`, a supported exact model and compatible model
family. Unknown, stale, unavailable, unsupported and mismatched states fail
closed.

## Host policy and permits

No policy means deny. A policy must explicitly set
`allowProviderRequest: true`, exact provider/model/workload IDs, a bounded
`policyId`, and an explicit `expiresInMs` from 1 through 60,000 milliseconds.
Unknown fields, missing fields, false authority, malformed scope and invalid
lifetime are denied. This API treats the policy object as host authority; it is
not a principal-authentication system or a cryptographic signature.

An issued permit is frozen and bound to the policy ID, exact scope and request
digest, with issue and expiry timestamps. Internal state is stored in a
process-local `WeakMap`; a hand-built or serialized permit is invalid. The
permit cannot be persisted or transferred between processes. At execution,
`now <= expiresAt` is valid; `now > expiresAt` is expired. A clock can be
injected for deterministic boundary tests. Permit expiry is clamped to the
health evidence expiry, so an authorization cannot outlive the evidence that
made the provider eligible.

Before any `await` or transport callback, the executor checks the exact permit
binding and synchronously marks it consumed. Concurrent reuse has one winner;
all later calls fail with `permit-already-consumed`. Transport failure does not
restore the permit.

## Exact transport registry and credentials

`createProviderTransportRegistry()` snapshots at most 32 host-supplied
transports. Provider IDs must be canonical lowercase identifiers, unique, and
exactly matched. Protocol is one of `openai`, `anthropic` or `google`.
Whitespace/case aliases, prefix matching, duplicate IDs, unknown fields and
unknown protocols are not accepted. Changes to the original registration
object after registration do not replace the captured callback or identity.

The envelope passed to a transport has no credential material. Credentials,
HTTP clients, SDKs, base URLs and proxies remain entirely in the host-owned
transport closure. FuryPipe neither inspects nor serializes those values.

The executor calls exactly one transport for the permit's provider. It does
not retry, back off, switch model/provider, or fallback. A retry/fallback must
create a new attempt from the model-neutral prompt through planner, adapter,
Context Runtime, request envelope and a newly authorized permit.

## Result evidence and bounds

Transport output is treated as untrusted data. The contract rejects unknown
fields, identity mismatches, invalid status values, unsafe token counts and
malformed values. Optional fields remain absent when not reported; missing
usage is not rewritten to zero. A response body, if supplied, must be a
`Uint8Array` no larger than 1 MiB and is copied before being returned.
The transport execution context carries this same 1 MiB limit so a future
streaming transport can stop reading before buffering an oversized body; the
executor still validates the returned byte count independently.

FuryPipe reports two independent evidence dimensions:

| Dimension | Missing transport report | Explicit transport report |
| --- | --- | --- |
| Network call | `unknown`, `not-reported` | `executed` / `not-executed` / `unknown`, `transport-reported` |
| Provider request | `unknown`, `not-reported` | `accepted` / `rejected` / `unknown`, `transport-reported` |

These values are never labeled `verified`. `transportInvoked: true` means only
that the registered callback began. It does not prove a network packet was
sent, that the provider received a request, or that a response was authentic.
Transport errors and invalid/oversized results are returned as stable,
non-sensitive `FuryGovernedProviderExecutorError` codes. Original thrown error
text is not attached to the public error.

## Usage and cost

Reported token counts must be non-negative safe integers. Partial usage remains
partial. A cost estimate is attempted only when input, output, cache-write and
cache-read counts are all explicitly present, using
`ProviderRuntimeState.estimateCost()` for the exact provider/model. If usage is
incomplete, an exact price is absent, or the runtime cannot price the exact
model, the result is `COST_UNKNOWN`; missing price or usage is never represented
as `$0` or zero tokens.

## State model and error outcomes

```text
PREPARED -> POLICY_APPROVED -> PERMIT_ISSUED -> PERMIT_CONSUMED
          -> TRANSPORT_INVOKED -> TRANSPORT_RESULT
```

Preparation, policy denial, missing/stale health, permit expiry, replay,
request mismatch, missing/mismatched transport, transport exceptions and
invalid results remain distinct outcomes. An error before callback entry has
`transportInvoked: false`; callback and result-processing errors after entry
have `transportInvoked: true`.

## Package and production boundary

These source modules are not added to the npm public export map in this track;
packaging/public API wiring is reserved for its separate integration work.
No built-in OpenAI, Anthropic or Google transport is included. No real provider
request, paid API, npm publication, release, tag, merge or deployment is part
of this implementation.
