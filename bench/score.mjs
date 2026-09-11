#!/usr/bin/env node
// bench/score.mjs — score pxpipe events.jsonl for cache health + cost.
//
//   node bench/score.mjs <run-dir | events.jsonl>            # single run
//   node bench/score.mjs <runA> <runB>                       # A/B diff (B - A)
//
// Writes score.json next to each events.jsonl. No deps, node >= 18.

import fs from 'node:fs';
import path from 'node:path';

const CACHE_CREATE_RATE = 1.25; // matches src/core/baseline.ts
const CACHE_READ_RATE = 0.1;

function loadRows(arg) {
  let file = arg;
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    file = path.join(arg, 'events.jsonl');
  }
  if (!fs.existsSync(file)) {
    console.error(`score: no events file at ${file}`);
    process.exit(1);
  }
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const p = r.path ?? '';
    if (p.includes('count_tokens')) continue;      // token-count probes aren't billed turns
    if (p && !p.includes('/v1/messages')) continue;
    if (r.input_tokens == null && r.output_tokens == null) continue; // errored / no usage
    rows.push(r);
  }
  return { file, rows };
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
const p50 = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function summarize(rows) {
  const sessions = new Map();
  for (const r of rows) {
    const key = r.first_user_sha8 ?? 'unknown';
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(r);
  }
  const perSession = [];
  for (const [key, rs] of sessions) {
    rs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const stopReasons = {};
    let flips = 0, coldRestarts = 0, flipWaste = 0, safety = 0;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (r.stop_reason) stopReasons[r.stop_reason] = (stopReasons[r.stop_reason] ?? 0) + 1;
      if (r.safety_flagged) safety++;
      if (i > 0) {
        if (r.cache_prefix_sha8 && rs[i - 1].cache_prefix_sha8 &&
            r.cache_prefix_sha8 !== rs[i - 1].cache_prefix_sha8) flips++;
        if ((r.cache_read_tokens ?? 0) === 0) {
          coldRestarts++;
          flipWaste += r.cache_create_tokens ?? 0;
        }
      }
    }
    const create = sum(rs, (r) => r.cache_create_tokens);
    const read = sum(rs, (r) => r.cache_read_tokens);
    const input = sum(rs, (r) => r.input_tokens);
    perSession.push({
      session: key,
      requests: rs.length,
      input_tokens: input,
      output_tokens: sum(rs, (r) => r.output_tokens),
      cache_create_tokens: create,
      cache_read_tokens: read,
      cost_units: Math.round(input + CACHE_CREATE_RATE * create + CACHE_READ_RATE * read),
      prefix_flips: flips,
      cold_restarts: coldRestarts,
      flip_waste_tokens: flipWaste,
      safety_flagged: safety,
      stop_reasons: stopReasons,
      p50_duration_ms: p50(rs.map((r) => r.duration_ms)),
    });
  }
  perSession.sort((a, b) => b.requests - a.requests);
  const tot = (f) => sum(perSession, f);
  const overall = {
    sessions: perSession.length,
    requests: tot((s) => s.requests),
    input_tokens: tot((s) => s.input_tokens),
    output_tokens: tot((s) => s.output_tokens),
    cache_create_tokens: tot((s) => s.cache_create_tokens),
    cache_read_tokens: tot((s) => s.cache_read_tokens),
    cost_units: tot((s) => s.cost_units),
    prefix_flips: tot((s) => s.prefix_flips),
    cold_restarts: tot((s) => s.cold_restarts),
    flip_waste_tokens: tot((s) => s.flip_waste_tokens),
    safety_flagged: tot((s) => s.safety_flagged),
  };
  return { overall, perSession };
}

const fmt = (n) => n.toLocaleString('en-US');

function printRun(file, s) {
  const o = s.overall;
  console.log(`\n== ${file}`);
  console.log(
    `   sessions=${o.sessions} requests=${o.requests} ` +
    `in=${fmt(o.input_tokens)} out=${fmt(o.output_tokens)} ` +
    `create=${fmt(o.cache_create_tokens)} read=${fmt(o.cache_read_tokens)}`
  );
  console.log(
    `   cost_units=${fmt(o.cost_units)}  prefix_flips=${o.prefix_flips}  ` +
    `cold_restarts=${o.cold_restarts}  flip_waste=${fmt(o.flip_waste_tokens)}  ` +
    `safety_flagged=${o.safety_flagged}`
  );
  for (const p of s.perSession.slice(0, 12)) {
    console.log(
      `   - ${p.session}  n=${p.requests}  cost=${fmt(p.cost_units)}  ` +
      `flips=${p.prefix_flips}  cold=${p.cold_restarts}  waste=${fmt(p.flip_waste_tokens)}  ` +
      `stops=${JSON.stringify(p.stop_reasons)}  p50=${p.p50_duration_ms}ms`
    );
  }
  if (s.perSession.length > 12) console.log(`   … +${s.perSession.length - 12} more sessions`);
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) {
  console.error('usage: node bench/score.mjs <run-dir|events.jsonl> [<run-dir|events.jsonl>]');
  process.exit(1);
}

const runs = args.map((a) => {
  const { file, rows } = loadRows(a);
  const s = summarize(rows);
  fs.writeFileSync(path.join(path.dirname(file), 'score.json'), JSON.stringify(s, null, 2));
  printRun(file, s);
  return s;
});

if (runs.length === 2) {
  const [a, b] = runs.map((r) => r.overall);
  console.log('\n== DIFF (B - A)');
  for (const k of ['requests', 'input_tokens', 'output_tokens', 'cache_create_tokens',
                   'cache_read_tokens', 'cost_units', 'prefix_flips', 'cold_restarts',
                   'flip_waste_tokens', 'safety_flagged']) {
    const d = b[k] - a[k];
    const pct = a[k] ? ` (${(100 * d / a[k]).toFixed(1)}%)` : '';
    console.log(`   ${k}: ${fmt(a[k])} -> ${fmt(b[k])}  ${d >= 0 ? '+' : ''}${fmt(d)}${pct}`);
  }
}
