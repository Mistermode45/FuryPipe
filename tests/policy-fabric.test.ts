import { describe, expect, it } from 'vitest';
import { createContextIR, evaluatePolicyFabric } from '../src/core/index.js';

const blocks = createContextIR('policy-fabric-test', [{
  sourceRole: 'user',
  sourceProviderShape: 'anthropic.message',
  semanticType: 'plain_text',
  trustLevel: 'USER_AUTHORED',
  provenance: 'fixture',
  text: 'safe content',
  exactnessClass: 'LOSSY_ALLOWED',
  volatilityClass: 'stable',
  cacheClass: 'stable',
  sideEffectClass: 'none',
  sensitivityClass: 'public',
  compressionEligibility: 'allow',
  dependencies: [],
  references: [],
  createdAt: '2026-09-11T00:00:00.000Z',
  logicalTurn: 1,
  lineage: ['fixture'],
}]).blocks;

describe('policy fabric', () => {
  it('evaluates RAW, NATIVE_CACHE, GUARDED_LOSSY, RETRIEVAL and HYBRID separately', () => {
    const result = evaluatePolicyFabric({
      provider: 'anthropic',
      mode: 'balanced',
      blocks,
      costs: { regularInput: 10, cacheWrite: 2, cacheRead: 1, visualInput: 3, retrieval: 4, localCompute: 1, retry: 0, output: 2 },
    });

    expect(result.alternatives.map((item) => item.strategy)).toEqual([
      'raw', 'native-cache', 'guarded-lossy', 'retrieval', 'hybrid',
    ]);
    expect(result.alternatives.every((item) => Number.isFinite(item.estimatedCostUsd))).toBe(true);
    expect(result.alternatives.find((item) => item.strategy === 'retrieval')?.eligible).toBe(false);
    expect(result.providerState.status).toBe('unknown');
  });

  it('blocks lossy strategies when the circuit is open and exposes safe fallback state', () => {
    const result = evaluatePolicyFabric({
      provider: 'anthropic',
      mode: 'aggressive',
      blocks,
      costs: { regularInput: 10, cacheWrite: 2, cacheRead: 1, visualInput: 3, retrieval: 4, localCompute: 1, retry: 0, output: 2 },
      providerState: {
        status: 'unavailable',
        circuit: 'open',
        fallbackProvider: 'gateway-local',
        fallbackAvailable: true,
        canaryAllowed: false,
        qualityRegressionDetected: true,
      },
    });

    expect(result.selected.strategy).toBe('raw');
    expect(result.alternatives.filter((item) => item.strategy !== 'raw').every((item) => !item.eligible)).toBe(true);
    expect(result.fallback).toMatchObject({ eligible: true, provider: 'gateway-local' });
    expect(result.safeguards).toEqual({
      circuitBreaker: 'open',
      canary: 'disabled',
      safeRollback: 'blocked',
      qualityRegression: 'detected',
    });
  });
});
