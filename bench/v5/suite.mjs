#!/usr/bin/env node
import fs from 'node:fs';
import { comparabilityFingerprint, validateBenchmarkResult } from './contract.mjs';

const VARIANTS = ['raw', 'pxpipe', 'furypipe'];
const METRICS = [
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'vision_tokens', 'latency_ms', 'ttft_ms', 'local_transform_ms',
  'request_bytes', 'response_bytes', 'cost_usd', 'errors',
];

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summary(values) {
  const known = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (known.length === 0) {
    return { known: 0, missing: values.length, min: null, max: null, mean: null, median: null, p95: null };
  }
  const mean = known.reduce((sum, value) => sum + value, 0) / known.length;
  return {
    known: known.length,
    missing: values.length - known.length,
    min: known[0],
    max: known[known.length - 1],
    mean,
    median: quantile(known, 0.5),
    p95: quantile(known, 0.95),
  };
}

function requireMinimumRuns(value) {
  const minimumRuns = value ?? 5;
  if (!Number.isSafeInteger(minimumRuns) || minimumRuns < 3 || minimumRuns > 100) {
    throw new RangeError('minimumRuns must be an integer between 3 and 100');
  }
  return minimumRuns;
}

export function assessBenchmarkSuite(results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('benchmark suite requires executed result objects');
  }
  const minimumRuns = requireMinimumRuns(options.minimumRuns);

  const runIds = new Set();
  const byVariant = Object.fromEntries(VARIANTS.map((variant) => [variant, []]));
  let fingerprint;

  for (const result of results) {
    const errors = validateBenchmarkResult(result);
    if (errors.length > 0) throw new Error(`invalid ${result?.variant ?? 'unknown'} result: ${errors.join('; ')}`);
    if (result.status !== 'EXECUTED') throw new Error(`${result.variant} result is not EXECUTED`);
    if (!byVariant[result.variant]) throw new Error(`unsupported benchmark variant: ${result.variant}`);
    if (runIds.has(result.run_id)) throw new Error(`duplicate benchmark run_id: ${result.run_id}`);
    runIds.add(result.run_id);

    const currentFingerprint = comparabilityFingerprint(result);
    if (fingerprint === undefined) fingerprint = currentFingerprint;
    else if (fingerprint !== currentFingerprint) {
      throw new Error('benchmark suite is not comparable: provider/model/fixture/prompt/toolset/context/cache_state differ');
    }
    byVariant[result.variant].push(result);
  }

  const counts = Object.fromEntries(VARIANTS.map((variant) => [variant, byVariant[variant].length]));
  const uniqueCounts = new Set(Object.values(counts));
  if (uniqueCounts.size !== 1) {
    throw new Error(`benchmark suite variant counts differ: raw=${counts.raw}, pxpipe=${counts.pxpipe}, furypipe=${counts.furypipe}`);
  }

  const repetitions = counts.raw;
  const blockers = [];
  if (repetitions < minimumRuns) {
    blockers.push(`requires at least ${minimumRuns} comparable repetitions per variant; got ${repetitions}`);
  }

  const exactnessFailures = results.filter((result) => result.exactness.checked !== true || result.exactness.passed !== true);
  if (exactnessFailures.length > 0) blockers.push(`${exactnessFailures.length} run(s) lack passing exactness evidence`);

  const errorRuns = results.filter((result) => result.metrics.errors !== 0);
  if (errorRuns.length > 0) blockers.push(`${errorRuns.length} run(s) reported benchmark errors`);

  const unscoredQuality = results.filter((result) => result.quality.status !== 'SCORED' || result.quality.score === null);
  if (unscoredQuality.length > 0) blockers.push(`${unscoredQuality.length} run(s) lack scored quality evidence`);

  const metrics = {};
  for (const key of METRICS) {
    metrics[key] = {};
    for (const variant of VARIANTS) {
      metrics[key][variant] = summary(byVariant[variant].map((result) => result.metrics[key]));
    }
  }

  const quality = {};
  for (const variant of VARIANTS) {
    quality[variant] = summary(byVariant[variant].map((result) =>
      result.quality.status === 'SCORED' ? result.quality.score : null));
  }

  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: repetitions,
    minimum_repetitions_for_claims: minimumRuns,
    claim_status: blockers.length === 0 ? 'CLAIM_ELIGIBLE' : 'METRICS_ONLY',
    claim_blockers: blockers,
    provider: results[0].provider,
    model: results[0].model,
    fixture: results[0].fixture,
    prompt: results[0].prompt,
    toolset: results[0].toolset,
    context: results[0].context,
    cache_state: results[0].cache_state,
    metrics,
    quality,
    exactness: {
      checked_runs: results.filter((result) => result.exactness.checked).length,
      passing_runs: results.filter((result) => result.exactness.checked && result.exactness.passed).length,
      mismatches: results.reduce((sum, result) => sum + result.exactness.mismatches, 0),
    },
    errors: {
      runs_with_errors: errorRuns.length,
      total: results.reduce((sum, result) => sum + result.metrics.errors, 0),
    },
    note: 'Descriptive statistics only; CLAIM_ELIGIBLE does not establish statistical significance or causal superiority.',
  };
}

function main(argv) {
  if (argv.length < 1) {
    console.error('usage: node bench/v5/suite.mjs <result.json> [result.json ...]');
    return 2;
  }
  try {
    const results = argv.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    process.stdout.write(JSON.stringify(assessBenchmarkSuite(results), null, 2) + '\n');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('suite.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
