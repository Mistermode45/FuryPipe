import type { RecoveryHandle, RecoveryMetadata, RecoveryStore } from './recovery-store.js';

export interface RecoverySearchHit {
  readonly handle: string;
  readonly source?: string;
  /** UTF-16 offsets in the stored UTF-8 text. The matched text is not returned. */
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly matchCount: number;
}

export interface RecoverySearchOptions {
  readonly source?: string;
  readonly maxHits?: number;
}

export interface RecoveryIndex {
  readonly size: number;
  add(bytes: Uint8Array | ArrayBuffer, metadata?: RecoveryMetadata): Promise<RecoveryHandle>;
  addHandle(handle: RecoveryHandle | string): Promise<void>;
  search(query: string, options?: RecoverySearchOptions): Promise<readonly RecoverySearchHit[]>;
  clear(): void;
}

const MAX_RECOVERY_INDEX_ENTRIES = 10_000;

interface IndexedHandle {
  readonly handle: string;
  readonly source?: string;
}

function canonicalHandle(handle: RecoveryHandle | string): string {
  return typeof handle === 'string'
    ? handle
    : `furypipe-recovery/v1/${handle.algorithm}/${handle.digest}`;
}

function boundedMaxHits(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new RangeError('maxHits must be an integer from 1 to 1000');
  return value;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Exact, source-aware retrieval over immutable Recovery Store objects. The
 * index stores handles and optional source labels only; it never stores the
 * searchable plaintext or a vector embedding.
 */
export function createRecoveryIndex(store: RecoveryStore): RecoveryIndex {
  const entries = new Map<string, IndexedHandle>();
  let pendingAdds = 0;

  return {
    get size() { return entries.size; },

    async add(bytes, metadata) {
      if (entries.size + pendingAdds >= MAX_RECOVERY_INDEX_ENTRIES) {
        throw new RangeError(`recovery index is limited to ${MAX_RECOVERY_INDEX_ENTRIES} unique handles`);
      }
      pendingAdds += 1;
      try {
        const handle = await store.put(bytes, metadata);
        const key = canonicalHandle(handle);
        if (!entries.has(key) && entries.size >= MAX_RECOVERY_INDEX_ENTRIES) {
          throw new RangeError(`recovery index is limited to ${MAX_RECOVERY_INDEX_ENTRIES} unique handles`);
        }
        entries.set(key, { handle: key, ...(metadata?.source === undefined ? {} : { source: metadata.source }) });
        return handle;
      } finally {
        pendingAdds -= 1;
      }
    },

    async addHandle(handle) {
      const manifest = await store.manifest(handle);
      const key = canonicalHandle(manifest);
      if (!entries.has(key) && entries.size >= MAX_RECOVERY_INDEX_ENTRIES) {
        throw new RangeError(`recovery index is limited to ${MAX_RECOVERY_INDEX_ENTRIES} unique handles`);
      }
      entries.set(key, {
        handle: key,
        ...(manifest.metadata?.source === undefined ? {} : { source: manifest.metadata.source }),
      });
    },

    async search(query, options = {}) {
      if (query.length === 0) throw new RangeError('retrieval query must not be empty');
      if (query.length > 256) throw new RangeError('retrieval query exceeds 256 characters');
      const maxHits = boundedMaxHits(options.maxHits);
      const hits: RecoverySearchHit[] = [];
      const snapshot = [...entries.values()];
      for (const entry of snapshot) {
        if (options.source !== undefined && entry.source !== options.source) continue;
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(await store.get(entry.handle));
        } catch {
          // Binary or malformed UTF-8 objects remain retrievable by handle but
          // are intentionally excluded from text search.
          continue;
        }
        const first = text.indexOf(query);
        if (first < 0) continue;
        let count = 0;
        for (let at = first; at >= 0 && count < 1000; at = text.indexOf(query, at + Math.max(1, query.length))) count++;
        hits.push({
          handle: entry.handle,
          ...(entry.source === undefined ? {} : { source: entry.source }),
          start: first,
          end: first + query.length,
          line: lineAt(text, first),
          matchCount: count,
        });
        if (hits.length >= maxHits) break;
      }
      return hits;
    },

    clear() { entries.clear(); },
  };
}
