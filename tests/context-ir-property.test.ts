import { describe, expect, it } from 'vitest';
import {
  compileDocument,
  createContextIR,
  verifyContextIR,
  verifyContextIRBlockText,
  type ContextIRBlockInput,
} from '../src/core/index.js';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function irInput(text: string, ordinal: number): ContextIRBlockInput {
  const bytes = new TextEncoder().encode(text).byteLength;
  return {
    sourceRole: 'tool',
    sourceProviderShape: 'anthropic.tool_result',
    semanticType: 'tool_output',
    trustLevel: 'TOOL_UNTRUSTED_CONTENT',
    provenance: 'property:repeated',
    byteRange: { start: 0, end: bytes },
    tokenEstimate: 1,
    exactnessClass: 'LOSSY_ALLOWED',
    volatilityClass: 'stable',
    cacheClass: 'stable',
    sideEffectClass: 'none',
    sensitivityClass: 'internal',
    compressionEligibility: 'allow',
    dependencies: [],
    references: [],
    createdAt: '2026-09-12T00:00:00.000Z',
    logicalTurn: ordinal % 7,
    lineage: ['property'],
    text,
  };
}

const UNICODE_UNITS = [
  'a',
  'é',
  '中',
  '😀',
  'e\u0301',
  '👩‍💻',
  '🇫🇷',
  '\r\n',
  '\n',
  'ا',
  'क',
  '🧑🏽‍🚀',
] as const;

function generatedUnicodeDocument(random: () => number, count: number): string {
  let result = '';
  for (let index = 0; index < count; index += 1) {
    result += UNICODE_UNITS[Math.floor(random() * UNICODE_UNITS.length)]!;
  }
  return result;
}

describe('Context IR deterministic property coverage', () => {
  it('keeps 1000 repeated-content block identities unique and deterministic', () => {
    const inputs = Array.from({ length: 1000 }, (_, ordinal) => irInput('same-content', ordinal));
    const first = createContextIR('property-request', inputs);
    const second = createContextIR('property-request', inputs);

    const ids = first.blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(inputs.length);
    expect(second.blocks.map((block) => block.id)).toEqual(ids);
    expect(verifyContextIR(first)).toEqual({
      ok: true,
      duplicateIds: [],
      invalidReferences: [],
    });
    expect(first.blocks.every((block) => verifyContextIRBlockText(block, 'same-content'))).toBe(true);
  });

  it('domain-separates generated IDs by request scope even with identical metadata/content', () => {
    const inputs = Array.from({ length: 256 }, (_, ordinal) => irInput('scope-sensitive', ordinal));
    const alpha = createContextIR('scope-alpha', inputs);
    const beta = createContextIR('scope-beta', inputs);

    const alphaIds = new Set(alpha.blocks.map((block) => block.id));
    expect(beta.blocks.every((block) => !alphaIds.has(block.id))).toBe(true);
  });

  it('rejects explicit duplicate IDs instead of silently re-keying them', () => {
    const first = { ...irInput('one', 0), id: 'caller-fixed-id' };
    const second = { ...irInput('two', 1), id: 'caller-fixed-id' };
    expect(() => createContextIR('duplicate-property', [first, second])).toThrow(/duplicate=caller-fixed-id/);
  });

  it('does not retain generated source plaintext in Context IR metadata', () => {
    const marker = 'PROPERTY-PLAINTEXT-MUST-NOT-SURVIVE-7d91';
    const ir = createContextIR('plaintext-property', [irInput(marker, 0)]);
    expect(JSON.stringify(ir)).not.toContain(marker);
    expect(verifyContextIRBlockText(ir.blocks[0]!, marker)).toBe(true);
  });
});

describe('Document compiler deterministic Unicode properties', () => {
  it('reconstructs randomized Unicode documents byte-exactly across grapheme-safe chunks (seed=0xF17ECAFE)', () => {
    const random = mulberry32(0xF17ECAFE);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoder = new TextEncoder();

    for (let caseIndex = 0; caseIndex < 64; caseIndex += 1) {
      const graphemes = 300 + Math.floor(random() * 500);
      const source = generatedUnicodeDocument(random, graphemes);
      const chunkChars = 256 + Math.floor(random() * 96);
      const requestId = `unicode-property-${caseIndex}`;
      const input = {
        requestId,
        text: source,
        source: `fixture-${caseIndex}.txt`,
        sourceRole: 'user' as const,
        sourceProviderShape: 'property.text',
        provenance: `property:unicode:${caseIndex}`,
        logicalTurn: caseIndex,
        createdAt: '2026-09-12T00:00:00.000Z',
        chunkChars,
      };

      const first = compileDocument(input);
      const second = compileDocument(input);
      const encoded = encoder.encode(source);
      const decodedChunks: string[] = [];
      let expectedStart = 0;

      for (const block of first.ir.blocks) {
        const range = block.byteRange;
        expect(range).toBeDefined();
        expect(range!.start).toBe(expectedStart);
        expect(range!.end).toBeGreaterThanOrEqual(range!.start);
        expect(range!.end).toBeLessThanOrEqual(encoded.byteLength);

        const decoded = decoder.decode(encoded.slice(range!.start, range!.end));
        decodedChunks.push(decoded);
        expect(decoded.endsWith('\r')).toBe(false);
        expect(verifyContextIRBlockText(block, decoded)).toBe(true);
        expectedStart = range!.end;
      }

      expect(expectedStart).toBe(encoded.byteLength);
      expect(decodedChunks.join('')).toBe(source);
      expect(new Set(first.ir.blocks.map((block) => block.id)).size).toBe(first.ir.blocks.length);
      expect(second.ir.blocks.map((block) => block.id)).toEqual(first.ir.blocks.map((block) => block.id));
    }
  });

  it('preserves empty-document byte identity without inventing source content', () => {
    const result = compileDocument({
      requestId: 'unicode-empty-property',
      text: '',
      source: 'empty.txt',
      sourceRole: 'user',
      sourceProviderShape: 'property.text',
      provenance: 'property:empty',
      logicalTurn: 0,
      createdAt: '2026-09-12T00:00:00.000Z',
      chunkChars: 256,
    });

    expect(result.chunks).toBe(1);
    expect(result.ir.blocks[0]?.byteRange).toEqual({ start: 0, end: 0 });
    expect(verifyContextIRBlockText(result.ir.blocks[0]!, '')).toBe(true);
  });
});
