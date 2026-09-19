# FuryPipe VNext — Gateway Transport Threat Model & WebSocket Contract (2026)

> Architecture only. No network listener is introduced by this document.

## 1. Principle

FuryPipe must not expose a persistent network transport until device authentication, pairing, principal/session identity and authorization are established.

Transport provides connectivity.

```text
connected != authenticated
authenticated != authorized
authorized connection != authorized action
```

Every privileged action is authorized independently.

## 2. Default bind policy

Default production posture:

```text
host = 127.0.0.1
remote = disabled
```

Remote binding requires explicit operator configuration.

When remote binding is enabled:

- TLS/WSS is mandatory unless a separately authenticated secure tunnel terminates locally;
- authentication cannot be disabled;
- explicit network allow policy is required;
- remote configuration must be visible in `furypipe doctor` and Control Plane.

Never silently promote `0.0.0.0` because the local port is unavailable.

## 3. WebSocket handshake

The HTTP upgrade boundary validates:

1. supported route;
2. HTTP method/upgrade headers;
3. exact Origin policy for browser clients;
4. transport authentication preconditions;
5. connection quotas;
6. protocol version.

Browser clients require an explicit Origin allowlist.

No wildcard/sub-string Origin matching.

Node/worker clients that do not have a browser Origin use the non-browser authenticated-device path.

## 4. Credentials

Never pass session credentials in:

- URL path;
- query parameters;
- logs;
- close reason;
- user-visible error strings.

Browser credential handling and paired-node credential handling are separate threat models.

A node's device private key never leaves the node.

## 5. Compression

WebSocket `permessage-deflate` should be disabled by default for the security-sensitive control plane.

If a future benchmark justifies compression, it must be independently threat-modelled before activation.

Do not compress secret-bearing frames together with attacker-controlled data.

## 6. Payload bounds

Initial target:

```text
control message max: 64 KiB
```

Large artifacts do not travel inline through arbitrary Gateway JSON messages.

Use bounded artifact/file transfer primitives with explicit content metadata and separate limits.

Message parsing must reject:

- over-size payloads;
- unexpected binary frames on JSON routes;
- deep/unbounded JSON;
- duplicate semantic IDs;
- unsupported fields where exact schemas apply.

## 7. Versioned message envelope

Conceptual envelope:

```text
furypipe-gateway-message/v1

messageId
connectionId
sessionId/reference
sequence
type
sentAt
payload
```

The final wire schema should use exact keys and bounded strings/numbers.

The server does not trust client timestamps for authorization freshness.

## 8. Sequencing

Each established connection receives a monotonically increasing inbound sequence.

Goals:

- reject exact duplicate messages;
- make replay/ordering bugs observable;
- allow deterministic acknowledgements;
- avoid accidentally executing the same command twice after reconnect.

Sequence numbers alone are not execution idempotency.

External side effects still require their own stable execution identity/governance.

## 9. Acknowledgements

Separate:

```text
transport received
application accepted
action authorized
action executed
action verified
```

A transport ACK means only that the Gateway accepted the frame into its bounded processing path.

It must never be interpreted as successful tool execution.

## 10. Resynchronization

A reconnect does not automatically replay commands.

For observation/event streams, a client can request resync using a bounded cursor.

For command streams:

```text
reconnect != resend permission
```

Unknown/uncertain commands are reconciled against durable execution evidence before any new attempt.

## 11. Backpressure

Every connection has bounded:

- inbound message queue;
- outbound message queue;
- outstanding request count;
- total queued bytes.

When limits are reached:

- stop accepting more work;
- emit a bounded overload error when safe;
- close abusive or persistently stalled connections.

No unbounded promise/list/map growth.

## 12. Rate limiting

Rate policy should be multi-dimensional:

- per connection;
- per principal;
- per paired device;
- per IP as a fallback;
- per command/risk class.

Rate limits are not authorization.

High-risk actions can have stricter limits than read-only inspection.

## 13. Heartbeat and idle lifecycle

Use ping/pong or protocol heartbeat to detect dead clients.

Maintain:

- handshake timeout;
- authentication timeout;
- idle timeout;
- heartbeat interval;
- missed-heartbeat threshold;
- graceful drain deadline.

A dead transport must not leave a session permanently active.

Session expiry/revocation remains independent from socket closure.

## 14. Connection quotas

Hard limits:

- global connections;
- connections per principal;
- connections per device;
- pending unauthenticated handshakes;
- pending auth challenges.

The unauthenticated/pre-auth limits should be lower than authenticated limits.

