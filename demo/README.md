# pxpipe demos

Two demos, two questions, two honest verdicts.

| folder | question | status |
|---|---|---|
| [**`cost-ab/`**](cost-ab/README.md) | Does pxpipe **cost less** on a real task? | **~break-even.** Compression is real but lands in `cache_read` (cheap at `$`, rumored-free at the subscription cap); session *divergence* dominates the totals. |
| [**`effective-context/`**](effective-context/README.md) | Does pxpipe stay **sharp** in a context that overloads the plain column? | **unvalidated** — modern long-context Claude may not "drown," so run it before claiming a win. |

What *is* validated: in the cost A/B's Rust-rewrite task, both columns ported a
whole library to Rust and **both passed all 5 tests with the exact expected
integers** — pxpipe through imaged spec + source. So compression **didn't break a
precision task**. pxpipe's case rests on **capability** (not breaking real work,
and effective context), not on saving tokens.

Shared tooling: [`../eval/ab/analyze.mjs`](../eval/ab/) reads the two proxy logs
(`ab-on.jsonl` / `ab-off.jsonl`) and reports the honest cost comparison.
