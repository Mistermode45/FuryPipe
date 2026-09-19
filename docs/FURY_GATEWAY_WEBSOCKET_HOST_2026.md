# Fury Gateway WebSocket Host (VNext Phase 1.3B, 2026)

## Status

Phase 1.3B connects the Phase 1.3A transport-security kernel to a real RFC6455 WebSocket server.

The host is intentionally **loopback-only**.

It does not expose FuryPipe remotely and it does not create an execution path.

```text
real socket
→ trusted-host session resolution
→ Phase 1.3A transport admission
→ Phase 1.2 command admission
→ bounded response

never:

socket
→ direct shell/browser/MCP execution
```

Every server response remains:

```text
executionAuthority = false
```

## 1. WebSocket implementation

Runtime dependency:

```text
ws@8.21.3
```

Development declarations:

```text
@types/ws@8.18.1
```

Both are pinned exactly.

FuryPipe does not install the optional native `bufferutil` or `utf-8-validate` addons.

The host uses:

```text
perMessageDeflate = false
clientTracking = false
maxPayload = configured transport bound
noServer = true
```

The HTTP upgrade is owned by FuryPipe so route, query, protocol and authority gates run before the WebSocket is admitted.

## 2. Security baseline for ws

The 2026 `ws` security advisory GHSA-96hv-2xvq-fx4p affected 8.x versions earlier than 8.21.0 and described memory exhaustion through large numbers of tiny fragments/data chunks.

FuryPipe pins a version newer than the patched boundary.

Current upstream release 8.21.3 also contains a permessage-deflate negotiation bug fix. FuryPipe disables per-message compression entirely for this control-plane host, so compression is not an authority or optimization dependency.

Sources:

- https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p
- https://github.com/websockets/ws/releases/tag/8.21.3

## 3. Bind policy

Default and currently only supported network bind class:

```text
127.0.0.1
::1
localhost
```

A non-loopback host such as:

```text
0.0.0.0
192.168.x.x
public interface
```

fails before listen with:

```text
remote-bind-forbidden
```

There is no boolean that can bypass this in Phase 1.3B.

Remote/WSS exposure is a separate future security track.

## 4. Port

Default:

```text
0
```

The operating system allocates an ephemeral loopback port.

A caller may provide a fixed port from 0 through 65535.

Port selection does not grant network authority.

## 5. Exact route

Only:

```text
/gateway/v1
```

is eligible for WebSocket upgrade.

Other paths return a bounded HTTP rejection.

The route rejects **all query strings**.

Therefore credentials cannot be passed as:

```text
/gateway/v1?token=...
/gateway/v1?session=...
```

The network host does not implement URL credentials.

## 6. Required subprotocol

Every upgrade must request exactly:

```text
furypipe.gateway.v1
```

Missing, additional or different WebSocket subprotocol declarations fail before trusted-host session resolution.

This prevents an arbitrary generic WebSocket client from silently entering the Fury Gateway protocol.

## 7. Trusted-host connection resolver

The host does not deserialize a session object from the client.

Instead it invokes an internal trusted-host resolver:

```text
resolveConnection(context)
→ process-local FuryGatewaySessionLease
→ client kind
→ optional current authenticated device/pairing
```

The resolver may later be backed by a browser session system, local owner identity, or device proof.

Phase 1.3B deliberately does not define that remote/browser credential format.

The returned resolver object is immediately snapshotted before admission.

```text
serialized client session
!= process-local session evidence
```

## 8. Browser Origin

For browser connections, the Phase 1.3A exact Origin allowlist remains mandatory.

Examples:

```text
https://app.example.test
http://localhost:3000
```

No wildcard matching.

Origin is an additional CSWSH boundary, not principal authentication.

## 9. HTTP bounds

The loopback HTTP server applies:

```text
max headers = 64
headers timeout = 5 seconds
request timeout = 5 seconds
```

Ordinary HTTP requests receive only a 404/no-store response.

No dashboard, files, tokens or debugging surface is exposed by this host.

## 10. Pending upgrades

Pending WebSocket upgrades have a bounded counter.

Default:

```text
64
```

Hard maximum:

```text
1024
```

Over-limit upgrades receive 429.

The resolver is synchronous in this phase so authority cannot remain parked indefinitely inside an unresolved asynchronous handshake.

## 11. Real connection flow

