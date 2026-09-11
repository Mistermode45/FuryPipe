# Patch-grid probe findings

## Probe 1 — billing staircase (count_tokens, free) ✅

- Both `claude-fable-5` and `claude-sonnet-5` bill vision on a **28×28 px patch
  grid**. The "Sonnet uses 32×32" rumor is false: image_tokens steps occur
  exactly when W or H crosses a multiple of 28, on both axes, both models
  (CSVs in this dir).
- Formula: `image_tokens = 3 + ceil(W/28) * ceil(H/28)` (fixed +3 per image).
  Spot check at H=28: W=53..56 → 5 tokens (2 patches), W=57..60 → 6 (3 patches).
- The docs' `(W×H)/750` is just an approximation of 784 px²/patch (28²) plus
  the constant.
- No server-side resample at ≤1568 px long edge: a 1.73 MP image bills the full
  grid, so there is no ~1.15 MP cap kicking in — what we render is exactly what
  the model sees.

## Geometry consequences for pxpipe (CELL 5×8, PAD_X = PAD_Y = 4)

- Height = 8 + 8·rows → hits a 28-multiple iff **rows ≡ 6 (mod 7)**
  (every 7 rows = 56 px = exactly 2 patch rows).
  `MAX_HEIGHT_PX = 728` at 90 rows = 26 patch rows, a perfect fit.
- Width = 8 + 5·cols (+ atlas slack) → hits a 28-multiple iff
  **cols ≡ 4 (mod 28)** (every 28 cols = 140 px = 5 patch cols).
  312 cols → 1568 px = 56 patch cols, also a perfect fit at the width cap.
- Full-cap page: 312 × 90 = 28,080 chars for 3 + 56·26 = **1459 tokens ≈ 19.2
  chars/token** — the density ceiling for this geometry.
- Snapping rule: pick rows ≡ 6 (mod 7) and cols ≡ 4 (mod 28); anything else
  strands already-paid patch area (up to 27 px per axis, ~1–3% of the bill).
- Phase structure: gcd(5,28)=1 → all 28 horizontal glyph↔patch phases occur in
  every image; gcd(8,28)=4 → only 7 distinct vertical phases.

## Probe 2 — accuracy vs phase ✅ (verdict: phase alignment does NOT matter)

- Question: do glyphs straddling a patch boundary misread more? A 5 px glyph
  straddles when `x mod 28 ≥ 24`; an 8 px glyph row straddles when
  `y mod 28 ≥ 21`. If straddle phases dominate errors, phase-locked pitch
  (fractional 5.6 / 9.33 px advances, ≈24% density cost) could pay for itself;
  if flat, keep packed 5×8 and close the alignment theory.
- Method notes (pitfalls that produced false signals first):
  - Pure-random char grids trip the safety layer ("looks like credentials") —
    use real repo source as content.
  - `temperature` is rejected by fable/sonnet-5 → sampling is stochastic;
    single runs are NOT repeatable (same image scored 169 vs 237 errs).
  - Models wrap/merge lines (sonnet emitted 101 lines for 90); positional
    line pairing turns one slip into a phase-flat ~27% error smear. The
    harness now does banded line-level DP alignment before char scoring
    (sonnet went 72.54% → 99.87% on the identical response).
  - Within one image, row phase aliases content line-type every 7 lines
    (8·7 = 56 = 2 patches) → row buckets are confounded. Controlled sweep:
    prepend k = 0..6 blank lines (shifts content by 8k px through all 7 row
    phases, content identical), then score with per-line fixed effects
    (`rescore-sweep.mjs`, offline, from dumped responses).
- **Results (claude-fable-5, 312×90 production geometry):**
  - Columns (within-image, content-controlled by construction): straddle
    4.47% vs aligned 4.60% on 3,691 chars — null, per-phase table flat.
  - Rows (7-offset paired sweep, 439 line×run cells): straddle excess
    −0.16%±0.28 vs aligned +0.03%±0.29, **z = −0.45** — null.
  - Real code at full page: fable 99.96% (1/2,276), sonnet 99.87% (3/2,276).
    28,080 chars for 1,459 image tokens ≈ 19.2 chars/token with ~0.1% CER.
- **What actually causes misreads** (in error-yield order):
  1. Long high-entropy runs (base64/hex blobs): bimodal derailment — the
     same line on the same pixels scored 4% and 73% error across runs. The
     decoder loses lock mid-run with no language prior to recover; this, not
     geometry, is the production misread mechanism.
  2. 5×8 confusables: `w→W` (11× in one page), `s→S`, `c→C`, `K→H`, `M→N`,
     `8→0`, `(→O`, `:→.` — legibility floor, context-corrected in real code.
  3. Line wraps on long lines — harmless after alignment, but consumers that
     trust exact line numbers must re-align.
- Recommendations: keep packed 5×8 (fractional-advance idea rejected); snap
  dims per Probe 1 for billing only; route/flag high-entropy lines (e.g.
  >64 chars of base64-ish content) as literal text instead of pixels.
