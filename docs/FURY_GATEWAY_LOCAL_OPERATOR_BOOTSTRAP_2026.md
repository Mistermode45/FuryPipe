# Fury Gateway Local Operator Browser Bootstrap (VNext Phase 1.4B, 2026)

## Status

Phase 1.4B adds the first browser-safe authentication bridge for the local Fury Gateway.

It does **not** trust loopback merely because a request originates from localhost.

The flow is:

```text
trusted local operator session
→ one-time bootstrap ticket
→ bounded local HTTP redemption
→ short-lived HttpOnly browser cookie
→ exact-Origin WebSocket resolution
→ existing Gateway session
```

No new execution authority is introduced.

## Core authority separation

```text
localhost
!= authenticated user

bootstrap ticket
!= authenticated browser session

browser cookie
!= command scope

WebSocket connected
!= command authorized

command eligible
!= execution permit

executed
!= verified
```

## 1. Prerequisite authority

The bootstrap manager requires an already-active FuryPipe session with:

```text
role = operator
binding.kind = local-operator
```

The bootstrap layer does not create or infer principal identity.

Principal/session authority remains owned by the Phase 1.2 runtime.

## 2. One-time bootstrap ticket

A trusted local caller may issue a one-time bootstrap ticket.

Ticket properties:

- 256 random bits;
- Base64URL encoding;
- default TTL: 60 seconds;
- configurable TTL: 10 seconds to 5 minutes;
- bounded pending-ticket registry;
- single use;
- process-local registry;
- only SHA-256 digest retained by the manager.

The raw ticket is returned once to the trusted caller.

It must never be:

- logged;
- persisted;
- included in a URL;
- included in query parameters;
- included in telemetry.

A serialized copy of the ticket is still secret-bearing data and must be handled as a credential.

## 3. HTTP redemption endpoint

Local redemption endpoint:

```text
POST /gateway/local-bootstrap/v1
```

Required controls:

- loopback source address;
- exact allowlisted HTTP(S) Origin;
- POST only;
- no query string;
- `Content-Type: application/json`;
- bounded request body;
- exact JSON schema;
- valid unexpired one-time ticket.

Request body:

```json
{
  "format": "furypipe-gateway-local-bootstrap/v1",
  "code": "<one-time-secret>"
}
```

The code is consumed only after network/Origin/request-shape gates pass.

A wrong Origin therefore cannot burn a valid ticket.

## 4. Request-body limits

Default maximum body:

```text
2 KiB
```

Configurable:

```text
256 bytes .. 16 KiB
```

If `Content-Length` already exceeds the bound, the request body is drained without buffering.

Chunked bodies are counted while streaming and rejected if the cumulative size exceeds the limit.

## 5. Browser session cookie

Successful redemption creates a new random browser bearer token.

Only its SHA-256 digest is retained.

Default browser-session TTL:

```text
15 minutes
```

Configurable:

```text
30 seconds .. 60 minutes
```

Actual expiry is additionally capped by the underlying Gateway session expiry.

Cookie:

```text
furypipe_gateway_local=<opaque random token>
HttpOnly
SameSite=Strict
Path=/gateway/
Max-Age=<bounded>
```

The cookie is intentionally **not** named with the `__Host-` prefix in this local HTTP phase because that prefix requires `Secure`.

The cookie is valid only for loopback-local transport.

A future HTTPS/WSS remote-capable surface must use a Secure cookie contract and cannot reuse this local-only policy unchanged.

## 6. Why no Secure cookie yet

Phase 1.4B remains strictly loopback HTTP/WS.

The host still forbids non-loopback binds.

Therefore this phase does not pretend that a local HTTP cookie is suitable for remote transport.

```text
local cookie
!= remote credential
```

Remote WSS/TLS support requires a separate security track.

## 7. SameSite and Origin

The cookie uses:

```text
SameSite=Strict
```

Every bootstrap, logout and WebSocket resolution additionally requires an exact allowlisted Origin.

Wildcard Origins remain forbidden.

