import { describe, expect, it } from 'vitest';

import {
  createContextOptimizerProfileRegistry,
  digestContextOptimizerProfile,
  isGeneratedContextOptimizerProfileQualification,
  qualifyContextOptimizerProfile,
  type FuryContextOptimizerProfileDefinition,
} from '../src/context-optimizer-profile.js';

function summary(median: number, repetitions = 5) {
  return {
    known: repetitions,
    missing: 0,
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

function benchmarkSuite(overrides: {
  provider?: string;
  model?: string;
  rawTokens?: number;
  pxpipeTokens?: number;
  furyTokens?: number;
  rawQuality?: number;
  pxpipeQuality?: number;
  furyQuality?: number;
} = {}) {
  const digest = (id: string, ch: string) => ({ id, sha256: ch.repeat(64) });
  const rawTokens = overrides.rawTokens ?? 1000;
  const pxpipeTokens = overrides.pxpipeTokens ?? 850;
  const furyTokens = overrides.furyTokens ?? 700;

  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: 5,
    minimum_repetitions_for_claims: 5,
    claim_status: 'CLAIM_ELIGIBLE',
    claim_blockers: [],
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-5.6-sol',
    fixture: digest('coding-context', 'a'),
    prompt: digest('coding-prompt', 'b'),
    toolset: digest('coding-tools', 'c'),
    context: digest('coding-context-v1', 'd'),
    cache_state: 'cold',
    metrics: {
      input_tokens: metric(rawTokens, pxpipeTokens, furyTokens),
      output_tokens: metric(100, 100, 100),
      cache_read_tokens: metric(0, 0, 0),
      cache_write_tokens: metric(0, 0, 0),
      vision_tokens: metric(0, 0, 0),
      latency_ms: metric(1000, 950, 900),
      ttft_ms: metric(300, 290, 280),
      local_transform_ms: metric(0, 4, 6),
      request_bytes: metric(4000, 3400, 2800),
      response_bytes: metric(500, 500, 500),
      cost_usd: metric(0.02, 0.018, 0.015),
      errors: metric(0, 0, 0),
    },
    quality: {
      raw: summary(overrides.rawQuality ?? 0.90),
      pxpipe: summary(overrides.pxpipeQuality ?? 0.92),
      furypipe: summary(overrides.furyQuality ?? 0.95),
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

const profile = (): FuryContextOptimizerProfileDefinition => ({
  id: 'coding-compact-v1',
  priority: 20,
  options: {
    maxBytes: 24 * 1024,
    maxItems: 64,
    discoveryMinRelevance: 0.72,
    strictOrdering: false,
    maxBytesByKind: {
      transcript: 8 * 1024,
      'tool-output': 4 * 1024,
    },
  },
});

function qualify(
  definition = profile(),
  overrides: {
    provider?: string;
    model?: string;
    workloadId?: string;
    suite?: ReturnType<typeof benchmarkSuite>;
    minimumRelativeTokenImprovementRatio?: number;
  } = {},
) {
  return qualifyContextOptimizerProfile({
    profile: definition,
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-5.6-sol',
    workloadId: overrides.workloadId ?? 'coding',
    benchmarkSuite: overrides.suite ?? benchmarkSuite(),
    benchmarkSuiteSha256: 'e'.repeat(64),
    baseline: 'raw',
    minimumRelativeTokenImprovementRatio:
      overrides.minimumRelativeTokenImprovementRatio ?? 0.20,
  });
}

describe('Context Optimizer benchmark-qualified profiles', () => {
  it('produces a deterministic profile digest independent of kind-budget key order', () => {
    const first = profile();
    const second: FuryContextOptimizerProfileDefinition = {
      ...first,
      options: {
        ...first.options,
        maxBytesByKind: {
          'tool-output': 4 * 1024,
          transcript: 8 * 1024,
        },
      },
    };

    expect(digestContextOptimizerProfile(first)).toBe(digestContextOptimizerProfile(second));
    expect(digestContextOptimizerProfile(first)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('does not allow a benchmark profile to configure secret authority', () => {
    expect(() => digestContextOptimizerProfile({
      id: 'unsafe',
      options: {
        maxBytes: 1024,
        allowSecret: true,
      } as never,
    })).toThrow(/option is not allowed: allowSecret/);
  });

  it('qualifies exact measured token reduction only when anti-regression passes', () => {
    const decision = qualify();

    expect(decision.status).toBe('QUALIFIED');
    expect(decision.claim.status).toBe('CLAIM_ELIGIBLE');
    expect(decision.qualification).toEqual(expect.objectContaining({
      profileId: 'coding-compact-v1',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      baseline: 'raw',
      repetitions: 5,
      baselineTokenMedian: 1000,
      candidateTokenMedian: 700,
      measuredTokenImprovement: 300,
      measuredTokenImprovementRatio: 0.3,
      rawQualityMedian: 0.90,
      pxpipeQualityMedian: 0.92,
      candidateQualityMedian: 0.95,
      exactnessMismatches: 0,
      benchmarkErrors: 0,
    }));
    expect(isGeneratedContextOptimizerProfileQualification(decision.qualification)).toBe(true);
    expect(decision.optimizerExecuted).toBe(false);
    expect(decision.providerCallExecuted).toBe(false);
    expect(decision.executionAuthorized).toBe(false);
  });

  it('blocks qualification when benchmark provider/model differs from the requested scope', () => {
    const decision = qualify(profile(), {
      provider: 'anthropic',
      model: 'claude-opus-5',
      suite: benchmarkSuite({
        provider: 'openai',
        model: 'gpt-5.6-sol',
      }),
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers.join(' ')).toMatch(/scope-mismatch/);
    expect(decision.qualification).toBeUndefined();
  });

  it('blocks token savings that regress quality', () => {
    const decision = qualify(profile(), {
      suite: benchmarkSuite({
        rawQuality: 0.90,
        pxpipeQuality: 0.92,
        furyQuality: 0.80,
      }),
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.claim.antiRegression.status).toBe('BLOCKED');
    expect(decision.blockers.join(' ')).toMatch(/quality-regression/);
  });

  it('blocks a profile when the measured token reduction misses the requested threshold', () => {
    const decision = qualify(profile(), {
      minimumRelativeTokenImprovementRatio: 0.35,
      suite: benchmarkSuite({
        rawTokens: 1000,
        furyTokens: 700,
      }),
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.blockers.join(' ')).toMatch(/relative-threshold-not-met/);
  });

  it('selects the highest-priority profile with a generated exact-scope qualification', () => {
    const conservative: FuryContextOptimizerProfileDefinition = {
      id: 'coding-conservative-v1',
      priority: 50,
      options: {
        maxBytes: 40 * 1024,
        maxItems: 96,
      },
    };
    const compact = profile();
    const compactDecision = qualify(compact);
    const conservativeDecision = qualify(conservative);

    const registry = createContextOptimizerProfileRegistry([conservative, compact]);
    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      qualifications: [
        conservativeDecision.qualification!,
        compactDecision.qualification!,
      ],
    });

    expect(plan.profileId).toBe('coding-compact-v1');
    expect(plan.profileDigest).toBe(digestContextOptimizerProfile(compact));
    expect(plan.options).toEqual(compact.options);
    expect(plan.evidence).toBe('verified');
    expect(plan.optimizerExecuted).toBe(false);
    expect(plan.providerCallExecuted).toBe(false);
    expect(plan.executionAuthorized).toBe(false);
  });

  it('does not transfer qualification across provider, model, or workload', () => {
    const decision = qualify();
    const qualification = decision.qualification!;
    const registry = createContextOptimizerProfileRegistry([profile()]);

    for (const scope of [
      { provider: 'anthropic', model: 'gpt-5.6-sol', workloadId: 'coding' },
      { provider: 'openai', model: 'gpt-5.6-luna', workloadId: 'coding' },
      { provider: 'openai', model: 'gpt-5.6-sol', workloadId: 'marketing' },
    ]) {
      const plan = registry.resolve({
        ...scope,
        qualifications: [qualification],
      });
      expect(plan.profileId).toBeUndefined();
      expect(plan.evidence).toBe('none');
      expect(plan.blocked).toContainEqual({
        id: 'coding-compact-v1',
        reason: 'scope-mismatch',
      });
    }
  });

  it('blocks a changed profile after qualification via digest mismatch', () => {
    const qualifiedProfile = profile();
    const decision = qualify(qualifiedProfile);

    const changed: FuryContextOptimizerProfileDefinition = {
      ...qualifiedProfile,
      options: {
        ...qualifiedProfile.options,
        maxBytes: 12 * 1024,
      },
    };

    const registry = createContextOptimizerProfileRegistry([changed]);
    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      qualifications: [decision.qualification!],
    });

    expect(plan.profileId).toBeUndefined();
    expect(plan.blocked).toContainEqual({
      id: 'coding-compact-v1',
      reason: 'digest-mismatch',
    });
  });

  it('rejects copied or hand-built qualifications instead of trusting serialized shape alone', () => {
    const decision = qualify();
    const original = decision.qualification!;
    const copied = { ...original };
    const registry = createContextOptimizerProfileRegistry([profile()]);

    expect(isGeneratedContextOptimizerProfileQualification(copied)).toBe(false);

    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      qualifications: [copied],
    });

    expect(plan.profileId).toBeUndefined();
    expect(plan.blocked).toContainEqual({
      id: 'coding-compact-v1',
      reason: 'invalid-qualification',
    });
  });

  it('returns no profile when evidence is absent rather than silently applying aggressive defaults', () => {
    const registry = createContextOptimizerProfileRegistry([profile()]);

    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.profileId).toBeUndefined();
    expect(plan.options).toBeUndefined();
    expect(plan.evidence).toBe('none');
    expect(plan.blocked).toEqual([{
      id: 'coding-compact-v1',
      reason: 'missing-qualification',
    }]);
  });

  it('falls through a blocked higher-priority profile to a lower qualified profile', () => {
    const aggressive: FuryContextOptimizerProfileDefinition = {
      id: 'aggressive',
      priority: 1,
      options: { maxBytes: 8 * 1024 },
    };
    const safe: FuryContextOptimizerProfileDefinition = {
      id: 'safe',
      priority: 10,
      options: { maxBytes: 32 * 1024 },
    };
    const safeDecision = qualify(safe);

    const registry = createContextOptimizerProfileRegistry([safe, aggressive]);
    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      qualifications: [safeDecision.qualification!],
    });

    expect(plan.profileId).toBe('safe');
    expect(plan.blocked).toEqual([{
      id: 'aggressive',
      reason: 'missing-qualification',
    }]);
  });

  it('rejects duplicate-id profile mutation and invalid per-kind budgets', () => {
    const registry = createContextOptimizerProfileRegistry([profile()]);

    expect(() => registry.register({
      ...profile(),
      options: { maxBytes: 12 * 1024 },
    })).toThrow(/id conflict/);

    expect(() => digestContextOptimizerProfile({
      id: 'invalid-kind-budget',
      options: {
        maxBytes: 1024,
        maxBytesByKind: { transcript: 2048 },
      },
    })).toThrow(/exceeds maxBytes/);
  });
});
