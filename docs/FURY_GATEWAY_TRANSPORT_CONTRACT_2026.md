# Fury Gateway Transport Contract (VNext Phase 1.3a, 2026)

## Status

Phase 1.3a freezes FuryPipe's transport contract and transport-local governance **before** any real WebSocket listener is introduced.

This track adds:

- a public bounded JSON message envelope;
- loopback-first bind policy;
- explicit remote-mode requirements;
- exact browser Origin policy;
- process-local connection handles;
- connection quotas;
- inbound rate limiting;
- strict sequencing;
- duplicate message-ID protection;
- outbound queue backpressure;
- idle connection sweeping;
- draining/stopped lifecycle.

It deliberately does **not** add:

- a TCP/HTTP/WebSocket listener;
- a public remote port;
- a browser login endpoint;
- TLS certificate management;
- bearer-token parsing;
- command execution;
- provider/tool/MCP execution;
- automatic reconnect/replay;
- durable transport-session persistence.

## 1. Public message envelope

Public package surface:

```text
furypipe/gateway
```

Message format:

```text
furypipe-gateway-message/v1
```

Fields:

```text
format
protocolVersion
messageId
sequence
kind
type
sentAt
payload
```

Parser output additionally carries:

```text
authority = transport-data-only
```

Therefore:

```text
valid message
!= authenticated principal
!= active session
!= authorized command
!= execution
```

## 2. Message size and structure

Hard message limit:

```text
64 KiB UTF-8
```

Payload structure is additionally bounded:

- maximum depth: 16;
- maximum total nodes: 4096;
- maximum keys per object: 128;
- maximum array length: 256;
- maximum payload string: 16 KiB UTF-8;
- unsafe object keys such as `__proto__`, `prototype`, and `constructor` are rejected.

The byte limit is checked before JSON parsing.

## 3. Message kinds

Initial transport kinds:

```text
request
response
event
ack
ping
pong
error
```

The `type` field is a bounded namespaced identifier.

Transport does not infer authorization from either `kind` or `type`.

For example:

```text
kind=request
type=shell.run
```

is still only untrusted transport data until a higher-level command-admission boundary accepts it.

## 4. Sequence model

Each direction uses its own monotonically increasing sequence.

Inbound connection state begins at:

```text
expected sequence = 1
```

Rules:

- sequence lower than expected → stale/replay reject;
- sequence higher than expected → gap reject;
- accepted sequence advances exactly once.

Transport sequence prevents accidental frame replay/order confusion.

It is **not** an execution idempotency key.

```text
sequence accepted
!= side effect executed
```

## 5. Message IDs

Message IDs are bounded identifiers.

A connection keeps a bounded recent-ID set and rejects duplicates still in that set.

Message-ID deduplication is a transport hygiene mechanism only.

Durable side-effect deduplication remains governed by the existing execution/recovery layers.

## 6. Bind policy

Default:

```text
host = 127.0.0.1
remoteEnabled = false
secureTransport = none
```

Non-loopback binding while remote mode is disabled fails closed.

Remote mode requires one of:

```text
tls
authenticated-tunnel
```

Remote + `secureTransport=none` is rejected.

Phase 1.3a does not create a listener, so this policy is validated as configuration only.

## 7. Browser Origin policy

Browser clients require an exact allowlisted HTTP(S) Origin.

Rejected:

- wildcard origins;
- origin substring matching;
- paths;
- queries;
- fragments;
- credentials in Origin URLs.

Example:

```text
allowed:
https://console.example.com

rejected:
https://console.example.com.evil.test
https://*.example.com
https://console.example.com/path
```

Browser transports cannot claim `node` or `worker` roles.

## 8. Device transports

Non-browser device transport does not use browser Origin as an authority signal.

Supplying browser Origin metadata on a device transport is rejected to avoid confused-deputy behavior.

Device authentication and pairing still occur through the separate Phase 1.1 boundary.

## 9. Connection handles

A transport connection handle is process-local evidence.

```text
transport-connection-only
```

Copying or serializing the handle does not recreate its connection identity.

A transport connection is still not:

- authentication;
- pairing;
- principal identity;
- session authority;
- command permission.

## 10. Lifecycle

Internal lifecycle:

```text
starting
→ ready
→ draining
→ stopped
```

Also allowed:

```text
starting → draining
starting → stopped
ready → stopped
```

No transition back to `ready` after draining/stopped.

While draining:

- existing connection state may still settle;
- new connections are rejected.

The future real socket adapter will close/drain underlying sockets according to this coordinator.

## 11. Connection quotas

Default global connection limit:

```text
2048
```

Default per-role limits:

```text
operator = 64
node     = 1024
channel  = 256
worker   = 1024
```

Both global and per-role limits must pass.

## 12. Rate limiting

Default per-connection inbound limit:

```text
240 attempts / 60 seconds
```

The limiter counts transport attempts before sequence admission.

Therefore repeated invalid sequence attempts still consume rate budget.

Rate limiting does not grant or remove authorization; it is only a resource-protection boundary.

## 13. Backpressure

Default outbound queue limits:

```text
128 messages
1 MiB queued UTF-8 bytes
```

If either limit is reached:

```text
backpressure
```

is returned and no additional message is queued.

No unbounded message/promise queue is allowed.

## 14. Idle lifecycle

Default idle timeout:

```text
2 minutes
```

The coordinator can sweep idle process-local connection state.

A future socket adapter will map swept handles to actual socket closure.

## 15. ACK semantics

Future ACK messages must remain transport-level.

```text
ACK
= message accepted by bounded transport processing
```

It must never mean:

```text
authorized
executed
succeeded
verified
```

Higher-level receipts remain separate.

## 16. Reconnect semantics

A new transport connection receives a new process-local connection ID and fresh directional sequencing.

```text
reconnect
!= replay permission
```

A transport layer must not automatically resend effectful commands.

Unknown external side effects continue to use FuryPipe's existing durable evidence/recovery governance.

## 17. Integration with Phase 1.2

Future command path:

```text
bounded transport message
→ authenticated device/principal/session
→ command registry
→ Gateway command admission
→ plugin/tool permission intersection
→ Agent Fabric / MCP / worker governance
→ execution
→ evidence
→ verification
```

Phase 1.3a stops at the first line.

It does not call the Phase 1.2 command evaluator automatically because there is no real socket/session binding adapter yet.

## 18. Public/private package boundary

Public:

```text
furypipe/gateway
```

including the descriptive message parser/serializer.

Internal:

```text
gateway-transport-node
```

The internal coordinator is intentionally not exported as a stable npm subpath.

## 19. Gate to Phase 1.3b

A real WebSocket listener may be added only after this track is exact-head green across:

- audit;
- typecheck;
- full test suite;
- build;
- package smoke;
- Linux/macOS/Windows;
- Node 22/24/26;
- all applicable security/workflow gates.

Phase 1.3b must then preserve:

- loopback-only default;
- no credential in URL/query/logs;
- exact Origin enforcement before WebSocket acceptance;
- max payload at the WebSocket implementation layer as well as the Fury parser;
- per-message authorization after session binding;
- heartbeat/idle closure;
- bounded socket send buffers/backpressure;
- no command execution inside the transport parser.
