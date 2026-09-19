# Fury Gateway Principal, Session & Command Admission Runtime (VNext Phase 1.2, 2026)

## Status

This track introduces internal, process-local authority primitives for the future Fury Gateway.

It does **not** introduce:

- a WebSocket listener;
- a network bearer token;
- browser login;
- OAuth/OIDC verification;
- command execution;
- worker execution;
- durable credential storage;
- automatic scope elevation.

The runtime freezes three boundaries:

```text
trusted-host principal evidence
→ bounded session lease
→ command admission decision
```

An admission decision is never an execution permit.

## Authority lifecycle

```text
connect envelope
!= authenticated device

authenticated device
!= paired device

paired device
!= authenticated principal

authenticated principal
!= session lease

session lease
!= sufficient command scope

scope
!= plugin permission

eligible command
!= execution authority

executed
!= verified
```

## 1. Principal evidence

The principal registry accepts a **trusted-host assertion** only.

Supported principal kinds:

- human;
- service;
- automation.

Initial authentication-method vocabulary:

- local-owner;
- oidc;
- service-credential;
- automation-owner.

The registry does not verify passwords, OIDC tokens or service credentials.

Those future adapters authenticate externally and then call the trusted-host boundary.

### Anti-forgery

Authenticated-principal evidence is process-local.

A copied/serialized object does not regain authority.

### External identity pinning

For one `principalId`, FuryPipe pins:

- principal kind;
- issuer;
- authentication method;
- SHA-256 digest of issuer+external subject.

The raw external subject is not retained in the evidence object.

A different subject cannot silently reuse an existing principal ID.

### Revocation

Principal revocation:

- increments generation;
- invalidates existing evidence;
- invalidates sessions bound to the old generation;
- does not silently reactivate on the next assertion.

Reactivation/re-enrollment is intentionally a future explicit administrative operation.

### Principal evidence TTL

Default:

```text
5 minutes
```

Allowed:

```text
30 seconds .. 15 minutes
```

Expiry of authentication evidence does not itself revoke the principal record.

It only means that fresh evidence is required for issuing another session.

## 2. Session leases

A session joins:

- authenticated principal;
- principal generation;
- Gateway audience;
- role;
- exact scope set;
- local-operator or paired-device binding;
- issuance/expiry.

### Session authority

Sessions are also process-local evidence.

```text
copied session object
!= active session
```

### Default TTL

```text
15 minutes
```

Configurable range:

```text
30 seconds .. 60 minutes
```

There is no automatic refresh.

### Terminal retention

Terminal states are retained for bounded local diagnostics:

- expired;
- revoked;
- principal-revoked.

Default terminal retention:

```text
5 minutes
```

Configurable:

```text
30 seconds .. 60 minutes
```

After the retention window the process-local record is garbage-collected.

This prevents unbounded revoked-session accumulation while preserving short-lived diagnostics.

### Local operator binding

A `local-operator` session requires:

- role = operator;
- principal kind = human;
- authentication method = local-owner.

This is not the future browser remote-login path.

### Paired device binding

A paired-device session requires:

- generated device-auth evidence;
- matching role;
- fresh device authentication;
- current pairing.

The session pins:

- device ID;
- public-key digest;
- pairing ID;
- exact connect fingerprint;
- exact device-auth timestamp.

Therefore a new device authentication/connection cannot silently reuse the old device-bound session.

## 3. Gateway scopes

Scopes are explicit and wildcard-free.

Control scopes include:

- Gateway/session/pairing/channel inspection and management;
- memory;
- automations;
- nodes/workers;
- plugins;
- skills;
- MCP;
- models;
- evidence;
- settings.

Capability scopes mirror the existing Fury plugin permission vocabulary:

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

No `*` scope exists.

Duplicate or unknown scopes fail closed.

## 4. Command registry

Every command is registered with:

- exact command name;
- allowed roles;
- required Gateway scopes;
- required Fury plugin permissions;
- risk class;
- fresh-approval requirement.

Risk classes:

- inspect;
- read;
- write;
- process;
- admin.

A command that requires a Fury plugin permission must also explicitly require the mapped `capability.*` scope.

This prevents plugin permission metadata from becoming an implicit session grant.

## 5. Plugin permission intersection

The command evaluator receives the permissions declared by the selected plugin/tool capability.

For example:

```text
session:
  capability.repository-read

command:
  requires repository-read

selected plugin:
  declares repository-read
```

can become eligible.

But:

```text
session has scope
plugin does not declare permission
```

is denied with:

```text
plugin-permission-mismatch
```

## 6. Device-bound command admission

For a paired-device session, every admission additionally requires current process-local device proof.

The current proof must exactly match the session's:

- device ID;
- public-key digest;
- role;
- connect fingerprint;
- device-auth timestamp.

The pairing must also still exist with the same pairing ID.

Thus:

```text
new connection
!= old session authority
```

and:

```text
revoked pairing
→ command denied
```

## 7. Fresh approval

Commands can declare:

```text
requiresFreshApproval = true
```

Phase 1.2 deliberately has no approval issuer yet.

Therefore those commands always return:

```text
fresh-approval-required
```

They never fail open.

A future approval layer can satisfy this gate with a separate process-local authority object.

## 8. Admission output

Admission returns bounded metadata:

- decision digest;
- session ID digest;
- principal ID digest;
- command;
- risk class;
- required scopes;
- required plugin permissions;
- outcome;
- reason.

And always:

```text
executionAuthority = false
```

Even:

```text
outcome = eligible
```

means only that Gateway-level admission gates passed.

Downstream execution still requires the relevant:

- Agent Fabric write boundary;
- plugin/tool policy;
- MCP M1-M5.1 governance;
- worker/sandbox boundary;
- task-specific approval;
- evidence/verification.

## 9. Agent Fabric intersection

Existing Agent Fabric permissions remain separate:

```text
read
scoped-write
```

For agent-driven repository mutation, effective authority is bounded by:

```text
Gateway capability scope
∩ Fury plugin/tool permission
∩ AgentFabricPermission
∩ allowedWritePaths
∩ downstream tool/MCP policy
```

A reviewer with `read` cannot write even when the session holds a repository-write scope.

## 10. Public package surface

The raw Phase 1.2 authority modules remain internal:

- gateway-principal-node;
- gateway-session-node;
- gateway-command-authorization-node.

They are not npm package exports.

The public Gateway surface remains the descriptive `furypipe/gateway` contract from Phase 1.

A future high-level `FuryGatewayHost`/client surface will wrap these internal authorities after transport/session architecture is validated.

## 11. Required adversarial validation

This track must prove:

- copied/fabricated principal evidence rejected;
- principal subject identity cannot drift;
- principal revocation invalidates sessions;
- principal evidence expires;
- copied/fabricated sessions rejected;
- scope wildcards/duplicates/unknown values rejected;
- session expiry and bounded terminal GC;
- paired session requires exact device-auth evidence;
- command role mismatch denied;
- missing session scope denied;
- plugin-permission mismatch denied;
- fresh-approval command denied;
- pairing revocation blocks future admission;
- no admission result can become an execution permit;
- raw authority modules remain package-hidden.

## 12. Gate to transport

No persistent network Gateway should be implemented until this track is exact-head green across FuryPipe's full CI matrix.