Browser session records are bound to the Origin used during redemption.

A cookie presented from another Origin does not resolve a Gateway session.

## 8. Same-origin Control Plane expectation

The production WebChat/Control Plane should be served from the same local site as the Gateway bootstrap surface.

Phase 1.4B does not add permissive CORS.

This is deliberate.

A separate localhost development server must not become a production cross-origin trust shortcut.

## 9. No URL credentials

Both bootstrap and logout reject query strings.

The host already rejects WebSocket query strings.

Therefore:

```text
ticket in URL = rejected
cookie in URL = unsupported
session ID in URL = unsupported
```

This reduces leakage through:

- browser history;
- referrers;
- reverse-proxy logs;
- screenshots;
- diagnostics.

## 10. Browser-session registry

The browser-token registry is:

- process-local;
- bounded;
- digest-only;
- TTL-governed;
- tied to one underlying Gateway session;
- tied to one exact Origin.

Default capacity:

```text
16 browser sessions
```

Hard maximum:

```text
256
```

Expired entries and entries backed by inactive Gateway sessions are garbage-collected.

## 11. Duplicate cookie handling

If more than one `furypipe_gateway_local` cookie is presented, the request fails closed.

The resolver never “chooses the first” or “chooses the last”.

This prevents ambiguous cookie parsing from becoming an authentication decision.

## 12. Logout

Local logout endpoint:

```text
POST /gateway/local-logout/v1
```

Controls:

- loopback only;
- exact Origin;
- POST only;
- no query string;
- Origin must match the browser-session record.

Logout:

1. deletes the matching digest entry;
2. returns a clearing cookie;
3. uses `Max-Age=0`;
4. does not expose token/session identifiers in the response body.

## 13. Session revocation

Every browser resolution rechecks the underlying process-local Gateway session.

Therefore:

```text
Gateway session revoked/expired
→ browser cookie no longer resolves
→ future WebSocket upgrade denied
```

Cookie TTL alone is never authority.

## 14. HTTP host composition

Phase 1.4B adds an internal optional HTTP request hook to the existing loopback WebSocket host.

The hook does not change default behavior.

Without a handler:

```text
HTTP request → 404 no-store
```

With a handler:

- the handler must explicitly claim the request;
- returning `false` falls back to 404;
- handler exceptions fail closed with an empty 500 response;
- error bodies do not contain secrets.

The long-lived Gateway daemon can pass this internal handler through to the WebSocket host.

## 15. Safe response headers

Bootstrap HTTP responses include defensive metadata such as:

- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`.

Successful redemption returns no body.

## 16. Explicitly NOT implemented

- no username/password login;
- no OAuth/OIDC browser login;
- no remote bind;
- no HTTPS/WSS certificate management;
- no persistent cookie/session database;
- no refresh token;
- no long-lived browser bearer;
- no token in URL/query;
- no permissive CORS;
- no automatic command scope elevation;
- no agent execution;
- no shell/browser/MCP execution in bootstrap callbacks.

## 17. Public package surface

The raw bootstrap manager remains internal:

```text
gateway-local-operator-bootstrap-node
```

It is not an npm package export.

The stable public Gateway contract remains:

```text
furypipe/gateway
```

A high-level local Control Plane/CLI bootstrap will wrap this manager only after exact-head validation.

## 18. Required validation

The E2E suite proves:

- one-time ticket redemption;
- ticket replay rejection;
- wrong Origin rejection before ticket consumption;
- query-string rejection;
- strict content type/body/schema limits;
- ticket expiry;
- browser-cookie expiry;
- underlying session revocation;
- HttpOnly/SameSite/Path/Max-Age attributes;
- real WebSocket connection using the cookie;
- duplicate-cookie fail-closed behavior;
- logout invalidation;
- ticket/browser-session quotas;
- bulk browser-session revocation;
- composition through the long-lived Gateway daemon;
- no raw session/principal identifier in WebSocket hello;
- no execution authority introduced.

No merge, release, tag, publish or deploy.
