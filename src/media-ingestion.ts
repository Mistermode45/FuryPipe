import { createHash, randomBytes } from 'node:crypto';

export const FURY_MEDIA_INGESTION_SOURCE_FORMAT = 'furypipe-media-ingestion-source/v1' as const;
export const FURY_MEDIA_INGESTION_INPUT_FORMAT = 'furypipe-media-ingestion-input/v1' as const;
export const FURY_MEDIA_INGESTION_EVIDENCE_FORMAT = 'furypipe-media-ingestion-evidence/v1' as const;
export const FURY_MEDIA_INGESTION_HANDLE_FORMAT = 'furypipe-media-ingestion-handle/v1' as const;
export const FURY_MEDIA_INGESTION_BATCH_FORMAT = 'furypipe-media-ingestion-batch/v1' as const;

export type FuryMediaKind = 'image' | 'document' | 'audio' | 'video';
export type FuryMediaSourceOrigin =
  | 'user-upload'
  | 'local-file'
  | 'remote-transfer'
  | 'node-capture'
  | 'provider-output'
  | 'generated';

export interface FuryMediaIngestionSource {
  readonly format: typeof FURY_MEDIA_INGESTION_SOURCE_FORMAT;
  readonly origin: FuryMediaSourceOrigin;
  readonly referenceDigestSha256?: string;
}

export interface FuryMediaIngestionInput {
  readonly format: typeof FURY_MEDIA_INGESTION_INPUT_FORMAT;
  readonly itemId: string;
  readonly kind: FuryMediaKind;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly source: FuryMediaIngestionSource;
  readonly transformedFromSha256?: string;
  readonly transformationDigestSha256?: string;
}

export interface FuryMediaDimensions {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
}

export interface FuryMediaIngestionEvidence {
  readonly format: typeof FURY_MEDIA_INGESTION_EVIDENCE_FORMAT;
  readonly itemIdSha256: string;
  readonly mediaSha256: string;
  readonly byteCount: number;
  readonly kind: FuryMediaKind;
  readonly mimeType: string;
  readonly sourceOrigin: FuryMediaSourceOrigin;
  readonly provenanceDigestSha256: string;
  readonly dimensions?: FuryMediaDimensions;
  readonly durationMs?: number;
  readonly transformed: boolean;
  readonly transformedFromSha256?: string;
  readonly transformationDigestSha256?: string;
  readonly contentTrust: 'untrusted-media-content';
  readonly instructionAuthority: false;
  readonly executionAuthority: false;
  readonly automaticRemoteFetchAllowed: false;
  readonly rawMediaPersisted: false;
  readonly providerCompatibility: 'not-evaluated';
}

export interface FuryMediaIngestionHandle {
  readonly format: typeof FURY_MEDIA_INGESTION_HANDLE_FORMAT;
  readonly handleIdSha256: string;
  readonly evidence: FuryMediaIngestionEvidence;
  readonly authority: 'process-local-media-handle';
  readonly executionAuthority: false;
}

export interface FuryMediaIngestionBatch {
  readonly format: typeof FURY_MEDIA_INGESTION_BATCH_FORMAT;
  readonly handles: readonly FuryMediaIngestionHandle[];
  readonly itemCount: number;
  readonly byteCount: number;
  readonly authority: 'media-ingestion-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryMediaIngestionCoordinatorOptions {
  readonly maxBatchItems?: number;
  readonly maxItemBytes?: number;
  readonly maxBatchBytes?: number;
  readonly maxActiveItems?: number;
  readonly maxActiveBytes?: number;
  readonly maxImageDimension?: number;
  readonly maxImagePixels?: number;
  readonly maxDurationMs?: number;
}

export interface FuryMediaIngestionCoordinator {
  ingestBatch(inputs: readonly FuryMediaIngestionInput[]): FuryMediaIngestionBatch;
  readBytes(handle: FuryMediaIngestionHandle): Uint8Array;
  inspect(handle: FuryMediaIngestionHandle): FuryMediaIngestionEvidence;
  release(handle: FuryMediaIngestionHandle): boolean;
  activeItemCount(): number;
  activeByteCount(): number;
}

export type FuryMediaIngestionErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'unsupported-media-type'
  | 'mime-mismatch'
  | 'malformed-media'
  | 'dimension-limit'
  | 'duration-limit'
  | 'item-limit'
  | 'byte-limit'
  | 'invalid-handle'
  | 'released-handle';

