import { describe, expect, it } from 'vitest';

import {
  assessBenchmarkAntiRegression,
  evaluateBenchmarkClaim,
  validateBenchmarkSuiteEvidence,
} from '../src/benchmark-claim-gate.js';

function summary(median: number | null, known = 5, missing = 0) {
  if (known === 0) {
    return { known, missing, min: null, max: null, mean: null, median: null, p95: null };
  }
  return {
    known,
    missing,
    min: median,
    max: median,
    mean: median,
    median,
    p95: median,
  };
}

function metric(raw: number, pxpipe: number, furypipe: number) {
  return {
    raw: summary(raw),
    pxpipe: summary(pxpipe),
    furypipe: summary(furypipe),
  };
}

function suiteFixture() {
  const digest = (id: string, char: string) => ({ id, sha256: char.repeat(64) });
  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: 5,
    minimum_repetitions_for_claims: 5,
    claim_status: 'CLAIM_ELIGIBLE',
    claim_blockers: [],
    provider: 'fixture-provider',
    model: 'fixture-model',
    fixture: digest('fixture-1', 'a'),
    prompt: digest('prompt-1', 'b'),
    toolset: digest('toolset-1', 'c'),
    context: digest('context-1', 'd'),
    cache_state: 'cold',
    metrics: {
      input_tokens: metric(100, 85, 70),
      output_tokens: metric(30, 30, 30),
      cache_read_tokens: metric(10, 20, 30),
      cache_write_tokens: metric(5, 5, 5),
      vision_tokens: metric(0, 0, 0),
      latency_ms: metric(1000, 900, 800),
      ttft_ms: metric(300, 280, 250),
      local_transform_ms: metric(0, 4, 6),
      request_bytes: metric(1000, 900, 800),
      response_bytes: metric(500, 500, 500),
      cost_usd: metric(0.02, 0.018, 0.015),
      errors: metric(0, 0, 0),
    },
    quality: {
      raw: summary(0.90),
      pxpipe: summary(0.92),
      furypipe: summary(0.95),
    },
    exactness: {
      checked_runs: 15,
      passing_runs: 15,
      mismatches: 0,
    },
    errors: {
      runs_with_errors: 0,
      total: 0,
    },
  };
}

describe('FuryPipe benchmark anti-regression gate', () => {
  it('passes only when FuryPipe preserves quality against both baselines', () => {
    const decision = assessBenchmarkAntiRegression(suiteFixture());

    expect(decision.status).toBe('PASS');
    expect(decision.qualityMedian).toEqual({
      raw: 0.90,
      pxpipe: 0.92,
      furypipe: 0.95,
    });
    expect(decision.blockers).toEqual([]);
    expect(decision.providerCallExecuted).toBe(false);
    expect(decision.executionAuthorized).toBe(false);
  });

  it('blocks an efficiency win that regresses quality against pxpipe', () => {
    const suite = suiteFixture();
    suite.quality.furypipe = summary(0.91);

    const decision = assessBenchmarkAntiRegression(suite);

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers).toContainEqual(expect.objectContaining({
      code: 'quality-regression-vs-pxpipe',
    }));
  });

  it('blocks quality regression against RAW independently of pxpipe', () => {
    const suite = suiteFixture();
    suite.quality.raw = summary(0.96);
    suite.quality.pxpipe = summary(0.89);
    suite.quality.furypipe = summary(0.95);

    const decision = assessBenchmarkAntiRegression(suite);

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers).toContainEqual(expect.objectContaining({
      code: 'quality-regression-vs-raw',
    }));
  });

  it('blocks suites that are metrics-only, exactness-incomplete, or contain errors', () => {
    const suite = suiteFixture();
    suite.claim_status = 'METRICS_ONLY';
    suite.claim_blockers = ['quality evidence incomplete'];
    suite.exactness.passing_runs = 14;
    suite.exactness.mismatches = 1;
    suite.errors.runs_with_errors = 1;
    suite.errors.total = 1;

    const decision = assessBenchmarkAntiRegression(suite);

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'suite-not-claim-eligible',
      'suite-claim-blockers-present',
      'exactness-incomplete',
      'benchmark-errors',
    ]));
  });

  it('rejects structurally inconsistent or out-of-range suite evidence', () => {
    const inconsistent = suiteFixture();
    inconsistent.metrics.input_tokens.furypipe = summary(70, 4, 0);
    expect(() => validateBenchmarkSuiteEvidence(inconsistent)).toThrow(/known \+ missing/);

    const invalidQuality = suiteFixture();
    invalidQuality.quality.furypipe = summary(1.1);
    expect(() => validateBenchmarkSuiteEvidence(invalidQuality)).toThrow(/between 0 and 1/);

    const wrongComparability = suiteFixture();
    (wrongComparability as { comparability: string }).comparability = 'UNKNOWN';
    expect(() => validateBenchmarkSuiteEvidence(wrongComparability)).toThrow(/comparability must be VERIFIED/);
  });
});

