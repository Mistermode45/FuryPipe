# M6 Multi-call DAG Orchestration Runtime — 2026

## Status

Implemented on this stacked Draft PR. The runtime is a bounded immutable plan validator and a deterministic, fresh-authority scheduler. It does not replace the Direct MCP governance path.

Every node callback must perform the existing M1 inventory, M2 proposal/policy/approval, M3 permit, M4 execution/replay, M5 durable evidence, and M5.1 retention checks. The DAG layer passes opaque output digests between nodes; it never manufactures approval, permit, replay intent, or verification.

## State machine

A plan is immutable and content-addressed. A node moves through:

`planned -> ready -> approved -> executable -> executing -> executed -> succeeded`

Terminal negative states are `failed`, `unknown`, `verification_failed`, `cancelled`, and `expired`. `blocked` is assigned to descendants whose dependencies did not reach verified `succeeded`.

The runtime preserves:

- `scheduled != executing`;
- `executing != executed`;
- `executed != succeeded != verified`;
- `DAG success != partial success`.

There is no implicit transition from durable evidence to authority.

## Plan and topology

Each node has a stable semantic identifier and a content-addressed `nodeId`. The canonical plan digest includes the format version, normalized nodes, explicit edges, and all quotas. Node order in input does not change the digest.

Validation rejects duplicate nodes, self-edges, duplicate edges, missing dependencies, cycles, unbounded fan-in/fan-out, excessive depth, oversized plans, oversized node inputs, and open-world nodes. Input references must name an explicit predecessor and the fixed `result` output. Ambient mutable input is forbidden.

## Scheduler

The scheduler uses deterministic topological order and admits only ready nodes. Independent nodes may run in one bounded batch; dependent nodes cannot run until every dependency is verified succeeded and every referenced output digest exists.

Before each node call:

1. scheduler asks the caller's M1-M5.1 integration for fresh authority;
2. scheduler validates permit expiry;
3. scheduler atomically records the node attempt when a RecoveryStore is supplied;
4. scheduler rechecks expiry and cancellation;
5. executor callback performs exactly one governed node call.

A predecessor's approval, permit, trust, replay intent, durable record, tombstone, or output digest is never passed as authority. Output digest is data lineage only.

## Recovery and restart

The durable node-attempt record is content-addressed and bounded by the RecoveryStore atomic uniqueness primitive. Its metadata is broad enough to prevent two reservation variants for the same scope, run, plan, and node from both succeeding. It contains no raw arguments, raw results, tenant IDs, principal IDs, or permits.

An existing attempt is evidence that an attempt was admitted; it is not permission to continue. A crash before or during the callback therefore produces no automatic resume. A new caller request must create a new governed run identity and obtain fresh authority, subject to the caller's own retry/replay policy.

Unknown and verification-failed nodes block descendants. A remote call that may have started is never represented as cancelled merely because the local process stopped.

## Quotas

The plan carries hard limits for node count, edge count, depth, fan-in, fan-out, serialized plan bytes, node input bytes, aggregate output budget, wall-clock time, concurrent nodes, and recovery evidence. The scheduler never creates an unbounded queue or recursive execution tree.

## Failure, cancellation, retry

There is no automatic retry, hidden retry, mutation replay, open-world replay, or compensation. Mutation nodes can be admitted only through a fresh caller authority callback and are never treated as replay-safe. A failed, unknown, verification-failed, expired, or cancelled dependency blocks descendants by default.

Cancellation before wire admission prevents the callback. Cancellation after a remote call may have started preserves `unknown`; it never claims the call did not happen.

## Confidentiality

Durable evidence stores only plan/node digests, state, bounded timestamps, attempt number, output digest, and verification flags. Raw arguments, raw results, identity plaintext, permit material, and authorization objects remain process-local to the governed integration. Errors are truncated and do not include payloads.

## Operator boundary

Inspection and reconciliation are evidence operations. They cannot create authority. Recovery operators must submit a new caller request through the normal Direct MCP policy and permit boundaries. Tombstones and compacted evidence from M5.1 remain historical lineage and cannot reopen a node or authorize replay.

## Threat model

The security boundary assumes hostile or stale plans, forged node IDs, copied authority objects, dependency output tampering, schema drift, endpoint drift, inventory drift, concurrent schedulers, stale locks, process crashes, corrupted evidence, and cancellation races.

The runtime fails closed on malformed topology, invalid authority, expired permits, missing verified outputs, duplicate durable admission, persistence failure, and unresolved outcomes.

## Non-goals

M6 does not provide a generic raw state-transition API, force-success API, approval bypass, background execution, automatic compensation, or a DAG-level replay button. Multi-call orchestration remains a composition of normal governed node executions, not a new authority system.
