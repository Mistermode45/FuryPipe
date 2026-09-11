# FuryPipe learning and knowledge layers

M13 introduces two explicit, host-driven layers:

- `createHumanLearningPath` builds a bounded diagnostic and prerequisite roadmap. Each topic keeps theory, practice, exercises, project material, quiz prompts, explain-back prompts, a mastery graph, and a deterministic spaced-review schedule. `recordHumanLearningAttempt` updates mastery from observed scores.
- `runAgentLearningCycle` executes `Plan -> Execute -> Verify -> Reflect -> Extract lesson -> Validate -> Store -> Reuse`. The callbacks are real host callbacks; the library does not invent a model, shell, network, RAG index, or fine-tuning backend.

The agent layer receives only a task digest in callback context and stores only metadata plus a host-owned opaque `contentHandle`. Lessons must pass the explicit validation callback before storage; a successful reuse increments the adapter's bounded `reuseCount`. The in-memory store is a test/runtime adapter, not durable production knowledge storage.

Limits are deliberate: no claim of autonomous general learning, model training, semantic retrieval, cross-process durability, or human/client validation is made by this module. A production host must provide its own validated content store, retrieval policy, retention policy, and model/provider integration.
