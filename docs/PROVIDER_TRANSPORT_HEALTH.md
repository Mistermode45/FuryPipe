# Provider Transport Health Observation

## Purpose

This layer converts a completed governed provider transport result into conservative,
metadata-only provider-health evidence. It does **not** perform a provider request,
probe, retry, fallback, credential lookup, or hidden network call.

The distinction is deliberate:

- a transport result is `transport-result` evidence;
- it is **not** renamed to `live-probe`;
- the assessment itself has process-local provenance;
- the source execution result remains `not-verified` unless another, stronger
  provenance mechanism proves it.

## Positive evidence

An assessment becomes `available` only when all of the following are present:

1. `network.status === executed` with `transport-reported` evidence;
2. `providerRequest.status === accepted` with `transport-reported` evidence;
3. an HTTP status in the 2xx range;
4. an explicit host freshness TTL.

Accepted results without an HTTP status stay `unknown`. A contradictory accepted
result with a non-2xx status also stays `unknown`.

## Negative evidence

Rejected HTTP results do not automatically mark a provider unavailable. The host
must explicitly supply exact rejection statuses in `unavailableHttpStatuses` and
an `unavailableTtlMs`.

This prevents FuryPipe from silently turning request-specific errors such as bad
credentials, malformed requests, quota policy, or model-specific failures into a
global provider outage.

`retryAfterMs` is preserved as metadata when present. It does not silently alter
the configured health TTL and does not schedule a retry.

## Promotion into Provider Runtime

`assessProviderTransportHealth()` creates a process-local assessment.

`applyProviderTransportHealthAssessment()` is a separate explicit mutation step.
It refuses forged/reconstructed assessment objects, ignores `unknown` conclusions,
and records known conclusions in `ProviderRuntimeState` as
`evidenceKind: transport-result`.

The local freshness ceiling is 15 minutes. The host must choose shorter TTLs when
appropriate.

## Non-goals and evidence limits

This feature is not:

- live-provider certification;
- proof of packet delivery;
- signed or persistent provenance;
- proof that a model generated a semantically correct response;
- automatic retry/fallback;
- a replacement for operator-config or dedicated live probes.

A real provider probe or production execution can still fail for host networking,
credentials, account state, quota, model policy, or provider incidents. FuryPipe
therefore keeps `transport-result`, `live-probe`, and `operator-config` distinct.
