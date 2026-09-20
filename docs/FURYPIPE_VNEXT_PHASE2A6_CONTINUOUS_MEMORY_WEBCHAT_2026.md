# FuryPipe VNext — Phase 2A.6 Continuous Memory WebChat

**Status:** architecture track — implementation pending  
**Stack base:** exact Phase 2A.5 HEAD `e0197028f590a113a577597035a7c8047c5b7a4a`  
**Branch:** `vnext-phase2a6-continuous-memory-webchat`

## 1. Goal

Add durable, governed local WebChat memory without creating a second memory system.

Phase 2A.6 reuses the existing FuryPipe primitives:

- `createRecoveryStore`;
- `createLongTermMemoryStore`;
- `createContinuousMemoryEngine`;
- `runContinuousMemoryTurn`;
- the existing Fury Kernel conversation lifecycle;
- the Phase 2A.4 governed model/provider path.

No browser-owned transcript database, vector database, alternate memory index, or parallel persistence layer is introduced.

## 2. Non-negotiable distinctions

```text
conversation state != durable memory
recalled memory != instruction authority
recalled memory != verified current fact
memory candidate != stored memory
stored memory != current-turn user instruction
provider response != verified evidence
model inference permit != memory write authority
memory write != tool/process/network execution authority
learning failure != model execution failure
forget request != hard purge unless explicitly requested
```

Memory context must remain data. The existing Continuous Memory context block already states that recalled items are not instructions and cannot override current system, developer, repository, security, or user instructions.

## 3. Existing source of truth

### Long-Term Memory

Existing `long-term-memory.ts` already provides:

- immutable revisions;
- tombstones;
- scope digests instead of persisted raw scope IDs;
- bounded recall;
- importance/confidence;
- validity/expiry windows;
- history;
- purge;
- Recovery integrity verification.

### Continuous Memory

Existing `continuous-memory.ts` already provides:

- lexical + optional semantic recall terms;
- bounded dereferenced recall;
- context block generation;
- candidate validation;
- policy filtering;
- explicit REMEMBER / FORGET;
- secret-never-stored behavior;
- sensitive-content policy;
- inferred-memory policy;
- dedup/update/delete receipts;
- soft and hard forget APIs.

### Continuous Memory Turn

Existing `runContinuousMemoryTurn()` already establishes the required ordering:

```text
memory recall
→ execute turn once
→ validate completed assistant result
→ memory learning
```

Recall failure happens before execution and therefore fails closed.

Learning failure happens after execution and is returned as `failed_after_execution`; FuryPipe must never retry a provider/tool/external action merely because memory learning failed.

## 4. WebChat-specific security defaults

The generic Continuous Memory engine supports inferred learning, but the WebChat integration will use stricter defaults:

- memory integration disabled unless explicit host configuration exists;
- `allowInferred: false` by default;
- `allowSensitive: false` by default;
- `secret` candidates remain unconditionally non-storable;
- raw scope IDs are host-owned and never returned by the WebChat config endpoint;
- recall item count and bytes remain bounded;
- learning candidate count remains bounded;
- memory storage quotas are explicit;
- browser localStorage/sessionStorage is not used for memory;
- memory data is not appended to the visible transcript unless the user explicitly asks to inspect memory.

## 5. Persistent storage

WebChat memory will use `RecoveryStore`.

The host configuration will provide an absolute Recovery root and namespace. Durable personal/project memory must use host-owned AES-256-GCM Recovery encryption.

Configuration must never contain raw encryption keys. It may contain only environment-variable references for key material.

Planned fail-closed rules:

- absolute Recovery path only;
- bounded safe namespace;
- regular host-owned config file, not a symlink;
- explicit active key id;
- bounded keyring;
- keys resolved process-locally from environment variables;
- exact 32-byte key material after decoding;
- legacy plaintext disabled by default;
- explicit quotas for object / namespace / global bytes.

The browser receives at most redacted state such as `enabled`, memory policy mode, and recall/learning lifecycle summaries.

## 6. Scopes

Continuous Memory already supports:

- `global`;
- `workspace`;
- `project`;
- `user`;
- `agent`.

WebChat will not let the browser invent scope identity.

Configured scope IDs are host-owned. Long-Term Memory hashes scope identity before persistence.

Initial local WebChat integration should normally expose only the scopes explicitly configured by the host, with `user` / `project` preferred over `global`.

## 7. Model integration

Memory recall must be injected **before** the provider retry/fallback orchestrator captures and adapts the BASE prompt.

Required sequence:

```text
Kernel accepted turn
→ build bounded conversation snapshot
→ ContinuousMemory.beforeTurn()
→ produce FURYPIPE_MEMORY_DATA_V1 context block
→ construct model-neutral BASE FuryPrompt including memory context
→ provider adapter/profile/context
→ exact provider permit
→ provider execution
→ strict response decode
→ Kernel.completeTurn()
→ ContinuousMemory.afterTurn()
```

This preserves the existing provider invariant:

> Every retry/fallback attempt starts from the same model-neutral BASE prompt and reconstructs adapter/profile/context/request/permit.

Memory must never be injected after provider-specific adaptation.

## 8. Model bridge API direction

The browser-facing command remains:

`conversation.model.execute`

The browser does not send memory text, recalled entries, scope IDs, candidate lists, or memory-write flags.

The model bridge will use a process-local memory coordinator configured at construction time.

