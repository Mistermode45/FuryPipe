# Provider Transport Conformance — Offline Contract Suite

## Purpose

This suite verifies the three production provider transports through the real
FuryPipe governed execution boundary while keeping CI fully offline.

It uses injected fake `fetch` implementations. Therefore it validates FuryPipe's
request construction, normalization and governance contracts, **not** the current
availability or behavior of external provider services.

## Covered providers

- OpenAI — fixed `POST https://api.openai.com/v1/responses`;
- Anthropic — fixed `POST https://api.anthropic.com/v1/messages`;
- Google Gemini — fixed `POST https://generativelanguage.googleapis.com/v1/interactions`.

The fixtures assert exact provider/model identity, exact final FuryPrompt forwarding,
authentication header placement, provider-specific body shape, bounded normalized
usage fields, request-ID semantics where documented, and transport evidence labels.

## Governance path

Each fixture uses the real local path:

```text
Provider Attempt Context Runtime
  -> Provider Request Envelope
  -> fresh Provider Runtime health
  -> explicit host execution policy
  -> process-local single-use permit
  -> Governed Provider Executor
  -> production ProviderTransport
  -> injected fake fetch
```

No test bypasses the execution gate to claim governed execution coverage.

## Retry and rejection contract

For every production transport, the suite verifies that an HTTP 503 with
`Retry-After`:

- performs exactly one HTTP request;
- is reported as network `executed` using transport-reported evidence;
- is reported as provider request `rejected`;
- preserves bounded `retryAfterMs` metadata;
- does **not** perform an automatic retry;
- does not return the rejected response body as successful response bytes.

This suite does not decide whether the host should retry or fall back. That policy
belongs above the Governed Provider Executor.

## Failure and malformed-response contract

Injected fetch failures are sanitized by the governed boundary and do not trigger a
second request. Successful HTTP responses containing malformed JSON remain
HTTP-accepted but do not gain invented usage, request IDs, finish reasons, or other
provider metadata.

## Evidence limits

A green conformance suite means the checked FuryPipe offline contracts passed for the
repository commit under test. It does **not** prove:

- external DNS/TLS/network reachability;
- provider uptime;
- credential validity;
- account/quota/model authorization;
- provider-side request acceptance in production;
- current pricing;
- latency or performance;
- token savings;
- response authenticity;
- persistent or signed provider provenance.

No real credential or paid request is used. `transport-reported` must not be relabeled
as independently `verified` evidence.
