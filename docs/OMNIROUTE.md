# OmniRoute adapter

## Status

`LOCAL_ADAPTER_IMPLEMENTED_EXTERNAL_RUNTIME_NOT_PROBED`

FuryPipe can use an existing OmniRoute instance as an explicit multi-protocol gateway for its Anthropic, OpenAI and Gemini-compatible routes.

No OmniRoute package, binary, provider credential or external service is installed automatically.

## Configuration

Local OmniRoute example:

```text
PXPIPE_PROVIDER=omniroute
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=<your OmniRoute API key>
furypipe
```

The port is intentionally not hard-coded by FuryPipe. Use the actual port/base URL of your OmniRoute instance.

Remote OmniRoute example:

```text
PXPIPE_PROVIDER=omniroute
OMNIROUTE_BASE_URL=https://gateway.example.com/v1
OMNIROUTE_API_KEY=<your OmniRoute API key>
furypipe
```

For compatibility, `PXPIPE_GATEWAY_BASE_URL` may be used instead of `OMNIROUTE_BASE_URL`, but the dedicated variable is preferred.

## URL security

The adapter accepts:

- an origin/root URL, such as `http://127.0.0.1:20128`;
- the same URL ending in `/v1`.

FuryPipe normalizes either form to the gateway root because it appends protocol paths itself.

The adapter rejects:

- URL credentials;
- query strings and fragments;
- arbitrary path prefixes other than root or `/v1`;
- protocols other than HTTP/HTTPS;
- remote plaintext HTTP.

Plain HTTP is allowed only for loopback addresses (`localhost`, `127.x.x.x`, `::1`). Remote gateways require HTTPS.

## Protocol mapping

One OmniRoute base is mapped to all three FuryPipe upstream families:

| FuryPipe family | OmniRoute surface |
|---|---|
| Anthropic | `/v1/messages` |
| Anthropic token counting | `/v1/messages/count_tokens` |
| OpenAI Chat Completions | `/v1/chat/completions` |
| OpenAI Responses | `/v1/responses` |
| Gemini | `/v1beta/models/...` |

This preserves FuryPipe's existing protocol-specific transforms instead of adding an OmniRoute-specific prompt format.

## Authentication

`OMNIROUTE_API_KEY` is converted to the outbound `Authorization: Bearer ...` header.

The dedicated key wins over credentials received from the caller. This prevents an inbound OpenAI/Anthropic credential from being disclosed to OmniRoute accidentally.

Generic gateway headers are allowed through `PXPIPE_GATEWAY_HEADERS`, but credential-bearing names such as `Authorization`, `Proxy-Authorization` and cookies are rejected by the OmniRoute adapter. Authentication has one explicit source.

The adapter inspection output reports only whether authentication is configured. It never returns the API key.

If the OmniRoute instance deliberately runs without required API-key authentication, `OMNIROUTE_API_KEY` can be omitted. FuryPipe then reports the adapter authentication state as `caller-or-disabled`; operators should verify the OmniRoute-side security policy before exposing that instance.

## Evidence boundary

The local adapter proves:

- URL normalization and remote HTTPS enforcement;
- multi-protocol upstream configuration;
- credential isolation;
- package/API wiring.

It does **not** prove:

- that a particular OmniRoute deployment is reachable;
- that any third-party provider behind OmniRoute is healthy;
- provider quotas/free tiers;
- provider pricing;
- hosted fallback behavior;
- end-to-end external latency or correctness.

Those require an explicitly authorized external runtime test and should feed Provider Runtime health/benchmark evidence rather than being inferred from adapter presence.
