import { describe, expect, it } from 'vitest';
import {
  appendInstructionEntry,
  createContextIR,
  createInstructionLedger,
  planCache,
  validateInstructionLedger,
  verifyContextIRBlockText,
} from '../src/core/index.js';

function input(text: string, id?: string) {
  return {
    ...(id ? { id } : {}),
    sourceRole: 'tool' as const,
    sourceProviderShape: 'anthropic.tool_result',
    semanticType: 'tool_output',
    trustLevel: 'TOOL_UNTRUSTED_CONTENT' as const,
    provenance: 'fixture:test',
    byteRange: { start: 0, end: new TextEncoder().encode(text).byteLength },
    tokenEstimate: 10,
    exactnessClass: 'LOSSY_ALLOWED' as const,
    volatilityClass: 'stable' as const,
    cacheClass: 'stable' as const,
    sideEffectClass: 'none' as const,
    sensitivityClass: 'internal' as const,
    compressionEligibility: 'allow' as const,
    dependencies: [],
    references: [],
    createdAt: '2026-09-11T00:00:00.000Z',
    logicalTurn: 1,
    lineage: ['fixture:test'],
    text,
  };
}

describe('Context IR and cache planner', () => {
  it('creates stable content-addressed blocks and verifies their text', () => {
    const ir = createContextIR('req-test', [input('alpha')]);
    expect(ir.blocks[0]?.id).toMatch(/^ctx_[0-9a-f]{24}$/);
    expect(verifyContextIRBlockText(ir.blocks[0]!, 'alpha')).toBe(true);
    expect(verifyContextIRBlockText(ir.blocks[0]!, 'tampered')).toBe(false);
  });

  it('forces raw mode for protected blocks and never mutates their order', () => {
    const ir = createContextIR('req-test', [input('first', 'first'), {
      ...input('secret', 'secret'),
      exactnessClass: 'BYTE_EXACT_REQUIRED',
      compressionEligibility: 'deny',
    }]);
    const plan = planCache(ir.blocks, {
      provider: 'anthropic',
      protocol: 'messages',
      minTokens: 1024,
      granularity: 'prefix',
      strictOrdering: false,
      explicitMarkers: true,
    });
    expect(plan.mode).toBe('raw_passthrough');
    expect(plan.orderedBlockIds).toEqual(['first', 'secret']);
    expect(plan.requiresProviderContractTest).toBe(true);
  });
});

describe('Instruction Ledger', () => {
  it('keeps the latest user request role and exact text hash', () => {
    let ledger = createInstructionLedger();
    ledger = appendInstructionEntry(ledger, {
      category: 'objective', sourceRole: 'system', text: 'Keep protocol bytes intact.',
      provenance: 'fixture:system', logicalTurn: 0, active: true, historical: false,
    });
    ledger = appendInstructionEntry(ledger, {
      category: 'latest_user_request', sourceRole: 'user', text: 'Continue the local build.',
      provenance: 'fixture:user', logicalTurn: 1, active: true, historical: false,
    });
    expect(ledger.latestUserTurnId).toBe(ledger.entries[1]?.id);
    expect(validateInstructionLedger(ledger).ok).toBe(true);
    expect(ledger.entries[1]?.text).toBe('Continue the local build.');
  });

  it('rejects a role-relabeled latest user request', () => {
    const ledger = {
      format: 'furypipe-instruction-ledger/v1' as const,
      entries: [{
        id: 'bad', category: 'latest_user_request' as const, sourceRole: 'system' as const,
        text: 'not a user turn', textHash: 'bad', provenance: 'fixture', logicalTurn: 1,
        active: true, historical: false,
      }],
    };
    expect(validateInstructionLedger(ledger).ok).toBe(false);
  });
});

