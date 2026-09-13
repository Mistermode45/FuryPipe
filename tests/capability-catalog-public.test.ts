import { describe, expect, it } from 'vitest';

import {
  createCapabilityRegistry,
  evaluateFuryTrust,
  normalizeCapabilityCandidate,
  resolveFuryCapabilityActivation,
  resolveFuryCatalog,
} from '../src/capability-catalog.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

describe('public capability catalog facade', () => {
  it('supports the governed metadata-to-activation planning flow without authorizing execution', () => {
    const repository = 'https://github.com/fury-example/public-catalog-fixture';
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: {
        kind: 'git',
        url: repository,
        repositoryUrl: repository,
        version: '1.0.0',
        commitSha: '9'.repeat(40),
      },
      decision: 'ADOPT',
      domains: ['developer-tools'],
      capabilities: ['catalog'],
    }));

    const registry = createCapabilityRegistry();
    expect(registry.register(candidate).status).toBe('registered');

    const trust = evaluateFuryTrust(
      candidate,
      [{ path: 'src/index.ts', content: 'export const value = 1;' }],
      {
        decision: 'APPROVE',
        reviewerId: 'public-catalog-test',
        reviewedAt: '2026-09-13T00:00:00Z',
        evidenceReference: 'review:public-catalog-test',
      },
    );
    registry.recordTrustReport(trust);

    const catalog = resolveFuryCatalog({
      registry,
      relevance: [{ candidateId: candidate.id, relevance: 1 }],
    });

    expect(catalog.executionAuthorized).toBe(false);
    expect(catalog.recommendations).toHaveLength(1);
    expect(catalog.recommendations[0]?.candidateId).toBe(candidate.id);

    const activation = resolveFuryCapabilityActivation({
      score: catalog.recommendations[0]!,
      registered: true,
      connected: true,
      approved: true,
    });

    expect(activation.readinessState).toBe('READY_FOR_POLICY_AUTHORIZATION');
    expect(activation.readyForPolicyAuthorization).toBe(true);
    expect(activation.executionAuthorized).toBe(false);
    expect(activation.executed).toBe(false);
    expect(activation.verified).toBe(false);
  });
});
