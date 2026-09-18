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

## Exact proposal validation

A proposal can only be created from:

1. a process-local FuryPipe lifecycle state;
2. a process-local catalog handle created from the exact `tools/list`;
3. the currently selected tool;
4. the selected inventory schema digest;
5. strict JSON arguments that pass the exact listed JSON Schema.

The official `@modelcontextprotocol/client@2.0.0` `fromJsonSchema()`
adapter is used for schema validation.

Public proposal evidence contains only identifiers and SHA-256 digests. The raw
arguments remain behind process-local WeakMap provenance for the future M3
executor. Copying or serializing the proposal destroys its authority.

## Policy

There are no wildcard or implicit allow rules.

A policy contains two bounded exact `sourceId + toolName` allowlists:

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
governed-policy approval. If their exact pair is operator-allowlisted they
produce `require_operator`; otherwise they are denied.

## Exact approval binding

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
```

The M0 execution-permit factory now requires the requested input digest to equal
the input digest that was actually approved. A caller cannot validate/approve
one argument object and substitute another before permit creation.

## Privacy

Raw tool arguments and raw schemas do not appear in proposal, policy decision,
approval, lifecycle or permit evidence. Tests use plaintext canaries to enforce
this property.

## Authority boundary

M2 introduces no `callTool()`, no transport execution callback, no retry
authority and no replay authority.

No release, tag, npm publish, or deploy is part of M2.
