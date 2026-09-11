# Effective-context needle test — attempt log

Goal: model reads the imaged (pxpipe-compressed) context and answers
`balance=<n>, count=<m>, final=<n+m>` correctly. Iterate on render crispness
until it passes. Keep every failure here so we don't repeat dead ends.

## Attempt 1 — 2026-07-03T03:32Z — INVALID (not a legibility test)

- Headless `claude -p` with b.sh prompt, `--model claude-fable-5[1m]`, via :47824.
- Reply: `balance=15021, count=9, final=15030` (expected 15021 / 10 / 15031).
- All 9 reported AUDIT-ZX9 hits matched grep ground truth line-for-line.
- **Failure A (task noise):** model never opened filler-000 — transcript has 0
  mentions. "numerical order" was read as starting at 001. Fixed by making the
  prompt explicit in a.sh/b.sh (numbering starts at 000).
- **Failure B (invalidates the run):** transcript shows all 74 assistant
  messages ran `claude-opus-4-8`, not fable — the CLI's main loop switched to
  Opus despite `--model` (aux requests still fable; probes reproduce this with
  and without `[1m]`). The :47824 proxy at the time was the cost-ab instance
  (`PXPIPE_MODELS=claude-fable-5`), so every opus request **passed through
  uncompressed** → "perfect recall" was of raw text, proves nothing.
- Fix: `setup.sh opus` → compress scope fable+opus, fresh ec logs
  (`~/.pxpipe/ec-on.jsonl`) + PNG dumps (`/tmp/ec-png`), reseeded /tmp copies.
- Lesson: always verify per-request `compressed=true` for the *session that
  answered* (match `first_user_sha8`, don't trust tail-of-log).

## Attempt 2 — 2026-07-03T04:24Z — PASS on legibility (recorded A/B, both arms fable)

- Recorded side-by-side (`Fable-AB-Demo.mp4`, Drive id
  `1pmI3quwv7uuNQ2Z7KMW-78OUOE30AzmU`): LEFT = a.sh plain passthrough,
  RIGHT = b.sh via pxpipe :47824, both `claude-fable-5[1m]`, prompt with the
  filler-000 fix from attempt 1.
- **Both arms content-correct:** count=10 (segment tallies 6/2/1/1 — matches
  attempt-1 grep ground truth line-for-line, incl. filler-000 line 221) and
  ledger 8037 → 8519 → 7899 → 15798 → 15021. The imaged-context arm read every
  filler render individually — legibility on fable confirmed at task scale, not
  just eval scale.
- LEFT emitted the exact `balance=15021, count=10, final=15031` line in one
  reply (5m 3s churn). Session after both demos: **$42.21**, /context
  964.5k/1M (96%, messages 912.9k) — one task from forced autocompact.
- RIGHT split the answer: tally table first, needed one follow-up ("and: (1)
  the final ledger balance…") to emit 15,021. **Format/instruction miss, not a
  legibility miss.** Session: **$4.51**, cache-read 451.8K vs LEFT's 21.7M.
- Remaining gap (open): single-reply format compliance on the compressed arm —
  prompt-shape issue; the "Reply as: balance=<n>, count=<m>, final=<n+m>"
  instruction sits inside the imaged region once history is compressed, so it
  competes with the OCR banner. Candidate fix: keep the final-format sentence
  in the protected text tail (it's an exact-value instruction — same class as
  the lossy-limit rule that keeps numbers as text).
