#!/usr/bin/env node
// A/B analyzer for pxpipe ON vs OFF (passthrough) arms.
//
// Reads two events.jsonl logs — one from a pxpipe-ON proxy, one from a
// PXPIPE_DISABLE=1 passthrough proxy — and reports the honest comparison in
// BOTH accounting views, plus the deterministic per-request compression that
// is NOT confounded by trajectory divergence.
//
// Usage:
//   node eval/ab/analyze.mjs ~/.pxpipe/ab-on.jsonl ~/.pxpipe/ab-off.jsonl
//
// To capture the two logs the easy way, run the demo: demo/cost-ab/ (setup.sh
// starts both ON/OFF proxies with separate logs; a.sh/b.sh run the task).

import fs from 'node:fs';

const [onPath, offPath] = process.argv.slice(2);
if (!onPath || !offPath) {
  console.error('usage: node eval/ab/analyze.mjs <on.jsonl> <off.jsonl>');
  process.exit(1);
}

// Opus 4.8 list-$ ratios (relative to input) — DOCUMENTED.
const APIW = { input: 1, cc: 1.25, cr: 0.1, output: 5 };
// HYPOTHETICAL cap weights. cache_read=0 here ASSUMES the Pro/Max weekly/5h usage
// cap excludes cache reads — that is a RUMOR, UNCONFIRMED (Anthropic doesn't
// publish the cap formula). Treat this column as "what IF cache reads were free",
// not as fact. To measure it for real, capture anthropic-ratelimit-unified-5h/7d
// -utilization headers and regress the delta against the token buckets.
const CAPW = { input: 1, cc: 1, cr: 0, output: 1 };
const USD_PER_MTOK_INPUT = 5; // Opus 4.8 input $/MTok

function load(p) {
  return fs.readFileSync(p, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((r) => (r.path || '').includes('/v1/messages') && !(r.path || '').includes('count_tokens'));
}
const num = (r, k) => { const v = r[k]; const n = Number(v); return Number.isFinite(n) ? n : 0; };

function arm(rows) {
  let input = 0, cc = 0, cr = 0, output = 0, n = 0, compressed = 0;
  for (const r of rows) {
    const i = num(r, 'input_tokens'), c = num(r, 'cache_create_tokens'),
          d = num(r, 'cache_read_tokens'), o = num(r, 'output_tokens');
    if (i + c + d + o === 0) continue; // no usage (e.g. probe-only) — skip
    input += i; cc += c; cr += d; output += o; n += 1;
    if (r.compressed) compressed += 1;
  }
  const apiEff = input * APIW.input + cc * APIW.cc + cr * APIW.cr + output * APIW.output;
  const capTok = input * CAPW.input + cc * CAPW.cc + cr * CAPW.cr + output * CAPW.output;
  return { n, compressed, input, cc, cr, output,
    apiUsd: (apiEff * USD_PER_MTOK_INPUT) / 1e6, capTok };
}

const on = arm(load(onPath));
const off = arm(load(offPath));

const pct = (a, b) => (b > 0 ? ((b - a) / b) * 100 : 0);
const f = (x) => x.toLocaleString('en-US');

console.log('\n=== pxpipe A/B: ON vs OFF (passthrough) ===\n');
const col = (label, v) => `${label.padEnd(22)} ${String(v).padStart(14)}`;
for (const [name, a] of [['OFF (normal)', off], ['ON  (pxpipe)', on]]) {
  console.log(`-- ${name} --  (${a.n} reqs, ${a.compressed} compressed)`);
  console.log('   ' + col('input', f(a.input)));
  console.log('   ' + col('cache_create', f(a.cc)));
  console.log('   ' + col('cache_read', f(a.cr)));
  console.log('   ' + col('output', f(a.output)));
  console.log('   ' + col('$ (API list rates)', '$' + a.apiUsd.toFixed(4)));
  console.log('   ' + col('cap tokens (cr=0)', f(Math.round(a.capTok))));
  console.log('');
}

console.log('=== VERDICT (lower ON = pxpipe wins) ===');
console.log(`  API-$ view : ON $${on.apiUsd.toFixed(4)} vs OFF $${off.apiUsd.toFixed(4)}  ->  ${pct(on.apiUsd, off.apiUsd).toFixed(1)}% ${on.apiUsd <= off.apiUsd ? 'saved' : 'MORE'}`);
console.log(`  cap?? view : ON ${f(Math.round(on.capTok))} vs OFF ${f(Math.round(off.capTok))} cap-tok  ->  ${pct(on.capTok, off.capTok).toFixed(1)}% ${on.capTok <= off.capTok ? 'saved' : 'MORE'}`);
console.log('  (cap?? ASSUMES cache_read is free against the Pro/Max cap — UNCONFIRMED rumor, not measured. See CAPW note.)');

// Divergence guard: the two arms run different trajectories. If the work done
// differs a lot, the session-level $/cap deltas above are confounded — trust the
// per-request compression below instead.
const divOut = off.output > 0 ? on.output / off.output : 1;
const divReq = off.n > 0 ? on.n / off.n : 1;
console.log('\n=== DIVERGENCE CHECK (same task can still take different paths) ===');
console.log(`  requests  ON/OFF = ${divReq.toFixed(2)}   output ON/OFF = ${divOut.toFixed(2)}`);
if (Math.abs(divReq - 1) > 0.25 || Math.abs(divOut - 1) > 0.25) {
  console.log('  ⚠  arms diverged >25% — the session-level verdict is confounded by trajectory, NOT compression.');
  console.log('     Run the task several times per arm and compare medians, OR trust the per-request number below.');
} else {
  console.log('  arms are comparable (<25% divergence) — session-level verdict is meaningful.');
}

// Deterministic per-request compression (from the ON arm only): each request's
// own pre-compression body (baseline_tokens, a real count_tokens) vs what pxpipe
// actually sent (input+cc+cr). Same body, so NO divergence — this is the clean
// "does pxpipe send fewer tokens" answer.
const onRows = load(onPath).filter((r) => r.compressed && num(r, 'baseline_tokens') > 0);
let ratios = [];
for (const r of onRows) {
  const ppTok = num(r, 'input_tokens') + num(r, 'cache_create_tokens') + num(r, 'cache_read_tokens');
  if (ppTok > 0) ratios.push(ppTok / num(r, 'baseline_tokens'));
}
ratios.sort((a, b) => a - b);
const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
console.log('\n=== PER-REQUEST COMPRESSION (deterministic, no divergence) ===');
console.log(`  pxpipe body / text body, median over ${ratios.length} compressed reqs: ${med.toFixed(2)}`);
console.log(`  => pxpipe sends ${((1 - med) * 100).toFixed(0)}% fewer tokens per request than the same body as text.`);
console.log(`     Real compression — but it lands in cache_read, which is ~free against your cap (see cap view).`);
console.log('');
