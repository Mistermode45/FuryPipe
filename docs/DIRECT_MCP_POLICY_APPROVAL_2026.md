# Governed Direct MCP Policy & Approval — M2

## Status

M2 validates exact tool arguments and produces source-bound policy/approval
evidence. It still does **not** call an MCP tool. M3 is the first track allowed
to introduce a governed `callTool()`.

## Lifecycle

```text
configured
!= connected
!= healthy
!= listed
!= trusted
!= selected
!= arguments_validated
!= policy_evaluated
!= approved
!= executed
!= succeeded
!= verified
```

Annotations remain non-authoritative:

```text
annotation != trust != approval != authorization != execution
```

## Selection

The supported public M2 transition `selectMcpDirectTool()` can select exactly
one tool from a healthy listed inventory. Selection grants no approval, permit
or execution authority.

## Exact proposal validation

A proposal can only be created from:

1. a process-local FuryPipe lifecycle state;
2. a process-local catalog handle created from the exact `tools/list`;
3. the currently selected tool;
4. the selected inventory schema digest;
5. strict JSON arguments that pass the exact listed JSON Schema.

The official `@modelcontextprotocol/client@2.0.0` `fromJsonSchema()`
adapter is used for schema validation with a **fresh**
`AjvJsonSchemaValidator` per proposal. FuryPipe deliberately does not reuse the
SDK's default module-level validator here: two independent MCP servers may
advertise different schemas with the same `$id`, and shared AJV `$id` cache
state must never make one proposal validate against another server's schema.

Public proposal evidence contains only identifiers and SHA-256 digests. The raw
arguments remain behind process-local WeakMap provenance for the future M3
executor. Copying or serializing the proposal destroys its authority.

## Policy

There are no wildcard or implicit allow rules.

A policy contains two bounded exact `sourceId + endpointFingerprint + toolName` allowlists:

- `governedPolicyAllowlist`: candidates for policy approval;
- `operatorApprovalAllowlist`: candidates that an operator may explicitly approve.

An exact governed-policy allowlist match is still insufficient on its own.
Automatic policy approval is possible only when all of these are true:

- source trust is `trusted`;
- risk class is `trusted_read_only_closed_world`;
- `closedWorldReadCandidate=true`;
- annotations have not granted authorization;
- the normal policy gate remains required.

Untrusted, open-world, additive-mutation and destructive tools never receive
governed-policy approval. If their exact tuple is operator-allowlisted they
produce `require_operator`; otherwise they are denied.

## Exact approval binding

The policy decision records a SHA-256 digest of the normalized exact policy
configuration, including both bounded allowlists.

A generated approval is bound to:

```text
policy decision digest
+ proposal digest
+ source id
+ endpoint fingerprint
+ selected tool
+ listed schema digest
+ exact input digest
+ approval kind
+ approval timestamp
+ approval expiry
```

Operator approval additionally requires a short-lived, process-local,
single-use intent object. The resulting approval cannot outlive that intent.
Governed-policy approvals receive a 30-second freshness window. The host/UI must create that object only after fresh
human intent; copied or serialized intent is not authority.

The M0 execution-permit factory now requires a still-fresh approval and the
requested input digest to equal the input digest that was actually approved.
Permit expiry is capped at the approval expiry boundary. A caller cannot validate/approve
one argument object and substitute another before permit creation.

## Privacy

Raw tool arguments and raw schemas do not appear in proposal, policy decision,
operator intent, approval, lifecycle or permit evidence. Tests use plaintext canaries to enforce
this property.

## Authority boundary

The raw governance module and client test seam are not supported package
subpaths. Raw lifecycle constructors/mutators, permit constructors/consumers,
approval mutation, execution recording and verification are not exported from
the root API. The supported path is the real M1 inventory probe followed by M2
proposal/policy/approval governance.

M2 introduces no `callTool()`, no transport execution callback, no retry
authority and no replay authority.

No release, tag, npm publish, or deploy is part of M2.
