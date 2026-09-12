# FuryPipe learning and knowledge layers

M13 introduces two explicit, host-driven layers:

- `createHumanLearningPath` builds a bounded diagnostic and prerequisite roadmap. Each topic keeps theory, practice, exercises, project material, quiz prompts, explain-back prompts, a mastery graph, and a deterministic spaced-review schedule. `recordHumanLearningAttempt` updates mastery from observed scores.
- `runAgentLearningCycle` executes `Plan -> Execute -> Verify -> Reflect -> Extract lesson -> Validate -> Store -> Reuse`. The callbacks are real host callbacks; the library does not invent a model, shell, network, RAG index, or fine-tuning backend.

The agent layer receives only a task digest in callback context and stores only metadata plus a host-owned opaque `contentHandle`. Lessons must pass the explicit validation callback before storage; a successful reuse increments the adapter's bounded `reuseCount`. `createRecoveryAgentLearningStore()` persists versioned validated lesson records in immutable Recovery objects and reconstructs the latest revision after a process restart. The default in-memory store remains a test/runtime adapter.

Limits are deliberate: no claim of autonomous general learning, model training, semantic retrieval, or human/client validation is made by this module. Recovery durability is proven locally, but a concurrent multi-instance read-modify-write can still require a host transaction/coordinator. A production host must provide its retrieval policy, retention policy, model/provider integration and hosted validation.


## Knowledge index and graph

`src/knowledge.ts` adds an executable metadata-only knowledge layer over validated agent lessons.

Implemented:

- validated lessons can be registered as knowledge entries;
- host-supplied retrieval terms are NFKC-normalized and stored only as domain-separated SHA-256 digests;
- search hashes its query terms and returns opaque content handles plus lesson/task digests, never lesson plaintext or indexed terms;
- exact memory-class and task-digest filters are supported;
- graph edges are explicit `depends_on`, `supports`, `contradicts` or `related_to` relations;
- edge evidence is hashed before storage;
- dangling and self edges are rejected;
- ranking is deterministic by matched-term count, graph degree, reuse count and stable ID.

### Retrieval backend decision

The V5 local baseline deliberately uses a metadata inverted index.

- **Metadata index — ADOPT now.** It matches the current privacy contract because learning content is opaque and only explicit host metadata may be indexed.
- **SQLite FTS — DEFER.** FTS is useful when FuryPipe is allowed to persist searchable plaintext/tokenized lesson content. The current learning contract intentionally does not expose that content to this layer.
- **Embeddings/vector DB — REJECT for the current baseline.** No embedding provider or local embedding model is part of the proven runtime, and adding one only to check a RAG box would introduce network/model/privacy/supply-chain requirements without evidence.
- **Hybrid retrieval — FUTURE.** A host may combine this metadata index with an independently validated semantic retriever later, but FuryPipe must keep provenance and exact opaque handles visible.

This is real retrieval but not semantic RAG. M13 therefore remains `PARTIAL`: durable graph persistence, semantic retrieval, hosted provider validation and multi-instance transactional updates remain separate work.
