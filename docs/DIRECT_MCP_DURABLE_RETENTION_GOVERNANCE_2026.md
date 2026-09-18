# Direct MCP Durable Retention Governance — M5.1 (2026)

## Status

This track is stacked on M5 PR #190 at exact parent
`a2d01aa413a9726d176080a8d46246f05228c768`.

M5.1 governs evidence maintenance only. It does not add retry, replay,
reconciliation, operator success marking, mutation replay, open-world replay,
or multi-call execution.

## Security contract

```
deleted != safe_to_retry
expired != replayable
archived != reconciled
missing != succeeded
missing != failed
durable != authoritative
GC != authorization
maintenance != execution authority
```

A maintenance operation may remove full payload bytes only after a compacted
content-addressed lineage record is durably written, verified, and atomically
bound to the exact current attempt chain. A compacted record is historical
evidence, never a permit, approval, authorization, or replay intent.

## State machine

```
active full evidence
  -> eligible only for known succeeded/tool_error
  -> compacting (lock-local, not externally observable)
  -> compacted tombstone + no full payload
  -> archived evidence (optional future export; not implemented here)

armed without terminal -> unresolved and never automatic GC
unknown              -> unresolved and never automatic GC
evidence_failed      -> unresolved and never automatic GC
verification_failed  -> unresolved and never automatic GC
```

Compaction is allowed only for a complete attempt with:
- reservation, armed marker, and terminal record;
- terminal outcome `succeeded` or `tool_error`;
- exact reservation ID and armed-record digest lineage;
- valid scope and replay-key digests;
- no later attempt for the same replay key;
- no conflicting or duplicate records.

## Record formats

Full M5 records remain unchanged.

M5.1 adds:

```
furypipe-mcp-direct-durable-tombstone/v1
```

Required tombstone fields:
- `scopeSha256`;
- `replayKeySha256`;
- final `attempt`;
- exact `reservationIdSha256`;
- `armedRecordSha256`;
- exact `reservationRecordSha256` and `terminalRecordSha256`;
- `outcome` (`succeeded` or `tool_error`);
- `resultSha256`;
- `terminalAt`;
- `compactedAt`;
- `retentionClass`;
- `retainUntil`;
- `lineageSha256`;
- `format`.

No raw arguments, raw results, tenant IDs, principal IDs, credentials, permits,
headers, or environment values are stored.

The tombstone is content-addressed. Its handle is the compaction evidence.
The lineage digest binds the canonical set of records that was compacted. The logical `compactedAt` is derived from the terminal timestamp so concurrent maintainers produce one content-addressed tombstone.

## Atomic protocol

Under the RecoveryStore inter-process lock:

1. Load and verify the exact replay-key record set.
2. Require a complete known terminal at the final attempt.
3. Require no unresolved state and no later attempt.
4. Write the tombstone with an atomic uniqueness slot.
5. Verify the tombstone content and metadata while still under the lock.
6. Delete only the exact reservation, armed, and terminal handles using target
   metadata and presence constraints.
7. Keep the tombstone if cleanup partially fails; recovery must classify the
   mixed state deterministically and fail closed.
8. A concurrent reservation observes either the pre-compaction lineage or the
   tombstone, never an invented clear state.

No `list -> decide -> delete` sequence is authoritative. The internal maintenance operation is bounded and opaque; raw delete/compact primitives remain internal and no maintenance primitive is exported.

## Replay and attempt rules

A tombstone proves that a known terminal existed. It does not:
- create a replay intent;
- create a permit;
- approve a new call;
- prove the remote system's current state;
- allow automatic retry.

A new attempt must still come through fresh M1/M2/M3/M4 authority. M5.1
must reject attempt 1 reservation when a tombstone exists. Tombstone lineage
also prevents ABA reuse of attempt numbers.

After restart, the coordinator reports a compacted historical state and blocks
ordinary reservation without a fresh governed replay path. No automatic replay
is performed.

## Retention policy

| Evidence | Automatic compaction | Automatic deletion | Replay-safe |
|---|---:|---:|---:|
| armed without terminal | no | no | no |
| unknown terminal | no | no | no |
| evidence_failed | no | no | no |
| verification_failed | no | no | no |
| succeeded terminal | yes, bounded | only as part of verified compaction | no |
| tool_error terminal | yes, bounded | only as part of verified compaction | no |
| tombstone | bounded maintenance only | no implicit deletion in M5.1 | no |

`retainUntil` is maintenance metadata, not authorization metadata. Expiry
never changes an unresolved state into a retryable state.

## Crash matrix

| Crash point | Required result |
|---|---|
| before tombstone write | full evidence remains; no compaction claim |
| after tombstone write before verification | tombstone is verified or state is corrupt; never clear |
| after tombstone verification before cleanup | tombstone plus full records is valid mixed state; retrying compaction is idempotent |
| during full-record cleanup | tombstone remains; missing/extra records fail closed or are safely recognized as the same lineage |
| after cleanup | tombstone remains the historical proof |
| process restart | known history remains visible; no automatic replay |

## Threat model

- Cross-process races are serialized by the RecoveryStore root lock.
- ABA is prevented by exact attempt, reservation digest, armed digest, lineage
  digest, and tombstone uniqueness metadata.
- TOCTOU is prevented by atomic target metadata and presence constraints under
  the same lock.
- Corrupt tombstones fail closed.
- Duplicate tombstones fail closed unless they are the same content-addressed
  object and exact lineage.
- Scope and replay-key isolation remains mandatory.
- Quota or lock failure blocks maintenance and execution; it never falls back
  to process-local authority.
- Maintenance cannot consume permits or invoke `callTool()`.

## Operator boundary

Compaction is not reconciliation. Reconciliation is not replay. M5.1 has no
operator shortcut for declaring remote success, remote failure, or safe retry.
Unresolved evidence remains unresolved until a future separately governed
protocol supplies independent evidence.

## Validation gate

M5.1 remains Draft until:
- unit and cross-process compaction tests pass;
- restart E2E passes;
- full 12-workflow exact-head CI is green;
- the 9-job OS/Node matrix is green;
- CodeQL, Secret Scan, Supply Chain, Provenance, Benchmark Contract and
  Control Room Security Evidence remain green;
- PR #190 remains unchanged and Draft.

M6 multi-call DAG orchestration is not implemented by this track.
