export const FURY_BENCHMARK_VARIANTS = Object.freeze(['raw', 'pxpipe', 'furypipe'] as const);
export const FURY_BENCHMARK_METRICS = Object.freeze([
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'vision_tokens',
  'latency_ms',
  'ttft_ms',
  'local_transform_ms',
  'request_bytes',
  'response_bytes',
  'cost_usd',
  'errors',
] as const);

export type FuryBenchmarkVariant = typeof FURY_BENCHMARK_VARIANTS[number];
export type FuryBenchmarkBaseline = Exclude<FuryBenchmarkVariant, 'furypipe'>;
export type FuryBenchmarkMetric = typeof FURY_BENCHMARK_METRICS[number];
export type FuryBenchmarkDirection = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';

export interface FuryBenchmarkSummary {
  readonly known: number;
  readonly missing: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p95: number | null;
}

export interface FuryBenchmarkDigestIdentity {
  readonly id: string;
  readonly sha256: string;
}

export interface FuryBenchmarkSuiteEvidence {
  readonly schema_version: 'furypipe-benchmark-suite/v1';
  readonly comparability: 'VERIFIED';
  readonly repetitions_per_variant: number;
  readonly minimum_repetitions_for_claims: number;
  readonly claim_status: 'CLAIM_ELIGIBLE' | 'METRICS_ONLY';
  readonly claim_blockers: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly fixture: FuryBenchmarkDigestIdentity;
  readonly prompt: FuryBenchmarkDigestIdentity;
  readonly toolset: FuryBenchmarkDigestIdentity;
  readonly context: FuryBenchmarkDigestIdentity;
  readonly cache_state: 'cold' | 'warm' | 'disabled';
  readonly metrics: Readonly<Record<FuryBenchmarkMetric, Readonly<Record<FuryBenchmarkVariant, FuryBenchmarkSummary>>>>;
  readonly quality: Readonly<Record<FuryBenchmarkVariant, FuryBenchmarkSummary>>;
  readonly exactness: {
    readonly checked_runs: number;
    readonly passing_runs: number;
    readonly mismatches: number;
  };
  readonly errors: {
    readonly runs_with_errors: number;
    readonly total: number;
  };
}

export type FuryBenchmarkAntiRegressionBlockerCode =
  | 'suite-not-claim-eligible'
  | 'suite-claim-blockers-present'
  | 'insufficient-repetitions'
  | 'incomplete-quality-evidence'
  | 'quality-regression-vs-raw'
  | 'quality-regression-vs-pxpipe'
  | 'exactness-incomplete'
  | 'benchmark-errors';

export interface FuryBenchmarkAntiRegressionBlocker {
  readonly code: FuryBenchmarkAntiRegressionBlockerCode;
  readonly detail: string;
}

export interface FuryBenchmarkAntiRegressionDecision {
  readonly format: 'furypipe-benchmark-anti-regression/v1';
  readonly status: 'PASS' | 'BLOCKED';
  readonly qualityMedian: Readonly<Record<FuryBenchmarkVariant, number | null>>;
  readonly blockers: readonly FuryBenchmarkAntiRegressionBlocker[];
  readonly providerCallExecuted: false;
  readonly executionAuthorized: false;
}

export type FuryBenchmarkClaimBlockerCode =
  | FuryBenchmarkAntiRegressionBlockerCode
  | 'incomplete-metric-evidence'
  | 'no-measured-improvement'
  | 'absolute-threshold-not-met'
  | 'relative-threshold-not-met'
  | 'relative-improvement-unavailable';

export interface FuryBenchmarkClaimBlocker {
  readonly code: FuryBenchmarkClaimBlockerCode;
  readonly detail: string;
}

export interface FuryBenchmarkClaimRequest {
  readonly suite: unknown;
  readonly baseline: FuryBenchmarkBaseline;
  readonly metric: FuryBenchmarkMetric;
  readonly direction: FuryBenchmarkDirection;
  readonly minimumAbsoluteImprovement?: number;
  readonly minimumRelativeImprovementRatio?: number;
}