export class FuryMediaIngestionError extends Error {
  readonly retrySafe = false;
  constructor(readonly code: FuryMediaIngestionErrorCode, message: string) {
    super(message);
    this.name = 'FuryMediaIngestionError';
  }
}

interface ParsedMedia {
  readonly kind: FuryMediaKind;
  readonly mimeType: string;
  readonly dimensions?: FuryMediaDimensions;
  readonly durationMs?: number;
}

interface HandleState {
  readonly coordinator: FuryMediaIngestionCoordinator;
  readonly handle: FuryMediaIngestionHandle;
  readonly bytes: Uint8Array;
  released: boolean;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const GENERATED_HANDLES = new WeakSet<object>();
const HANDLE_STATES = new WeakMap<object, HandleState>();

const SHA256 = /^[0-9a-f]{64}$/u;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const SOURCES = new Set<FuryMediaSourceOrigin>([
  'user-upload', 'local-file', 'remote-transfer', 'node-capture', 'provider-output', 'generated',
]);
const KINDS = new Set<FuryMediaKind>(['image', 'document', 'audio', 'video']);
const MIME_KIND = new Map<string, FuryMediaKind>([
  ['image/png', 'image'],
  ['image/jpeg', 'image'],
  ['image/gif', 'image'],
  ['application/pdf', 'document'],
  ['text/plain', 'document'],
  ['audio/wav', 'audio'],
  ['video/mp4', 'video'],
]);

const DEFAULT_MAX_BATCH_ITEMS = 8;
const HARD_MAX_BATCH_ITEMS = 32;
const DEFAULT_MAX_ITEM_BYTES = 16 * 1024 * 1024;
const HARD_MAX_ITEM_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BATCH_BYTES = 32 * 1024 * 1024;
const HARD_MAX_BATCH_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_ITEMS = 32;
const HARD_MAX_ACTIVE_ITEMS = 256;
const DEFAULT_MAX_ACTIVE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_ACTIVE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_DIMENSION = 16_384;
const HARD_MAX_IMAGE_DIMENSION = 65_535;
const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000;
const HARD_MAX_IMAGE_PIXELS = 100_000_000;
const DEFAULT_MAX_DURATION_MS = 10 * 60_000;
const HARD_MAX_DURATION_MS = 60 * 60_000;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256')
    .update('furypipe-media-ingestion/v1\0', 'utf8')
    .update(label, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryMediaIngestionError('invalid-config', `${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryMediaIngestionError('invalid-input', `${label} must be a plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryMediaIngestionError('invalid-input', `${label} must use a plain-object prototype`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new FuryMediaIngestionError('invalid-input', `${label} must not contain symbol keys`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryMediaIngestionError('invalid-input', `${label} must contain enumerable data properties only`);
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!accepted.has(key)) throw new FuryMediaIngestionError('invalid-input', `${label} contains unsupported field: ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryMediaIngestionError('invalid-input', `${label} is missing required field: ${key}`);
    }
  }
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'media integer is truncated');
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'media integer is truncated');
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'media integer is truncated');
  return (((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'media integer is truncated');
  return (((bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 3] ?? 0) * 0x1000000)) >>> 0);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function dimensions(width: number, height: number): FuryMediaDimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new FuryMediaIngestionError('malformed-media', 'image dimensions are invalid');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new FuryMediaIngestionError('malformed-media', 'image pixel count is unsafe');
  return Object.freeze({ width, height, pixels });
}

function parsePng(bytes: Uint8Array): FuryMediaDimensions {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || sig.some((value, index) => bytes[index] !== value) || readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical PNG data');
  }
  return dimensions(readU32BE(bytes, 16), readU32BE(bytes, 20));
}

function parseGif(bytes: Uint8Array): FuryMediaDimensions {
  const header = ascii(bytes, 0, 6);
  if ((header !== 'GIF87a' && header !== 'GIF89a') || bytes.length < 10) {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical GIF data');
  }
  return dimensions(readU16LE(bytes, 6), readU16LE(bytes, 8));
}

function parseJpeg(bytes: Uint8Array): FuryMediaDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical JPEG data');
  }
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let segments = 0;
  while (offset + 4 <= bytes.length && segments++ < 4096) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = readU16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'JPEG segment is truncated');
    if (sof.has(marker)) {
      if (length < 7) throw new FuryMediaIngestionError('malformed-media', 'JPEG SOF segment is invalid');
      return dimensions(readU16BE(bytes, offset + 5), readU16BE(bytes, offset + 3));
    }
    offset += length;
  }
  throw new FuryMediaIngestionError('malformed-media', 'JPEG dimensions were not found');
}

function parsePdf(bytes: Uint8Array): void {
  if (bytes.length < 8 || ascii(bytes, 0, 5) !== '%PDF-') {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical PDF data');
  }
}

function parseText(bytes: Uint8Array): void {
  if (bytes.includes(0)) throw new FuryMediaIngestionError('mime-mismatch', 'text/plain contains NUL bytes');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FuryMediaIngestionError('mime-mismatch', 'text/plain is not valid UTF-8');
  }
}

function parseWavDuration(bytes: Uint8Array): number {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical WAV data');
  }
  let offset = 12;
  let byteRate: number | undefined;
  let dataBytes: number | undefined;
  let chunks = 0;
  while (offset + 8 <= bytes.length && chunks++ < 4096) {
    const type = ascii(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) throw new FuryMediaIngestionError('malformed-media', 'WAV chunk is truncated');
    if (type === 'fmt ') {
      if (size < 16) throw new FuryMediaIngestionError('malformed-media', 'WAV fmt chunk is invalid');
      byteRate = readU32LE(bytes, dataStart + 8);
      if (!byteRate) throw new FuryMediaIngestionError('malformed-media', 'WAV byte rate is invalid');
    } else if (type === 'data') {
      dataBytes = size;
    }
    offset = dataEnd + (size % 2);
  }
  if (byteRate === undefined || dataBytes === undefined) throw new FuryMediaIngestionError('malformed-media', 'WAV duration evidence is incomplete');
  const value = Math.ceil((dataBytes * 1000) / byteRate);
  if (!Number.isSafeInteger(value) || value < 0) throw new FuryMediaIngestionError('malformed-media', 'WAV duration is invalid');
  return value;
}

function parseMp4Duration(bytes: Uint8Array): number {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') {
    throw new FuryMediaIngestionError('mime-mismatch', 'bytes are not canonical MP4 data');
  }
  const findMvhd = (start: number, end: number, depth: number): { timescale: number; duration: number } | undefined => {
    let offset = start;
    let boxes = 0;
    while (offset + 8 <= end && boxes++ < 8192) {
      const size = readU32BE(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      if (size === 1 || size < 8 || offset + size > end) throw new FuryMediaIngestionError('malformed-media', 'MP4 box is invalid or uses unsupported extended sizing');
      if (type === 'mvhd') {
        const body = offset + 8;
        const version = bytes[body];
        if (version === 0) {
          if (size < 28) throw new FuryMediaIngestionError('malformed-media', 'MP4 mvhd box is truncated');
          return { timescale: readU32BE(bytes, body + 12), duration: readU32BE(bytes, body + 16) };
        }
        if (version === 1) {
          if (size < 40) throw new FuryMediaIngestionError('malformed-media', 'MP4 mvhd v1 box is truncated');
          const timescale = readU32BE(bytes, body + 20);
          const high = readU32BE(bytes, body + 24);
          const low = readU32BE(bytes, body + 28);
          const duration = high * 0x100000000 + low;
          if (!Number.isSafeInteger(duration)) throw new FuryMediaIngestionError('malformed-media', 'MP4 duration exceeds safe integer range');
          return { timescale, duration };
        }
        throw new FuryMediaIngestionError('malformed-media', 'MP4 mvhd version is unsupported');
      }
      if (type === 'moov' && depth < 2) {
        const found = findMvhd(offset + 8, offset + size, depth + 1);
        if (found) return found;
      }
      offset += size;
    }
    return undefined;
  };
  const timing = findMvhd(0, bytes.length, 0);
  if (!timing || timing.timescale < 1 || timing.duration < 0) throw new FuryMediaIngestionError('malformed-media', 'MP4 duration evidence is missing');
  const value = Math.ceil((timing.duration * 1000) / timing.timescale);
  if (!Number.isSafeInteger(value) || value < 0) throw new FuryMediaIngestionError('malformed-media', 'MP4 duration is invalid');
  return value;
}

function parseMedia(kind: FuryMediaKind, mimeType: string, bytes: Uint8Array): ParsedMedia {
  const expectedKind = MIME_KIND.get(mimeType);
  if (!expectedKind) throw new FuryMediaIngestionError('unsupported-media-type', 'media MIME type is not in the explicit supported set');
  if (expectedKind !== kind) throw new FuryMediaIngestionError('mime-mismatch', 'declared media kind does not match MIME type');
  if (mimeType === 'image/png') return Object.freeze({ kind, mimeType, dimensions: parsePng(bytes) });
  if (mimeType === 'image/jpeg') return Object.freeze({ kind, mimeType, dimensions: parseJpeg(bytes) });
  if (mimeType === 'image/gif') return Object.freeze({ kind, mimeType, dimensions: parseGif(bytes) });
  if (mimeType === 'application/pdf') { parsePdf(bytes); return Object.freeze({ kind, mimeType }); }
  if (mimeType === 'text/plain') { parseText(bytes); return Object.freeze({ kind, mimeType }); }
  if (mimeType === 'audio/wav') return Object.freeze({ kind, mimeType, durationMs: parseWavDuration(bytes) });
  if (mimeType === 'video/mp4') return Object.freeze({ kind, mimeType, durationMs: parseMp4Duration(bytes) });
  throw new FuryMediaIngestionError('unsupported-media-type', 'media MIME type is not supported');
}

function normalizeSource(source: FuryMediaIngestionSource): FuryMediaIngestionSource {
  const record = plainRecord(source, 'media source');
  exactKeys(record, ['format', 'origin', 'referenceDigestSha256'], ['format', 'origin'], 'media source');
  if (source.format !== FURY_MEDIA_INGESTION_SOURCE_FORMAT || !SOURCES.has(source.origin)) {
    throw new FuryMediaIngestionError('invalid-input', 'media source identity is invalid');
  }
  if (source.referenceDigestSha256 !== undefined && !SHA256.test(source.referenceDigestSha256)) {
    throw new FuryMediaIngestionError('invalid-input', 'media source reference digest is invalid');
  }
  if (source.origin === 'remote-transfer' && source.referenceDigestSha256 === undefined) {
    throw new FuryMediaIngestionError('invalid-input', 'remote media provenance requires a reference digest');
  }
  return Object.freeze({
    format: FURY_MEDIA_INGESTION_SOURCE_FORMAT,
    origin: source.origin,
    ...(source.referenceDigestSha256 === undefined ? {} : { referenceDigestSha256: source.referenceDigestSha256 }),
  });
}

function normalizeInput(
  input: FuryMediaIngestionInput,
  maxItemBytes: number,
  maxImageDimension: number,
  maxImagePixels: number,
  maxDurationMs: number,
): { readonly evidence: FuryMediaIngestionEvidence; readonly bytes: Uint8Array } {
  const record = plainRecord(input, 'media ingestion input');
  exactKeys(
    record,
    ['format', 'itemId', 'kind', 'mimeType', 'bytes', 'source', 'transformedFromSha256', 'transformationDigestSha256'],
    ['format', 'itemId', 'kind', 'mimeType', 'bytes', 'source'],
    'media ingestion input',
  );
  if (
    input.format !== FURY_MEDIA_INGESTION_INPUT_FORMAT
    || !ITEM_ID.test(input.itemId)
    || !KINDS.has(input.kind)
    || typeof input.mimeType !== 'string'
    || input.mimeType !== input.mimeType.toLowerCase()
    || !MIME.test(input.mimeType)
    || !(input.bytes instanceof Uint8Array)
  ) {
    throw new FuryMediaIngestionError('invalid-input', 'media ingestion identity or bytes are invalid');
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > maxItemBytes) {
    throw new FuryMediaIngestionError('byte-limit', 'media item exceeds its byte bound');
  }
  const hasFrom = input.transformedFromSha256 !== undefined;
  const hasTransform = input.transformationDigestSha256 !== undefined;
  if (hasFrom !== hasTransform) throw new FuryMediaIngestionError('invalid-input', 'media transformation evidence must be complete');
  if (
    (input.transformedFromSha256 !== undefined && !SHA256.test(input.transformedFromSha256))
    || (input.transformationDigestSha256 !== undefined && !SHA256.test(input.transformationDigestSha256))
  ) {
    throw new FuryMediaIngestionError('invalid-input', 'media transformation digest is invalid');
  }

  const source = normalizeSource(input.source);
  const retained = new Uint8Array(input.bytes);
  const parsed = parseMedia(input.kind, input.mimeType, retained);
  if (parsed.dimensions) {
    if (
      parsed.dimensions.width > maxImageDimension
      || parsed.dimensions.height > maxImageDimension
      || parsed.dimensions.pixels > maxImagePixels
    ) {
      retained.fill(0);
      throw new FuryMediaIngestionError('dimension-limit', 'media image dimensions exceed configured bounds');
    }
  }
  if (parsed.durationMs !== undefined && parsed.durationMs > maxDurationMs) {
    retained.fill(0);
    throw new FuryMediaIngestionError('duration-limit', 'media duration exceeds configured bounds');
  }
  const mediaSha256 = sha256(retained);
  const provenanceDigestSha256 = digest('provenance', JSON.stringify({
    origin: source.origin,
    referenceDigestSha256: source.referenceDigestSha256 ?? null,
    mediaSha256,
    transformedFromSha256: input.transformedFromSha256 ?? null,
    transformationDigestSha256: input.transformationDigestSha256 ?? null,
  }));
  const evidence: FuryMediaIngestionEvidence = Object.freeze({
    format: FURY_MEDIA_INGESTION_EVIDENCE_FORMAT,
    itemIdSha256: digest('item-id', input.itemId),
    mediaSha256,
    byteCount: retained.byteLength,
    kind: parsed.kind,
    mimeType: parsed.mimeType,
    sourceOrigin: source.origin,
    provenanceDigestSha256,
    ...(parsed.dimensions === undefined ? {} : { dimensions: parsed.dimensions }),
    ...(parsed.durationMs === undefined ? {} : { durationMs: parsed.durationMs }),
    transformed: hasFrom,
    ...(input.transformedFromSha256 === undefined ? {} : { transformedFromSha256: input.transformedFromSha256 }),
    ...(input.transformationDigestSha256 === undefined ? {} : { transformationDigestSha256: input.transformationDigestSha256 }),
    contentTrust: 'untrusted-media-content' as const,
    instructionAuthority: false as const,
    executionAuthority: false as const,
    automaticRemoteFetchAllowed: false as const,
    rawMediaPersisted: false as const,
    providerCompatibility: 'not-evaluated' as const,
  });
  return Object.freeze({ evidence, bytes: retained });
}

export function isGeneratedFuryMediaIngestionCoordinator(value: unknown): value is FuryMediaIngestionCoordinator {
  return typeof value === 'object' && value !== null && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryMediaIngestionHandle(value: unknown): value is FuryMediaIngestionHandle {
  return typeof value === 'object' && value !== null && GENERATED_HANDLES.has(value);
}

export function createFuryMediaIngestionCoordinator(
  options: FuryMediaIngestionCoordinatorOptions = {},
): FuryMediaIngestionCoordinator {
  const maxBatchItems = boundedInteger(options.maxBatchItems, DEFAULT_MAX_BATCH_ITEMS, 1, HARD_MAX_BATCH_ITEMS, 'maxBatchItems');
  const maxItemBytes = boundedInteger(options.maxItemBytes, DEFAULT_MAX_ITEM_BYTES, 1, HARD_MAX_ITEM_BYTES, 'maxItemBytes');
  const maxBatchBytes = boundedInteger(options.maxBatchBytes, DEFAULT_MAX_BATCH_BYTES, maxItemBytes, HARD_MAX_BATCH_BYTES, 'maxBatchBytes');
  const maxActiveItems = boundedInteger(options.maxActiveItems, DEFAULT_MAX_ACTIVE_ITEMS, 1, HARD_MAX_ACTIVE_ITEMS, 'maxActiveItems');
  const maxActiveBytes = boundedInteger(options.maxActiveBytes, DEFAULT_MAX_ACTIVE_BYTES, maxItemBytes, HARD_MAX_ACTIVE_BYTES, 'maxActiveBytes');
  const maxImageDimension = boundedInteger(options.maxImageDimension, DEFAULT_MAX_IMAGE_DIMENSION, 1, HARD_MAX_IMAGE_DIMENSION, 'maxImageDimension');
  const maxImagePixels = boundedInteger(options.maxImagePixels, DEFAULT_MAX_IMAGE_PIXELS, 1, HARD_MAX_IMAGE_PIXELS, 'maxImagePixels');
  const maxDurationMs = boundedInteger(options.maxDurationMs, DEFAULT_MAX_DURATION_MS, 1, HARD_MAX_DURATION_MS, 'maxDurationMs');

  const active = new Map<FuryMediaIngestionHandle, HandleState>();
  let activeBytes = 0;
  let coordinator: FuryMediaIngestionCoordinator;

  const stateFor = (handle: FuryMediaIngestionHandle): HandleState => {
    if (!isGeneratedFuryMediaIngestionHandle(handle)) throw new FuryMediaIngestionError('invalid-handle', 'media handle must be process-local generated evidence');
    const state = HANDLE_STATES.get(handle);
    if (!state || state.handle !== handle || state.coordinator !== coordinator) throw new FuryMediaIngestionError('invalid-handle', 'media handle does not belong to this coordinator');
    if (state.released) throw new FuryMediaIngestionError('released-handle', 'media handle was released');
    return state;
  };

  coordinator = Object.freeze({
    ingestBatch(inputs: readonly FuryMediaIngestionInput[]): FuryMediaIngestionBatch {
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > maxBatchItems) {
        throw new FuryMediaIngestionError('item-limit', 'media batch item count exceeds its bound');
      }
      if (active.size + inputs.length > maxActiveItems) {
        throw new FuryMediaIngestionError('item-limit', 'media active-item quota would be exceeded');
      }
      const ids = new Set<string>();
      const normalized: { evidence: FuryMediaIngestionEvidence; bytes: Uint8Array }[] = [];
      let batchBytes = 0;
      try {
        for (const input of inputs) {
          const inputRecord = plainRecord(input, 'media ingestion input');
          const itemId = inputRecord.itemId;
          if (typeof itemId !== 'string' || ids.has(itemId)) throw new FuryMediaIngestionError('invalid-input', 'media batch contains duplicate or invalid item IDs');
          ids.add(itemId);
          const item = normalizeInput(input, maxItemBytes, maxImageDimension, maxImagePixels, maxDurationMs);
          batchBytes += item.bytes.byteLength;
          if (!Number.isSafeInteger(batchBytes) || batchBytes > maxBatchBytes) throw new FuryMediaIngestionError('byte-limit', 'media batch exceeds its byte bound');
          normalized.push(item);
        }
        if (activeBytes + batchBytes > maxActiveBytes) throw new FuryMediaIngestionError('byte-limit', 'media active-byte quota would be exceeded');
      } catch (error) {
        for (const item of normalized) item.bytes.fill(0);
        throw error;
      }

      const handles: FuryMediaIngestionHandle[] = [];
      for (const item of normalized) {
        const handle: FuryMediaIngestionHandle = Object.freeze({
          format: FURY_MEDIA_INGESTION_HANDLE_FORMAT,
          handleIdSha256: digest('handle', randomBytes(32).toString('base64url')),
          evidence: item.evidence,
          authority: 'process-local-media-handle' as const,
          executionAuthority: false as const,
        });
        const state: HandleState = { coordinator, handle, bytes: item.bytes, released: false };
        GENERATED_HANDLES.add(handle);
        HANDLE_STATES.set(handle, state);
        active.set(handle, state);
        activeBytes += item.bytes.byteLength;
        handles.push(handle);
      }
      return Object.freeze({
        format: FURY_MEDIA_INGESTION_BATCH_FORMAT,
        handles: Object.freeze(handles),
        itemCount: handles.length,
        byteCount: batchBytes,
        authority: 'media-ingestion-evidence-only' as const,
        executionAuthority: false as const,
      });
    },

    readBytes(handle: FuryMediaIngestionHandle): Uint8Array {
      return new Uint8Array(stateFor(handle).bytes);
    },

    inspect(handle: FuryMediaIngestionHandle): FuryMediaIngestionEvidence {
      return stateFor(handle).handle.evidence;
    },

    release(handle: FuryMediaIngestionHandle): boolean {
      const state = stateFor(handle);
      state.released = true;
      active.delete(handle);
      activeBytes -= state.bytes.byteLength;
      state.bytes.fill(0);
      return true;
    },

    activeItemCount(): number {
      return active.size;
    },

    activeByteCount(): number {
      return activeBytes;
    },
  });

  GENERATED_COORDINATORS.add(coordinator);
  return coordinator;
}
