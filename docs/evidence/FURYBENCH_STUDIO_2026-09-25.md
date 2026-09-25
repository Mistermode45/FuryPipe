# FuryBench — Studio track (QA-04), 2026-09-25

Command: `pnpm run bench:studio` (script: `scripts/furybench-studio.ts`).
Output: `artifacts/furybench-studio/result.json` and `summary.md` (git-ignored).
No provider is called. All numbers below are from this container
(Linux, Node 22), on the branch head noted in each run.

## 1. Context capsule vs baselines

**Question.** Given one file that is about to change, does the context capsule fit the other files that
really changed with it into a fixed byte budget?

**Ground truth.** Other `src/` files changed in the same commit of this repository's history, a signal
independent of the import graph that the capsule uses. The shallow clone has 82 commits, giving 49
samples: commits touching 2–12 `src/*.ts` files that still exist, with up to 3 seeds per commit.

**Budget matched.** Every variant sees the same 286 candidate files and gets a 96 KiB budget, which is
1.7% of the full context. The capsule gets 8 KiB more for its pinned contract constraints, and those
constraints hold no file.

| Variant | Mean recall, before (head 621b959) | Mean recall, after this change |
|---|---|---|
| capsule | 0.199 | **0.282** |
| same-folder baseline | 0.201 | 0.201 |
| alphabetical baseline | 0 | 0 |

Paired comparison, after the change:

| Comparison | Wins | Losses | Ties |
|---|---|---|---|
| Capsule vs same-folder | 19 | 14 | 16 |
| Capsule vs alphabetical | 24 | 0 | 25 |

**What changed.** The first run showed the capsule no better than a plain same-folder heuristic. It
ranked only reverse dependents, the blast radius, above the rest. The compiler now ranks:
1. **Direct import neighbours:** files the change imports and files that import it.
2. **Transitive radius:** the rest of the blast radius.
3. **Same folder:** as a tie-breaker.

**Limits, stated plainly.**
- The same history was used before and after the change. The change is a general heuristic, not fitted
  to this data, but no held-out repository was measured yet.
- 49 samples from one TypeScript repository is a small sample.
- Recall of co-changed files is a proxy for useful context. It does not measure task success.
- On 14 of 49 samples the capsule loses to the same-folder baseline.

## 2. Dispatcher, plan level

The runs replay 19 commits that touch at least 2 files through the planner, then through FuryDispatcher,
in SINGLE and AUTO modes.

| Metric | SINGLE | AUTO |
|---|---|---|
| Mean sequential steps (dispatch groups) | 7.105 | 5.316 |
| Mean agents | 1 | 1.895 |

- AUTO produced a parallel plan for 18 of 19 commits.
- Parallel writers with overlapping write scopes in the same group: **0**. The script fails if this is
  ever non-zero.

**Limits.** Steps are a scheduling property, not measured wall time. No agent ran.

## 3. Local inference fit

**NOT_EXECUTED.** No reachable local inference server with a text model exists in this container. The
case runs `measureFuryLocalModel` (measured tokens/s) when one is present, and never estimates.