describe('FuryPipe benchmark claim gate', () => {
  it('allows a scoped descriptive efficiency claim only after anti-regression passes', () => {
    const suite = suiteFixture();
    const decision = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'input_tokens',
      direction: 'LOWER_IS_BETTER',
      minimumAbsoluteImprovement: 20,
      minimumRelativeImprovementRatio: 0.20,
    });

    expect(decision.status).toBe('CLAIM_ELIGIBLE');
    expect(decision.baselineMedian).toBe(100);
    expect(decision.candidateMedian).toBe(70);
    expect(decision.measuredDelta).toBe(-30);
    expect(decision.measuredImprovement).toBe(30);
    expect(decision.measuredImprovementRatio).toBe(0.30);
    expect(decision.antiRegression.status).toBe('PASS');
    expect(decision.scope).toEqual(expect.objectContaining({
      provider: suite.provider,
      model: suite.model,
      cacheState: suite.cache_state,
      repetitionsPerVariant: 5,
    }));
    expect(decision.limitations).toEqual([
      'DESCRIPTIVE_ONLY',
      'NO_STATISTICAL_SIGNIFICANCE_CLAIM',
      'NO_CAUSALITY_CLAIM',
      'NO_CROSS_SCOPE_GENERALIZATION',
    ]);
    expect(decision.providerCallExecuted).toBe(false);
    expect(decision.executionAuthorized).toBe(false);
  });

  it('never lets efficiency hide a quality regression', () => {
    const suite = suiteFixture();
    suite.quality.furypipe = summary(0.80);

    const decision = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'input_tokens',
      direction: 'LOWER_IS_BETTER',
    });

    expect(decision.measuredImprovement).toBe(30);
    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'quality-regression-vs-raw',
      'quality-regression-vs-pxpipe',
    ]));
  });

  it('blocks a claim when the selected metric has missing observations', () => {
    const suite = suiteFixture();
    suite.metrics.latency_ms.furypipe = {
      known: 4,
      missing: 1,
      min: 790,
      max: 820,
      mean: 800,
      median: 800,
      p95: 815,
    };

    const decision = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'latency_ms',
      direction: 'LOWER_IS_BETTER',
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers).toContainEqual(expect.objectContaining({
      code: 'incomplete-metric-evidence',
    }));
  });

  it('blocks equal or worse medians instead of presenting them as improvements', () => {
    const suite = suiteFixture();

    const equal = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'output_tokens',
      direction: 'LOWER_IS_BETTER',
    });
    expect(equal.status).toBe('BLOCKED');
    expect(equal.blockers).toContainEqual(expect.objectContaining({
      code: 'no-measured-improvement',
    }));

    const wrongDirection = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'input_tokens',
      direction: 'HIGHER_IS_BETTER',
    });
    expect(wrongDirection.status).toBe('BLOCKED');
    expect(wrongDirection.blockers).toContainEqual(expect.objectContaining({
      code: 'no-measured-improvement',
    }));
  });

  it('supports explicit higher-is-better claims without inferring metric semantics', () => {
    const decision = evaluateBenchmarkClaim({
      suite: suiteFixture(),
      baseline: 'raw',
      metric: 'cache_read_tokens',
      direction: 'HIGHER_IS_BETTER',
      minimumAbsoluteImprovement: 15,
    });

    expect(decision.status).toBe('CLAIM_ELIGIBLE');
    expect(decision.measuredImprovement).toBe(20);
  });

  it('enforces caller-specified absolute and relative thresholds', () => {
    const absolute = evaluateBenchmarkClaim({
      suite: suiteFixture(),
      baseline: 'raw',
      metric: 'input_tokens',
      direction: 'LOWER_IS_BETTER',
      minimumAbsoluteImprovement: 31,
    });
    expect(absolute.status).toBe('BLOCKED');
    expect(absolute.blockers).toContainEqual(expect.objectContaining({
      code: 'absolute-threshold-not-met',
    }));

    const relative = evaluateBenchmarkClaim({
      suite: suiteFixture(),
      baseline: 'raw',
      metric: 'input_tokens',
      direction: 'LOWER_IS_BETTER',
      minimumRelativeImprovementRatio: 0.31,
    });
    expect(relative.status).toBe('BLOCKED');
    expect(relative.blockers).toContainEqual(expect.objectContaining({
      code: 'relative-threshold-not-met',
    }));
  });

  it('fails closed for relative claims when the baseline median is zero', () => {
    const suite = suiteFixture();
    suite.metrics.vision_tokens = metric(0, 0, 1);

    const decision = evaluateBenchmarkClaim({
      suite,
      baseline: 'raw',
      metric: 'vision_tokens',
      direction: 'HIGHER_IS_BETTER',
      minimumRelativeImprovementRatio: 0.10,
    });

    expect(decision.measuredImprovement).toBe(1);
    expect(decision.measuredImprovementRatio).toBeNull();
    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers).toContainEqual(expect.objectContaining({
      code: 'relative-improvement-unavailable',
    }));
  });

  it('preserves exact benchmark scope instead of generalizing evidence', () => {
    const suite = suiteFixture();
    const decision = evaluateBenchmarkClaim({
      suite,
      baseline: 'pxpipe',
      metric: 'latency_ms',
      direction: 'LOWER_IS_BETTER',
    });

    expect(decision.scope.fixture).toEqual(suite.fixture);
    expect(decision.scope.prompt).toEqual(suite.prompt);
    expect(decision.scope.toolset).toEqual(suite.toolset);
    expect(decision.scope.context).toEqual(suite.context);
    expect(decision.scope.provider).toBe('fixture-provider');
    expect(decision.scope.model).toBe('fixture-model');
    expect(decision.limitations).toContain('NO_CROSS_SCOPE_GENERALIZATION');
  });
});
