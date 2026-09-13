# Governed Provider Streaming

## Scope

FuryPipe exposes a governed text-streaming path for the exact OpenAI, Anthropic
and Google provider identities already used by the provider runtime.

The streaming path is separate from the buffered `ProviderTransport` contract.
It does not change existing buffered execution semantics.

Public package surfaces:

```ts
import {
  createGovernedProviderStreamExecutor,
  createProviderStreamTransportRegistry,
} from 'furypipe/provider-streaming';

import {
  createOpenAIProviderStreamTransport,
  createAnthropicProviderStreamTransport,
  createGoogleProviderStreamTransport,
} from 'furypipe/provider-stream-transports';
```

The shared SSE runtime and provider-specific mappers remain private package
implementation details.

## Governance path

```text
model-neutral/provider-specific FuryPrompt pipeline
-> immutable Provider Request Envelope
-> exact Provider Execution Gate
-> short-lived process-local single-use Permit
-> Governed Provider Stream Executor
-> exact registered ProviderStreamTransport
-> fixed provider HTTPS endpoint
-> bounded SSE parser
-> normalized governed stream events
```

The permit is consumed synchronously before the first provider stream transport
callback can yield.

Streaming does not bypass Provider Runtime health, exact-model eligibility,
execution policy scope or request-digest binding.

## No retries, reconnects or fallback

This layer performs exactly one stream attempt.

It does not:

- retry a rejected HTTP request;
- reconnect an interrupted SSE stream;
- replay an ambiguous provider request;
- select another model;
- select another provider;
- sleep on `Retry-After`;
- call the retry/fallback orchestrator automatically.

A future streaming retry/fallback layer must preserve the same BASE-rebuild and
ambiguity rules as the existing governed retry/fallback orchestrator.

## Production endpoints

The transport implementations were checked against provider documentation on
2026-09-13.

| Provider | Endpoint | Stream switch |
| --- | --- | --- |
| OpenAI Responses | `POST https://api.openai.com/v1/responses` | `stream: true` |
| Anthropic Messages | `POST https://api.anthropic.com/v1/messages` | `stream: true` |
| Google Gemini Interactions | `POST https://generativelanguage.googleapis.com/v1/interactions?alt=sse` | `stream: true` |

The Google source tree continues to use stable `v1`, matching the existing
buffered production transport. The documented REST SSE selector `?alt=sse` is
required in addition to `stream: true`. No legacy `generateContent` stream is added.

Official source families consulted:

- OpenAI Responses streaming API reference;
- Anthropic Messages streaming documentation and event reference;
- Google Gemini Interactions streaming documentation and May 2026 event-name migration.

Provider documentation is time-sensitive and must be rechecked before changing
request/event behavior.

## User-visible text policy

FuryPipe exposes only assistant-facing text deltas.

### OpenAI

User-visible:

- `response.output_text.delta`;
- `response.refusal.delta`.

Not promoted to text:

- reasoning events;
- tool-call events;
- shell events;
- computer-use events;
- unknown/future event payloads.

### Anthropic

User-visible:

- `content_block_delta` with `delta.type == text_delta`.

Not promoted to text:

- `thinking_delta`;
- `signature_delta`;
- `input_json_delta`;
- tool-use payloads;
- server-side tool payloads;
- citations payloads;
- future unknown events.

Anthropic explicitly documents that new event types may be added. FuryPipe
therefore preserves only the safe event type as metadata for unknown events and
drops their untrusted payload.

### Google Gemini

User-visible text requires both:

```text
step.start.step.type == model_output
AND
step.delta.delta.type == text
```

Text-shaped deltas emitted from a `thought`, `function_call`, agent,
server-tool, image or other step are not promoted to assistant text.

Thought signatures, thought summaries, function arguments, image chunks and
tool payloads remain opaque.

## Event model

A normalized governed event contains:

- monotonically increasing local sequence number;
- exact provider/model/workload/request digest;
- normalized event kind;
- safe provider event type;
- optional user-visible text;
- optional bounded token usage categories;
- optional safe finish reason;
- optional terminal status;
- optional safe provider error code;
- evidence label `transport-reported`.

Event kinds:

