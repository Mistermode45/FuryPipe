import { describe, expect, it } from 'vitest';
import { compileDocument, verifyContextIRBlockText } from '../src/core/index.js';

describe('document compiler', () => {
  it('compiles deterministic metadata-only chunks with UTF-8 byte ranges', () => {
    const result = compileDocument({
      requestId: 'req-doc', text: 'é'.repeat(300), source: 'fixture.md', sourceRole: 'user',
      sourceProviderShape: 'anthropic.message', provenance: 'fixture:test', logicalTurn: 2, chunkChars: 256,
    });
    expect(result.format).toBe('furypipe-document-compilation/v1');
    expect(result.chunks).toBe(2);
    expect(result.ir.blocks[0]?.byteRange?.end).toBe(512);
    expect(result.ir.blocks[1]?.byteRange?.start).toBe(512);
    expect(verifyContextIRBlockText(result.ir.blocks[0]!, 'é'.repeat(256))).toBe(true);
  });

  it('does not split Unicode scalar values, grapheme clusters or CRLF', () => {
    const source = `${'😀'.repeat(256)}\r\n${'e\u0301'.repeat(256)}`;
    const result = compileDocument({
      requestId: 'req-doc-unicode', text: source, source: 'unicode.txt', sourceRole: 'user',
      sourceProviderShape: 'test.text', provenance: 'fixture:unicode', logicalTurn: 1, chunkChars: 256,
    });
    const encoded = new TextEncoder().encode(source);
    const chunks = result.ir.blocks.map((block) => {
      const range = block.byteRange!;
      return new TextDecoder().decode(encoded.slice(range.start, range.end));
    });
    expect(chunks.join('')).toBe(source);
    expect(chunks.every((chunk) => !chunk.endsWith('\r'))).toBe(true);
    expect(new Set(result.ir.blocks.map((block) => block.id)).size).toBe(result.ir.blocks.length);
  });

  it('compiles secret-like chunks as byte-exact and deny', () => {
    const result = compileDocument({
      requestId: 'req-doc-secret', text: 'Authorization: Bearer abc.def.ghi', source: 'tool.log', sourceRole: 'tool',
      sourceProviderShape: 'anthropic.tool_result', provenance: 'fixture:tool', logicalTurn: 3,
    });
    expect(result.ir.blocks[0]?.exactnessClass).toBe('BYTE_EXACT_REQUIRED');
    expect(result.ir.blocks[0]?.compressionEligibility).toBe('deny');
    expect(result.ir.blocks[0]?.sensitivityClass).toBe('secret');
  });

  it('rejects unsafe chunk limits', () => {
    expect(() => compileDocument({
      requestId: 'req-doc-invalid', text: 'x', source: 'x', sourceRole: 'user',
      sourceProviderShape: 'test', provenance: 'fixture', logicalTurn: 1, chunkChars: 1,
    })).toThrow('chunkChars');
  });
});
