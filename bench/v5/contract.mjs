const VARIANTS = new Set(['raw', 'pxpipe', 'furypipe']);
const STATUSES = new Set(['BENCHMARK_NON_EXECUTED', 'EXECUTED', 'INVALID', 'FAILED']);
const CACHE_STATES = new Set(['cold', 'warm', 'disabled']);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function checkDigestIdentity(value, field, errors) {
  if (!value || typeof value !== 'object') {
    errors.push(`${field} must be an object`);
    return;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) errors.push(`${field}.id is required`);
  if (typeof value.sha256 !== 'string' || !HEX64.test(value.sha256)) errors.push(`${field}.sha256 must be lowercase SHA-256`);
}

export function validateBenchmarkResult(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['result must be an object'];
  if (value.schema_version !== 'furypipe-benchmark/v1') errors.push('schema_version must be furypipe-benchmark/v1');
  if (typeof value.run_id !== 'string' || value.run_id.length === 0) errors.push('run_id is required');
  if (!STATUSES.has(value.status)) errors.push('status is invalid');
  if (!VARIANTS.has(value.variant)) errors.push('variant is invalid');
  if (!value.source || typeof value.source !== 'object') errors.push('source is required');
  else {
    if (typeof value.source.repository !== 'string' || value.source.repository.length === 0) errors.push('source.repository is required');
    if (typeof value.source.commit !== 'string' || !HEX40.test(value.source.commit)) errors.push('source.commit must be a 40-character lowercase git SHA');
  }
  if (typeof value.provider !== 'string' || value.provider.length === 0) errors.push('provider is required');
  if (typeof value.model !== 'string' || value.model.length === 0) errors.push('model is required');
  for (const field of ['fixture', 'prompt', 'toolset', 'context']) checkDigestIdentity(value[field], field, errors);
  if (!CACHE_STATES.has(value.cache_state)) errors.push('cache_state is invalid');

  const m = value.metrics;
  if (!m || typeof m !== 'object') errors.push('metrics is required');
  else {
    for (const key of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'vision_tokens', 'request_bytes', 'response_bytes', 'errors']) {
      const v = m[key];
      if (v !== null && (!Number.isInteger(v) || v < 0)) errors.push(`metrics.${key} must be a non-negative integer or null`);
    }
    for (const key of ['latency_ms', 'ttft_ms', 'local_transform_ms', 'cost_usd']) {
      const v = m[key];
      if (v !== null && !isFiniteNonNegative(v)) errors.push(`metrics.${key} must be a non-negative finite number or null`);
    }
    if (!Number.isInteger(m.errors) || m.errors < 0) errors.push('metrics.errors must be a non-negative integer');
  }

  const q = value.quality;
  if (!q || typeof q !== 'object' || !['NOT_SCORED', 'SCORED'].includes(q.status)) errors.push('quality.status is invalid');
  else {
    if (q.status === 'NOT_SCORED' && q.score !== null) errors.push('quality.score must be null when NOT_SCORED');
    if (q.status === 'SCORED' && (!isFiniteNonNegative(q.score) || q.score > 1)) errors.push('quality.score must be between 0 and 1 when SCORED');
  }

  const e = value.exactness;
  if (!e || typeof e !== 'object') errors.push('exactness is required');
  else {
    if (typeof e.checked !== 'boolean') errors.push('exactness.checked must be boolean');
    if (e.passed !== null && typeof e.passed !== 'boolean') errors.push('exactness.passed must be boolean or null');
    if (!Number.isInteger(e.mismatches) || e.mismatches < 0) errors.push('exactness.mismatches must be a non-negative integer');
    if (!e.checked && e.passed !== null) errors.push('exactness.passed must be null when not checked');
  }

  const r = value.recovery;
  if (!r || typeof r !== 'object') errors.push('recovery is required');
  else {
    if (!Number.isInteger(r.handles) || r.handles < 0) errors.push('recovery.handles must be a non-negative integer');
    if (r.verified !== null && typeof r.verified !== 'boolean') errors.push('recovery.verified must be boolean or null');
  }
  return errors;
}

export function comparabilityFingerprint(result) {
  return JSON.stringify({
    provider: result.provider,
    model: result.model,
    fixture: result.fixture,
    prompt: result.prompt,
    toolset: result.toolset,
    context: result.context,
    cache_state: result.cache_state,
  });
}

export function assertComparable(results) {
  if (!Array.isArray(results) || results.length !== 3) throw new Error('comparison requires exactly RAW, pxpipe and FuryPipe results');
  for (const result of results) {
    const errors = validateBenchmarkResult(result);
    if (errors.length) throw new Error(`invalid ${result?.variant ?? 'unknown'} result: ${errors.join('; ')}`);
    if (result.status !== 'EXECUTED') throw new Error(`${result.variant} result is not EXECUTED`);
  }
  const variants = new Set(results.map((result) => result.variant));
  if (variants.size !== 3 || [...VARIANTS].some((variant) => !variants.has(variant))) {
    throw new Error('comparison requires one result for each variant: raw, pxpipe, furypipe');
  }
  const fingerprints = new Set(results.map(comparabilityFingerprint));
  if (fingerprints.size !== 1) throw new Error('results are not comparable: provider/model/fixture/prompt/toolset/context/cache_state differ');
}

function delta(candidate, baseline) {
  if (candidate === null || baseline === null) return null;
  return candidate - baseline;
}

export function compareTriplet(results) {
  assertComparable(results);
  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  const raw = byVariant.raw;
  const pxpipe = byVariant.pxpipe;
  const furypipe = byVariant.furypipe;
  const metricKeys = [
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
    'vision_tokens', 'latency_ms', 'ttft_ms', 'local_transform_ms',
    'request_bytes', 'response_bytes', 'cost_usd', 'errors',
  ];
  const metrics = {};
  for (const key of metricKeys) {
    metrics[key] = {
      raw: raw.metrics[key],
      pxpipe: pxpipe.metrics[key],
      furypipe: furypipe.metrics[key],
      furypipe_vs_raw: delta(furypipe.metrics[key], raw.metrics[key]),
      furypipe_vs_pxpipe: delta(furypipe.metrics[key], pxpipe.metrics[key]),
    };
  }
  return {
    schema_version: 'furypipe-benchmark-comparison/v1',
    comparability: 'VERIFIED',
    fixture: raw.fixture,
    provider: raw.provider,
    model: raw.model,
    cache_state: raw.cache_state,
    metrics,
    quality: {
      raw: raw.quality,
      pxpipe: pxpipe.quality,
      furypipe: furypipe.quality,
    },
    exactness: {
      raw: raw.exactness,
      pxpipe: pxpipe.exactness,
      furypipe: furypipe.exactness,
    },
    recovery: {
      raw: raw.recovery,
      pxpipe: pxpipe.recovery,
      furypipe: furypipe.recovery,
    },
  };
}
