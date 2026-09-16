import { describe, expect, it } from 'vitest';

import {
  createProviderAttemptPlanner,
} from '../src/provider-attempt-planner.js';
import {
  createModelAdapterRegistry,
  digestModelAdapter,
  type FuryModelAdapterDefinition,
  type FuryModelAdapterQualification,
} from '../src/model-adapter-registry.js';
import {
  createContextOptimizerProfileRegistry,
  qualifyContextOptimizerProfile,
  type FuryContextOptimizerProfileDefinition,
} from '../src/context-optimizer-profile.js';

const basePrompt = {
  level: 'ENGINEERING' as const,
  sections: {
    task: 'BASE',
    constraints: 'BASE_CONSTRAINT',
  },
};

const openAiAdapter: FuryModelAdapterDefinition = {
  id: 'openai-coding-v1',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  workloadId: 'coding',
  additions: {
    constraints: ['OPENAI_ONLY'],
  },
};

const anthropicAdapter: FuryModelAdapterDefinition = {
  id: 'anthropic-coding-v1',
  provider: 'anthropic',
  model: 'claude-opus-5',
  workloadId: 'coding',
  additions: {
    constraints: ['ANTHROPIC_ONLY'],
  },
};

const compactProfile: FuryContextOptimizerProfileDefinition = {
  id: 'coding-compact-v1',
  priority: 10,
  options: {
    maxBytes: 24 * 1024,
    maxItems: 64,
    discoveryMinRelevance: 0.7,
  },
};

function modelQualification(adapter: FuryModelAdapterDefinition): FuryModelAdapterQualification {
  return {
    format: 'furypipe-model-adapter-qualification/v1',
    adapterId: adapter.id,
    adapterDigest: digestModelAdapter(adapter),
    benchmarkSuiteSha256: 'a'.repeat(64),
    provider: adapter.provider,
    model: adapter.model,
    workloadId: adapter.workloadId,
    comparability: 'VERIFIED',
    claimStatus: 'CLAIM_ELIGIBLE',
    repetitions: 5,
    baselineQualityMedian: 0.90,
    candidateQualityMedian: 0.95,
    exactnessCheckedRuns: 5,
    exactnessPassingRuns: 5,
    exactnessMismatches: 0,
    errors: 0,
  };
}

function summary(median: number) {
  return {
    known: 5,
    missing: 0,
    min: median,
    max: median,
    mean: median,
    median,
    p95: median,
  };
}

function metric(raw: number, upstream: number, furypipe: number) {
  return {
    raw: summary(raw),
    upstream: summary(upstream),
    furypipe: summary(furypipe),
  };
}