## 15. Browser clients

Browser WebSocket clients require:

- exact Origin allowlist;
- browser-safe session credential;
- CSRF/session protections where cookie state participates;
- XSS-aware design;
- Content Security Policy in the dashboard;
- SameSite/Secure/HttpOnly cookie properties where cookies are used.

A browser client cannot self-declare itself an operator and receive operator authority.

## 16. Nodes/workers

Nodes/workers authenticate with the Phase 1.1 device key path.

Future sender-constrained sessions bind to:

- device identity;
- Gateway audience;
- session;
- current connection/challenge.

A stolen session token without the device proof should be insufficient in device-bound mode.

## 17. Message-level authorization

Every action message goes through Phase 1.2 authorization.

Conceptually:

```text
message parsed
→ session active?
→ principal active?
→ device/pairing valid where required?
→ role allowed?
→ scope present?
→ command registered?
→ plugin/tool permission present?
→ risk/approval valid?
→ execution admission
```

No privileged switch statement may bypass this evaluator.

## 18. Command IDs and external effects

Every effectful request receives a stable request/execution ID before dispatch.

The ID is bound to:

- principal/session;
- command identity;
- canonical input digest;
- target capability identity.

For durable external side effects, Recovery/evidence governance determines whether a prior attempt is known, unknown or terminal.

```text
missing response != safe retry
```

## 19. Error model

Errors are versioned and bounded.

Return:

- safe error code;
- safe human-readable message;
- correlation ID;
- retry classification where meaningful.

Do not return:

- stack traces by default;
- secrets;
- full raw provider/tool responses;
- internal filesystem paths unless a trusted local developer mode explicitly enables them.

## 20. Logging

Security logs should cover:

- connection open/close;
- authentication result;
- pairing/session state changes;
- authorization deny/allow evidence;
- rate-limit events;
- invalid message schemas;
- protocol violations;
- abnormal disconnects.

Never log:

- access/session tokens;
- refresh tokens;
- private keys;
- OAuth secrets;
- raw sensitive prompts/results;
- full message bodies by default.

## 21. Transport roles

One Gateway may expose different route classes:

```text
/operator
/node
/channel
/worker
```

or one versioned route with role negotiated after authentication.

Whichever is implemented, role does not create authority.

The final choice should optimize protocol simplicity and testability.

## 22. Worker isolation

The Gateway WebSocket server does not execute shell/browser/code directly.

After authorization it dispatches to an isolated Worker boundary.

```text
Gateway
→ governed dispatch
→ worker
→ result/evidence
```

This preserves the VNext small-Gateway architecture.

## 23. Graceful shutdown

`draining` state means:

- reject new effectful work;
- allow bounded in-flight work to settle;
- stop issuing new auth challenges/sessions;
- flush safe durable evidence;
- close transports after the drain deadline.

Do not claim effectful work was cancelled if it may already have reached an external system.

## 24. Test matrix before remote enablement

Required tests:

- unauthorized connection;
- wrong Origin;
- wildcard-Origin bypass attempt;
- invalid protocol;
- oversized frame;
- malformed JSON;
- unknown fields;
- duplicate sequence;
- old sequence;
- message flood;
- connection flood;
- stalled reader/backpressure;
- heartbeat timeout;
- expired session;
- session revoked mid-connection;
- pairing revoked mid-connection;
- role mismatch;
- scope mismatch;
- command not registered;
- reconnect after uncertain effect;
- graceful drain;
- token/secret log canaries.

Platform coverage:

- Linux;
- macOS;
- Windows;
- Node 22/24/26 matrix used by FuryPipe CI.

## 25. External security basis

Current security design aligns with:
- OAuth 2.0 Security BCP principle of least privilege and sender-constrained credentials where appropriate;
- DPoP proof-of-possession concepts for protecting stolen credentials;
- OWASP WebSocket guidance covering Origin allowlists, per-message authorization, payload/rate bounds, heartbeat/backpressure and secret-safe logs.

FuryPipe does not need to implement OAuth or DPoP wire formats internally to use these security principles.

## 26. Phase 1.3 gate

A real persistent WebSocket listener can be implemented only after:

1. Phase 1.1 exact-head CI is green;
2. Phase 1.2 exact-head CI is green;
3. authorization evaluator is the mandatory dispatch boundary;
4. payload/rate/backpressure limits are constants/config contracts;
5. loopback-vs-remote policy is explicit;
6. secret-safe event logging is tested;
7. no command execution exists directly in the transport parser.
