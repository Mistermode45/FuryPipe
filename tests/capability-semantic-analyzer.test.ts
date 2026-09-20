import { describe, expect, it, vi } from 'vitest';

import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
} from '../src/capability-index.js';
import {
  selectFuryCapabilitiesForTask,
} from '../src/capability-autopilot.js';
import {
  createGovernedFuryCapabilitySemanticAnalyzer,
  FURY_CAPABILITY_SEMANTIC_ANALYSIS_FORMAT,
  FURY_CAPABILITY_SEMANTIC_PROVIDER_OUTPUT_FORMAT,
  isGeneratedFuryCapabilitySemanticAnalysis,
} from '../src/capability-semantic-analyzer.js';
import {
  DEFAULT_PROVIDER_REGISTRY,
} from '../src/core/provider-fabric.js';
import {
  createProviderRuntimeState,
} from '../src/core/provider-runtime.js';
import {
  createProviderTransportRegistry,
  type ProviderTransport,
} from '../src/provider-transport.js';

function indexWithSkills() {
  const index = createFuryCapabilityIndex();
  for (const [id, description] of [
    ['repo-review', 'Review repository architecture and security.'],
    ['test-audit', 'Audit tests and validation coverage.'],
  ] as const) {
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id,
      name: id.replaceAll('-', ' '),
      description,
      families: ['repository'],
      tags: ['review'],
      keywords: ['repository', 'review'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: [],
      compatibility: [],
      source: {
        system: 'skill-registry',
        sourceId: id,
      },
    });
  }
  return index;
}

function providerFixture(responseText: string) {
  const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  runtime.observeHealth({
    providerId: 'openai',
    availability: 'available',
    observedAt: 1_000,
    expiresAt: 60_000,
    latencyMs: 12,
    source: 'semantic-analyzer-test',
    evidenceKind: 'operator-config',
  });

  const execute = vi.fn<ProviderTransport['execute']>(
    async (request, context) => {
      expect(request.providerId).toBe('openai');
      expect(request.model).toBe('gpt-5.6-sol');
      expect(request.workloadId).toBe('capability-semantic-analyzer');
      expect(context.providerId).toBe('openai');
      expect(context.model).toBe('gpt-5.6-sol');
      return {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        providerRequestId: 'semantic-test-request',
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        responseBytes: new TextEncoder().encode(JSON.stringify({
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'output_text',
              text: responseText,
            }],
          }],
        })),
      };
    },
  );

  const transports = createProviderTransportRegistry([{
    providerId: 'openai',
    protocol: 'openai',
    execute,
  }]);

  return { runtime, transports, execute };
}

function analyzerFor(
  responseText: string,
  overrides: Record<string, unknown> = {},
) {
  const provider = providerFixture(responseText);
  const analyzer = createGovernedFuryCapabilitySemanticAnalyzer({
    providerRuntime: provider.runtime,
    transports: provider.transports,
    route: {
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      allowProviderRequest: true,
      permitTtlMs: 5_000,
    },
    now: () => 2_000,
    ...overrides,
  });
  return { ...provider, analyzer };
}

