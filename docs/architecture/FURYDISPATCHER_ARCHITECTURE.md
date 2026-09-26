# FuryDispatcher and worktree isolation

Code: `src/fury-dispatcher.ts`, `src/fury-writer-pool.ts` · tests: `tests/fury-dispatcher.test.ts`, `tests/fury-graph.test.ts`

## Model

A runtime binding is harness × provider × model × locality (`local`/`cloud`) with per-skill scores (0..1) and a per-task cost estimate. Scores come from FuryBench/routing history; Studio currently derives bindings from real discovery with **empty scores** and says so.

`planFuryDispatch({ ir, candidates, mode, manual?, width?, coupling?, couplingThreshold? })` is pure and deterministic. It plans; it never executes.

## Modes

OFF (no dispatch), SINGLE, AUTO, MANUAL, PIPELINE, PARALLEL, COUNCIL, RACE, REVIEW_CHAIN, SPECIALISTS, LOCAL_CLOUD_HYBRID, LOCAL_ONLY, CUSTOM_GRAPH.

AUTO computes a dispatch benefit from the widest parallel level of the DAG and the number of skill classes. LOW (one task, or a single-width chain of one skill class) → SINGLE with one agent. Otherwise → SPECIALISTS.

## Invariants (tested)

- Child authority ≤ contract authority for every assignment (`assertFuryAuthorityWithin`); a task only receives the capabilities it declared.
- `LOCAL_ONLY` and `privacy: local-only` exclude cloud bindings; with no local binding the plan is BLOCKED.
- Writers with overlapping write scopes are never in the same parallel group. With `coupling` (e.g. `furyScopeCoupling` from FuryGraph), writers whose scopes share dependency edges are serialized too, and the plan states why.
- Reviewer, security and judge tasks prefer a harness different from the implementer's.
- Concurrent agents, estimated cost and cloud task runs stay within the IR budget, or the plan is BLOCKED with the reason.

## Worktrees

`createFuryWriterPool()` leases one real git worktree per writer task (branch `fury/<run>/<task>`). It is built on the existing coding-runtime worktree manager. The pool refuses double leases, rolls back partial acquisition for a plan and reaps orphaned worktrees left by crashed writers.
