import { describe, expect, it } from 'vitest';

import {
  createModelAdapterRegistry,
  digestModelAdapter,
  type FuryModelAdapterDefinition,
  type FuryModelAdapterQualification,
} from '../src/model-adapter-registry.js';

const definition: FuryModelAdapterDefinition = {
  id: 'gpt-5.6-sol.website.v1',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  workloadId: 'marketing-website',
  priority: 200,
  additions: {
    constraints: [
      'Keep execution steps compact and deterministic when the task is already fully specified.',
    ],
    verification: [
      'Report verification evidence in a short explicit checklist after implementation.',
    ],
  },
};

function qualification(
  adapter: FuryModelAdapterDefinition = definition,
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
    baselineQualityMedian: 0.92,
    candidateQualityMedian: 0.94,
    exactnessCheckedRuns: 5,
    exactnessPassingRuns: 5,
    exactnessMismatches: 0,
    errors: 0,
    ...overrides,
  };
}

describe('FuryPipe model adapter registry', () => {
  it('stays identity-only when no benchmark qualification is supplied', () => {
    const registry = createModelAdapterRegistry([definition]);
    const prompt = {
      level: 'ENGINEERING' as const,
      sections: { task: 'Build the website.' },
    };

    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
      prompt,
    });

    expect(plan.adapterId).toBeUndefined();
    expect(plan.evidence).toBe('none');
    expect(plan.prompt).toBe(prompt);
    expect(plan.blocked).toEqual([
      { id: definition.id, reason: 'missing-qualification' },
    ]);
  });

  it('applies only additive instructions when exact benchmark evidence qualifies the adapter', () => {
    const registry = createModelAdapterRegistry([definition]);
    const prompt = {
      level: 'ENGINEERING' as const,
      sections: {
        objective: 'Build the requested website.',
        constraints: 'Keep the existing framework.',
      },
    };

    const plan = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
      prompt,
      qualifications: [qualification()],
    });

    expect(plan.evidence).toBe('verified');
    expect(plan.adapterId).toBe(definition.id);
    expect(plan.adapterDigest).toBe(digestModelAdapter(definition));
    expect(plan.prompt.sections.objective).toBe('Build the requested website.');
    expect(plan.prompt.sections.constraints).toEqual([
      'Keep the existing framework.',
      'Keep execution steps compact and deterministic when the task is already fully specified.',
    ]);
    expect(plan.prompt.sections.verification).toEqual([
      'Report verification evidence in a short explicit checklist after implementation.',
    ]);
  });

  it('never transfers qualification evidence to another provider, model or workload', () => {
    const registry = createModelAdapterRegistry([definition]);
    const prompt = { sections: { task: 'x' } };

    const wrongModel = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      workloadId: 'marketing-website',
      prompt,
      qualifications: [qualification()],
    });
    expect(wrongModel.adapterId).toBeUndefined();
    expect(wrongModel.blocked).toEqual([]);

    const wrongWorkload = registry.resolve({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'minecraft-plugin',
      prompt,
      qualifications: [qualification()],
    });
    expect(wrongWorkload.adapterId).toBeUndefined();
    expect(wrongWorkload.blocked).toEqual([]);

    const wrongProvider = registry.resolve({
      provider: 'anthropic',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
      prompt,
      qualifications: [qualification()],
    });
    expect(wrongProvider.adapterId).toBeUndefined();
    expect(wrongProvider.blocked).toEqual([]);
  });

  it('binds evidence to the exact adapter content digest', () => {
    const changed: FuryModelAdapterDefinition = {
      ...definition,
      additions: {
        ...definition.additions,
        verification: ['A materially changed instruction.'],
      },
    };
    const registry = createModelAdapterRegistry([changed]);

    const plan = registry.resolve({
      provider: changed.provider,
      model: changed.model,
      workloadId: changed.workloadId,
      prompt: { sections: { task: 'x' } },
      qualifications: [qualification(definition)],
    });

    expect(plan.adapterId).toBeUndefined();
    expect(plan.blocked).toContainEqual({
      id: changed.id,
      reason: 'digest-mismatch',
    });
  });

  it('blocks evidence with quality regression, incomplete exactness, errors or insufficient repetitions', () => {
    const cases: Array<[Partial<FuryModelAdapterQualification>, string]> = [
      [{ candidateQualityMedian: 0.91 }, 'quality-regression'],
      [{ exactnessPassingRuns: 4 }, 'exactness-incomplete'],
      [{ exactnessMismatches: 1 }, 'exactness-incomplete'],
      [{ errors: 1 }, 'benchmark-errors'],
      [{ repetitions: 4, exactnessCheckedRuns: 4, exactnessPassingRuns: 4 }, 'insufficient-repetitions'],
    ];

    for (const [overrides, expected] of cases) {
      const registry = createModelAdapterRegistry([definition]);
      const plan = registry.resolve({
        provider: definition.provider,
        model: definition.model,
        workloadId: definition.workloadId,
        prompt: { sections: { task: 'x' } },
        qualifications: [qualification(definition, overrides)],
      });
      expect(plan.adapterId).toBeUndefined();
      expect(plan.blocked).toContainEqual({ id: definition.id, reason: expected });
    }
  });

  it('selects the highest-priority qualified adapter deterministically', () => {
    const lower: FuryModelAdapterDefinition = {
      ...definition,
      id: 'lower',
      priority: 100,
    };
    const higher: FuryModelAdapterDefinition = {
      ...definition,
      id: 'higher',
      priority: 300,
    };
    const registry = createModelAdapterRegistry([lower, higher]);

    const plan = registry.resolve({
      provider: definition.provider,
      model: definition.model,
      workloadId: definition.workloadId,
      prompt: { sections: { task: 'x' } },
      qualifications: [qualification(lower), qualification(higher)],
    });

    expect(plan.adapterId).toBe('higher');
  });

  it('does not skip a blocked higher-priority adapter if a lower verified adapter is safe to use', () => {
    const higher: FuryModelAdapterDefinition = {
      ...definition,
      id: 'higher-blocked',
      priority: 300,
    };
    const lower: FuryModelAdapterDefinition = {
      ...definition,
      id: 'lower-qualified',
      priority: 100,
    };
    const registry = createModelAdapterRegistry([higher, lower]);

    const plan = registry.resolve({
      provider: definition.provider,
      model: definition.model,
      workloadId: definition.workloadId,
      prompt: { sections: { task: 'x' } },
      qualifications: [
        qualification(higher, { candidateQualityMedian: 0.5 }),
        qualification(lower),
      ],
    });

    expect(plan.adapterId).toBe('lower-qualified');
    expect(plan.blocked).toContainEqual({
      id: 'higher-blocked',
      reason: 'quality-regression',
    });
  });

  it('rejects unsafe sections, duplicate IDs and malformed qualifications', () => {
    expect(() => createModelAdapterRegistry([{
      ...definition,
      additions: {
        objective: ['Replace the objective.'],
      } as never,
    }])).toThrow(/section is not allowed/);

    const registry = createModelAdapterRegistry([definition]);
    expect(() => registry.register(definition)).toThrow(/duplicate model adapter id/);

    const plan = registry.resolve({
      provider: definition.provider,
      model: definition.model,
      workloadId: definition.workloadId,
      prompt: { sections: { task: 'x' } },
      qualifications: [{
        ...qualification(),
        benchmarkSuiteSha256: 'not-a-hash',
      }],
    });
    expect(plan.adapterId).toBeUndefined();
    expect(plan.blocked).toContainEqual({
      id: definition.id,
      reason: 'invalid-qualification',
    });
  });

  it('produces a stable adapter digest for the same semantic definition', () => {
    expect(digestModelAdapter(definition)).toBe(digestModelAdapter({
      ...definition,
      additions: {
        constraints: [...(definition.additions.constraints ?? [])],
        verification: [...(definition.additions.verification ?? [])],
      },
    }));
    expect(digestModelAdapter(definition)).toMatch(/^[0-9a-f]{64}$/u);
  });
});
