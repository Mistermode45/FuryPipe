import { createHash } from 'node:crypto';

import type { PrecisionManifest, ProtectedSpan } from './exact-guard.js';

export type ReceiptConfidence = 'unknown' | 'estimated' | 'verified';

export interface CompressionReceipt {
  readonly format: 'furypipe-compression-receipt/v1';
  readonly requestId?: string;
  readonly strategy: 'passthrough' | 'pxpipe-transform' | 'externalize';
  readonly model?: string;
  readonly originalHash: string;
  readonly transformedHash: string;
  readonly originalBytes: number;
  readonly transformedBytes: number;
  /** Protected spans contain hashes and offsets only; source plaintext is never retained. */
  readonly protectedSpans: readonly ProtectedSpan[];
  readonly recoveryHandles: readonly string[];
  readonly tokenCost: {
    readonly before?: number;
    readonly after?: number;
    readonly confidence: ReceiptConfidence;
  };
  readonly cacheEffects?: Readonly<Record<string, number | string | boolean | null>>;
  readonly confidence: ReceiptConfidence;
  readonly verificationStatus: 'verified' | 'unverified';
}

export interface CompressionReceiptInput {
  readonly original: Uint8Array;
  readonly transformed: Uint8Array;
  readonly requestId?: string;
  readonly model?: string | null;
  readonly strategy: CompressionReceipt['strategy'];
  readonly precisionManifest?: PrecisionManifest;
  readonly recoveryHandles?: readonly string[];
  readonly tokenCost?: {
    readonly before?: number;
    readonly after?: number;
    readonly confidence?: ReceiptConfidence;
  };
  readonly cacheEffects?: Readonly<Record<string, number | string | boolean | null>>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validTokenCost(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

/**
 * Creates a machine-readable, plaintext-free audit receipt for one transformation.
 * SHA-256 is used here as the receipt's interoperable wire format; it is not a
 * claim that the upstream image renderer is lossless.
 */
export function createCompressionReceipt(input: CompressionReceiptInput): CompressionReceipt {
  if (!validTokenCost(input.tokenCost?.before) || !validTokenCost(input.tokenCost?.after)) {
    throw new RangeError('receipt token costs must be finite non-negative numbers');
  }

  const precisionManifest = input.precisionManifest;
  const protectedSpans = precisionManifest?.spans ?? [];
  const recoveryHandles = input.recoveryHandles ?? [];
  const confidence = input.tokenCost?.confidence ?? 'unknown';

  return {
    format: 'furypipe-compression-receipt/v1',
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    strategy: input.strategy,
    ...(input.model ? { model: input.model } : {}),
    originalHash: sha256(input.original),
    transformedHash: sha256(input.transformed),
    originalBytes: input.original.byteLength,
    transformedBytes: input.transformed.byteLength,
    protectedSpans,
    recoveryHandles: [...recoveryHandles],
    tokenCost: {
      ...(input.tokenCost?.before === undefined ? {} : { before: input.tokenCost.before }),
      ...(input.tokenCost?.after === undefined ? {} : { after: input.tokenCost.after }),
      confidence,
    },
    ...(input.cacheEffects === undefined ? {} : { cacheEffects: { ...input.cacheEffects } }),
    confidence,
    verificationStatus: precisionManifest?.verificationStatus ?? 'unverified',
  };
}

export function verifyCompressionReceipt(
  receipt: CompressionReceipt,
  original: Uint8Array,
  transformed: Uint8Array,
): boolean {
  return receipt.format === 'furypipe-compression-receipt/v1'
    && receipt.originalBytes === original.byteLength
    && receipt.transformedBytes === transformed.byteLength
    && receipt.originalHash === sha256(original)
    && receipt.transformedHash === sha256(transformed);
}