- `text-delta`;
- `usage`;
- `terminal`;
- `provider-error`;
- `provider-event`.

`provider-event` contains metadata only. The provider payload is deliberately
not copied.

## Terminal semantics

An HTTP 2xx response only establishes an HTTP-accepted stream session according
to transport-reported evidence.

It does not prove successful generation completion.

An accepted stream must end with one of:

- an explicit normalized `terminal` event;
- an explicit normalized `provider-error` event.

If the SSE source ends after text or metadata without a terminal provider event,
iteration fails with:

```text
stream-interrupted
```

FuryPipe does not silently upgrade an EOF to success.

Provider terminal statuses are:

- `completed`;
- `incomplete`;
- `failed`;
- `cancelled`;
- `requires-action`;
- `unknown`.

## HTTP rejection

A non-2xx response:

- is reported as network `executed`;
- is reported as provider request `rejected`;
- may expose bounded `Retry-After` metadata;
- cancels/discards the rejection body;
- returns zero stream events;
- never retries automatically.

Rejected response text is never copied into FuryPipe stream events.

## Evidence boundaries

```text
transport callback invoked != provider network verified
HTTP 2xx != generation completed
stream session accepted != terminal completion
text delta received != final answer complete
provider event reported != independently verified
provider usage reported != independently verified billing
process-local provenance != signed provenance
process-local provenance != durable provenance
```

All network/provider status remains `transport-reported` or `not-reported`.

## Process-local provenance

Generated stream sessions and governed events are tracked with process-local
object identity.

`isGeneratedGovernedProviderStreamSession()` and
`isGeneratedGovernedProviderStreamEvent()` deliberately fail for serialized,
copied or `structuredClone` values.

No claim of persistent/signed provenance is made.

## Bounds

Streaming is incrementally parsed and bounded.

Current local FuryPipe policy:

- maximum SSE frame: 256 KiB;
- maximum cumulative user-visible text: 8 MiB;
- maximum cumulative SSE wire bytes: 16 MiB;
- maximum provider transport registrations: existing provider transport bound;
- retry delay metadata: maximum seven days, matching buffered HTTP transport policy.

These are FuryPipe safety limits, not provider model capability claims.

The parser does not buffer the complete SSE stream in memory.

## Timeout and cancellation

The existing provider HTTP `timeoutMs` option is used as a stream inactivity
timeout.

It is armed while opening the provider request and rearmed before each stream
read. An inactive stream is aborted.

A host `AbortSignal` propagates to the provider fetch.

Cancellation after the provider callback has been invoked does not prove the
provider performed no work.

## Credential handling

Credentials:

- come only from the host `getCredential()` callback;
- are resolved once per stream attempt;
- are placed only in the fixed provider authentication header;
- never enter the Provider Request Envelope;
- never enter governed stream metadata;
- never enter safe error messages.

If an exposed provider text/metadata field contains the active credential
literally, streaming fails closed instead of returning that field.

## Token usage and cost

Usage categories remain optional:

- `inputTokens`;
- `outputTokens`;
- `cacheWriteTokens`;
- `cacheReadTokens`.

Missing provider categories stay absent. They are never converted to zero.

The stream executor carries forward explicitly reported categories and computes
an exact provider cost only when all four categories required by the existing
cost oracle are present.

Otherwise cost remains explicit `unknown`.

In particular, the current Gemini Interactions usage schema does not establish
a cache-write token category, so FuryPipe does not synthesize one.

## Offline conformance

CI uses injected fake `fetch` streams.

Coverage includes:

- fixed endpoints;
- exact provider/model/prompt forwarding;
- provider authentication headers;
- required streaming request fields;
- redirect rejection;
- OpenAI output text vs reasoning filtering;
- Anthropic text vs thinking/signature/tool filtering;
- Gemini model-output text vs thought/function filtering;
- terminal-event enforcement;
- unknown-event payload suppression;
- HTTP rejection and Retry-After;
- non-SSE 2xx rejection;
- credential leak prevention;
- frame-size enforcement;
- single-use permit consumption;
- process-local provenance.

No provider credential, paid request or live network call is used in CI.

A green suite is evidence for FuryPipe's local implementation only. It is not a
live-provider certification.
