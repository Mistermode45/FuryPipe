# Production Provider Transports

## Scope and verification

This source-level integration adds native `fetch` transports for the exact
OpenAI, Anthropic and Google provider IDs already accepted by the governed
executor. Each factory returns a `ProviderTransport` and is exercised both
directly with fake `fetch` and, for OpenAI, through the real request-envelope,
single-use permit, registry and executor path.

Official provider documentation was checked on **2026-09-13**. These links are
the source ledger for endpoint, authentication, API shape, usage, request IDs
and retry metadata:

| Provider | Official sources consulted |
| --- | --- |
| OpenAI | [Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create); [API authentication and response headers](https://developers.openai.com/api/reference/overview); [rate-limit headers and Retry-After](https://developers.openai.com/api/docs/guides/rate-limits) |
| Anthropic | [Messages create reference](https://platform.claude.com/docs/en/api/http/messages/create); [API authentication and required headers](https://platform.claude.com/docs/en/api/overview); [API versioning](https://platform.claude.com/docs/en/api/versioning); [usage and rate-limit details](https://platform.claude.com/docs/en/api/rate-limits); [errors and request IDs](https://platform.claude.com/docs/en/api/errors) |
| Google Gemini | [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview); [stable API versions and REST example](https://ai.google.dev/gemini-api/docs/api-versions); [Interactions schema and usage](https://ai.google.dev/api/interactions-api); [API-key guidance](https://ai.google.dev/gemini-api/docs/api-key); [rate-limit troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) |

The docs establish that OpenAI Responses uses `POST /v1/responses`; Anthropic
Messages uses `POST /v1/messages` with a required API-version header; and
Gemini Interactions is generally available and recommended for new projects,
with stable `v1` at `POST /v1/interactions`. The legacy Gemini
`generateContent` endpoint is not used here.

## Factories and host-owned settings

Source imports are available from `src/provider-transports/index.ts`:

```ts
import {
  createOpenAIProviderTransport,
  createAnthropicProviderTransport,
  createGoogleProviderTransport,
} from './provider-transports/index.js';
```

The returned transport can be passed to `createProviderTransportRegistry()`;
the governed executor remains responsible for exact request authorization and
single-use permit consumption. The package export map is intentionally
unchanged in this track, so these factories are not yet public package
subpaths.

All transports require a host-owned `getCredential()` callback. It is resolved
once per attempt (allowing host rotation), must return a non-empty string of at
most 8,192 characters without surrounding whitespace or control characters,
and is never included in a returned value or error. No environment variable,
credential store, arbitrary base URL, proxy, provider SDK, or extra runtime
dependency is introduced. Invalid credentials fail before `fetch`.

Other options:

- `fetchImpl` is an injectable native-fetch-compatible function; production
  defaults to `globalThis.fetch`.
- `timeoutMs` defaults to 60,000 and must be a positive safe integer no greater
  than 300,000. This is a FuryPipe local policy, not a provider recommendation.
- `maxOutputTokens` is optional for OpenAI and Google, required for Anthropic
  Messages, and if present must be an integer from 1 through 1,000,000. This is
  a generic validation ceiling, not a model capability table; the provider
  still validates the selected exact model's limit.
- `now` is optional and used only to interpret HTTP-date `Retry-After` values.

`execute(request, permit)` remains compatible. A third optional executor
argument, `{ signal?: AbortSignal }`, carries host cancellation to the
transport. Cancellation and timeout abort the request and surface as a safe
transport error, never as a fabricated HTTP rejection.

## Provider request and response mapping

### OpenAI

- Endpoint: `https://api.openai.com/v1/responses` (fixed constant).
- Auth: `Authorization: Bearer <credential>`; content type is JSON.
- Request: exact envelope `model` and `prompt` as `model` and `input`; always
  `store: false`; optional host-supplied `max_output_tokens`. No instructions,
  tools, conversation state, model aliasing, or hidden prompt are added.
- Request ID: only the documented `x-request-id` response header is mapped.
  The Response object's `id` is not treated as a request ID.
- Usage: `output_tokens` maps directly. `cached_tokens` and
  `cache_write_tokens` are read only from `usage.input_tokens_details` and
  remain absent when not reported. `inputTokens` is derived as
  `input_tokens - cached_tokens - cache_write_tokens` only when both cache
  counts are valid and their sum does not exceed the total. Otherwise that
  ambiguous input count is omitted rather than double-counted by FuryPipe's
  category-based cost estimator.
- Finish reason: only `incomplete_details.reason` is mapped; response lifecycle
  `status` is not relabeled as a finish reason.
- Retry metadata: generic `Retry-After` is preferred. For HTTP 429 only, when
  no valid generic value exists, the documented
  `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`, and
  `x-ratelimit-reset-project-tokens` duration values are parsed and the larger
  valid delay is reported.
- Privacy/deprecation: Responses currently stores generated responses by
  default for later retrieval; this adapter explicitly sends `store: false`.

### Anthropic

- Endpoint: `https://api.anthropic.com/v1/messages` (fixed constant).
- Auth: `Authorization: Bearer <credential>`; required
  `anthropic-version: 2023-06-01`; content type is JSON. The version is pinned
  and must be reviewed against Anthropic versioning docs when this transport is
  updated.
- Request: exact envelope `model` and `prompt` as one user message, plus
  required host-supplied `max_tokens`. No `system` or tools are added.
- Request ID: only the documented `request-id` response header is mapped; the
  Message object's `id` is not used.
- Usage: `input_tokens` maps to uncached `inputTokens`;
  `cache_creation_input_tokens`, `cache_read_input_tokens`, and
  `output_tokens` map to their matching optional categories. This follows the
  current Messages usage documentation, which distinguishes cached reads,
  cache creation and non-cached input. No absent count becomes zero.
- Finish reason: `stop_reason` only.
- Retry metadata: generic `retry-after` is parsed when present. Anthropic docs
  note that some spend-cap 429 responses omit that header; FuryPipe reports no
  delay in that case and does not infer one.

### Google Gemini

- API generation: stable Gemini Interactions `v1`, not legacy `generateContent`.
- Endpoint: `https://generativelanguage.googleapis.com/v1/interactions` (fixed
  constant).
- Auth: `x-goog-api-key: <credential>`; content type is JSON. The host must
  supply an appropriate current Gemini API auth key and manage it securely.
- Request: exact envelope `model` and `prompt` as `model` and `input`; always
  `store: false`; optional `generation_config.max_output_tokens`. No system
  instruction, tools, agent, or previous-interaction state is added.
- Request ID: no documented request-ID header was found in the consulted
  Interactions reference. The interaction object `id` is therefore omitted.
- Usage: when both are valid and `total_cached_tokens <= total_input_tokens`,
  `inputTokens` is `total_input_tokens - total_cached_tokens`; cached tokens
  map to `cacheReadTokens`; `total_output_tokens` maps to `outputTokens`.
  Otherwise ambiguous total input is omitted. The API does not expose a cache
  write field in the consulted usage schema, so none is synthesized.
- Finish reason: lifecycle `status` is not mapped to a finish reason.
- Retry metadata: generic `Retry-After` is parsed if a response contains it;
  the consulted Gemini docs recommend application-level backoff for 429/503
  but do not document a provider-specific retry header for this endpoint.

## Shared HTTP behavior and evidence semantics

- Each attempt performs at most one `POST`. There is no automatic retry,
  backoff, model rewrite, fallback provider, or SDK-internal retry.
- Redirects are rejected by native fetch (`redirect: 'error'`); endpoints are
  constants rather than caller-provided URLs.
- A returned HTTP response is reported as `networkStatus: executed`. HTTP
  2xx maps to `providerRequestStatus: accepted`; non-2xx maps to `rejected`.
  These are transport-reported HTTP semantics only, not proof of packet
  delivery, provider-side generation completion, response authenticity, or
  business success. A 2xx with malformed/empty JSON stays HTTP-accepted but has
  no normalized JSON metadata.
- DNS/TLS/socket/fetch failures, timeout, and host cancellation throw a
  sanitized transport error without the original error or cause. They are not
  converted into `rejected` HTTP results.
- Every response body is consumed with a `ReadableStream` reader and a running
  byte count. `Content-Length` greater than the exact 1 MiB execution-context
  ceiling is an early-abort hint, but the stream counter is authoritative.
  Exactly 1 MiB is allowed; one byte more aborts and cancels the body, returning
  `response-too-large`. The executor independently validates and snapshots
  successful response bytes.
- Successful HTTP bodies may be returned as bounded raw `Uint8Array` bytes.
  Non-2xx response bodies are consumed under the same bound but discarded;
  their text is never copied into the result. Invalid JSON on a success keeps
  bounded bytes but yields no parsed fields. A successful body containing the
  credential literally or after JSON string decoding fails closed and is not
  returned. Request-ID headers containing the credential are omitted.
- `httpStatus` is an integer from 100 through 599. `retryAfterMs` is an
  explicitly parsed, non-negative safe integer capped at seven days. Standard
  seconds and HTTP-date syntax are supported; invalid or out-of-bound values
  are omitted. OpenAI documented reset durations are parsed only as a 429
  fallback. These fields carry information only; they do not schedule work.
- The executor's existing v1 execution-receipt format is reserved by the
  adjacent track and does not persist `httpStatus` or `retryAfterMs`. This
  transport track does not alter that format.

## Tests and boundaries

The local fake-fetch suite covers exact endpoints, headers and request bodies;
provider response and usage mapping; documented request-ID behavior; generic
and OpenAI rate-limit metadata; rejected HTTP and network errors; malformed
JSON; credential isolation; timeout and host cancellation; timer cleanup;
early `Content-Length`; actual streamed-size enforcement; and the exact 1 MiB
boundary. Tests make no real provider calls and incur no provider charges.

This is source-level production transport code wired to the governed executor,
not a live-provider certification. Public package export wiring is deliberately
deferred to its separately reserved track. Real provider credentials, network
requests, cross-platform CI, deployed hosts, and production telemetry are not
validated here.
