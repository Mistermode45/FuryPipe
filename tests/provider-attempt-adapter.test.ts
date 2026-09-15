import { describe, expect, it } from 'vitest';

import {
  createModelAdapterRegistry,
  digestModelAdapter,
  type FuryModelAdapterBlock,
  type FuryModelAdapterDefinition,
  type FuryModelAdapterQualification,
} from '../src/model-adapter-registry.js';
import { DEFAULT_PROVIDER_REGISTRY, createProviderRuntimeState } from '../src/core/index.js';
import {
  createProviderAttemptAdapterPlanner,
  type FuryProviderAttemptBasePrompt,
} from '../src/provider-attempt-adapter.js';

const openAiAdapter: FuryModelAdapterDefinition = {
  id: 'openai-gpt-sol-marketing-v1',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  workloadId: 'marketing-website',
  priority: 100,
  additions: {
    constraints: ['OPENAI_ONLY'],
    verification: ['Verify the OpenAI-specific benchmarked output contract.'],
  },
};

const anthropicAdapter: FuryModelAdapterDefinition = {
  id: 'anthropic-claude-opus-marketing-v1',
  provider: 'anthropic',
  model: 'claude-opus-5',
  workloadId: 'marketing-website',
  priority: 100,
  additions: {
    constraints: ['CLAUDE_ONLY'],
  },
};

const basePrompt: FuryProviderAttemptBasePrompt = {
  level: 'ENGINEERING',
  sections: {
    task: 'BASE',
    constraints: 'BASE_CONSTRAINT',
  },
};

function qualification(
  adapter: FuryModelAdapterDefinition,
  overrides: Partial<FuryModelAdapterQualification> = {},
): FuryModelAdapterQualification {
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
    baselineQualityMedian: 0.9,
    candidateQualityMedian: 0.92,
    exactnessCheckedRuns: 5,
    exactnessPassingRuns: 5,
    exactnessMismatches: 0,
    errors: 0,
    ...overrides,
  };
}

function planner(
  adapters: readonly FuryModelAdapterDefinition[] = [openAiAdapter],
  qualifications: readonly FuryModelAdapterQualification[] = [],
  prompt: FuryProviderAttemptBasePrompt = basePrompt,
) {
  return createProviderAttemptAdapterPlanner({
    basePrompt: prompt,
    registry: createModelAdapterRegistry(adapters),
    qualifications,
  });
}