export interface FuryBenchmarkClaimDecision {
  readonly format: 'furypipe-benchmark-claim/v1';
  readonly status: 'CLAIM_ELIGIBLE' | 'BLOCKED';
  readonly claimType: 'MEASURED_COMPARISON';
  readonly baseline: FuryBenchmarkBaseline;
  readonly candidate: 'furypipe';
  readonly metric: FuryBenchmarkMetric;
  readonly direction: FuryBenchmarkDirection;
  readonly scope: {
    readonly provider: string;
    readonly model: string;
    readonly fixture: FuryBenchmarkDigestIdentity;
    readonly prompt: FuryBenchmarkDigestIdentity;
    readonly toolset: FuryBenchmarkDigestIdentity;
    readonly context: FuryBenchmarkDigestIdentity;
    readonly cacheState: 'cold' | 'warm' | 'disabled';
    readonly repetitionsPerVariant: number;
  };
  readonly baselineMedian: number | null;
  readonly candidateMedian: number | null;
  readonly measuredDelta: number | null;
  readonly measuredImprovement: number | null;
  readonly measuredImprovementRatio: number | null;
  readonly thresholds: {
    readonly minimumAbsoluteImprovement: number;
    readonly minimumRelativeImprovementRatio: number;
  };
  readonly antiRegression: FuryBenchmarkAntiRegressionDecision;
  readonly blockers: readonly FuryBenchmarkClaimBlocker[];
  readonly limitations: readonly [
    'DESCRIPTIVE_ONLY',
    'NO_STATISTICAL_SIGNIFICANCE_CLAIM',
    'NO_CAUSALITY_CLAIM',
    'NO_CROSS_SCOPE_GENERALIZATION',
  ];
  readonly providerCallExecuted: false;
  readonly executionAuthorized: false;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_TEXT_CHARS = 512;
const MAX_BLOCKERS = 256;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value: unknown, label: string, max = MAX_TEXT_CHARS): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} must be bounded printable text`);
  }
  return normalized;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function nullableFiniteNonNegative(value: unknown, label: string): number | null {
  if (value === null) return null;
  return finiteNonNegative(value, label);
}

function parseDigestIdentity(value: unknown, label: string): FuryBenchmarkDigestIdentity {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object`);
  const id = boundedText(value.id, `${label}.id`);
  if (typeof value.sha256 !== 'string' || !HEX64.test(value.sha256)) {
    throw new Error(`${label}.sha256 must be lowercase SHA-256`);
  }
  return Object.freeze({ id, sha256: value.sha256 });
}

function parseSummary(value: unknown, label: string, repetitions: number): FuryBenchmarkSummary {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object`);
  const known = safeInteger(value.known, `${label}.known`);
  const missing = safeInteger(value.missing, `${label}.missing`);
  if (known + missing !== repetitions) {
    throw new Error(`${label} known + missing must equal repetitions_per_variant`);
  }

  const min = nullableFiniteNonNegative(value.min, `${label}.min`);
  const max = nullableFiniteNonNegative(value.max, `${label}.max`);
  const mean = nullableFiniteNonNegative(value.mean, `${label}.mean`);
  const median = nullableFiniteNonNegative(value.median, `${label}.median`);
  const p95 = nullableFiniteNonNegative(value.p95, `${label}.p95`);

  if (known === 0) {
    if ([min, max, mean, median, p95].some((entry) => entry !== null)) {
      throw new Error(`${label} statistics must be null when known is zero`);
    }
  } else {
    if ([min, max, mean, median, p95].some((entry) => entry === null)) {
      throw new Error(`${label} statistics must be present when known is non-zero`);
    }
    const lower = min as number;
    const upper = max as number;
    const values = [mean as number, median as number, p95 as number];
    if (lower > upper || values.some((entry) => entry < lower || entry > upper)) {
      throw new Error(`${label} statistics are internally inconsistent`);
    }
  }

  return Object.freeze({ known, missing, min, max, mean, median, p95 });
}

function parseVariantSummaries(
  value: unknown,
  label: string,
  repetitions: number,
): Readonly<Record<FuryBenchmarkVariant, FuryBenchmarkSummary>> {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object`);
  const parsed = {
    raw: parseSummary(value.raw, `${label}.raw`, repetitions),
    pxpipe: parseSummary(value.pxpipe, `${label}.pxpipe`, repetitions),
    furypipe: parseSummary(value.furypipe, `${label}.furypipe`, repetitions),
  };
  return Object.freeze(parsed);
}

