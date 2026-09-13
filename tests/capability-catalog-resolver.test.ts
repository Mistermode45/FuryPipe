import { describe, expect, it } from 'vitest';

import { resolveFuryCatalog } from '../src/capability-catalog-resolver.js';
import { createCapabilityRegistry } from '../src/ecosystem/registry.js';
import { normalizeCapabilityCandidate } from '../src/ecosystem/normalize.js';
import { evaluateFuryTrust } from '../src/fury-trust.js';
import { qualifyFuryCapabilityPerformance } from '../src/fury-score.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

function makeCandidate(
  idChar: string,
  overrides: Parameters<typeof makeCapabilityCandidate>[0] = {},
) {
  const repository = `https://github.com/fury-example/catalog-${idChar}`;
  return normalizeCapabilityCandidate(makeCapabilityCandidate({
    source: {
      kind: 'git',
      url: repository,
      repositoryUrl: repository,
      version: '1.0.0',
      commitSha: idChar.repeat(40),
    },
    decision: 'ADOPT',
    domains: ['software'],
    capabilities: ['code'],
    ...overrides,
  }));
}

function safeTrust(candidate: ReturnType<typeof makeCandidate>) {
  return evaluateFuryTrust(
    candidate,
    [{ path: 'src/index.ts', content: 'export const value = 1;' }],
    {
      decision: 'APPROVE',
      reviewerId: 'catalog-reviewer',
      reviewedAt: '2026-09-13T00:00:00Z',
      evidenceReference: 'review:catalog',
    },
  );
}

function registerWithTrust(
  registry: ReturnType<typeof createCapabilityRegistry>,
  candidate: ReturnType<typeof makeCandidate>,
  trust = safeTrust(candidate),
): void {
  expect(registry.register(candidate).status).toBe('registered');
  registry.recordTrustReport(trust);
}

