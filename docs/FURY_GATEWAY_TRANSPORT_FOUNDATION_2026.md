# Fury Gateway Transport Foundation (VNext Phase 1.3A, 2026)

## Status

Phase 1.3A defines the **transport-security kernel** used by the future WebSocket host.

It intentionally does **not** create a listening socket.

The reason is architectural: network I/O must sit behind a tested admission boundary rather than mixing parsing, authentication, authorization and execution in one server callback.

The next sub-track, Phase 1.3B, will connect a maintained WebSocket implementation to this kernel.

## Authority separation

```text
socket connected
!= transport connection admitted

transport connection
!= authenticated principal

authenticated principal
!= active session

active session
!= command eligible

command eligible
!= execution permit

transport receipt
!= application success

executed
!= verified
```

Every transport artifact in this phase explicitly carries:

```text
executionAuthority = false
```

## 1. Loopback-first policy

Default:

```text
allowRemote = false
```

Accepted loopback addresses:

- `127.0.0.1`
- `::1`
- `::ffff:127.0.0.1`

Remote addresses fail closed unless a future host explicitly enables remote transport.

A real remote listener is not part of Phase 1.3A.

## 2. Browser Origin policy

Browser connections require an exact HTTP(S) Origin.

Rules:

- Origin is mandatory for `clientKind=browser`;
- wildcard Origins are forbidden;
- URL path/query/fragment/userinfo are forbidden;
- allowlist matching is exact after URL-origin normalization.

An Origin is not authentication.

It is an additional browser boundary.

## 3. Browser role boundary

In Phase 1.3A browser transport is restricted to:

```text
role = operator
```

Node/channel/worker transport will use device-authenticated connection paths in the real host layer.

This prevents a browser Origin from being treated as a node/worker identity shortcut.

## 4. Connection evidence

Opening a transport connection requires:

- a process-local session lease;
- the session must still be active;
- role/client-kind compatibility;
- loopback/remote policy;
- browser Origin policy;
- global connection quota;
- per-principal connection quota.

The resulting connection object is process-local evidence.

```text
copied object
!= transport connection authority
```

Default quotas:

```text
max connections: 512
max connections per principal: 8
```

Both are hard-bounded by configuration maxima.

## 5. Message size

Default maximum text-frame payload:

```text
64 KiB
```

Configurable within:

```text
1 KiB .. 1 MiB
```

Oversized data is rejected before JSON parsing.

Phase 1.3A accepts **text JSON only**.

Binary frames belong to future artifact-transfer primitives and must not be silently interpreted as control-plane JSON.

## 6. Versioned envelope

Accepted messages use:

```text
furypipe-gateway-message/v1
```

Envelope:

```text
format
messageId
connectionId
sequence
type
sentAt
payload
```

Supported Phase 1.3A types:

- `command`
- `ping`
- `resync`

Unknown fields fail closed.

## 7. JSON structural limits

Before a command reaches downstream policy, JSON is constrained by:

```text
max nesting depth = 16
max visited JSON nodes = 4096
```

Unsafe object keys are rejected:

- `__proto__`
- `prototype`
- `constructor`

Non-finite numbers and unsupported JavaScript values are rejected.

Accepted command input is recursively frozen before it leaves the parser.

Therefore:

```text
accepted input
!= mutable post-admission object
```

## 8. Message sequencing

Each connection starts with:

```text
sequence = 1
```

The next message must match the exact expected sequence.

Lower:

```text
sequence-replay
```

Higher:

```text
sequence-gap
```

Sequence is consumed at transport acceptance.

A denied downstream command does not make the old message replayable.

Sequence is transport replay protection only.

It is **not** external-effect idempotency.

## 9. Rate limiting

Default per-connection rate window:

```text
120 messages / 60 seconds
```

The window and count are bounded configuration values.

Rate limiting is independent from authorization.

A command that is under the rate limit can still be denied by session/permission policy.

## 10. Backpressure

Each connection has explicit in-flight limits.

Defaults:

```text
32 in-flight messages
512 KiB in-flight bytes
```

An accepted message returns a process-local release callback.

Until released, it occupies the in-flight budget.

If either bound is reached:

```text
backpressure
```

No unbounded queue is created by this kernel.

The future socket adapter must stop reading/dispatching when this boundary rejects work.

## 11. Transport receipt

Successful framing creates:

```text
status = transport-received
executionAuthority = false
```

The receipt proves only that:

- the message passed the bounded transport parser;
- the sequence was accepted;
- the connection/session existed at that boundary.

It does **not** prove:

- command authorization;
- execution;
- external effect;
- success;
- verification.

## 12. Command payload

Command payload:

```text
commandName
declaredPluginPermissions[]
input
```

Plugin permissions use the existing Fury plugin permission vocabulary.

The payload does not grant those permissions.

They are passed into Phase 1.2 Command Admission as claimed/declared capability metadata and must match the registered command policy.

## 13. Mandatory Phase 1.2 admission

All command messages flow through:

```text
evaluateFuryGatewayCommandAdmission(...)
```

The transport kernel does not duplicate or bypass session/scope/plugin policy.

Result:

```text
eligible
or
deny
```

but always:

```text
executionAuthority = false
```

Downstream Agent Fabric, worker/sandbox and Direct MCP governance remain mandatory.

## 14. Session revocation while connected

Session validity is rechecked at each message boundary.

Therefore:

```text
socket/connection still open
+
session revoked/expired
=
new message rejected
```

The future host should subsequently close the physical connection with a safe protocol close code.

## 15. Connection close

Transport connection evidence is process-local and can be closed exactly once.

Close:

- marks the connection inactive;
- removes it from the active registry;
- decrements the per-principal quota.

Closing a connection does not assert that in-flight external effects were cancelled.

## 16. Public package surface

`gateway-transport-node` remains internal.

It is **not** an npm export.

The public Gateway package surface remains:

```text
furypipe/gateway
```

until a high-level host/client API is ready.

## 17. Phase 1.3B dependency decision

A real Node WebSocket server should use a maintained RFC6455 implementation rather than handwritten frame parsing.

Current 2026 research identifies `ws` as an actively maintained MIT WebSocket client/server library with no runtime dependencies.

FuryPipe will add it only through a reproducible pnpm lock update.

The lockfile will not be fabricated manually.

## 18. Phase 1.3B host responsibilities

The real host adapter must:

1. bind loopback by default;
2. require explicit remote enablement;
3. use WSS or a separately authenticated secure tunnel for remote exposure;
4. set WebSocket payload limits at the library boundary;
5. disable per-message compression by default;
6. validate browser Origin before upgrade;
7. cap pending unauthenticated upgrades;
8. bind successful sockets to process-local Gateway evidence;
9. route every text message through this transport coordinator;
10. implement ping/pong heartbeat;
11. apply socket-level backpressure;
12. close on revoked/expired sessions;
13. never execute shell/browser/MCP work inside the network callback;
14. log safe metadata only;
15. never accept tokens in URL/query strings.

## 19. Required Phase 1.3A validation

Tests cover:

- process-local session requirement;
- loopback-only default;
- exact Origin allowlist;
- wildcard Origin rejection;
- connection quotas;
- session revocation mid-connection;
- text-only messages;
- pre-parse payload bounds;
- schema drift;
- prototype-pollution keys;
- recursively frozen command inputs;
- replay rejection;
- sequence-gap rejection;
- rate limiting;
- in-flight backpressure;
- mandatory Phase 1.2 command admission;
- copied connection/accepted-message evidence rejection;
- close semantics;
- `executionAuthority=false`.

Phase 1.3B must not begin from this branch until exact-head CI is green.