function parseClaimBlockers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKERS) {
    throw new Error('benchmark suite claim_blockers must be a bounded array');
  }
  return Object.freeze(value.map((entry, index) =>
    boundedText(entry, `benchmark suite claim_blockers[${index}]`, 1024)));
}

export function validateBenchmarkSuiteEvidence(value: unknown): FuryBenchmarkSuiteEvidence {
  if (!isPlainRecord(value)) throw new Error('benchmark suite evidence must be an object');
  if (value.schema_version !== 'furypipe-benchmark-suite/v1') {
    throw new Error('benchmark suite schema_version must be furypipe-benchmark-suite/v1');
  }
  if (value.comparability !== 'VERIFIED') {
    throw new Error('benchmark suite comparability must be VERIFIED');
  }

  const repetitions = safeInteger(value.repetitions_per_variant, 'benchmark suite repetitions_per_variant');
  const minimumRepetitions = safeInteger(
    value.minimum_repetitions_for_claims,
    'benchmark suite minimum_repetitions_for_claims',
  );
  if (minimumRepetitions < 3 || minimumRepetitions > 100) {
    throw new Error('benchmark suite minimum_repetitions_for_claims must be between 3 and 100');
  }
  if (value.claim_status !== 'CLAIM_ELIGIBLE' && value.claim_status !== 'METRICS_ONLY') {
    throw new Error('benchmark suite claim_status is invalid');
  }

  const claimBlockers = parseClaimBlockers(value.claim_blockers);
  const provider = boundedText(value.provider, 'benchmark suite provider');
  const model = boundedText(value.model, 'benchmark suite model');
  const cacheState = value.cache_state;
  if (cacheState !== 'cold' && cacheState !== 'warm' && cacheState !== 'disabled') {
    throw new Error('benchmark suite cache_state is invalid');
  }

  if (!isPlainRecord(value.metrics)) throw new Error('benchmark suite metrics must be an object');
  const metrics = {} as Record<FuryBenchmarkMetric, Readonly<Record<FuryBenchmarkVariant, FuryBenchmarkSummary>>>;
  for (const metric of FURY_BENCHMARK_METRICS) {
    metrics[metric] = parseVariantSummaries(value.metrics[metric], `benchmark suite metrics.${metric}`, repetitions);
  }

  const quality = parseVariantSummaries(value.quality, 'benchmark suite quality', repetitions);

  if (!isPlainRecord(value.exactness)) throw new Error('benchmark suite exactness must be an object');
  const exactness = Object.freeze({
    checked_runs: safeInteger(value.exactness.checked_runs, 'benchmark suite exactness.checked_runs'),
    passing_runs: safeInteger(value.exactness.passing_runs, 'benchmark suite exactness.passing_runs'),
    mismatches: safeInteger(value.exactness.mismatches, 'benchmark suite exactness.mismatches'),
  });

  if (!isPlainRecord(value.errors)) throw new Error('benchmark suite errors must be an object');
  const errors = Object.freeze({
    runs_with_errors: safeInteger(value.errors.runs_with_errors, 'benchmark suite errors.runs_with_errors'),
    total: safeInteger(value.errors.total, 'benchmark suite errors.total'),
  });

  return Object.freeze({
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: repetitions,
    minimum_repetitions_for_claims: minimumRepetitions,
    claim_status: value.claim_status,
    claim_blockers: claimBlockers,
    provider,
    model,
    fixture: parseDigestIdentity(value.fixture, 'benchmark suite fixture'),
    prompt: parseDigestIdentity(value.prompt, 'benchmark suite prompt'),
    toolset: parseDigestIdentity(value.toolset, 'benchmark suite toolset'),
    context: parseDigestIdentity(value.context, 'benchmark suite context'),
    cache_state: cacheState,
    metrics: Object.freeze(metrics),
    quality,
    exactness,
    errors,
  });
}

function blocker(
  code: FuryBenchmarkAntiRegressionBlockerCode,
  detail: string,
): FuryBenchmarkAntiRegressionBlocker {
  return Object.freeze({ code, detail });
}

