# FuryPipe VNext — Principal, Session & Authorization Architecture (2026)

> Phase 0 / security architecture only.
>
> This document specifies the intended Phase 1.2 boundary after Gateway device authentication and pairing. It does not create a network listener or a production authentication service.

## 1. Core separation

FuryPipe must not collapse identity, pairing, session and authorization into one "logged in" bit.

The required lifecycle is:

```text
connect envelope
!= authenticated device

authenticated device
!= paired device

paired device
!= authenticated principal

authenticated principal
!= active session

active session
!= scope grant

scope grant
!= tool/plugin permission

permission available
!= action authorized

action authorized
!= action executed

action executed
!= action verified
```

A role such as `operator`, `node`, `channel` or `worker` is descriptive routing metadata. A role never grants authority by itself.

---

## 2. Principal model

A principal is the identity on whose behalf the Gateway is acting.

Initial principal kinds:

```text
human
service
automation
```

Potential future kinds may include team/workspace identities, but Phase 1.2 should remain small.

### Principal record

Conceptual fields:

```text
principalId
kind
displayName?
issuer
subject
authenticationMethod
authenticatedAt
expiresAt?
status
```

### Authentication adapters

The Gateway core must not hardcode one authentication system.

Possible trusted adapters:

- local OS/account bootstrap;
- browser/OIDC;
- device-owner approval;
- service credential;
- future passkey/WebAuthn;
- enterprise identity provider.

The adapter produces process-local principal evidence.

The remote client must not be allowed to construct a principal object and have it treated as authenticated.

---

## 3. Device identity versus principal identity

A device proves possession of a device key.

A principal proves a user/service identity.

They are intentionally separate.

Examples:

```text
same user
→ desktop
→ laptop
→ phone

same device
→ personal principal
→ work principal
```

Pairing pins a known device identity.

Pairing does not answer:

```text
who is currently using this device?
```

Principal authentication does not answer:

```text
is this endpoint a paired device?
```

Sensitive sessions may require both.

---

## 4. Session model

A session is a bounded, revocable lease joining:

- a principal;
- a client/device or browser session;
- a Gateway instance/audience;
- a role;
- an exact scope set;
- creation/expiry metadata.

Conceptual format:

```text
furypipe-gateway-session/v1
```

Fields:

```text
sessionId
principalId
deviceId? / client binding
role
audience
scopes[]
issuedAt
expiresAt
status
sessionVersion
```

### Session states

```text
active
draining
revoked
expired
```

No hidden refresh from `expired` back to `active`.

A refresh is a new authorization event.

---

## 5. Session credential strategy

FuryPipe should avoid a permanent global bearer token.

For network transports, the preferred design is:

```text
short-lived opaque session credential
+
server-side digest only
+
audience restriction
+
device/client binding where possible
+
rotation
+
explicit revocation
```

For paired device/node connections, session use should be bound to the already-proven device public key or to a fresh proof-of-possession step.

This follows the security principle of sender-constrained credentials without requiring FuryPipe to copy DPoP wire format internally.

For browser clients, a separate browser-safe session mechanism may be used. It must include explicit Origin/CSRF protections and must not reuse node credentials.

### Secret handling

Never log:

- raw session token;
- refresh credential;
- device private key;
- OAuth bearer token;
- complete authentication message.

Receipts should use digests/IDs only.

---

## 6. Session TTL

Initial defaults should be short and evidence-driven.

Suggested starting values for testing:

```text
interactive access session: 15 minutes
hard maximum without fresh auth: 60 minutes
high-risk elevation: 5 minutes
```

These are initial engineering defaults, not permanent product promises.

Long-lived automations do not receive a permanent interactive session token.

---

## 7. Gateway scope vocabulary

Gateway scopes represent authority granted to a session.

They are distinct from plugin-declared permissions.

### Control-plane scopes

Candidate V1 vocabulary:

