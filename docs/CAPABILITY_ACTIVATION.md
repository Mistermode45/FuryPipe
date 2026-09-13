# FuryPipe Capability Activation Contract

## Purpose

Catalog discovery, runtime availability, operator approval, execution, and verification are different facts.

This contract makes that separation explicit:

```text
recommended
  ≠ registered
  ≠ connected
  ≠ approved
  ≠ ready for policy authorization
  ≠ executed
  ≠ verified
```

The module is planning/state-validation only. It does not install, connect, approve, execute, verify, or grant runtime authority.

## Input authority

The contract starts from a FuryScore result and host-supplied lifecycle observations.

FuryScore remains authoritative for routing disposition:

- `RANKED` → catalog recommendation;
- `REVIEW_REQUIRED` → manual approval remains required;
- `REFERENCE_ONLY` → never execution-ready;
- `BLOCKED` → never execution-ready.

Host lifecycle observations then describe whether the capability is actually:

- registered in the real host inventory;
- connected/mounted;
- explicitly approved;
- observed as executed;
- observed as verified.

These observations are not cryptographic attestations. Execution and verification references are bounded identifiers that keep claims attached to evidence/receipts instead of turning bare booleans into proof.

## Readiness

For a routing-eligible capability, readiness advances only through:

```text
NEEDS_REGISTRATION
→ NEEDS_CONNECTION
→ NEEDS_APPROVAL
→ READY_FOR_POLICY_AUTHORIZATION
```

`READY_FOR_POLICY_AUTHORIZATION` does **not** mean authorized.

The output always contains:

```text
executionAuthorized: false
```

A separate governed policy/runtime layer must still decide whether execution is allowed for the current task, user, permissions, network boundary, credentials, side effects, and environment.

## Fail-closed invariants

The contract rejects contradictory lifecycle claims:

- connected while unregistered;
- executed before readiness;
- execution without a receipt reference;
- verified before execution;
- verification without evidence references;
- duplicate or unbounded evidence references.

`REFERENCE_ONLY` and `BLOCKED` never become policy-ready even if the caller claims registration, connection, and approval.

## Security boundary

This module intentionally does not:

- authenticate an operator;
- authorize permissions;
- install or download a capability;
- open network access;
- mount an MCP server;
- connect a plugin;
- run a subprocess;
- read credentials;
- execute a model/provider;
- perform deployment;
- verify receipt authenticity;
- claim runtime safety.

It only produces a deterministic, immutable lifecycle contract for later governed layers.

## Relationship to Catalog Resolver and Task Orchestrator

Catalog Resolver answers: **which candidates are worth considering, under FuryTrust/FuryScore?**

Task Orchestrator can expose those recommendations without activating them.

Capability Activation Contract answers: **given one scored candidate and real host observations, what lifecycle gate is still missing before the governed runtime may even consider authorization?**

The Capability Router remains authoritative for the real registered runtime inventory.
