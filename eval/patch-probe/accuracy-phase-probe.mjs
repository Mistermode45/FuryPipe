#!/usr/bin/env node
// Probe 2: OCR accuracy vs glyph↔patch phase, using the PRODUCTION renderer.
// gcd(CELL_W=5,28)=1 → one image contains all 28 horizontal phases;
// gcd(CELL_H=8,28)=4 → 7 vertical phases. Content is gibberish lowercase
// 4-letter groups (no language prior, not credential-shaped → avoids the
// refusal classifier that fires on mixed-case alnum strings). Every 5th cell
// is a space; cols must be a multiple of lcm(5,28)=140 so each phase sees an
// equal number of letter cells (4 letters + 1 space per phase per 140 cols).
//
// Usage: CC_OAUTH_TOKEN=... node accuracy-phase-probe.mjs [model] [cols] [rows] [seed]
//   cols: multiple of 140, rows: multiple of 7.
// NOTE: real inference — costs output tokens.

import { writeFile } from 'node:fs/promises';
import { renderTextToPngs, PAD_X, PAD_Y, CELL_W, CELL_H } from '../../dist/core/render.js';

const model = process.argv[2] ?? 'claude-fable-5';
const COLS = +(process.argv[3] ?? 140);
const ROWS = +(process.argv[4] ?? 21);
const seedArg = process.argv[5] ?? '1';
const PADL = +(process.argv[6] ?? 0); // blank lines prepended to the IMAGE only: shifts row phase by PADL*CELL_H px, content identical
const fileMode = !/^\d+$/.test(seedArg); // non-numeric 5th arg = path to a real text file
const seed = fileMode ? 1 : +seedArg;
const P = 28;
if (!fileMode && (COLS % 140 || ROWS % 7)) console.error(`warn: cols%140=${COLS % 140} rows%7=${ROWS % 7} — phases unbalanced`);

let s = (seed >>> 0) || 1;
const rnd = () => (s ^= s << 13, s ^= s >>> 17, s ^= s << 5, (s >>> 0) / 2 ** 32);
// Random-order REAL dictionary words: refusal-safe, production-representative.
// Language prior is phase-independent, so straddle effects survive as relative
// error-rate differences. Phase balance is statistical, not exact (per-phase
// totals are tracked, so unevenness is handled in the rates).
const { readFileSync } = await import('node:fs');
let grid;
if (fileMode) {
  // Production-representative content: real source text, pre-wrapped to COLS.
  grid = readFileSync(seedArg, 'utf8').split('\n')
    .map(l => l.replace(/\t/g, '  ').replace(/[^\x20-\x7e]/g, '?').trimEnd().slice(0, COLS))
    .filter(l => l.trim().length >= 8)
    .slice(0, ROWS);
  if (grid.length < ROWS) console.error(`warn: file only yielded ${grid.length} lines`);
} else {
  const WORDS = readFileSync('/usr/share/dict/words', 'utf8').split('\n')
    .filter(w => /^[a-z]{3,7}$/.test(w));
  grid = Array.from({ length: ROWS }, () => {
    let line = '';
    for (;;) {
      const w = WORDS[(rnd() * WORDS.length) | 0];
      if (line.length + w.length + (line ? 1 : 0) > COLS) break;
      line += (line ? ' ' : '') + w;
    }
    return line;
  });
}

const imgs = await renderTextToPngs('\n'.repeat(PADL) + grid.join('\n'), COLS);
if (PADL) console.error(`padLines=${PADL} (row shift ${PADL * CELL_H}px, phase +${(PADL * CELL_H) % 28} mod 28)`);
if (imgs.length !== 1) throw new Error(`expected 1 image, got ${imgs.length}`);
const img = imgs[0];
const png = img.png ?? img.data ?? img.buffer ?? Object.values(img).find(v => v instanceof Uint8Array);
if (!png) throw new Error('no png buffer; keys=' + Object.keys(img).join(','));
console.error(`image: ${img.width ?? '?'}x${img.height ?? '?'}px ${png.length}B; predicted image_tokens=` +
  (img.width && img.height ? 3 + Math.ceil(img.width / P) * Math.ceil(img.height / P) : '?'));

