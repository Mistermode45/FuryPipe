# FuryPipe Long-Term Memory

## Status

`DURABLE_LOCAL_LONG_TERM_MEMORY_IMPLEMENTED`

FuryPipe now has a durable, host-controlled long-term memory layer backed by Recovery.

This subsystem is deliberately **not** an automatic LLM memory extractor. The host decides what is promoted, updated, deleted or ignored.

## Architecture

The runtime separates:

- **Working memory** — stays outside this subsystem and remains short-lived.
- **Episodic memory** — durable past events/outcomes.
- **Semantic memory** — durable facts and validated knowledge.
- **Procedural memory** — durable procedures and learned workflows.
- **Project memory** — durable project-specific decisions/context.
- **User memory** — durable user-scoped preferences/facts when the host explicitly stores them.
- **Skills memory** — durable skill-related knowledge.

The long-term layer accepts every Agent memory class except `Working`.

## Storage model

Every mutation is an immutable Recovery revision:

```text
ADD -> version 1
UPDATE -> version 2 -> supersedes 1
UPDATE -> version 3 -> supersedes 2
DELETE -> tombstone version 4
```

A `NOOP` operation performs no write.

The latest revision determines current state. Older revisions remain auditable until an explicit physical purge.

### Conflict behavior

Concurrent writers can race on the same memory/version. FuryPipe does not silently pick a winner. If more than one highest revision exists, reads fail closed with a revision-conflict error.

This is safer than silently merging contradictory long-term memory. Strict multi-writer transactions still require an external coordinator or future transactional backend.

## Scope isolation

Memories are scoped to one of:

- `global`
- `workspace`
- `project`
- `user`
- `agent`

Raw scope IDs are never persisted. They are domain-separated SHA-256 digests.

The same memory ID can safely exist in multiple scopes without cross-scope recall.

## Privacy boundary

FuryPipe persists only digests for:

- raw scope IDs;
- retrieval terms;
- source labels;
- mutation reasons.

The payload stores:

- stable memory ID;
- memory class;
- opaque host-owned content handle;
- content digest;
- hashed term index;
- confidence/importance;
- temporal metadata;
- revision lineage.

The long-term memory layer never dereferences the content handle.

If the Recovery namespace is configured with AES-256-GCM, the complete memory revision payload inherits Recovery encryption at rest.

## Retrieval

Recall uses explicit host-provided search terms. The terms are normalized in memory and hashed before comparison.

Ranking is deterministic:

- term coverage: 55%
- importance: 20%
- confidence: 20%
- recency: 5%

Recall supports:

- multiple scopes;
- memory-class filtering;
- minimum importance;
- minimum confidence;
- valid-time filtering;
- expiration filtering;
- bounded result count.

No embedding model, vector DB or provider call is executed implicitly.

## Temporal memory

Each active memory can define:

- `validFrom`
- optional `validTo`
- optional `expiresAt`

A memory outside its validity interval is invisible to recall.

Temporal expiry is a logical memory rule. It does not physically erase immutable history.

## Forgetting

FuryPipe supports two different privacy/audit operations.

### Logical delete

`DELETE` writes a tombstone revision.

The memory is no longer recalled, but the earlier revision history remains available for audit/recovery.

### Physical purge

`purge(memoryId, scope)` deletes every Recovery revision for that memory key.

Use physical purge when the host needs hard deletion instead of audit-preserving forget.

## Learning integration

`promoteValidatedLessonToLongTermMemory()` promotes only validated Agent Learning lessons.

Rules:

- `Working` memory cannot be promoted without reclassification;
- first promotion uses `ADD`;
- later promotion of the same lesson uses `UPDATE`;
- content remains an opaque handle;
- the learning task is stored only as a source digest;
- search terms must be supplied explicitly by the host.

This connects Learning -> durable Long-Term Memory without making an LLM silently decide what is worth remembering.

## Why this design

FuryPipe intentionally combines useful production patterns without adopting another full agent runtime:

- explicit `ADD / UPDATE / DELETE / NOOP` consolidation;
- separation of short-term and long-term memory;
- immutable revision history;
- temporal validity;
- scoped durable stores;
- host-controlled promotion;
- metadata-only retrieval by default;
- hard deletion when explicitly requested.

A semantic/vector backend can be added later behind a host adapter, but it is not required for the baseline.

## Current limitations

The following are not claimed yet:

- semantic embedding retrieval;
- temporal knowledge-graph reasoning across arbitrary entities;
- automatic contradiction extraction by an LLM;
- distributed multi-writer transactions;
- hosted memory-service validation;
- cross-device synchronization service.

These remain separate integration tracks, not hidden assumptions.
