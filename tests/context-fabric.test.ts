import { describe, expect, it } from 'vitest';
import {
  appendInstructionEntry,
  createContextIR,
  createInstructionEntry,
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

  it('assigns distinct IDs to repeated content in one request', () => {
    const first = input('repeat');
    const second = { ...input('repeat'), byteRange: { start: 6, end: 12 } };
    const ir = createContextIR('req-repeated', [first, second]);
    expect(ir.blocks[0]?.id).not.toBe(ir.blocks[1]?.id);
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

  it('keeps one active latest user request per scope and preserves history', () => {
    let ledger = createInstructionLedger();
    ledger = appendInstructionEntry(ledger, {
      category: 'latest_user_request', sourceRole: 'user', scope: 'task', text: 'first',
      provenance: 'fixture:user:1', logicalTurn: 1, active: true, historical: false,
    });
    ledger = appendInstructionEntry(ledger, {
      category: 'latest_user_request', sourceRole: 'user', scope: 'task', text: 'second',
      provenance: 'fixture:user:2', logicalTurn: 2, active: true, historical: false,
    });
    expect(ledger.entries[0]).toMatchObject({ active: false, historical: true });
    expect(ledger.entries[1]).toMatchObject({ active: true, historical: false, supersedes: ledger.entries[0]?.id });
    expect(ledger.latestUserTurnIds?.task).toBe(ledger.entries[1]?.id);
    expect(validateInstructionLedger(ledger)).toEqual({ ok: true, errors: [] });
  });

  it('preserves prototype-named scopes in the latest request index', () => {
    const ledger = appendInstructionEntry(createInstructionLedger(), {
      category: 'latest_user_request', sourceRole: 'user', scope: '__proto__', text: 'keep this scoped request',
      provenance: 'fixture:prototype-scope', logicalTurn: 1, active: true, historical: false,
    });

    expect(ledger.latestUserTurnIds).toBeDefined();
    expect(Object.hasOwn(ledger.latestUserTurnIds!, '__proto__')).toBe(true);
    expect(ledger.latestUserTurnIds?.['__proto__']).toBe(ledger.entries[0]?.id);
    expect(validateInstructionLedger(ledger)).toEqual({ ok: true, errors: [] });
  });

  it('bounds individual instruction text and total ledger entry count', () => {
    expect(() => createInstructionEntry({
      category: 'constraint', sourceRole: 'user', text: 'x'.repeat(256 * 1024 + 1),
      provenance: 'fixture:large', logicalTurn: 1, active: true, historical: false,
    })).toThrow(/per-entry limit/);

    const entries = Array.from({ length: 4_097 }, (_, index) => createInstructionEntry({
      category: 'constraint', sourceRole: 'system', text: 'bounded',
      provenance: `fixture:${index}`, logicalTurn: index, active: true, historical: false,
    }));
    expect(() => createInstructionLedger(entries)).toThrow(/limited to 4096 entries/);
  });
});