export function assessBenchmarkAntiRegression(
  value: unknown,
): FuryBenchmarkAntiRegressionDecision {
  const suite = validateBenchmarkSuiteEvidence(value);
  const blockers: FuryBenchmarkAntiRegressionBlocker[] = [];

  if (suite.claim_status !== 'CLAIM_ELIGIBLE') {
    blockers.push(blocker('suite-not-claim-eligible', 'benchmark suite is not CLAIM_ELIGIBLE'));
  }
  if (suite.claim_blockers.length > 0) {
    blockers.push(blocker(
      'suite-claim-blockers-present',
      `benchmark suite reports ${suite.claim_blockers.length} claim blocker(s)`,
    ));
  }
  if (suite.repetitions_per_variant < suite.minimum_repetitions_for_claims) {
    blockers.push(blocker(
      'insufficient-repetitions',
      `requires at least ${suite.minimum_repetitions_for_claims} repetitions per variant; got ${suite.repetitions_per_variant}`,
    ));
  }

  const qualityComplete = FURY_BENCHMARK_VARIANTS.every((variant) =>
    suite.quality[variant].known === suite.repetitions_per_variant
    && suite.quality[variant].missing === 0
    && suite.quality[variant].median !== null);
  if (!qualityComplete) {
    blockers.push(blocker('incomplete-quality-evidence', 'quality evidence is incomplete for one or more variants'));
  }

  const furyMedian = suite.quality.furypipe.median;
  const rawMedian = suite.quality.raw.median;
  const pxpipeMedian = suite.quality.pxpipe.median;
  if (furyMedian !== null && rawMedian !== null && furyMedian < rawMedian) {
    blockers.push(blocker(
      'quality-regression-vs-raw',
      `FuryPipe median quality ${furyMedian} is below RAW median quality ${rawMedian}`,
    ));
  }
  if (furyMedian !== null && pxpipeMedian !== null && furyMedian < pxpipeMedian) {
    blockers.push(blocker(
      'quality-regression-vs-pxpipe',
      `FuryPipe median quality ${furyMedian} is below pxpipe median quality ${pxpipeMedian}`,
    ));
  }

  const totalRuns = suite.repetitions_per_variant * FURY_BENCHMARK_VARIANTS.length;
  if (
    suite.exactness.checked_runs !== totalRuns
    || suite.exactness.passing_runs !== totalRuns
    || suite.exactness.mismatches !== 0
  ) {
    blockers.push(blocker(
      'exactness-incomplete',
      'all comparable benchmark runs must have passing exactness with zero mismatches',
    ));
  }

  if (suite.errors.runs_with_errors !== 0 || suite.errors.total !== 0) {
    blockers.push(blocker('benchmark-errors', 'benchmark suite contains one or more recorded errors'));
  }

  return Object.freeze({
    format: 'furypipe-benchmark-anti-regression/v1',
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    qualityMedian: Object.freeze({
      raw: rawMedian,
      pxpipe: pxpipeMedian,
      furypipe: furyMedian,
    }),
    blockers: Object.freeze(blockers),
    providerCallExecuted: false,
    executionAuthorized: false,
  });
}

function normalizeThreshold(value: unknown, label: string): number {
  if (value === undefined) return 0;
  return finiteNonNegative(value, label);
}

function claimBlocker(code: FuryBenchmarkClaimBlockerCode, detail: string): FuryBenchmarkClaimBlocker {
  return Object.freeze({ code, detail });
}

