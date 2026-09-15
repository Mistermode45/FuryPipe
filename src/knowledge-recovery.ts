import type { RecoveryHandle, RecoveryStore } from './core/recovery-store.js';
import {
  createKnowledgeIndex,
  type KnowledgeIndex,
  type KnowledgeSnapshot,
} from './knowledge.js';

const KNOWLEDGE_SOURCE = 'knowledge-index';
const KNOWLEDGE_CONTENT_TYPE = 'application/vnd.furypipe.knowledge-snapshot+json';
const MAX_SNAPSHOTS = 10_000;

export interface RecoveryKnowledgeStoreOptions {
  readonly now?: () => number;
}

export interface RecoveryKnowledgeLoadResult {
  readonly index: KnowledgeIndex;
  readonly handle: RecoveryHandle;
  readonly createdAt: number;
}

export interface RecoveryKnowledgeStore {
  save(index: KnowledgeIndex): Promise<RecoveryHandle>;
  loadLatest(): Promise<RecoveryKnowledgeLoadResult | undefined>;
  listSnapshots(): Promise<readonly RecoveryHandle[]>;
}

function safeTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('knowledge Recovery timestamp must be a non-negative safe integer');
  }
  return value;
}

function createdAtOf(handle: RecoveryHandle): number {
  const value = handle.metadata?.createdAt;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function compareSnapshotHandles(a: RecoveryHandle, b: RecoveryHandle): number {
  const time = createdAtOf(b) - createdAtOf(a);
  if (time !== 0) return time;
  return b.digest.localeCompare(a.digest);
}

function parseSnapshot(bytes: Uint8Array): KnowledgeSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('knowledge Recovery snapshot cannot be decoded');
  }
  // createKnowledgeIndex performs the complete bounded structural validation.
  const index = createKnowledgeIndex(parsed as KnowledgeSnapshot);
  return index.snapshot();
}

export function createRecoveryKnowledgeStore(
  store: RecoveryStore,
  options: RecoveryKnowledgeStoreOptions = {},
): RecoveryKnowledgeStore {
  if (!store || typeof store.put !== 'function' || typeof store.get !== 'function'
    || typeof store.verify !== 'function' || typeof store.list !== 'function') {
    throw new Error('Recovery knowledge store requires put/get/verify/list support');
  }
  const now = options.now ?? Date.now;
  const list = store.list.bind(store);

  const listSnapshots = async (): Promise<readonly RecoveryHandle[]> => {
    const handles = await list({
      limit: MAX_SNAPSHOTS,
      metadata: {
        source: KNOWLEDGE_SOURCE,
        contentType: KNOWLEDGE_CONTENT_TYPE,
      },
    });
    const valid = handles.filter((handle) =>
      handle.format === 'furypipe-recovery/v1'
      && handle.algorithm === 'sha256'
      && typeof handle.metadata?.createdAt === 'number'
      && Number.isSafeInteger(handle.metadata.createdAt)
      && handle.metadata.createdAt >= 0);
    return Object.freeze(valid.map((handle) => Object.freeze({ ...handle, metadata: handle.metadata ? { ...handle.metadata } : undefined }))
      .sort(compareSnapshotHandles));
  };

  return {
    async save(index) {
      if (!index || typeof index.snapshot !== 'function') {
        throw new Error('knowledge index does not support snapshots');
      }
      const snapshot = index.snapshot();
      // Re-open in-memory before persistence so even custom KnowledgeIndex
      // implementations cannot inject an invalid snapshot into Recovery.
      const validated = createKnowledgeIndex(snapshot).snapshot();
      const createdAt = safeTimestamp(now());
      const bytes = new TextEncoder().encode(JSON.stringify(validated));
      return store.put(bytes, {
        source: KNOWLEDGE_SOURCE,
        contentType: KNOWLEDGE_CONTENT_TYPE,
        format: validated.format,
        createdAt,
        entries: validated.entries.length,
        edges: validated.edges.length,
      });
    },

    async loadLatest() {
      const handles = await listSnapshots();
      const handle = handles[0];
      if (!handle) return undefined;

      const verification = await store.verify(handle);
      if (!verification.ok || !verification.exists || !verification.digestMatches) {
        throw new Error('latest knowledge Recovery snapshot failed integrity verification');
      }
      const snapshot = parseSnapshot(await store.get(handle));
      return Object.freeze({
        index: createKnowledgeIndex(snapshot),
        handle,
        createdAt: createdAtOf(handle),
      });
    },

    listSnapshots,
  };
}

export const KNOWLEDGE_RECOVERY_METADATA = Object.freeze({
  source: KNOWLEDGE_SOURCE,
  contentType: KNOWLEDGE_CONTENT_TYPE,
});
