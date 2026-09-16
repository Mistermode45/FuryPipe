# Demo 1 — cost A/B

**What it measures:** does FuryPipe cost less on a real coding task? **Honest verdict:
~break-even on cost.** The compression is real (~55% fewer *real* tokens, verified)
but it lands in `cache_read` — cheap at `$` (0.1×), and its weight against a Pro/Max
weekly cap is unpublished. The capability story is in
[`../effective-context/`](../effective-context/README.md).

Two columns fix the **same** failing test suite in isolated working copies — one
plain, one through FuryPipe — **both behind a proxy so both arms are logged.** It's a
real project (`template/`): the fix hinges on precise `SPEC.md` rules (volume tiers by
*total quantity*, loyalty applied *after* the discount, *banker's* rounding), so it
doubles as a recall test. `node --test` is built in (no install).

---

## Run it — 3 scripts, 3 terminals

```bash
# Terminal 1 — set up: kills old proxies, builds, starts BOTH proxies, seeds copies
bash demo/cost-ab/setup.sh             # Fable 5 (production default)
bash demo/cost-ab/setup.sh opus        # ...or arm any other model, once, here

# Terminal 2 — LEFT  = normal   (interactive Claude — you watch the CLI)
bash demo/cost-ab/a.sh                 # inherits the model setup.sh armed

# Terminal 3 — RIGHT = FuryPipe   (interactive Claude)
bash demo/cost-ab/b.sh                 # same model, automatically
```

`a.sh` / `b.sh` launch a **real interactive Claude session** with the task prompt
already submitted — you see the CLI work, nothing headless. They run two real
sessions (uses plan usage). `claude` is usually a shell alias; the scripts resolve
the real binary, or set `CLAUDE_BIN=/path/to/claude`. To redo a run, re-run
`setup.sh` (it resets the working copies + fresh logs), then `a.sh` / `b.sh`.

**Model:** choose it **once**, in `setup.sh`; `a.sh` and `b.sh` inherit it. That is
the point — an A/B across two *different* models measures nothing, and the old
"pass it to all three" contract made that mistake one typo away.

`setup.sh` takes `fable` (default), `opus`, `sonnet`, `haiku`, or any full
`claude-…` id; `FURYPIPE_DEMO_MODEL=opus bash demo/cost-ab/setup.sh` works too. The
alias table is [`demo/models.sh`](../models.sh) — the single place to edit when a
new model ships, instead of six scripts.

`setup.sh` adds the model to the `:48724` proxy's compress scope **and records the
choice**. `a.sh`/`b.sh` default to it, and `b.sh` **refuses to run** a model that
isn't in scope: FuryPipe would pass it through uncompressed, so the arm would look
like a FuryPipe result while measuring nothing. Override a single column with
`b.sh sonnet` if you actually want that. You can also toggle scope live on the
dashboard "compress models" chips.

## See the result — just open the dashboard

Each proxy serves a **live dashboard** in your browser — no commands, no extra window:

| open in browser | shows |
|---|---|
| **http://127.0.0.1:48724/** (FuryPipe → `b.sh`) | **`THIS SESSION — N% fewer tokens (… total)`** |
| http://127.0.0.1:48723/ (plain → `a.sh`) | ~0% — the passthrough **control** |

It updates as the run goes. The headline is the **honest, rate-free number**: real
server tokens (`input+cache_create+cache_read+output`) vs the same body as text
(`count_tokens`) — two real numbers, one division, no rate/cap assumptions. The
plain dashboard reading ~0% proves the method doesn't invent savings.

**Optional CLI** (same numbers, if you prefer a terminal):
```bash
node eval/ab/savings.mjs                                                # token compression, both arms
node eval/ab/analyze.mjs ~/.furypipe/ab-on.jsonl ~/.furypipe/ab-off.jsonl   # $ / cap?? (divergence-confounded)
```
The `$`/`cap??` deltas from `analyze.mjs` compare two *different* runs, so they're
muddied by divergence — trust the per-arm token % (dashboard or `savings.mjs`).
What the token cut *saves* depends on pricing (`cache_read` ×0.1 at `$`; weekly-cap
weight unknown).

## The other demo
This is the **cost** demo. The **capability** demo ("does FuryPipe stay sharp where plain
drowns?") is in [`../effective-context/`](../effective-context/README.md) — the more
promising story, since cost is ~break-even.
