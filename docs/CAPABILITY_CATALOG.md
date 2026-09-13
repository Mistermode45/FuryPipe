# FuryPipe Capability Catalog Public API

## Purpose

`furypipe/capability-catalog` is the public, non-executing facade for FuryPipe's capability catalog primitives.

It combines the already hardened metadata lifecycle:

```text
raw candidate
  ↓
normalizeCapabilityCandidate()
  ↓
Capability Registry
  ↓
FuryTrust
  ↓
FuryScore
  ↓
Capability Catalog Resolver
  ↓
Capability Activation Contract
```

This package surface does **not** install, connect, authorize, execute, or verify third-party capabilities.

## Public import

```ts
import {
  normalizeCapabilityCandidate,
  createCapabilityRegistry,
  evaluateFuryTrust,
  scoreFuryCapability,
  rankFuryCapabilities,
  qualifyFuryCapabilityPerformance,
  resolveFuryCatalog,
  resolveFuryCapabilityActivation,
} from 'furypipe/capability-catalog';
```

The facade also exports the corresponding ecosystem, trust, score, resolver, and activation types.

## Lifecycle boundaries

The following states are deliberately separate:

```text
catalog candidate
  ≠ trusted
  ≠ recommended
  ≠ registered in runtime
  ≠ connected
  ≠ approved
  ≠ policy-authorized
  ≠ executed
  ≠ verified
```

FuryTrust reports always keep runtime verification and execution authorization separate.

FuryScore ranks and routes candidates but never authorizes execution.

Catalog Resolver returns `executionAuthorized: false`.

Capability Activation Contract also returns `executionAuthorized: false`; even `READY_FOR_POLICY_AUTHORIZATION` means only that the next governed policy layer may evaluate the request.

## Recommended public flow

A host can:

1. normalize a caller-supplied candidate;
2. place it in a bounded in-memory registry;
3. evaluate caller-supplied static evidence with FuryTrust;
4. record the original FuryTrust report in the registry;
5. provide explicit task relevance;
6. optionally provide qualified exact-scope performance evidence;
7. resolve ranked catalog recommendations;
8. separately describe runtime registration, connection, approval, execution receipts, and verification evidence through the activation contract.

The catalog still cannot bypass Capability Router or Agent Runtime inventory.

## What is intentionally not exported through this facade

The lower-level ingestion coordinator/importer remains an internal foundation for now.

Public consumers can normalize and register candidate records directly, but FuryPipe does not yet expose an internet crawler, GitHub marketplace importer, MCP registry crawler, npm installer, persistent catalog database, or automatic runtime bridge through this subpath.

That keeps the initial package contract narrow while preserving the security model.

## Security properties

The facade performs no:

- source download;
- package installation;
- MCP connection;
- plugin activation;
- provider request;
- subprocess execution;
- credential use;
- filesystem mutation;
- deployment;
- financial or communication side effect.

A clean FuryTrust result is not proof of safety.

A high FuryScore is not approval.

A catalog recommendation is not runtime availability.

Runtime authorization belongs to the separate governed policy/runtime path.

## Related documentation

- `docs/ECOSYSTEM_INGESTION.md`
- `docs/FURYTRUST.md`
- `docs/CAPABILITY_CATALOG_RESOLVER.md`
- `docs/CAPABILITY_ACTIVATION.md`