function benchmarkSuite(provider: string, model: string) {
  const digest = (id: string, ch: string) => ({ id, sha256: ch.repeat(64) });
  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: 5,
    minimum_repetitions_for_claims: 5,
    claim_status: 'CLAIM_ELIGIBLE',
    claim_blockers: [],
    provider,
    model,
    fixture: digest('fixture', 'b'),
    prompt: digest('prompt', 'c'),
    toolset: digest('toolset', 'd'),
    context: digest('context', 'e'),
    cache_state: 'cold',
    metrics: {
      input_tokens: metric(1000, 850, 700),
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
      raw: summary(0.90),
      upstream: summary(0.92),
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

function contextQualification(
  profile: FuryContextOptimizerProfileDefinition,
  provider = 'openai',
  model = 'gpt-5.6-sol',
  workloadId = 'coding',
) {
  const decision = qualifyContextOptimizerProfile({
    profile,
    provider,
    model,
    workloadId,
    benchmarkSuite: benchmarkSuite(provider, model),
    benchmarkSuiteSha256: 'f'.repeat(64),
    baseline: 'raw',
    minimumRelativeTokenImprovementRatio: 0.20,
  });
  if (decision.status !== 'QUALIFIED' || decision.qualification === undefined) {
    throw new Error('expected generated context optimizer qualification');
  }
  return decision.qualification;
}

function planner(options: {
  adapters?: readonly FuryModelAdapterDefinition[];
  adapterQualifications?: readonly FuryModelAdapterQualification[];
  profiles?: readonly FuryContextOptimizerProfileDefinition[];
  contextQualifications?: readonly ReturnType<typeof contextQualification>[];
} = {}) {
  return createProviderAttemptPlanner({
    basePrompt,
    modelAdapters: {
      registry: createModelAdapterRegistry(options.adapters ?? [openAiAdapter]),
      qualifications: options.adapterQualifications ?? [],
    },
    contextProfiles: {
      registry: createContextOptimizerProfileRegistry(options.profiles ?? [compactProfile]),
      qualifications: options.contextQualifications ?? [],
    },
  });
}

describe('Provider Attempt Planner', () => {
  it('composes an exact qualified adapter and exact qualified context profile', () => {
    const plan = planner({
      adapterQualifications: [modelQualification(openAiAdapter)],
      contextQualifications: [contextQualification(compactProfile)],
    }).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.adapter.adapterState).toBe('APPLIED');
    expect(plan.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'OPENAI_ONLY']);
    expect(plan.contextProfileState).toBe('QUALIFIED');
    expect(plan.contextProfile.profileId).toBe('coding-compact-v1');
    expect(plan.contextProfile.options).toEqual(compactProfile.options);
    expect(plan.networkCallExecuted).toBe(false);
    expect(plan.providerRequestExecuted).toBe(false);
    expect(plan.optimizerExecuted).toBe(false);
    expect(plan.executionAuthorized).toBe(false);
  });

  it('can adapt the prompt while leaving context profile at identity when evidence is absent', () => {
    const plan = planner({
      adapterQualifications: [modelQualification(openAiAdapter)],
    }).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.adapter.adapterState).toBe('APPLIED');
    expect(plan.contextProfileState).toBe('IDENTITY');
    expect(plan.contextProfile.profileId).toBeUndefined();
    expect(plan.contextProfile.blocked).toEqual([
      { id: 'coding-compact-v1', reason: 'missing-qualification' },
    ]);
  });

  it('can select a context profile while leaving the prompt model-neutral when adapter evidence is absent', () => {
    const plan = planner({
      contextQualifications: [contextQualification(compactProfile)],
    }).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.adapter.adapterState).toBe('IDENTITY');
    expect(plan.prompt).toEqual(basePrompt);
    expect(plan.contextProfileState).toBe('QUALIFIED');
    expect(plan.contextProfile.profileId).toBe('coding-compact-v1');
  });

  it('recomputes both subsystems independently for fallback attempts without contamination', () => {
    const openAiProfileQualification = contextQualification(
      compactProfile,
      'openai',
      'gpt-5.6-sol',
      'coding',
    );
    const anthropicProfileQualification = contextQualification(
      compactProfile,
      'anthropic',
      'claude-opus-5',
      'coding',
    );
    const attemptPlanner = planner({
      adapters: [openAiAdapter, anthropicAdapter],
      adapterQualifications: [
        modelQualification(openAiAdapter),
        modelQualification(anthropicAdapter),
      ],
      contextQualifications: [
        openAiProfileQualification,
        anthropicProfileQualification,
      ],
    });

    const openAi = attemptPlanner.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });
    const anthropic = attemptPlanner.plan({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      workloadId: 'coding',
    });

    expect(openAi.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'OPENAI_ONLY']);
    expect(anthropic.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'ANTHROPIC_ONLY']);
    expect(JSON.stringify(anthropic.prompt)).not.toContain('OPENAI_ONLY');
    expect(JSON.stringify(openAi.prompt)).not.toContain('ANTHROPIC_ONLY');
    expect(openAi.contextProfile.profileId).toBe('coding-compact-v1');
    expect(anthropic.contextProfile.profileId).toBe('coding-compact-v1');
    expect(openAi.contextProfile.provider).toBe('openai');
    expect(anthropic.contextProfile.provider).toBe('anthropic');
  });

  it('does not transfer a context qualification to another provider, model, or workload', () => {
    const qualification = contextQualification(compactProfile);
    const attemptPlanner = planner({
      contextQualifications: [qualification],
    });

    const attempts = [
      { providerId: 'anthropic', model: 'gpt-5.6-sol', workloadId: 'coding' },
      { providerId: 'openai', model: 'gpt-5.6-luna', workloadId: 'coding' },
      { providerId: 'openai', model: 'gpt-5.6-sol', workloadId: 'marketing' },
    ];

    for (const attempt of attempts) {
      const plan = attemptPlanner.plan(attempt);
      expect(plan.contextProfileState).toBe('BLOCKED');
      expect(plan.contextProfile.profileId).toBeUndefined();
      expect(plan.contextProfile.blocked).toContainEqual({
        id: 'coding-compact-v1',
        reason: 'scope-mismatch',
      });
    }
  });

  it('snapshots context profiles so later registry mutation cannot alter the planner', () => {
    const registry = createContextOptimizerProfileRegistry([compactProfile]);
    const qualification = contextQualification(compactProfile);
    const attemptPlanner = createProviderAttemptPlanner({
      basePrompt,
      modelAdapters: {
        registry: createModelAdapterRegistry([]),
      },
      contextProfiles: {
        registry,
        qualifications: [qualification],
      },
    });

    registry.register({
      id: 'later-higher-priority',
      priority: 1,
      options: { maxBytes: 4096 },
    });

    const plan = attemptPlanner.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.contextProfile.profileId).toBe('coding-compact-v1');
    expect(plan.contextProfile.blocked.map((entry) => entry.id)).not.toContain('later-higher-priority');
  });

  it('preserves generated context qualification identity instead of cloning away provenance', () => {
    const qualification = contextQualification(compactProfile);
    const plan = planner({
      contextQualifications: [qualification],
    }).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.contextProfileState).toBe('QUALIFIED');
    expect(plan.contextProfile.profileId).toBe(compactProfile.id);
  });

  it('does not run Context Optimizer or grant execution authority', () => {
    const plan = planner().plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.optimizerExecuted).toBe(false);
    expect(plan.contextProfile.optimizerExecuted).toBe(false);
    expect(plan.networkCallExecuted).toBe(false);
    expect(plan.providerRequestExecuted).toBe(false);
    expect(plan.executionAuthorized).toBe(false);
    expect(Object.isFrozen(plan)).toBe(true);
  });
});