describe('Capability Autopilot governed semantic analyzer', () => {
  it('reranks only the deterministic shortlist through one exact governed provider call', async () => {
    const index = indexWithSkills();
    const objective = 'Review repository architecture and test coverage.';
    const selection = selectFuryCapabilitiesForTask({
      objective,
      index,
      explicitRequests: [
        { kind: 'skill', id: 'repo-review' },
        { kind: 'skill', id: 'test-audit' },
      ],
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });
    expect(selection.selected).toHaveLength(2);

    const providerOutput = JSON.stringify({
      format: FURY_CAPABILITY_SEMANTIC_PROVIDER_OUTPUT_FORMAT,
      rankings: [
        { kind: 'skill', id: 'test-audit', score: 0.95 },
        { kind: 'skill', id: 'repo-review', score: 0.6 },
      ],
    });
    const { analyzer, execute } = analyzerFor(providerOutput);

    const result = await analyzer.analyze({
      objective,
      selection,
      index,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(analyzer.activeAnalysisCount()).toBe(0);
    expect(result).toMatchObject({
      format: FURY_CAPABILITY_SEMANTIC_ANALYSIS_FORMAT,
      status: 'applied',
      selectionDigestSha256: selection.selectionDigestSha256,
      authority: 'ranking-data-only',
      executionAuthority: false,
      provider: {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        verification: 'unverified',
      },
      attempts: {
        planned: 1,
        processed: 1,
        transportInvocations: 1,
        outcome: 'SUCCEEDED',
      },
    });
    expect(result.order.map((item) => item.id)).toEqual([
      'test-audit',
      'repo-review',
    ]);
    expect(result.order[0]).toMatchObject({
      baselineRank: 1,
      semanticScore: 0.95,
    });
    expect(result.order[1]).toMatchObject({
      baselineRank: 0,
      semanticScore: 0.6,
    });
    expect(isGeneratedFuryCapabilitySemanticAnalysis(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(objective);
    expect(JSON.stringify(result)).not.toContain('executionAuthority":true');
  });

  it('falls back to baseline after malformed semantic output without retry or cross-provider fallback', async () => {
    const index = indexWithSkills();
    const objective = 'Review repository architecture.';
    const selection = selectFuryCapabilitiesForTask({
      objective,
      index,
      explicitRequests: [
        { kind: 'skill', id: 'repo-review' },
        { kind: 'skill', id: 'test-audit' },
      ],
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });

    const { analyzer, execute } = analyzerFor('{"format":"wrong","rankings":[]}');
    const baselineIds = selection.selected.map((item) => item.id);

    const result = await analyzer.analyze({
      objective,
      selection,
      index,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'semantic-output-invalid',
      authority: 'ranking-data-only',
      executionAuthority: false,
      attempts: {
        planned: 1,
        processed: 1,
        transportInvocations: 1,
        outcome: 'SUCCEEDED',
      },
    });
    expect(result.order.map((item) => item.id)).toEqual(baselineIds);
    expect(result.order.every((item) => item.semanticScore === undefined)).toBe(true);
  });

  it('fails closed to baseline before any provider call when selection evidence is stale', async () => {
    const index = indexWithSkills();
    const objective = 'Review repository architecture.';
    const selection = selectFuryCapabilitiesForTask({
      objective,
      index,
      explicitRequests: [{ kind: 'skill', id: 'repo-review' }],
    });

    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      name: 'repo review',
      description: 'Changed source-of-truth metadata.',
      families: ['repository'],
      tags: ['review'],
      keywords: ['repository', 'review'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: [],
      compatibility: [],
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        sourceRevision: 'changed',
      },
    });

    const { analyzer, execute } = analyzerFor(JSON.stringify({
      format: FURY_CAPABILITY_SEMANTIC_PROVIDER_OUTPUT_FORMAT,
      rankings: [{ kind: 'skill', id: 'repo-review', score: 1 }],
    }));

    const result = await analyzer.analyze({
      objective,
      selection,
      index,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'reselection-required',
      attempts: {
        planned: 0,
        processed: 0,
        transportInvocations: 0,
        outcome: 'NOT_STARTED',
      },
      executionAuthority: false,
    });
  });

  it('returns deterministic baseline without provider execution for an empty shortlist', async () => {
    const index = createFuryCapabilityIndex();
    const objective = 'Nothing relevant is indexed.';
    const selection = selectFuryCapabilitiesForTask({
      objective,
      index,
    });
    expect(selection.selected).toHaveLength(0);

    const { analyzer, execute } = analyzerFor('{}');
    const result = await analyzer.analyze({
      objective,
      selection,
      index,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'empty-selection',
      order: [],
      attempts: {
        planned: 0,
        processed: 0,
        transportInvocations: 0,
        outcome: 'NOT_STARTED',
      },
      authority: 'ranking-data-only',
      executionAuthority: false,
    });
  });

  it('requires explicit host provider request authority at analyzer construction', () => {
    const provider = providerFixture('{}');

    expect(() => createGovernedFuryCapabilitySemanticAnalyzer({
      providerRuntime: provider.runtime,
      transports: provider.transports,
      route: {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        allowProviderRequest: false,
        permitTtlMs: 5_000,
      } as never,
      now: () => 2_000,
    })).toThrow(/requires explicit provider request authority/u);

    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('rejects forged selection/index evidence before any transport invocation', async () => {
    const provider = providerFixture('{}');
    const analyzer = createGovernedFuryCapabilitySemanticAnalyzer({
      providerRuntime: provider.runtime,
      transports: provider.transports,
      route: {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        allowProviderRequest: true,
        permitTtlMs: 5_000,
      },
      now: () => 2_000,
    });

    const forgedIndex = {
      snapshot: vi.fn(() => {
        throw new Error('FORGED_INDEX_MUST_NOT_RUN');
      }),
    };
    const forgedSelection = {
      format: 'furypipe-capability-selection/v1',
      executionAuthority: false,
    };

    await expect(analyzer.analyze({
      objective: 'Repository review',
      selection: forgedSelection as never,
      index: forgedIndex as never,
    })).rejects.toThrow(/process-local selection/u);

    expect(forgedIndex.snapshot).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('rejects objective substitution before provider execution', async () => {
    const index = indexWithSkills();
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Original repository review objective.',
      index,
      explicitRequests: [{ kind: 'skill', id: 'repo-review' }],
    });
    const { analyzer, execute } = analyzerFor('{}');

    await expect(analyzer.analyze({
      objective: 'Substituted objective.',
      selection,
      index,
    })).rejects.toThrow(/objective does not match the selection/u);

    expect(execute).not.toHaveBeenCalled();
  });
});