describe('FuryPipe provider-attempt model adapter planner', () => {
  it('returns an immutable identity prompt when the exact candidate has no qualification', () => {
    const plan = planner().plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });

    expect(plan.adapterState).toBe('IDENTITY');
    expect(plan.adapterId).toBeUndefined();
    expect(plan.evidence).toBe('none');
    expect(plan.blocked).toEqual([{ id: openAiAdapter.id, reason: 'missing-qualification' }]);
    expect(plan.prompt).toEqual(basePrompt);
    expect(plan.prompt).not.toBe(basePrompt);
    expect(plan.networkCallExecuted).toBe(false);
    expect(plan.providerRequestExecuted).toBe(false);
  });

  it('applies a qualified exact adapter additively and preserves the base prompt', () => {
    const plan = planner([openAiAdapter], [qualification(openAiAdapter)]).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });

    expect(plan.adapterState).toBe('APPLIED');
    expect(plan.adapterId).toBe(openAiAdapter.id);
    expect(plan.adapterDigest).toBe(digestModelAdapter(openAiAdapter));
    expect(plan.evidence).toBe('verified');
    expect(plan.prompt.sections.task).toBe('BASE');
    expect(plan.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'OPENAI_ONLY']);
    expect(plan.prompt.sections.verification).toEqual([
      'Verify the OpenAI-specific benchmarked output contract.',
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.prompt)).toBe(true);
    expect(Object.isFrozen(plan.prompt.sections)).toBe(true);
  });

  it('does not apply model evidence to a different exact model', () => {
    const plan = planner([openAiAdapter], [qualification(openAiAdapter)]).plan({
      providerId: 'openai',
      model: 'gpt-5.6-luna',
      workloadId: 'marketing-website',
    });

    expect(plan.adapterState).toBe('IDENTITY');
    expect(plan.adapterId).toBeUndefined();
    expect(plan.blocked).toEqual([]);
    expect(plan.prompt.sections.constraints).toBe('BASE_CONSTRAINT');
  });

  it('does not transfer an OpenAI qualification to another provider', () => {
    const plan = planner([openAiAdapter], [qualification(openAiAdapter)]).plan({
      providerId: 'anthropic',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });

    expect(plan.adapterState).toBe('IDENTITY');
    expect(plan.adapterId).toBeUndefined();
    expect(plan.blocked).toEqual([]);
  });

  it('does not transfer qualification evidence to another workload', () => {
    const plan = planner([openAiAdapter], [qualification(openAiAdapter)]).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
    });

    expect(plan.adapterState).toBe('IDENTITY');
    expect(plan.adapterId).toBeUndefined();
    expect(plan.blocked).toEqual([]);
  });

  it('blocks a changed adapter digest and leaves the prompt unchanged', () => {
    const changedAdapter: FuryModelAdapterDefinition = {
      ...openAiAdapter,
      additions: { constraints: ['CHANGED_AFTER_QUALIFICATION'] },
    };
    const plan = planner([changedAdapter], [qualification(openAiAdapter)]).plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });

    expect(plan.adapterState).toBe('BLOCKED');
    expect(plan.adapterId).toBeUndefined();
    expect(plan.evidence).toBe('none');
    expect(plan.blocked).toEqual([{ id: changedAdapter.id, reason: 'digest-mismatch' }]);
    expect(plan.prompt.sections.constraints).toBe('BASE_CONSTRAINT');
  });

  it('preserves every existing qualification block reason from the registry', () => {
    const cases: ReadonlyArray<{
      readonly overrides: Partial<FuryModelAdapterQualification>;
      readonly reason: FuryModelAdapterBlock['reason'];
    }> = [
      { overrides: { benchmarkSuiteSha256: 'not-a-digest' }, reason: 'invalid-qualification' },
      { overrides: { provider: 'anthropic' }, reason: 'scope-mismatch' },
      { overrides: { adapterDigest: 'b'.repeat(64) }, reason: 'digest-mismatch' },
      { overrides: { repetitions: 4 }, reason: 'insufficient-repetitions' },
      { overrides: { candidateQualityMedian: 0.8 }, reason: 'quality-regression' },
      {
        overrides: { exactnessCheckedRuns: 4, exactnessPassingRuns: 4 },
        reason: 'exactness-incomplete',
      },
      { overrides: { errors: 1 }, reason: 'benchmark-errors' },
    ];

    for (const { overrides, reason } of cases) {
      const plan = planner([openAiAdapter], [qualification(openAiAdapter, overrides)]).plan({
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        workloadId: 'marketing-website',
      });
      expect(plan.adapterState).toBe('BLOCKED');
      expect(plan.adapterId).toBeUndefined();
      expect(plan.blocked).toContainEqual({ id: openAiAdapter.id, reason });
    }
  });

  it('recomposes every fallback attempt from BASE without cross-provider contamination', () => {
    const planAttempts = planner(
      [openAiAdapter, anthropicAdapter],
      [qualification(openAiAdapter), qualification(anthropicAdapter)],
    );

    const openAi = planAttempts.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });
    const anthropic = planAttempts.plan({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      workloadId: 'marketing-website',
    });

    expect(openAi.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'OPENAI_ONLY']);
    expect(anthropic.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'CLAUDE_ONLY']);
    expect(JSON.stringify(anthropic.prompt)).not.toContain('OPENAI_ONLY');
    expect(JSON.stringify(openAi.prompt)).not.toContain('CLAUDE_ONLY');
  });

  it('uses only BASE when a fallback adapter has no qualification', () => {
    const planAttempts = planner(
      [openAiAdapter, anthropicAdapter],
      [qualification(openAiAdapter)],
    );
    const openAi = planAttempts.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });
    const anthropic = planAttempts.plan({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      workloadId: 'marketing-website',
    });

    expect(openAi.adapterState).toBe('APPLIED');
    expect(anthropic.adapterState).toBe('IDENTITY');
    expect(anthropic.blocked).toEqual([{ id: anthropicAdapter.id, reason: 'missing-qualification' }]);
    expect(anthropic.prompt).toEqual(basePrompt);
    expect(JSON.stringify(anthropic.prompt)).not.toContain('OPENAI_ONLY');

    if (false) {
      // @ts-expect-error An attempt prompt must not become a new task-level base.
      createProviderAttemptAdapterPlanner({ basePrompt: openAi.prompt, registry: createModelAdapterRegistry([]) });
    }
  });

  it('isolates the base prompt, qualifications and attempts from later mutation', () => {
    const mutablePrompt = {
      sections: {
        task: ['BASE'],
        constraints: ['BASE_CONSTRAINT'],
      },
    };
    const mutableQualification = { ...qualification(openAiAdapter) };
    const planAttempts = planner(
      [openAiAdapter],
      [mutableQualification],
      mutablePrompt,
    );

    const first = planAttempts.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });
    mutablePrompt.sections.task[0] = 'MUTATED_BASE';
    mutableQualification.candidateQualityMedian = 0;

    const firstConstraints = first.prompt.sections.constraints;
    expect(Array.isArray(firstConstraints)).toBe(true);
    if (Array.isArray(firstConstraints)) {
      expect(Object.isFrozen(firstConstraints)).toBe(true);
      expect(Reflect.set(firstConstraints, 0, 'ATTEMPT_A_POISON')).toBe(false);
    }

    const second = planAttempts.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    });
    expect(first.prompt.sections.task).toEqual(['BASE']);
    expect(second.prompt.sections.task).toEqual(['BASE']);
    expect(second.prompt.sections.constraints).toEqual(['BASE_CONSTRAINT', 'OPENAI_ONLY']);
    expect(second.adapterState).toBe('APPLIED');
  });

  it('retains safe-section and size limits for malicious or oversized adapter data', () => {
    expect(() => createModelAdapterRegistry([{
      ...openAiAdapter,
      additions: { objective: ['Replace the task objective.'] } as never,
    }])).toThrow(/section is not allowed/u);

    expect(() => createModelAdapterRegistry([{
      ...openAiAdapter,
      additions: { constraints: ['X'.repeat(4097)] },
    }])).toThrow(/bounded non-empty string/u);

    expect(() => createModelAdapterRegistry([{
      ...openAiAdapter,
      additions: {
        constraints: Array.from({ length: 7 }, (_, index) => `${index}${'X'.repeat(4095)}`),
      },
    }])).toThrow(/24 KiB/u);
  });

  it('rejects padded or control-bearing attempt identity instead of normalizing it', () => {
    const planAttempts = planner();
    expect(() => planAttempts.plan({
      providerId: ' openai ',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
    })).toThrow(/exact 1-256 character identifier/u);
    expect(() => planAttempts.plan({
      providerId: 'openai',
      model: 'gpt-5.6-sol\n',
      workloadId: 'marketing-website',
    })).toThrow(/exact 1-256 character identifier/u);
  });

  it('consumes the exact selected fallback candidate without turning planning into execution', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 100,
      expiresAt: 200,
      source: 'provider-attempt-test',
      evidenceKind: 'operator-config',
    });
    const selection = runtime.selectFallback([
      { providerId: 'openai', model: 'gpt-5.6-sol' },
    ], 150);

    expect(selection.selected).toEqual({ providerId: 'openai', model: 'gpt-5.6-sol' });
    expect(selection.networkCallExecuted).toBe(false);
    if (selection.selected === undefined) throw new Error('expected a selected provider attempt');

    const plan = planner([openAiAdapter], [qualification(openAiAdapter)]).plan({
      ...selection.selected,
      workloadId: 'marketing-website',
    });
    expect(plan.adapterState).toBe('APPLIED');
    expect(plan.providerId).toBe(selection.selected.providerId);
    expect(plan.model).toBe(selection.selected.model);
    expect(plan.networkCallExecuted).toBe(false);
    expect(plan.providerRequestExecuted).toBe(false);
  });
});