const BASE = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
const res = await fetch(`${BASE}/v1/messages`, {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${process.env.CC_OAUTH_TOKEN}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model,
    max_tokens: ROWS * (COLS + 2) + 1500,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{
      role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } },
        { type: 'text', text: `OCR this image to plain text. Preserve line breaks. Output only the text.` },
      ],
    }],
  }),
});
const j = await res.json();
if (!res.ok) { console.error('API error:', JSON.stringify(j)); process.exit(1); }
await writeFile(`/tmp/phase-probe-${model}-${Date.now()}.json`, JSON.stringify({ model, cols: COLS, rows: ROWS, seedArg, padLines: PADL, grid, resp: j }, null, 2));
const out = (j.content?.find(b => b.type === 'text')?.text ?? '')
  .replace(/```[a-z]*\n?/g, '').split('\n').map(l => l.trimEnd()).filter(l => l.length);
console.error(`usage=${JSON.stringify(j.usage)} stop=${j.stop_reason} lines=${out.length}/${ROWS}`);
if (out.length < ROWS) console.error('rawTextHead: ' + JSON.stringify((j.content?.find(b => b.type === 'text')?.text ?? '').slice(0, 200)));

// Alignment-based scoring: Levenshtein backtrace marks which truth positions
// matched exactly; everything else (sub or indel) is an error at its truth pos.
function alignOk(truth, got, subs) {
  const T = truth.length, G = got.length;
  const dp = Array.from({ length: T + 1 }, () => new Array(G + 1).fill(0));
  for (let i = 0; i <= T; i++) dp[i][0] = i;
  for (let jj = 0; jj <= G; jj++) dp[0][jj] = jj;
  for (let i = 1; i <= T; i++) for (let jj = 1; jj <= G; jj++)
    dp[i][jj] = Math.min(dp[i - 1][jj - 1] + (truth[i - 1] === got[jj - 1] ? 0 : 1), dp[i - 1][jj] + 1, dp[i][jj - 1] + 1);
  const ok = new Array(T).fill(false);
  let i = T, jj = G;
  while (i > 0 && jj > 0) {
    if (dp[i][jj] === dp[i - 1][jj - 1] + (truth[i - 1] === got[jj - 1] ? 0 : 1)) {
      if (truth[i - 1] === got[jj - 1]) ok[i - 1] = true;
      else subs.set(`${truth[i - 1]}->${got[jj - 1]}`, (subs.get(`${truth[i - 1]}->${got[jj - 1]}`) ?? 0) + 1);
      i--; jj--;
    } else if (dp[i][jj] === dp[i - 1][jj] + 1) i--;
    else jj--;
  }
  return ok;
}

// Line-level alignment BEFORE char scoring: the model may emit preamble lines,
// wrap long lines (1 truth : 2 out), or drop lines. Positional r->r pairing
// turns one such slip into a phase-flat error smear. Banded DP, merge-aware.
function lev(a, b) {
  const m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, k) => k), cur = new Array(m + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let k = 1; k <= m; k++)
      cur[k] = Math.min(prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1), prev[k] + 1, cur[k - 1] + 1);
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
function alignLines(truth, got) {
  const T = truth.length, G = got.length, BAND = 25, INF = 1e9;
  const dp = Array.from({ length: T + 1 }, () => new Array(G + 1).fill(INF));
  const bt = Array.from({ length: T + 1 }, () => new Array(G + 1).fill(null));
  dp[0][0] = 0;
  for (let jj = 1; jj <= G; jj++) { dp[0][jj] = dp[0][jj - 1] + 2; bt[0][jj] = ['spur']; }
  for (let i = 1; i <= T; i++) {
    dp[i][0] = dp[i - 1][0] + truth[i - 1].length; bt[i][0] = ['miss'];
    for (let jj = Math.max(1, i - BAND); jj <= Math.min(G, i + BAND); jj++) {
      let c = dp[i - 1][jj - 1] + lev(truth[i - 1], got[jj - 1]), b = ['m11'];
      if (jj >= 2 && dp[i - 1][jj - 2] < INF) {
        const merged = [got[jj - 2] + ' ' + got[jj - 1], got[jj - 2] + got[jj - 1]];
        for (const mtxt of merged) {
          const c2 = dp[i - 1][jj - 2] + lev(truth[i - 1], mtxt);
          if (c2 < c) { c = c2; b = ['m12', mtxt]; }
        }
      }
      if (dp[i][jj - 1] + 2 < c) { c = dp[i][jj - 1] + 2; b = ['spur']; }
      if (dp[i - 1][jj] + truth[i - 1].length < c) { c = dp[i - 1][jj] + truth[i - 1].length; b = ['miss']; }
      dp[i][jj] = c; bt[i][jj] = b;
    }
  }
  const matched = new Array(T).fill(null);
  let i = T, jj = G;
  while ((i > 0 || jj > 0) && bt[i][jj]) {
    const b = bt[i][jj];
    if (b[0] === 'spur') jj--;
    else if (b[0] === 'miss') i--;
    else if (b[0] === 'm12') { matched[i - 1] = b[1]; i--; jj -= 2; }
    else { matched[i - 1] = got[jj - 1]; i--; jj--; }
  }
  return matched;
}

const mk = () => ({ err: new Array(P).fill(0), tot: new Array(P).fill(0) });
const col = mk(), row = mk();
let errs = 0, tot = 0, missedLines = 0;
const subs = new Map();
const matched = alignLines(grid, out);
for (let r = 0; r < ROWS && r < grid.length; r++) {
  const truth = grid[r];
  if (matched[r] == null) { missedLines++; continue; } // structural, not phase-scorable
  const ok = alignOk(truth, matched[r], subs);
  for (let c = 0; c < truth.length; c++) {
    if (truth[c] === ' ') continue; // letters only
    const cp = (PAD_X + c * CELL_W) % P, rp = (PAD_Y + (r + PADL) * CELL_H) % P;
    col.tot[cp]++; row.tot[rp]++; tot++;
    if (!ok[c]) { errs++; col.err[cp]++; row.err[rp]++; }
  }
}
const agg = (m, pred) => {
  let e = 0, t = 0;
  for (let p = 0; p < P; p++) if (m.tot[p] && pred(p)) { e += m.err[p]; t += m.tot[p]; }
  return t ? `${(100 * e / t).toFixed(2)}% (${e}/${t})` : 'n/a';
};
console.log(`model=${model} cols=${COLS} rows=${ROWS} seed=${seed}`);
console.log(`overall acc=${(100 * (1 - errs / tot)).toFixed(2)}% errs=${errs}/${tot} scoredLines=${grid.length - missedLines}/${ROWS} missedLines=${missedLines} rawOutLines=${out.length}`);
console.log(`colStraddle(x%28>=24): ${agg(col, p => p >= 24)}  vs aligned: ${agg(col, p => p < 24)}`);
console.log(`rowStraddle(y%28>=21): ${agg(row, p => p >= 21)}  vs aligned: ${agg(row, p => p < 21)}`);
console.log('axis,phase,err,tot,errPct');
for (let p = 0; p < P; p++) if (col.tot[p]) console.log(`col,${p},${col.err[p]},${col.tot[p]},${(100 * col.err[p] / col.tot[p]).toFixed(1)}`);
for (let p = 0; p < P; p++) if (row.tot[p]) console.log(`row,${p},${row.err[p]},${row.tot[p]},${(100 * row.err[p] / row.tot[p]).toFixed(1)}`);
console.log('topConfusions: ' + [...subs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(' '));
