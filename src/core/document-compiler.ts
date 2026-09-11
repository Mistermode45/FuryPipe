import { classifyContent, type ContentClassifierHints } from './content-classifier.js';
import { createContextIR, type ContextIR, type ContextIRBlockInput, type IRSourceRole } from './context-ir.js';

export interface DocumentCompilerInput {
  readonly requestId: string;
  readonly text: string;
  readonly source: string;
  readonly sourceRole: IRSourceRole;
  readonly sourceProviderShape: string;
  readonly provenance: string;
  readonly logicalTurn: number;
  readonly createdAt?: string;
  readonly chunkChars?: number;
  readonly classifierHints?: ContentClassifierHints;
}

export interface DocumentCompilation {
  readonly format: 'furypipe-document-compilation/v1';
  readonly source: string;
  readonly chunks: number;
  readonly ir: ContextIR;
}

function chunkLimit(value: number | undefined): number {
  if (value === undefined) return 4096;
  if (!Number.isSafeInteger(value) || value < 256 || value > 1_000_000) throw new RangeError('chunkChars must be an integer from 256 to 1000000');
  return value;
}

function trustFor(role: IRSourceRole): ContextIRBlockInput['trustLevel'] {
  switch (role) {
    case 'system': return 'SYSTEM_TRUSTED';
    case 'developer': return 'DEVELOPER_TRUSTED';
    case 'user': return 'USER_AUTHORED';
    case 'tool': return 'TOOL_UNTRUSTED_CONTENT';
    case 'assistant': return 'GENERATED_DERIVED';
  }
}

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/**
 * Return a UTF-16 offset that ends on a grapheme boundary. `chunkChars` is a
 * grapheme-count limit, not a code-unit limit, so surrogate pairs, combining
 * marks, emoji sequences and CRLF are never split between blocks.
 */
function safeChunkEnd(text: string, start: number, limit: number): number {
  if (start >= text.length) return start;
  let graphemes = 0;
  let end = start;
  for (const segment of graphemeSegmenter.segment(text.slice(start))) {
    if (graphemes === limit) break;
    end = start + segment.index + segment.segment.length;
    graphemes += 1;
  }
  if (end < text.length && text[end - 1] === '\r' && text[end] === '\n') end += 1;
  return end > start ? end : Math.min(text.length, start + 1);
}

/** Compile text into metadata-only Context IR blocks; source text is discarded after hashing. */
export function compileDocument(input: DocumentCompilerInput): DocumentCompilation {
  const limit = chunkLimit(input.chunkChars);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const chunks: ContextIRBlockInput[] = [];
  let charOffset = 0;
  let byteOffset = 0;
  while (charOffset < input.text.length || (input.text.length === 0 && chunks.length === 0)) {
    const nextOffset = input.text.length === 0 ? 0 : safeChunkEnd(input.text, charOffset, limit);
    const text = input.text.slice(charOffset, nextOffset);
    const classification = classifyContent(text, input.classifierHints);
    const chunkBytes = new TextEncoder().encode(text).byteLength;
    const secret = classification.sensitivity === 'secret';
    const guarded = classification.compressionEligibility !== 'allow';
    chunks.push({
      sourceRole: input.sourceRole,
      sourceProviderShape: input.sourceProviderShape,
      semanticType: classification.kind,
      trustLevel: trustFor(input.sourceRole),
      provenance: `${input.provenance}#chunk-${chunks.length}`,
      byteRange: { start: byteOffset, end: byteOffset + chunkBytes },
      tokenEstimate: classification.tokenEstimate,
      exactnessClass: secret ? 'BYTE_EXACT_REQUIRED' : guarded ? 'TOKEN_EXACT_REQUIRED' : 'LOSSY_ALLOWED',
      volatilityClass: 'stable',
      cacheClass: 'stable',
      sideEffectClass: 'none',
      sensitivityClass: classification.sensitivity,
      compressionEligibility: secret ? 'deny' : guarded ? 'guarded' : 'allow',
      dependencies: [],
      references: [],
      createdAt,
      logicalTurn: input.logicalTurn,
      lineage: [input.source, input.provenance, `chunk:${chunks.length}`],
      text,
    });
    if (text.length === 0) break;
    charOffset += text.length;
    byteOffset += chunkBytes;
  }

  return {
    format: 'furypipe-document-compilation/v1',
    source: input.source,
    chunks: chunks.length,
    ir: createContextIR(input.requestId, chunks),
  };
}
