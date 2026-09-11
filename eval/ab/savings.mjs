#!/usr/bin/env node
// Real per-request token compression for the A/B run, straight from the proxy log.
//
//   real tokens = input_tokens + cache_create_tokens + cache_read_tokens   (what the
//                 server actually processed for pxpipe's request)
//   as-text     = baseline_tokens                                          (a real
//                 count_tokens of the SAME body, uncompressed)
//
// Same body -> no trajectory divergence. This is the genuine compression. What it
// SAVES depends on token pricing (cache_read is 0.1x at $; its cap weight is unknown).
//
//   node eval/ab/savings.mjs              # reads ab-on.jsonl (pxpipe) + ab-off.jsonl (plain)
//   node eval/ab/savings.mjs <file>       # one specific log

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const arg = process.argv[2];
const targets = arg
  ? [{ label: 'log', file: arg }]
  : [
      { label: 'pxpipe', file: path.join(home, '.pxpipe', 'ab-on.jsonl') },
      { label: 'plain ', file: path.join(home, '.pxpipe', 'ab-off.jsonl') },
    ];

const load = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const isMsg = (r) =>
  (r.path || '').includes('/v1/messages') &&
  !(r.path || '').includes('count_tokens') &&
  (Number(r.baseline_tokens) || 0) > 0;
const n = (r, k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
const fmt = (x) => x.toLocaleString('en-US');
const ratio = (r) => {
  const real = n(r, 'input_tokens') + n(r, 'cache_create_tokens') + n(r, 'cache_read_tokens');
  const base = n(r, 'baseline_tokens');
  return { real, base, pct: base > 0 ? (1 - real / base) * 100 : 0 };
};

console.log('\n=== real token compression (server usage vs same body as text) ===');
for (const { label, file } of targets) {
  const rows = load(file).filter(isMsg);
  if (!rows.length) { console.log(`${label}: no measured requests yet (${file})`); continue; }
  const f = ratio(rows[0]);
  const l = ratio(rows[rows.length - 1]);
  const sumReal = rows.reduce((s, r) => s + ratio(r).real, 0);
  const sumBase = rows.reduce((s, r) => s + ratio(r).base, 0);
  const sessionPct = sumBase > 0 ? (1 - sumReal / sumBase) * 100 : 0;
  console.log(`${label}  initial: ${fmt(f.real)} real vs ${fmt(f.base)} as-text  ->  ${f.pct.toFixed(0)}% fewer`);
  console.log(`${label}  latest : ${fmt(l.real)} real vs ${fmt(l.base)} as-text  ->  ${l.pct.toFixed(0)}% fewer`);
  console.log(`${label}  SESSION: ${fmt(sumReal)} real vs ${fmt(sumBase)} as-text  ->  ${sessionPct.toFixed(0)}% fewer  (${rows.length} reqs)`);
}
console.log('\nThis is the genuine token reduction. It saves real $ only at the cache_read rate (0.1x);');
console.log('its effect on a Pro/Max weekly cap depends on an unpublished cache_read weight.');