```text
gateway.inspect

sessions.inspect
sessions.manage

pairings.inspect
pairings.manage

channels.inspect
channels.manage

memory.read
memory.write
memory.manage

automations.inspect
automations.manage

nodes.inspect
nodes.manage

workers.inspect
workers.submit
workers.manage

plugins.inspect
plugins.manage

skills.inspect
skills.manage

mcp.inspect
mcp.manage

models.inspect
models.manage

evidence.read

settings.inspect
settings.manage
```

### Capability execution scopes

Reuse the existing Fury plugin permission vocabulary through a namespaced session grant:

```text
capability.network
capability.browser
capability.process
capability.repository-read
capability.repository-write
capability.database-read
capability.database-write
capability.design-read
capability.design-write
capability.cloud-read
capability.cloud-write
capability.provider-inference
capability.provider-management
```

This avoids inventing a second incompatible capability-permission taxonomy.

---

## 8. No wildcard authority by default

V1 should not accept broad string wildcards such as:

```text
*
capability.*
admin.*
```

A product-level owner/admin preset may exist later, but it should compile into an explicit scope set at grant time.

This makes receipts and policy evaluation exact.

---

## 9. Effective authorization

The effective permission for an action is an intersection.

Conceptually:

```text
active authenticated principal
∩ active session
∩ unexpired session
∩ current device/pairing state where required
∩ session scopes
∩ role eligibility
∩ plugin/tool declared permissions
∩ exact command policy
∩ current risk/policy approval
= authorized action
```

No one input can independently grant execution.

---

## 10. Command registry

Every executable Gateway command should be registered with explicit metadata.

Conceptual record:

```text
commandName
version
allowedRoles[]
requiredGatewayScopes[]
requiredCapabilityPermissions[]
riskClass
requiresFreshApproval
maxInputBytes
timeoutClass
```

Examples:

```text
screen.capture
role: node
requires: capability.browser

shell.run
role: worker/node
requires: capability.process
risk: high

repository.read
requires: capability.repository-read

repository.write
requires: capability.repository-write
risk: high
```

A command advertised by a device is not automatically registered or authorized.

```text
advertised command
!= known command
!= granted command
!= authorized call
```

---

## 11. Per-action authorization

A persistent WebSocket connection must not imply unlimited authority.

Every privileged message/action should resolve:

1. current session state;
2. current principal state;
3. current audience;
4. current device/pairing state when applicable;
5. required scopes;
6. command/tool policy;
7. current approval/risk boundary.

Authorization is evaluated at the action boundary, not only at connection time.

---

## 12. Scope escalation

A session cannot silently add scopes.

Escalation flow:

```text
current session
→ action needs missing scope
→ explicit elevation request
→ current principal revalidation / approval as required
→ new short-lived scope grant or new session
```

High-risk permissions such as:

- process;
- repository-write;
- database-write;
- cloud-write;
- provider-management;

should support stricter elevation policy than read-only permissions.

---

## 13. Revocation

Revocation must be immediate at the Gateway authorization boundary.

Revocable objects:

- principal session;
- pairing;
- device;
- individual scope elevation;
- automation grant;
- connector credential.

A session's cached authorization result must not survive the revocation generation/version changing.

Potential mechanism:

```text
principal auth generation
session version
pairing version
policy version
```

Authorization receipts bind to the versions observed at decision time.

---

## 14. Automation authority

Automations are not interactive sessions with infinite lifetime.

An automation stores:

- owner principal;
- requested capability envelope;
- trigger;
- bounded policy;
- execution budget.

At each run FuryPipe re-evaluates:

```text
automation enabled
principal/owner still valid
current policy
current connector/device state
current granted scope
current capability risk
```

If a required authority is missing:

```text
automation blocked
```

not silent privilege recovery.

---

## 15. Plugin permission intersection

Existing FuryPipe plugins already declare permissions such as:

- network;
- browser;
- process;
- repository-read/write;
- database-read/write;
- design-read/write;
- cloud-read/write;
- provider-inference/management.

Phase 1.2 should reuse this vocabulary.

Example:

```text
GitHub plugin declares repository-read

session has capability.repository-read

tool policy allows exact read operation

=> may proceed to downstream governed execution
```

