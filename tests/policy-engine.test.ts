import { describe, expect, it } from 'vitest';
import { createContextIR } from '../src/core/context-ir.js';
import { evaluatePolicy } from '../src/core/policy-engine.js';

function block(exactnessClass: 'LOSSY_ALLOWED' | 'BYTE_EXACT_REQUIRED') {
  return createContextIR('policy-test', [{
    sourceRole: 'tool', sourceProviderShape: 'test', semanticType: 'text', trustLevel: 'TOOL_UNTRUSTED_CONTENT',
    provenance: 'fixture', text: 'payload', exactnessClass, volatilityClass: 'stable', cacheClass: 'stable',
    sideEffectClass: 'none', sensitivityClass: 'internal', compressionEligibility: exactnessClass === 'LOSSY_ALLOWED' ? 'allow' : 'deny',
    dependencies: [], references: [], createdAt: '2026-09-11T00:00:00.000Z', logicalTurn: 1, lineage: ['fixture'],
  }]).blocks;
}

const costs = { regularInput: 10, cacheWrite: 1, cacheRead: 1, visualInput: 2, retrieval: 0, localCompute: 1, retry: 0, output: 2 };

describe('policy engine', () => {
  it('selects guarded lossy only when the estimate is economical and eligible', () => {
    const decision = evaluatePolicy({ mode: 'balanced', blocks: block('LOSSY_ALLOWED'), costs });
    expect(decision.strategy).toBe('guarded-lossy');
    expect(decision.evidence).toBe('estimated');
    expect(decision.canaryEligible).toBe(true);
  });

  it('forces raw for byte-exact content, critical SLA and unavailable providers', () => {
    const decision = evaluatePolicy({ mode: 'aggressive', blocks: block('BYTE_EXACT_REQUIRED'), costs, providerAvailable: false, constraints: { qualitySla: 'critical' } });
    expect(decision.strategy).toBe('raw');
    expect(decision.hardConstraints.length).toBe(3);
    expect(decision.canaryEligible).toBe(false);
  });

  it('uses native cache in safe and coding-safe modes', () => {
    expect(evaluatePolicy({ mode: 'safe', blocks: block('LOSSY_ALLOWED'), costs }).strategy).toBe('native-cache');
    expect(evaluatePolicy({ mode: 'coding-safe', blocks: block('LOSSY_ALLOWED'), costs }).strategy).toBe('native-cache');
  });

  it('fails closed to raw when any cost component is negative or non-finite', () => {
    const negative = evaluatePolicy({ mode: 'balanced', blocks: block('LOSSY_ALLOWED'), costs: { ...costs, visualInput: -100 } });
    expect(negative.strategy).toBe('raw');
    expect(negative.canaryEligible).toBe(false);
    expect(negative.hardConstraints).toContain('invalid or out-of-range cost estimate');

    const notFinite = evaluatePolicy({ mode: 'balanced', blocks: block('LOSSY_ALLOWED'), costs: { ...costs, regularInput: Number.NaN } });
    expect(notFinite.strategy).toBe('raw');
    expect(notFinite.canaryEligible).toBe(false);
  });
});
