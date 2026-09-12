import { createHash } from 'node:crypto';
import type { RecoveryIndex, RecoverySearchHit, RecoverySearchOptions } from './source-retrieval.js';

export interface PolicyCacheOptions {
  readonly maxEntries?: number;
  readonly maxTotalBytes?: number;
  readonly maxEntryBytes?: number;
  readonly defaultTtlMs?: number;
  readonly now?: () => number;
}

export interface PolicyCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export interface PolicyCacheGetResult {
  readonly status: 'hit' | 'miss';
  readonly value?: Uint8Array;
}

export interface PolicyCacheExecutor {
  get(key: string): PolicyCacheGetResult;
  put(key: string, value: Uint8Array | ArrayBuffer, ttlMs?: number): void;
  delete(key: string): boolean;
  gc(): number;
  stats(): PolicyCacheStats;
  clear(): void;
}

export interface PolicyRetrievalResult {
  readonly format: 'furypipe-policy-retrieval/v1';
  readonly queryDigest: string;
  readonly hits: readonly RecoverySearchHit[];
}

export interface PolicyHybridContext {
  readonly queryDigest: string;
  readonly hits: readonly RecoverySearchHit[];
}

export interface PolicyHybridResult {
  readonly format: 'furypipe-policy-hybrid/v1';
  readonly queryDigest: string;
  readonly hits: readonly RecoverySearchHit[];
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly transformed: boolean;
  readonly output: Uint8Array;
}

interface CacheEntry {
  value: Uint8Array;
  expiresAt: number;
  sequence: number;
}

const CACHE_KEY = /^furypipe-policy-cache\/v1\/sha256\/[0-9a-f]{64}$/u;

function positiveSafeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return resolved;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative and finite`);
  return value;
}

function bytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0));
}

function validateCacheKey(key: string): void {
  if (!CACHE_KEY.test(key)) throw new Error('invalid FuryPipe policy cache key');
}

function digestQuery(query: string): string {
  return createHash('sha256').update(query, 'utf8').digest('hex');
}

export function derivePolicyCacheKey(
  provider: string,
  model: string | undefined,
  payload: Uint8Array | ArrayBuffer,
): string {
  if (provider.length < 1 || provider.length > 128) throw new Error('policy cache provider must be 1-128 characters');
  if (model !== undefined && (model.length < 1 || model.length > 256)) throw new Error('policy cache model must be 1-256 characters');
  const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const hash = createHash('sha256');
  const providerBytes = Buffer.from(provider, 'utf8');
  const modelBytes = Buffer.from(model ?? '', 'utf8');
  const lengths = Buffer.allocUnsafe(12);
  lengths.writeUInt32BE(providerBytes.byteLength, 0);
  lengths.writeUInt32BE(modelBytes.byteLength, 4);
  lengths.writeUInt32BE(payloadBytes.byteLength, 8);
  hash.update(lengths);
  hash.update(providerBytes);
  hash.update(modelBytes);
  hash.update(payloadBytes);
  return `furypipe-policy-cache/v1/sha256/${hash.digest('hex')}`;
}

export function createInMemoryPolicyCache(options: PolicyCacheOptions = {}): PolicyCacheExecutor {
  const maxEntries = positiveSafeInteger(options.maxEntries, 1024, 'maxEntries');
  const maxTotalBytes = positiveSafeInteger(options.maxTotalBytes, 64 * 1024 * 1024, 'maxTotalBytes');
  const maxEntryBytes = positiveSafeInteger(options.maxEntryBytes, 4 * 1024 * 1024, 'maxEntryBytes');
  const defaultTtlMs = positiveSafeInteger(options.defaultTtlMs, 5 * 60_000, 'defaultTtlMs');
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let sequence = 0;

  const expired = (entry: CacheEntry): boolean => nonNegativeFinite(now(), 'policy cache clock') >= entry.expiresAt;

  const remove = (key: string): boolean => {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key);
    totalBytes -= entry.value.byteLength;
    return true;
  };

  const evictOne = (): boolean => {
    let candidate: string | undefined;
    let candidateSequence = Number.POSITIVE_INFINITY;
    for (const [key, entry] of entries) {
      if (entry.sequence < candidateSequence) {
        candidate = key;
        candidateSequence = entry.sequence;
      }
    }
    if (candidate === undefined) return false;
    remove(candidate);
    evictions += 1;
    return true;
  };

  const gc = (): number => {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (expired(entry)) {
        remove(key);
        removed += 1;
      }
    }
    return removed;
  };

  return {
    get(key) {
      validateCacheKey(key);
      const entry = entries.get(key);
      if (!entry || expired(entry)) {
        if (entry) remove(key);
        misses += 1;
        return { status: 'miss' };
      }
      entry.sequence = ++sequence;
      hits += 1;
      return { status: 'hit', value: new Uint8Array(entry.value) };
    },

    put(key, value, ttlMs = defaultTtlMs) {
      validateCacheKey(key);
      const copy = bytes(value);
      if (copy.byteLength > maxEntryBytes) throw new Error('policy cache entry exceeds maxEntryBytes');
      if (copy.byteLength > maxTotalBytes) throw new Error('policy cache entry exceeds maxTotalBytes');
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new RangeError('policy cache ttlMs must be a positive safe integer');
      const clock = nonNegativeFinite(now(), 'policy cache clock');
      remove(key);
      gc();
      while (entries.size >= maxEntries || totalBytes + copy.byteLength > maxTotalBytes) {
        if (!evictOne()) break;
      }
      entries.set(key, { value: copy, expiresAt: clock + ttlMs, sequence: ++sequence });
      totalBytes += copy.byteLength;
    },

    delete(key) {
      validateCacheKey(key);
      return remove(key);
    },

    gc,

    stats() {
      gc();
      return { entries: entries.size, bytes: totalBytes, hits, misses, evictions };
    },

    clear() {
      entries.clear();
      totalBytes = 0;
    },
  };
}

export async function executeRecoveryRetrieval(
  index: RecoveryIndex,
  query: string,
  options?: RecoverySearchOptions,
): Promise<PolicyRetrievalResult> {
  const hits = await index.search(query, options);
  return Object.freeze({
    format: 'furypipe-policy-retrieval/v1',
    queryDigest: digestQuery(query),
    hits: Object.freeze(hits.map((hit) => Object.freeze({ ...hit }))),
  });
}

export async function executePolicyHybrid(
  index: RecoveryIndex,
  query: string,
  input: Uint8Array | ArrayBuffer,
  transform: (input: Uint8Array, context: PolicyHybridContext) => Promise<Uint8Array | ArrayBuffer>,
  options?: RecoverySearchOptions,
): Promise<PolicyHybridResult> {
  const retrieval = await executeRecoveryRetrieval(index, query, options);
  const source = bytes(input);
  if (retrieval.hits.length === 0) {
    return Object.freeze({
      format: 'furypipe-policy-hybrid/v1',
      queryDigest: retrieval.queryDigest,
      hits: retrieval.hits,
      inputBytes: source.byteLength,
      outputBytes: source.byteLength,
      transformed: false,
      output: source,
    });
  }

  const transformed = bytes(await transform(new Uint8Array(source), {
    queryDigest: retrieval.queryDigest,
    hits: retrieval.hits,
  }));
  return Object.freeze({
    format: 'furypipe-policy-hybrid/v1',
    queryDigest: retrieval.queryDigest,
    hits: retrieval.hits,
    inputBytes: source.byteLength,
    outputBytes: transformed.byteLength,
    transformed: true,
    output: transformed,
  });
}
