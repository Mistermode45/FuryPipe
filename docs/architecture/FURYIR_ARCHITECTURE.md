# FuryIR — Executable Intent Contract

Code: `src/fury-ir.ts` · tests: `tests/fury-ir.test.ts`

FuryIR (`furypipe-ir/v1`) is the single task representation consumed by the planner, dispatcher, context compiler, harness adapters and judge. Producing it from free-form text is model/harness work; `compileFuryIr()` guarantees what is produced is well-formed, bounded and authority-consistent.

| Field | Rule |
|---|---|
| `intent`, `must`, `mustNot` | bounded text, no control characters |
| `capabilities` | READ, WRITE, EXECUTE, NETWORK, EXTERNAL_ACTION → ALLOW / ASK / DENY (all required) |
| `privacy` | `local-only` (cannot ALLOW ambient NETWORK), `local-first`, `cloud-allowed` |
| `budget` | cost, tokens, wall time, agents (≥1), retries, cloud calls, tool calls; finite and capped |
| `successPredicates` | ≥1 MUST; each with an evidence contract mapping to FuryJudge requirements |
| `tasks` | DAG of ≤64 tasks with role, dependencies, declared capabilities and safe relative write scopes |
| `humanGates` | reference existing tasks; required before any EXTERNAL_ACTION task unless the contract ALLOWs it |
| `rollbackPolicy` | none, revert-worktree, manual |

Rejected: unknown keys, non-plain objects, cycles, unknown or self dependencies, duplicate ids, a task asking for a capability the contract DENYs, WRITE without a scope or a scope without WRITE, absolute/parent-traversal scopes.

The compiled document is frozen, has a deterministic topological `order` (lexical tie-break) and a canonical sha256 `digest`. `furyIrRequirements()` maps predicates to judge requirements; `readyFuryIrTasks()` returns tasks whose dependencies are done.
