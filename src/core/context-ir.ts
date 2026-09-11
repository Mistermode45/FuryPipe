import { createHash } from 'node:crypto';

export type IRSourceRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';
export type IRTrustLevel =
  | 'SYSTEM_TRUSTED'
  | 'DEVELOPER_TRUSTED'
  | 'USER_AUTHORED'
  | 'TOOL_TRUSTED_SCHEMA'
  | 'TOOL_UNTRUSTED_CONTENT'
  | 'EXTERNAL_UNTRUSTED'
  | 'GENERATED_DERIVED';
export type IRExactnessClass =
  | 'BYTE_EXACT_REQUIRED'
  | 'TOKEN_EXACT_REQUIRED'
  | 'SEMANTIC_EXACT_REQUIRED'
  | 'LOSSY_ALLOWED'
  | 'OPAQUE_PRESERVE_ONLY';
export type IRCompressionEligibility = 'allow' | 'guarded' | 'deny';

export interface IRByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ContextIRBlock {
  readonly id: string;
  readonly sourceRole: IRSourceRole;
  readonly sourceProviderShape: string;
  readonly semanticType: string;
  readonly trustLevel: IRTrustLevel;
  readonly provenance: string;
  readonly contentHash: string;
  readonly byteRange?: IRByteRange;
  readonly tokenEstimate?: number;
  readonly exactnessClass: IRExactnessClass;
  readonly volatilityClass: 'stable' | 'semi_stable' | 'dynamic';
  readonly cacheClass: 'stable' | 'semi_stable' | 'dynamic' | 'not_cacheable';
  readonly sideEffectClass: 'none' | 'idempotent' | 'non_idempotent' | 'unknown';
  readonly sensitivityClass: 'public' | 'internal' | 'confidential' | 'secret';
  readonly compressionEligibility: IRCompressionEligibility;
  readonly dependencies: readonly string[];
  readonly references: readonly string[];
  readonly toolTransactionId?: string;
  readonly createdAt: string;
  readonly logicalTurn: number;
  readonly lineage: readonly string[];
}

export interface ContextIR {
  readonly format: 'furypipe-context-ir/v1';
  readonly requestId: string;
  readonly blocks: readonly ContextIRBlock[];
}

export interface ContextIRBlockInput extends Omit<ContextIRBlock, 'id' | 'contentHash'> {
  readonly id?: string;
  readonly text: string;
}

export interface ContextIRVerification {
  readonly ok: boolean;
  readonly duplicateIds: readonly string[];
  readonly invalidReferences: readonly string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(new TextEncoder().encode(text)).digest('hex');
}

function stableId(input: ContextIRBlockInput, contentHash: string): string {
  return `ctx_${sha256(`${input.sourceRole}\0${input.logicalTurn}\0${contentHash}`).slice(0, 24)}`;
}

/** Create one IR block without retaining the source text in the IR. */
export function createContextIRBlock(input: ContextIRBlockInput): ContextIRBlock {
  const contentHash = sha256(input.text);
  const { text: _text, id: requestedId, ...metadata } = input;
  return {
    ...metadata,
    id: requestedId ?? stableId(input, contentHash),
    contentHash,
  };
}

/** Build a typed request graph and reject duplicate block IDs. */
export function createContextIR(requestId: string, inputs: readonly ContextIRBlockInput[]): ContextIR {
  const blocks = inputs.map(createContextIRBlock);
  const verification = verifyContextIR({ format: 'furypipe-context-ir/v1', requestId, blocks });
  if (!verification.ok) throw new Error(`invalid ContextIR: duplicate=${verification.duplicateIds.join(',')}`);
  return { format: 'furypipe-context-ir/v1', requestId, blocks };
}

export function verifyContextIR(ir: ContextIR): ContextIRVerification {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const block of ir.blocks) {
    if (seen.has(block.id)) duplicateIds.push(block.id);
    seen.add(block.id);
  }
  const ids = new Set(seen);
  const invalidReferences: string[] = [];
  for (const block of ir.blocks) {
    for (const reference of [...block.dependencies, ...block.references]) {
      if (!ids.has(reference)) invalidReferences.push(`${block.id}->${reference}`);
    }
  }
  return { ok: duplicateIds.length === 0 && invalidReferences.length === 0, duplicateIds, invalidReferences };
}

export function verifyContextIRBlockText(block: ContextIRBlock, text: string): boolean {
  return sha256(text) === block.contentHash;
}