A host-owned memory coordinator may augment the BASE FuryPrompt context for the exact active turn and receive the completed assistant message for post-turn learning.

No serialized memory receipt becomes execution authority.

## 9. Learning modes

### Initial safe mode — explicit / confirmed only

Default WebChat policy:

```text
allowInferred = false
allowSensitive = false
```

This permits explicit-user and user-confirmed memories that satisfy confidence/importance bounds while refusing inferred learning by default.

### Optional inferred mode

A future explicit host opt-in may enable inferred candidates using the existing high-confidence Continuous Memory threshold.

Enabling inferred memory must not be a browser toggle and must not weaken secret/sensitive handling.

## 10. Analyzer governance

`ContinuousMemoryAnalyzer` is host-owned.

Phase 2A.6 must not call a provider outside the governed provider fabric.

If a model-backed analyzer is enabled:

- provider/model route is host-owned;
- provider inference is independently permitted;
- analyzer prompt is bounded and model-neutral;
- analyzer output is strict structured data;
- malformed candidate output fails learning, not the completed user turn;
- no analyzer failure triggers model-response replay;
- analyzer cannot mark its own output as verified tool evidence;
- secret/sensitivity policy is revalidated by Continuous Memory after analyzer output.

A deterministic explicit-only analyzer remains a valid no-extra-provider configuration.

## 11. Forget / user control

Forget is a separate governed memory operation.

Planned commands:

- `memory.status`
- `memory.forget`

A later inspection surface may expose bounded recalled-memory metadata, but raw Recovery handles, raw scope IDs, encryption config and host paths remain hidden.

Soft forget publishes a tombstone.

Hard forget is a distinct explicit action and purges memory revisions + referenced payloads through the existing Continuous Memory / Long-Term Memory path.

No inferred analyzer result may issue FORGET; the existing engine already rejects inferred forget candidates.

## 12. Gateway scopes

Use existing memory scopes:

- `memory.read`
- `memory.write`
- `memory.manage`

Proposed mapping:

- status / recall lifecycle metadata: `memory.read`;
- explicit remember/learning control: `memory.write`;
- hard forget / administrative purge: `memory.manage`.

Memory operations must not inherit `capability.provider-inference`, `network`, `process` or MCP permissions unless a separate governed provider/tool operation genuinely requires them.

## 13. WebChat UX

Memory lifecycle is shown separately from chat and Tools.

At minimum the UI must distinguish:

- Memory disabled;
- Recall started;
- Recall completed;
- Recall truncated;
- No recall;
- Learning completed;
- Learning skipped by policy;
- Learning failed after execution;
- Forget completed;
- Hard purge completed.

The UI must never claim "remembered" merely because an analyzer proposed a candidate.

## 14. Failure semantics

### Recall failure

```text
provider execution = not started
Kernel turn = failed
memory = recall failure
```

Fail closed. Do not call the provider with partially established memory state.

### Learning failure after model completion

```text
provider execution = already completed
Kernel assistant message = completed
memory learning = failed_after_execution
retry provider = forbidden
```

The assistant response remains valid. Memory failure is separately surfaced.

### Recovery verification failure

Do not use the recalled payload. Fail closed before provider execution.

## 15. Gate sequence

### Gate 2A.6.0 — architecture
- exact lifecycle and authority boundaries;
- host config contract;
- provider integration point.

### Gate 2A.6.1 — encrypted local memory runtime
- strict host config;
- Recovery quotas/encryption;
- Continuous Memory engine construction;
- redacted runtime status.

### Gate 2A.6.2 — governed recall into model BASE
- recall before provider execution;
- bounded memory context;
- retry/fallback receives the same BASE;
- recall failure prevents provider invocation.

### Gate 2A.6.3 — post-turn learning
- explicit/confirmed safe policy;
- learning after Kernel completion;
- failure-after-execution receipt;
- no provider replay.

### Gate 2A.6.4 — user memory controls
- status;
- soft forget;
- hard purge;
- WebChat lifecycle UX.

### Gate 2A.6.5 — optional governed analyzer
- only if needed for automatic learning;
- host opt-in;
- strict structured decoder;
- independent provider permits.

## 16. Required tests

Before Phase 2A.6 can pass:

- memory disabled by default;
- config secrets/keys never appear in CLI/WebChat results;
- relative/symlink config paths fail closed;
- invalid or missing encryption keys fail closed;
- plaintext legacy reads disabled by default;
- recall happens before provider invocation;
- recall integrity failure results in zero provider transport invocations;
- memory context is present in every retry/fallback BASE reconstruction identically;
- memory data cannot inject system/developer authority;
- secret candidate is never stored;
- sensitive candidate is rejected by default;
- inferred candidate is rejected by WebChat default policy;
- explicit memory can persist across process-style Recovery reopen;
- learning failure after successful model execution does not retry provider;
- soft forget tombstones;
- hard forget purges revisions and payloads;
- raw scope IDs are absent from persisted Long-Term Memory metadata;
- no browser storage contains memory;
- package smoke remains green;
- 9/9 CI matrix remains green;
- Secret Scan / Benchmark / RC Evidence remain green;
- Chromium / Firefox / WebKit QA remains green.

## 17. Completion invariant

Phase 2A.6 is complete only when FuryPipe can prove:

```text
recalled != instruction
candidate != remembered
remembered != verified-current
memory failure != provider retry
forget != hard purge
browser session != memory write authority
memory write authority != provider/tool execution authority
```
