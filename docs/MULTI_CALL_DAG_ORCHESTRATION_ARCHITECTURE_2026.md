# Multi-call DAG Orchestration Architecture — M6 (2026)

## Status

Architecture only. M6 execution is not implemented.

M6 may not consume, replay, or reinterpret M5 durable evidence. Every node
must obtain fresh governed authority through the existing M1/M2/M3/M4
boundaries. A durable terminal, compacted tombstone, absence, expiry, or GC
result is never a permit.

## Non-goals

M6 does not add:

- automatic retry;
- hidden retry;
- mutation replay;
- open-world replay;
- implicit approval inheritance;
- permit inheritance across nodes;
- durable-state authority;
- background execution after a caller loses authority;
- best-effort partial success presented as success.

## Proposed model

A DAG is a bounded immutable plan:

- node identity is content-addressed;
- edges are explicit and acyclic;
- input references are exact node outputs, never ambient state;
- every node has an explicit capability/risk class;
- every node has an independent lifecycle:
  recommended, installed, connected, approved, executable, executed, verified;
- execution order is deterministic and bounded;
- fan-out, depth, node count, byte size, and wall-clock budget are quotas.

A node result is not automatically a permit for another node. The next node
must pass the normal policy, approval, authorization, permit, and execution
gates again.

## Authority boundary

```
DAG plan
  -> validate topology and quotas
  -> evaluate each node policy
  -> obtain fresh node approval/permit
  -> execute one node
  -> persist evidence
  -> verify node result
  -> release dependent node for fresh evaluation
```

The executor must never infer approval, authorization, or replay intent from:

- a previous node's success;
- a previous node's durable record;
- a compacted tombstone;
- a cached provider/tool connection;
- an archived or missing record.

## Failure and recovery

Node states must distinguish:

- planned;
- blocked;
- approved;
- executable;
- executing;
- executed;
- succeeded;
- failed;
- unknown;
- verification_failed;
- cancelled;
- expired.

`executed != succeeded != verified`.

A process restart reconstructs history as evidence only. It does not resume
execution automatically. Resumption requires a fresh caller request and fresh
authority for every unfinished node.

An unknown or verification-failed node blocks dependent nodes by default.
There is no automatic compensation or retry. Any future compensation protocol
must be separately specified and must not replay mutations implicitly.

## M5 dependency gates

M6 implementation remains blocked until M5.1 has:

- exact-head applicable CI/security evidence;
- verified tombstone lineage;
- cross-process lock and TOCTOU proofs;
- bounded quota behavior;
- restart and corruption fail-closed tests;
- no public raw maintenance primitive;
- independent review.

## Security properties to prove before implementation

- no cycle can enter execution;
- no edge can smuggle unapproved data or authority;
- no node can execute after permit expiry;
- no concurrent scheduler can execute one node twice;
- no restart can create a new attempt number;
- no partial DAG can be reported as globally succeeded;
- no mutation node is replay-safe without a separate explicit protocol;
- evidence retention and GC cannot change DAG authority.

M6 implementation requires a separate Draft PR stacked on the final M5.1
lineage. This document intentionally contains no runtime code.
