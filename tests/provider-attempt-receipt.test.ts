import { describe, expect, it } from 'vitest';

import {
  createProviderAttemptPlanReceipt,
  verifyProviderAttemptPlanReceipt,
} from '../src/provider-attempt-receipt.js';
import {
  createProviderAttemptPlanner,
  type FuryProviderAttemptPlan,
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
    task: 'SENSITIVE_SENTINEL_TASK_TEXT',
    constraints: 'BASE_CONSTRAINT',
  },
};

const adapter: FuryModelAdapterDefinition = {
  id: 'openai-coding-v1',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  workloadId: 'coding',
  additions: {
    constraints: ['OPENAI_ONLY_SENTINEL'],
  },
};

const profile: FuryContextOptimizerProfileDefinition = {
  id: 'coding-compact-v1',
  priority: 10,
  options: {
    maxBytes: 24 * 1024,
    maxItems: 64,
    discoveryMinRelevance: 0.70,
  },
};

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

function metric(raw: number, pxpipe: number, furypipe: number) {
  return {
    raw: summary(raw),
    pxpipe: summary(pxpipe),
    furypipe: summary(furypipe),
  };
}

function benchmarkSuite() {
  const digest = (id: string, char: string) => ({ id, sha256: char.repeat(64) });
  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: 5,
    minimum_repetitions_for_claims: 5,
    claim_status: 'CLAIM_ELIGIBLE',
    claim_blockers: [],
    provider: 'openai',
    model: 'gpt-5.6-sol',
    fixture: digest('fixture', 'a'),
    prompt: digest('prompt', 'b'),
    toolset: digest('toolset', 'c'),
    context: digest('context', 'd'),
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

function adapterQualification(): FuryModelAdapterQualification {
  return {
    format: 'furypipe-model-adapter-qualification/v1',
    adapterId: adapter.id,
    adapterDigest: digestModelAdapter(adapter),
    benchmarkSuiteSha256: 'e'.repeat(64),
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

function profileQualification(definition = profile) {
  const decision = qualifyContextOptimizerProfile({
    profile: definition,
    provider: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
    benchmarkSuite: benchmarkSuite(),
    benchmarkSuiteSha256: 'f'.repeat(64),
    baseline: 'raw',
    minimumRelativeTokenImprovementRatio: 0.20,
  });
  if (decision.status !== 'QUALIFIED' || decision.qualification === undefined) {
    throw new Error('expected generated context profile qualification');
  }
  return decision.qualification;
}

function identityPlan() {
  return createProviderAttemptPlanner({
    basePrompt,
    modelAdapters: {
      registry: createModelAdapterRegistry([]),
    },
    contextProfiles: {
      registry: createContextOptimizerProfileRegistry([]),
    },
  }).plan({
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
  });
}

function qualifiedPlan() {
  return createProviderAttemptPlanner({
    basePrompt,
    modelAdapters: {
      registry: createModelAdapterRegistry([adapter]),
      qualifications: [adapterQualification()],
    },
    contextProfiles: {
      registry: createContextOptimizerProfileRegistry([profile]),
      qualifications: [profileQualification()],
    },
  }).plan({
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
  });
}

describe('Provider Attempt Plan Receipt', () => {
  it('creates a deterministic plaintext-free receipt for an identity plan', () => {
    const plan = identityPlan();

    const first = createProviderAttemptPlanReceipt(plan);
    const second = createProviderAttemptPlanReceipt(plan);

    expect(first).toEqual(second);
    expect(first.receiptDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.prompt.promptDigest).toMatch(/^fp_[0-9a-f]{64}$/u);
    expect(first.prompt.sourceDigest).toMatch(/^fp_src_[0-9a-f]{64}$/u);
    expect(first.prompt.compileInputDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.adapter.state).toBe('IDENTITY');
    expect(first.contextProfile.state).toBe('IDENTITY');
    expect(first.verification).toEqual({
      structuralConsistency: 'verified',
      plannerProvenance: 'not-verified',
      providerResult: 'not-executed',
      currentContextResult: 'not-verified',
    });

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('SENSITIVE_SENTINEL_TASK_TEXT');
    expect(serialized).not.toContain('BASE_CONSTRAINT');
  });

  it('records applied adapter and qualified profile evidence without plaintext', () => {
    const plan = qualifiedPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);

    expect(receipt.adapter).toEqual(expect.objectContaining({
      state: 'APPLIED',
      evidence: 'verified',
      adapterId: 'openai-coding-v1',
      adapterDigest: digestModelAdapter(adapter),
    }));
    expect(receipt.contextProfile).toEqual(expect.objectContaining({
      state: 'QUALIFIED',
      evidence: 'verified',
      profileId: 'coding-compact-v1',
    }));
    expect(receipt.authority).toEqual({
      networkCallExecuted: false,
      providerRequestExecuted: false,
      optimizerExecuted: false,
      executionAuthorized: false,
    });

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain('OPENAI_ONLY_SENTINEL');
    expect(serialized).not.toContain('SENSITIVE_SENTINEL_TASK_TEXT');
  });

  it('verifies an untampered receipt against the exact plan', () => {
    const plan = qualifiedPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);

    expect(verifyProviderAttemptPlanReceipt(receipt, plan)).toBe(true);
  });

  it('verifies a semantically identical receipt regardless of top-level JSON key order', () => {
    const plan = qualifiedPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);
    const reordered = Object.fromEntries(Object.entries(receipt).reverse());

    expect(verifyProviderAttemptPlanReceipt(
      reordered as unknown as typeof receipt,
      plan,
    )).toBe(true);
  });

  it('rejects extra receipt fields even when the original digest is retained', () => {
    const plan = identityPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);
    const extended = {
      ...receipt,
      unexpected: 'field',
    };

    expect(verifyProviderAttemptPlanReceipt(
      extended as unknown as typeof receipt,
      plan,
    )).toBe(false);
  });

  it('rejects a tampered receipt', () => {
    const plan = identityPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);
    const tampered = {
      ...receipt,
      model: 'gpt-5.6-luna',
    };

    expect(verifyProviderAttemptPlanReceipt(tampered as typeof receipt, plan)).toBe(false);
  });

  it('fails closed when the adapter scope disagrees with the top-level attempt', () => {
    const plan = identityPlan();
    const inconsistent = {
      ...plan,
      adapter: {
        ...plan.adapter,
        providerId: 'anthropic',
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as FuryProviderAttemptPlan))
      .toThrow(/adapter plan scope/);
  });

  it('fails closed when the context profile scope disagrees with the attempt', () => {
    const plan = identityPlan();
    const inconsistent = {
      ...plan,
      contextProfile: {
        ...plan.contextProfile,
        model: 'gpt-5.6-luna',
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as FuryProviderAttemptPlan))
      .toThrow(/context profile scope/);
  });

  it('fails closed when planning-only authority flags are forged', () => {
    const plan = identityPlan();
    const inconsistent = {
      ...plan,
      executionAuthorized: true,
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as unknown as FuryProviderAttemptPlan))
      .toThrow(/planning-only/);
  });

  it('fails closed on contradictory APPLIED adapter evidence', () => {
    const plan = qualifiedPlan();
    const inconsistent = {
      ...plan,
      adapter: {
        ...plan.adapter,
        adapterDigest: undefined,
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as unknown as FuryProviderAttemptPlan))
      .toThrow(/APPLIED adapter state/);
  });

  it('fails closed on contradictory QUALIFIED context profile evidence', () => {
    const plan = qualifiedPlan();
    const inconsistent = {
      ...plan,
      contextProfile: {
        ...plan.contextProfile,
        options: undefined,
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as unknown as FuryProviderAttemptPlan))
      .toThrow(/QUALIFIED context profile/);
  });

  it('fails closed when FuryPrompt compile metadata differs even if rendered text can match', () => {
    const plan = identityPlan();
    const inconsistent = {
      ...plan,
      prompt: {
        ...plan.prompt,
        exactGuardMode: 'balanced' as const,
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as unknown as FuryProviderAttemptPlan))
      .toThrow(/prompt must exactly match adapter plan prompt/);
  });

  it('fails closed when the top-level prompt differs from the adapter prompt', () => {
    const plan = identityPlan();
    const inconsistent = {
      ...plan,
      prompt: {
        ...plan.prompt,
        sections: {
          ...plan.prompt.sections,
          task: 'DIFFERENT_TASK',
        },
      },
    };

    expect(() => createProviderAttemptPlanReceipt(inconsistent as unknown as FuryProviderAttemptPlan))
      .toThrow(/prompt must exactly match adapter plan prompt/);
  });

  it('preserves substantive block reasons without treating them as applied evidence', () => {
    const wrongAdapterQualification = {
      ...adapterQualification(),
      adapterDigest: '0'.repeat(64),
    };
    const changedProfile: FuryContextOptimizerProfileDefinition = {
      ...profile,
      options: {
        ...profile.options,
        maxBytes: 12 * 1024,
      },
    };
    const originalProfileQualification = profileQualification(profile);

    const plan = createProviderAttemptPlanner({
      basePrompt,
      modelAdapters: {
        registry: createModelAdapterRegistry([adapter]),
        qualifications: [wrongAdapterQualification],
      },
      contextProfiles: {
        registry: createContextOptimizerProfileRegistry([changedProfile]),
        qualifications: [originalProfileQualification],
      },
    }).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.adapter.adapterState).toBe('BLOCKED');
    expect(plan.contextProfileState).toBe('BLOCKED');

    const receipt = createProviderAttemptPlanReceipt(plan);
    expect(receipt.adapter.adapterId).toBeUndefined();
    expect(receipt.contextProfile.profileId).toBeUndefined();
    expect(receipt.adapter.blocked).toContainEqual({
      id: adapter.id,
      reason: 'digest-mismatch',
    });
    expect(receipt.contextProfile.blocked).toContainEqual({
      id: profile.id,
      reason: 'digest-mismatch',
    });
  });

  it('binds receipts to exact provider/model/workload scope', () => {
    const plan = identityPlan();
    const receipt = createProviderAttemptPlanReceipt(plan);

    expect(receipt.providerId).toBe('openai');
    expect(receipt.model).toBe('gpt-5.6-sol');
    expect(receipt.workloadId).toBe('coding');

    const otherPlan = createProviderAttemptPlanner({
      basePrompt,
      modelAdapters: { registry: createModelAdapterRegistry([]) },
      contextProfiles: { registry: createContextOptimizerProfileRegistry([]) },
    }).plan({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      workloadId: 'coding',
    });

    expect(verifyProviderAttemptPlanReceipt(receipt, otherPlan)).toBe(false);
    expect(createProviderAttemptPlanReceipt(otherPlan).receiptDigest).not.toBe(receipt.receiptDigest);
  });
});
