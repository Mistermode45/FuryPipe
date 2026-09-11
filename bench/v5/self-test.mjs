#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compareTriplet, validateBenchmarkResult } from './contract.mjs';

const digest = (id, ch) => ({ id, sha256: ch.repeat(64) });
const base = {
  schema_version: 'furypipe-benchmark/v1',
  run_id: 'self-test',
  status: 'EXECUTED',
  source: { repository: 'Mistermode45/FuryPipe', commit: '1'.repeat(40) },
  provider: 'fixture-provider',
  model: 'fixture-model',
  fixture: digest('fixture-1', 'a'),
  prompt: digest('prompt-1', 'b'),
  toolset: digest('tools-1', 'c'),
  context: digest('context-1', 'd'),
  cache_state: 'cold',
  metrics: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    vision_tokens: 0,
    latency_ms: 100,
    ttft_ms: 20,
    local_transform_ms: 1,
    request_bytes: 200,
    response_bytes: 50,
    cost_usd: null,
    errors: 0
  },
  quality: { status: 'NOT_SCORED', score: null },
  exactness: { checked: true, passed: true, mismatches: 0 },
  recovery: { handles: 0, verified: null }
};

const result = (variant, inputTokens) => ({
  ...structuredClone(base),
  variant,
  metrics: { ...base.metrics, input_tokens: inputTokens }
});

const raw = result('raw', 100);
const pxpipe = result('pxpipe', 80);
const furypipe = result('furypipe', 70);

assert.deepEqual(validateBenchmarkResult(raw), []);
const comparison = compareTriplet([raw, pxpipe, furypipe]);
assert.equal(comparison.comparability, 'VERIFIED');
assert.equal(comparison.metrics.input_tokens.furypipe_vs_raw, -30);
assert.equal(comparison.metrics.input_tokens.furypipe_vs_pxpipe, -10);

const mismatched = structuredClone(furypipe);
mismatched.model = 'different-model';
assert.throws(() => compareTriplet([raw, pxpipe, mismatched]), /not comparable/);

const fake = structuredClone(furypipe);
fake.status = 'BENCHMARK_NON_EXECUTED';
assert.throws(() => compareTriplet([raw, pxpipe, fake]), /not EXECUTED/);

console.log('benchmark contract self-test: PASS');