If the plugin declares `repository-write` but the session only has read:

```text
deny
```

Installing/enabling a plugin never grants its permissions to a session.

---

## 16. External MCP tools

MCP remains behind the existing M1-M5.1 governance.

Gateway session scope is an **additional upper bound**, not a replacement.

For an MCP write:

```text
Gateway session has required capability scope
+
MCP source/tool lifecycle valid
+
M2 policy/approval valid
+
M3 permit valid
+
M4/M5 execution governance
= eligible execution
```

A Gateway scope cannot bypass Direct MCP governance.

---

## 17. Memory authority

Memory read/write permissions need separate scopes.

```text
memory.read
memory.write
memory.manage
```

Even with `memory.read`, retrieval remains task-scoped and provenance-aware.

A session cannot request the entire global memory database merely because it has permission to retrieve relevant memory.

---

## 18. Browser/operator clients

Browser-based clients require a different threat model from paired nodes.

Requirements before browser WebSocket exposure:

- exact Origin allowlist;
- CSRF/session protections;
- secure cookie or equivalent browser-safe credential handling;
- XSS hardening;
- no device private-key assumption unless WebCrypto/passkey design is explicitly used;
- per-message authorization;
- connection/message quotas.

Do not reuse the node pairing key as a browser auth shortcut.

---

## 19. Node/worker clients

Paired nodes/workers should use proof-of-possession.

A future connection should bind:

```text
session
device key
Gateway audience
connection challenge
role
```

A stolen session credential without the device key should be insufficient where sender-constrained mode is enabled.

---

## 20. Auditing/evidence

Authorization receipt should contain safe metadata only:

```text
decisionId
sessionIdSha256
principalIdSha256 or safe principal reference
deviceIdSha256 / public identifier
command/tool identity
required scopes
granted scope digest
policy version
decision
reason
evaluatedAt
expiresAt
```

Do not persist raw tokens or secret-bearing request payloads.

---

## 21. Failure semantics

Fail closed on:

- unknown scope;
- duplicate scope;
- expired session;
- revoked session;
- stale policy version;
- stale pairing;
- principal disabled;
- role mismatch;
- command not registered;
- missing declared plugin permission;
- missing Gateway scope;
- unknown authorization state.

There is no "best effort allow".

---

## 22. Recommended Phase 1.2 implementation order

### 1. Scope vocabulary

Typed, bounded, canonical, duplicate-free.

### 2. Trusted-host principal evidence

Process-local evidence only.

No remote self-assertion.

### 3. Session lease coordinator

- short TTL;
- exact scope set;
- process-local unforgeable handle;
- revocation;
- expiry;
- audience binding.

### 4. Command policy registry

Exact command-to-scope mapping.

### 5. Authorization evaluator

Pure/fail-closed evaluator that returns a decision, not execution.

### 6. Plugin permission intersection

Map `capability.<permission>` to existing Fury plugin permissions.

### 7. Adversarial tests

- forged principal evidence;
- copied session object;
- expired session;
- revoked session;
- missing scope;
- role mismatch;
- device/pairing drift;
- policy version drift;
- wildcard scope;
- duplicate scope;
- plugin permission mismatch;
- elevation after revocation.

### 8. Package/public-surface test

No raw authority-mutator exposed.

---

## 23. Explicit non-goals for Phase 1.2

Do not add yet:

- public network listener;
- browser login UI;
- OIDC provider implementation;
- durable auth DB;
- refresh-token service;
- OAuth authorization server;
- command execution;
- generic admin wildcard;
- auto-escalation;
- hidden privilege inheritance.

---

## 24. Gate before Phase 1.3 transport

Before the persistent WebSocket listener ships:

- Phase 1.1 device auth/pairing fully green;
- Phase 1.2 principal/session/scope evaluator fully green;
- no authority object forgeable by serialized client input;
- session expiry/revocation tested;
- command policy tested;
- exact permission intersection tested;
- transport threat model frozen;
- origin/rate/payload/backpressure contracts frozen.

Only then should FuryPipe accept persistent remote clients.