describe('FuryPipe capability catalog resolver', () => {
  it('returns ranked recommendations separately from blocked candidates', () => {
    const registry = createCapabilityRegistry();
    const ranked = makeCandidate('a');
    const reference = makeCandidate('b', { decision: 'REFERENCE_ONLY' });
    const dangerous = makeCandidate('c', {
      permissions: {
        network: 'arbitrary',
        filesystem: 'read',
        subprocess: 'none',
        credentials: 'manage',
        externalWrites: [],
        database: 'none',
        browser: 'none',
        provider: 'none',
        cloud: 'none',
      },
    });

    registerWithTrust(registry, ranked);
    registerWithTrust(registry, reference);
    const dangerousTrust = evaluateFuryTrust(
      dangerous,
      [{ path: 'src/index.ts', content: 'export const value = 1;' }],
    );
    registerWithTrust(registry, dangerous, dangerousTrust);

    const result = resolveFuryCatalog({
      registry,
      relevance: [
        { candidateId: ranked.id, relevance: 0.8 },
        { candidateId: reference.id, relevance: 0.9 },
        { candidateId: dangerous.id, relevance: 1 },
      ],
    });

    expect(result.recommendations.map((entry) => entry.routingState)).toEqual([
      'RANKED',
      'REFERENCE_ONLY',
    ]);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.candidateId).toBe(dangerous.id);
    expect(result.executionAuthorized).toBe(false);
    expect(result.candidatesConsidered).toBe(3);
    expect(result.candidatesScored).toBe(3);
  });

  it('skips candidates without relevance or a recorded trust report', () => {
    const registry = createCapabilityRegistry();
    const missingRelevance = makeCandidate('d');
    const missingTrust = makeCandidate('e');

    registerWithTrust(registry, missingRelevance);
    expect(registry.register(missingTrust).status).toBe('registered');

    const result = resolveFuryCatalog({
      registry,
      relevance: [{ candidateId: missingTrust.id, relevance: 1 }],
    });

    expect(result.recommendations).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      { candidateId: missingRelevance.id, reason: 'missing-relevance' },
      { candidateId: missingTrust.id, reason: 'missing-trust-report' },
    ]));
  });

  it('uses qualified provider/model/workload performance evidence in ranking', () => {
    const registry = createCapabilityRegistry();
    const baseline = makeCandidate('f');
    const measured = makeCandidate('1');

    registerWithTrust(registry, baseline);
    registerWithTrust(registry, measured);

    const performance = qualifyFuryCapabilityPerformance({
      candidateId: measured.id,
      benchmarkId: 'bench-catalog-001',
      benchmarkSha256: 'f'.repeat(64),
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      sampleSize: 10,
      qualityDelta: 0.10,
      tokenDeltaRatio: -0.4,
      latencyDeltaRatio: -0.2,
      costDeltaRatio: -0.2,
      exactnessPassed: true,
      errors: 0,
    });

    const result = resolveFuryCatalog({
      registry,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      relevance: [
        { candidateId: baseline.id, relevance: 0.8 },
        { candidateId: measured.id, relevance: 0.8 },
      ],
      performance: [performance],
    });

    expect(result.recommendations[0]?.candidateId).toBe(measured.id);
    expect(result.recommendations[0]?.performanceEvidence).toBe('QUALIFIED');
    expect(result.recommendations[1]?.performanceEvidence).toBe('NONE');
  });

  it('applies registry query filters before relevance validation and ranking', () => {
    const registry = createCapabilityRegistry();
    const web = makeCandidate('2', { domains: ['web'] });
    const minecraft = makeCandidate('3', { domains: ['minecraft'] });
    registerWithTrust(registry, web);
    registerWithTrust(registry, minecraft);

    const result = resolveFuryCatalog({
      registry,
      query: { domains: ['minecraft'] },
      relevance: [{ candidateId: minecraft.id, relevance: 0.9 }],
    });

    expect(result.candidatesConsidered).toBe(1);
    expect(result.recommendations[0]?.candidateId).toBe(minecraft.id);

    expect(() => resolveFuryCatalog({
      registry,
      query: { domains: ['minecraft'] },
      relevance: [
        { candidateId: minecraft.id, relevance: 0.9 },
        { candidateId: web.id, relevance: 1 },
      ],
    })).toThrow(/outside the resolved query/);
  });

  it('rejects duplicate relevance, stale performance IDs and invalid result limits', () => {
    const registry = createCapabilityRegistry();
    const candidate = makeCandidate('4');
    registerWithTrust(registry, candidate);

    expect(() => resolveFuryCatalog({
      registry,
      relevance: [
        { candidateId: candidate.id, relevance: 0.5 },
        { candidateId: candidate.id, relevance: 0.6 },
      ],
    })).toThrow(/duplicate candidateId/);

    const outside = makeCandidate('5');
    const performance = qualifyFuryCapabilityPerformance({
      candidateId: outside.id,
      benchmarkId: 'bench-outside',
      benchmarkSha256: 'e'.repeat(64),
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      sampleSize: 5,
      qualityDelta: 0,
      tokenDeltaRatio: 0,
      latencyDeltaRatio: 0,
      exactnessPassed: true,
      errors: 0,
    });
    expect(() => resolveFuryCatalog({
      registry,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      relevance: [{ candidateId: candidate.id, relevance: 0.5 }],
      performance: [performance],
    })).toThrow(/performance references a candidate outside/);

    expect(() => resolveFuryCatalog({
      registry,
      relevance: [{ candidateId: candidate.id, relevance: 0.5 }],
      maxResults: 101,
    })).toThrow(/maxResults/);
  });

  it('is deterministic for the same registry state and inputs', () => {
    const registry = createCapabilityRegistry();
    const a = makeCandidate('6');
    const b = makeCandidate('7');
    registerWithTrust(registry, a);
    registerWithTrust(registry, b);

    const input = {
      registry,
      relevance: [
        { candidateId: b.id, relevance: 0.7 },
        { candidateId: a.id, relevance: 0.9 },
      ],
    };

    expect(resolveFuryCatalog(input)).toEqual(resolveFuryCatalog(input));
  });
});
