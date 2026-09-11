#!/usr/bin/env node
// Offline paired re-analysis of the row-phase sweep. Loads dumped responses
// (/tmp/phase-probe-claude-fable-5-*.json), maps each to its padLines k via the
// usage token counts in /tmp/phase-sweep-k*.txt, then measures the phase effect
// with per-line fixed effects: excess(ℓ,k) = errRate(ℓ,k) − mean_k errRate(ℓ,·).
// Content cancels; only geometry remains. No API calls.
import { readFileSync, readdirSync } from 'node:fs';
import { PAD_Y, CELL_H } from '../../dist/core/render.js';

const P = 28;

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
        for (const mtxt of [got[jj - 2] + ' ' + got[jj - 1], got[jj - 2] + got[jj - 1]]) {
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

// --- map dumps to k via usage token counts in sweep stdout files ---
const keyOf = u => `${u.input_tokens}/${u.output_tokens}`;
const kByKey = new Map();
for (const f of readdirSync('/tmp').filter(f => /^phase-sweep-k\d\.txt$/.test(f))) {
  const txt = readFileSync('/tmp/' + f, 'utf8');
  const m = txt.match(/usage=(\{.*?\}) stop=/s);
  if (m) kByKey.set(keyOf(JSON.parse(m[1])), +f.match(/k(\d)/)[1]);
}

const runs = [];
for (const f of readdirSync('/tmp').filter(f => f.startsWith('phase-probe-claude-fable-5-') && f.endsWith('.json'))) {
  const d = JSON.parse(readFileSync('/tmp/' + f, 'utf8'));
  if (!(d.seedArg ?? '').includes('atlas')) continue;
  const k = kByKey.get(keyOf(d.resp.usage));
  runs.push({ file: f, k: k ?? 0, replicate: k == null, grid: d.grid, resp: d.resp });
}
console.log(`runs: ${runs.map(r => `k=${r.k}${r.replicate ? '(rep)' : ''}`).join(' ')}`);

// --- per-line error rates ---
const L = runs[0].grid.length;
const cells = []; // {l, k, rate, phase, straddle}
for (const run of runs) {
  const out = (run.resp.content?.find(b => b.type === 'text')?.text ?? '')
    .replace(/```[a-z]*\n?/g, '').split('\n').map(l => l.trimEnd()).filter(l => l.length);
  const matched = alignLines(run.grid, out);
  for (let l = 0; l < L; l++) {
    if (matched[l] == null) continue;
    const phase = (PAD_Y + (l + run.k) * CELL_H) % P;
    cells.push({ l, k: run.k, rate: lev(run.grid[l], matched[l]) / run.grid[l].length, phase, straddle: phase >= 21 });
  }
}

// per-line means (fixed effect)
const byLine = new Map();
for (const c of cells) (byLine.get(c.l) ?? byLine.set(c.l, []).get(c.l)).push(c.rate);
const lineMean = new Map([...byLine].map(([l, rs]) => [l, rs.reduce((a, b) => a + b, 0) / rs.length]));
for (const c of cells) c.excess = c.rate - lineMean.get(c.l);

const bucket = (sel) => {
  const xs = cells.filter(sel).map(c => c.excess);
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { n, mean, se: sd / Math.sqrt(n) };
};
console.log('\nphase, n(line×run), excessErr%, ±SE%');
for (const p of [...new Set(cells.map(c => c.phase))].sort((a, b) => a - b)) {
  const { n, mean, se } = bucket(c => c.phase === p);
  console.log(`${String(p).padStart(2)}${p >= 21 ? '*' : ' '} , ${n}, ${(100 * mean).toFixed(2)}, ±${(100 * se).toFixed(2)}`);
}
const s = bucket(c => c.straddle), a = bucket(c => !c.straddle);
console.log(`\nstraddle(≥21): ${(100 * s.mean).toFixed(2)}%±${(100 * s.se).toFixed(2)} (n=${s.n})  aligned: ${(100 * a.mean).toFixed(2)}%±${(100 * a.se).toFixed(2)} (n=${a.n})  z=${((s.mean - a.mean) / Math.hypot(s.se, a.se)).toFixed(2)}`);

// hardest lines: err across k to eyeball content-vs-geometry
const hard = [...lineMean].sort((x, y) => y[1] - x[1]).slice(0, 6);
console.log('\nhardest lines (idx, meanErr%, per-run rate% by k, head):');
for (const [l, m] of hard) {
  const per = cells.filter(c => c.l === l).sort((x, y) => x.k - y.k).map(c => `k${c.k}${c.straddle ? '*' : ''}:${(100 * c.rate).toFixed(0)}`);
  console.log(`#${l} ${(100 * m).toFixed(1)}% [${per.join(' ')}] ${JSON.stringify(runs[0].grid[l].slice(0, 48))}`);
}