```text
TCP/HTTP upgrade
→ exact route
→ no query
→ exact Fury subprotocol
→ trusted-host resolver
→ Phase 1.3A openConnection()
→ ws handleUpgrade()
→ connected frame
```

The connected frame exposes:

- connection ID;
- role;
- client kind;
- subprotocol;
- `executionAuthority=false`.

It does not expose raw principal/session identity.

## 12. Real message flow

For a text WebSocket frame:

```text
ws maxPayload
→ Phase 1.3A JSON/parser bounds
→ sequence/rate/backpressure
→ process-local accepted-message evidence
→ command/ping/resync handling
```

### command

```text
Phase 1.2 command admission
→ command-admission response
```

No command executor exists in this host.

### ping

Returns an application-level pong response.

This is separate from WebSocket ping/pong heartbeat frames.

### resync

Currently returns:

```text
resync-unavailable
```

It does not replay commands.

## 13. Binary frames

Binary control frames are unsupported.

They close with:

```text
1003 binary-not-supported
```

Future artifact/binary transfer must use a separately bounded protocol.

## 14. Oversized frames

`ws.maxPayload` enforces the configured inbound payload bound before FuryPipe JSON parsing.

Phase 1.3A independently rechecks payload size.

Thus:

```text
library frame bound
+
application message bound
```

both apply.

## 15. Heartbeat

The server performs WebSocket ping/pong liveness checks.

Default interval:

```text
30 seconds
```

Configurable:

```text
1 second .. 5 minutes
```

A connection that does not answer the previous heartbeat is terminated.

Heartbeat state is transport liveness only.

It is not authorization freshness.

## 16. Session revocation

Before each accepted application message Phase 1.3A rechecks the process-local session.

Therefore:

```text
socket still open
+
session revoked/expired
→ next message rejected
→ socket closed by policy
```

A persistent connection cannot preserve revoked session authority.

## 17. Output backpressure

Before sending a server message, FuryPipe checks `ws.bufferedAmount`.

Default maximum buffered outbound data:

```text
512 KiB
```

Hard maximum:

```text
8 MiB
```

If the queue exceeds its bound the server closes with 1013.

No unbounded server send queue is created by the host.

## 18. Error handling

Network-facing responses never contain:

- stack traces;
- session tokens;
- principal raw IDs;
- request payloads;
- private keys;
- resolver errors.

Protocol failures return a bounded safe code when possible, then close with:

- 1008 for policy/protocol failures;
- 1013 for overload/backpressure;
- 1011 only for unknown internal failures.

## 19. Safe observability events

Optional host events expose bounded metadata only:

- listening host/port;
- connection open/close;
- upgrade denial category;
- protocol error code.

They never emit the HTTP Authorization/Cookie header, raw frame, principal subject or command arguments.

Observer exceptions are swallowed and cannot affect authority.

## 20. Shutdown

`stop()` is idempotent.

It:

1. stops heartbeat;
2. marks the host stopped;
3. closes active WebSockets with 1001;
4. releases Phase 1.3A connection quotas;
5. closes the HTTP server.

Shutdown does not claim that any separately governed external effect was cancelled.

## 21. Real E2E validation

The test suite opens real loopback WebSocket connections using the same `ws` implementation and verifies:

- ephemeral loopback listen;
- exact Fury subprotocol;
- permessage-deflate not negotiated;
- non-loopback bind rejection;
- wrong path rejection;
- query/token rejection before resolver;
- wrong subprotocol rejection before resolver;
- Origin denial;
- connected frame does not expose session/principal IDs;
- real text ping/pong;
- real command admission with no execution;
- command input is not echoed;
- binary close 1003;
- oversized frame close 1009;
- session revocation during an established connection;
- clean shutdown close 1001.

## 22. Public package surface

`gateway-websocket-host-node` remains internal.

It is **not** exported as an npm subpath.

The stable public Gateway package remains:

```text
furypipe/gateway
```

A future high-level `FuryGatewayHost` will expose a product-level API only after browser auth/device binding and remote TLS boundaries are complete.

## 23. Remaining transport work

Phase 1.3B intentionally stops before:

- public remote binding;
- WSS certificate/key management;
- reverse-proxy trust;
- forwarded-IP trust;
- browser credential format;
- network refresh credentials;
- external command execution;
- binary artifact transport;
- reconnect command replay;
- remote device enrollment over the socket.

These require separate explicit security gates.
