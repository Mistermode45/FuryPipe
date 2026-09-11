# FuryPipe learning and knowledge layers

M13 introduces two explicit, host-driven layers:

- `createHumanLearningPath` builds a bounded diagnostic and prerequisite roadmap. Each topic keeps theory, practice, exercises, project material, quiz prompts, explain-back prompts, a mastery graph, and a deterministic spaced-review schedule. `recordHumanLearningAttempt` updates mastery from observed scores.
- `runAgentLearningCycle` executes `Plan -> Execute -> Verify -> Reflect -> Extract lesson -> Validate -> Store -> Reuse`. The callbacks are real host callbacks; the library does not invent a model, shell, network, RAG index, or fine-tuning backend.

The agent layer receives only a task digest in callback context and stores only metadata plus a host-owned opaque `contentHandle`. Lessons must pass the explicit validation callback before storage; a successful reuse increments the adapter's bounded `reuseCount`. `createRecoveryAgentLearningStore()` persists versioned validated lesson records in immutable Recovery objects and reconstructs the latest revision after a process restart. The default in-memory store remains a test/runtime adapter.

Limits are deliberate: no claim of autonomous general learning, model training, semantic retrieval, or human/client validation is made by this module. Recovery durability is proven locally, but a concurrent multi-instance read-modify-write can still require a host transaction/coordinator. A production host must provide its retrieval policy, retention policy, model/provider integration and hosted validation.