export function evaluateBenchmarkClaim(input: FuryBenchmarkClaimRequest): FuryBenchmarkClaimDecision {
  if (!input || typeof input !== 'object') throw new Error('benchmark claim request is required');
  if (input.baseline !== 'raw' && input.baseline !== 'pxpipe') {
    throw new Error('benchmark claim baseline must be raw or pxpipe');
  }
  if (!FURY_BENCHMARK_METRICS.includes(input.metric)) {
    throw new Error('benchmark claim metric is invalid');
  }
  if (input.direction !== 'LOWER_IS_BETTER' && input.direction !== 'HIGHER_IS_BETTER') {
    throw new Error('benchmark claim direction is invalid');
  }

  const minimumAbsoluteImprovement = normalizeThreshold(
    input.minimumAbsoluteImprovement,
    'benchmark claim minimumAbsoluteImprovement',
  );
  const minimumRelativeImprovementRatio = normalizeThreshold(
    input.minimumRelativeImprovementRatio,
    'benchmark claim minimumRelativeImprovementRatio',
  );

  const suite = validateBenchmarkSuiteEvidence(input.suite);
  const antiRegression = assessBenchmarkAntiRegression(suite);
  const blockers: FuryBenchmarkClaimBlocker[] = antiRegression.blockers.map((entry) =>
    claimBlocker(entry.code, entry.detail));

  const baselineSummary = suite.metrics[input.metric][input.baseline];
  const candidateSummary = suite.metrics[input.metric].furypipe;
  const completeMetricEvidence =
    baselineSummary.known === suite.repetitions_per_variant
    && baselineSummary.missing === 0
    && baselineSummary.median !== null
    && candidateSummary.known === suite.repetitions_per_variant
    && candidateSummary.missing === 0
    && candidateSummary.median !== null;

  if (!completeMetricEvidence) {
    blockers.push(claimBlocker(
      'incomplete-metric-evidence',
      `${input.metric} must be known for every ${input.baseline} and furypipe repetition`,
    ));
  }

  const baselineMedian = baselineSummary.median;
  const candidateMedian = candidateSummary.median;
  const measuredDelta =
    baselineMedian === null || candidateMedian === null ? null : candidateMedian - baselineMedian;
  const measuredImprovement =
    measuredDelta === null
      ? null
      : input.direction === 'LOWER_IS_BETTER'
        ? -measuredDelta
        : measuredDelta;
  const measuredImprovementRatio =
    measuredImprovement === null || baselineMedian === null || baselineMedian === 0
      ? null
      : measuredImprovement / baselineMedian;

  if (completeMetricEvidence && measuredImprovement !== null && measuredImprovement <= 0) {
    blockers.push(claimBlocker(
      'no-measured-improvement',
      `FuryPipe median ${input.metric} does not improve on the selected ${input.baseline} baseline`,
    ));
  }
  if (
    completeMetricEvidence
    && measuredImprovement !== null
    && measuredImprovement > 0
    && measuredImprovement < minimumAbsoluteImprovement
  ) {
    blockers.push(claimBlocker(
      'absolute-threshold-not-met',
      `measured absolute improvement ${measuredImprovement} is below required ${minimumAbsoluteImprovement}`,
    ));
  }
  if (minimumRelativeImprovementRatio > 0) {
    if (measuredImprovementRatio === null) {
      blockers.push(claimBlocker(
        'relative-improvement-unavailable',
        'relative improvement is unavailable because the baseline median is zero or evidence is incomplete',
      ));
    } else if (measuredImprovementRatio < minimumRelativeImprovementRatio) {
      blockers.push(claimBlocker(
        'relative-threshold-not-met',
        `measured relative improvement ${measuredImprovementRatio} is below required ${minimumRelativeImprovementRatio}`,
      ));
    }
  }

  return Object.freeze({
    format: 'furypipe-benchmark-claim/v1',
    status: blockers.length === 0 ? 'CLAIM_ELIGIBLE' : 'BLOCKED',
    claimType: 'MEASURED_COMPARISON',
    baseline: input.baseline,
    candidate: 'furypipe',
    metric: input.metric,
    direction: input.direction,
    scope: Object.freeze({
      provider: suite.provider,
      model: suite.model,
      fixture: suite.fixture,
      prompt: suite.prompt,
      toolset: suite.toolset,
      context: suite.context,
      cacheState: suite.cache_state,
      repetitionsPerVariant: suite.repetitions_per_variant,
    }),
    baselineMedian,
    candidateMedian,
    measuredDelta,
    measuredImprovement,
    measuredImprovementRatio,
    thresholds: Object.freeze({
      minimumAbsoluteImprovement,
      minimumRelativeImprovementRatio,
    }),
    antiRegression,
    blockers: Object.freeze(blockers),
    limitations: Object.freeze([
      'DESCRIPTIVE_ONLY',
      'NO_STATISTICAL_SIGNIFICANCE_CLAIM',
      'NO_CAUSALITY_CLAIM',
      'NO_CROSS_SCOPE_GENERALIZATION',
    ] as const),
    providerCallExecuted: false,
    executionAuthorized: false,
  });
}
