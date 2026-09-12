import { createHash } from 'node:crypto';

import type { RecoveryHandle, RecoveryStore } from './core/recovery-store.js';
import type { AgentLearningLessonRecord, AgentMemoryClass } from './learning.js';

export type LongTermMemoryClass = Exclude<AgentMemoryClass, 'Working'>;
export type LongTermMemoryScopeKind = 'global' | 'workspace' | 'project' | 'user' | 'agent';
export type LongTermMemoryOperation = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';
export type LongTermMemoryState = 'active' | 'tombstone';

export interface LongTermMemoryScopeInput {
  readonly kind: LongTermMemoryScopeKind;
  /** Raw host identity. FuryPipe hashes it before persistence. */
  readonly id: string;
}

export interface LongTermMemoryScope {
  readonly kind: LongTermMemoryScopeKind;
  readonly idDigest: string;
}

export interface LongTermMemoryRecord {
  readonly format: 'furypipe-long-term-memory/v1';
  readonly memoryId: string;
  readonly version: number;
  readonly memoryClass: LongTermMemoryClass;
  readonly scope: LongTermMemoryScope;
  readonly state: LongTermMemoryState;
  /** Opaque host-owned handle. FuryPipe never dereferences it. */
  readonly contentHandle?: string;
  readonly contentDigest?: string;
  readonly sourceDigest: string;
  readonly reasonDigest: string;
  readonly termDigests: readonly string[];
  readonly importance: number;
  readonly confidence: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly validFrom: number;
  readonly validTo?: number;
  readonly expiresAt?: number;
  readonly supersedesVersion?: number;
}

export interface LongTermMemoryMutationInput {
  readonly operation: LongTermMemoryOperation;
  readonly memoryId: string;
  readonly scope: LongTermMemoryScopeInput;
  readonly now?: number;
  readonly reason: string;
  readonly memoryClass?: LongTermMemoryClass;
  readonly contentHandle?: string;
  readonly contentDigest?: string;
  readonly source?: string;
  readonly terms?: readonly string[];
  readonly importance?: number;
  readonly confidence?: number;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly expiresAt?: number;
}

export interface LongTermMemoryMutationResult {
  readonly operation: LongTermMemoryOperation;
  readonly stored: boolean;
  readonly record?: LongTermMemoryRecord;
  readonly previousVersion?: number;
  readonly handle?: RecoveryHandle;
}

export interface LongTermMemoryRecallInput {
  readonly scopes: readonly LongTermMemoryScopeInput[];
  readonly terms: readonly string[];
  readonly memoryClasses?: readonly LongTermMemoryClass[];
  readonly now?: number;
  readonly limit?: number;
  readonly minImportance?: number;
  readonly minConfidence?: number;
}

export interface LongTermMemoryRecallHit {
  readonly memoryId: string;
  readonly version: number;
  readonly memoryClass: LongTermMemoryClass;
  readonly scope: LongTermMemoryScope;
  readonly contentHandle: string;
  readonly contentDigest: string;
  readonly matchedTerms: number;
  readonly score: number;
  readonly importance: number;
  readonly confidence: number;
  readonly updatedAt: number;
  readonly validFrom: number;
  readonly validTo?: number;
  readonly expiresAt?: number;
}

export interface LongTermMemoryHistoryInput {
  readonly memoryId: string;
  readonly scope: LongTermMemoryScopeInput;
  readonly limit?: number;
}

export interface LongTermMemoryPurgeResult {
  readonly memoryId: string;
  readonly scope: LongTermMemoryScope;
  readonly deletedRevisions: number;
}

export interface LongTermMemoryStore {
  apply(input: LongTermMemoryMutationInput): Promise<LongTermMemoryMutationResult>;
  recall(input: LongTermMemoryRecallInput): Promise<readonly LongTermMemoryRecallHit[]>;
  latest(memoryId: string, scope: LongTermMemoryScopeInput): Promise<LongTermMemoryRecord | undefined>;
  history(input: LongTermMemoryHistoryInput): Promise<readonly LongTermMemoryRecord[]>;
  purge(memoryId: string, scope: LongTermMemoryScopeInput): Promise<LongTermMemoryPurgeResult>;
}

export interface PromoteLessonToLongTermMemoryInput {
  readonly lesson: AgentLearningLessonRecord;
  readonly scope: LongTermMemoryScopeInput;
  readonly terms: readonly string[];
  readonly now?: number;
  readonly importance?: number;
  readonly confidence?: number;
  readonly reason?: string;
}

const MEMORY_SOURCE = 'long-term-memory';
const MEMORY_CONTENT_TYPE = 'application/vnd.furypipe.long-term-memory+json';
const MEMORY_FORMAT = 'furypipe-long-term-memory/v1';
const MAX_RECORDS = 10_000;
const MAX_HISTORY = 512;
const MAX_TERMS = 64;
const MAX_TERM_LENGTH = 256;
const MAX_MEMORY_ID = 128;
const MAX_SCOPE_ID = 1024;
const MAX_HANDLE = 2048;
const MAX_DIGEST_TEXT = 256;
const MAX_REASON = 2048;
const MAX_SOURCE = 2048;
const MEMORY_CLASSES = new Set<LongTermMemoryClass>([
  'Episodic',
  'Semantic',
  'Procedural',
  'Project',
  'User',
  'Skills',
]);
const SCOPE_KINDS = new Set<LongTermMemoryScopeKind>([
  'global',
  'workspace',
  'project',
  'user',
  'agent',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestDomain(domain: string, value: string): string {
  return sha256(`furypipe-long-term-memory/${domain}/v1\0${value}`);
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value.trim();
}

function timestamp(value: number | undefined, label: string, fallback?: number): number {
  const resolved = value ?? fallback;
  if (resolved === undefined || !Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer timestamp`);
  }
  return resolved;
}

function unit(value: number | undefined, label: string, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1`);
  }
  return Math.round(resolved * 1_000_000) / 1_000_000;
}

function memoryClass(value: unknown): LongTermMemoryClass {
  if (!MEMORY_CLASSES.has(value as LongTermMemoryClass)) {
    throw new Error('long-term memory class must be Episodic, Semantic, Procedural, Project, User, or Skills');
  }
  return value as LongTermMemoryClass;
}

function scope(input: LongTermMemoryScopeInput): LongTermMemoryScope {
  if (!input || typeof input !== 'object' || !SCOPE_KINDS.has(input.kind)) {
    throw new Error('long-term memory scope kind is invalid');
  }
  const raw = boundedText(input.id, 'long-term memory scope id', MAX_SCOPE_ID);
  return Object.freeze({
    kind: input.kind,
    idDigest: digestDomain(`scope/${input.kind}`, raw),
  });
}

function memoryId(value: string): string {
  const id = boundedText(value, 'long-term memory id', MAX_MEMORY_ID);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw new Error('long-term memory id must use stable ASCII identifier characters');
  }
  return id;
}

function normalizeTerm(value: string): string {
  const text = boundedText(value, 'long-term memory term', MAX_TERM_LENGTH)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim();
  if (!text) throw new Error('long-term memory term must not normalize to empty');
  return text;
}

function termDigests(values: readonly string[] | undefined, required: boolean): readonly string[] {
  if (values === undefined) {
    if (required) throw new Error('long-term memory terms are required');
    return Object.freeze([]);
  }
  if (!Array.isArray(values) || values.length < (required ? 1 : 0) || values.length > MAX_TERMS) {
    throw new Error(`long-term memory terms must contain between ${required ? 1 : 0} and ${MAX_TERMS} items`);
  }
  return Object.freeze([...new Set(values.map((value) => digestDomain('term', normalizeTerm(value))))].sort());
}

function memoryKey(id: string, scoped: LongTermMemoryScope): string {
  return digestDomain('memory-key', `${scoped.kind}\0${scoped.idDigest}\0${id}`);
}

function validateTemporal(validFrom: number, validTo: number | undefined, expiresAt: number | undefined): void {
  if (validTo !== undefined && validTo <= validFrom) {
    throw new RangeError('long-term memory validTo must be later than validFrom');
  }
  if (expiresAt !== undefined && expiresAt <= validFrom) {
    throw new RangeError('long-term memory expiresAt must be later than validFrom');
  }
}

function validateRecord(value: unknown): LongTermMemoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('long-term memory record must be an object');
  }
  const record = value as Partial<LongTermMemoryRecord>;
  if (record.format !== MEMORY_FORMAT) throw new Error('long-term memory record format is invalid');
  const id = memoryId(record.memoryId as string);
  const version = record.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || version > 1_000_000_000) {
    throw new Error('long-term memory version is invalid');
  }
  const cls = memoryClass(record.memoryClass);
  if (!record.scope || typeof record.scope !== 'object'
    || !SCOPE_KINDS.has(record.scope.kind)
    || !/^[0-9a-f]{64}$/u.test(record.scope.idDigest)) {
    throw new Error('long-term memory persisted scope is invalid');
  }
  if (record.state !== 'active' && record.state !== 'tombstone') {
    throw new Error('long-term memory state is invalid');
  }
  if (record.contentHandle !== undefined) boundedText(record.contentHandle, 'long-term memory contentHandle', MAX_HANDLE);
  if (record.contentDigest !== undefined) boundedText(record.contentDigest, 'long-term memory contentDigest', MAX_DIGEST_TEXT);
  if (record.state === 'active' && (record.contentHandle === undefined || record.contentDigest === undefined)) {
    throw new Error('active long-term memory requires contentHandle and contentDigest');
  }
  if (record.state === 'tombstone' && (record.contentHandle !== undefined || record.contentDigest !== undefined)) {
    throw new Error('long-term memory tombstone must not retain content references');
  }
  if (!/^[0-9a-f]{64}$/u.test(record.sourceDigest as string)
    || !/^[0-9a-f]{64}$/u.test(record.reasonDigest as string)) {
    throw new Error('long-term memory source/reason digest is invalid');
  }
  if (!Array.isArray(record.termDigests) || record.termDigests.length > MAX_TERMS
    || record.termDigests.some((digest) => typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest))) {
    throw new Error('long-term memory term digests are invalid');
  }
  const importance = unit(record.importance, 'long-term memory importance', 0);
  const confidence = unit(record.confidence, 'long-term memory confidence', 0);
  const createdAt = timestamp(record.createdAt, 'long-term memory createdAt');
  const updatedAt = timestamp(record.updatedAt, 'long-term memory updatedAt');
  const validFrom = timestamp(record.validFrom, 'long-term memory validFrom');
  const validTo = record.validTo === undefined ? undefined : timestamp(record.validTo, 'long-term memory validTo');
  const expiresAt = record.expiresAt === undefined ? undefined : timestamp(record.expiresAt, 'long-term memory expiresAt');
  validateTemporal(validFrom, validTo, expiresAt);
  if (updatedAt < createdAt) throw new Error('long-term memory updatedAt must not precede createdAt');
  if (record.supersedesVersion !== undefined
    && (!Number.isSafeInteger(record.supersedesVersion) || record.supersedesVersion < 1 || record.supersedesVersion >= version)) {
    throw new Error('long-term memory supersedesVersion is invalid');
  }
  return Object.freeze({
    format: MEMORY_FORMAT,
    memoryId: id,
    version,
    memoryClass: cls,
    scope: Object.freeze({ kind: record.scope.kind, idDigest: record.scope.idDigest }),
    state: record.state,
    ...(record.contentHandle === undefined ? {} : { contentHandle: record.contentHandle }),
    ...(record.contentDigest === undefined ? {} : { contentDigest: record.contentDigest }),
    sourceDigest: record.sourceDigest,
    reasonDigest: record.reasonDigest,
    termDigests: Object.freeze([...new Set(record.termDigests)].sort()),
    importance,
    confidence,
    createdAt,
    updatedAt,
    validFrom,
    ...(validTo === undefined ? {} : { validTo }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(record.supersedesVersion === undefined ? {} : { supersedesVersion: record.supersedesVersion }),
  });
}

function compareHandleVersions(a: RecoveryHandle, b: RecoveryHandle): number {
  const av = typeof a.metadata?.version === 'number' ? a.metadata.version : -1;
  const bv = typeof b.metadata?.version === 'number' ? b.metadata.version : -1;
  if (bv !== av) return bv - av;
  const at = typeof a.metadata?.updatedAt === 'number' ? a.metadata.updatedAt : -1;
  const bt = typeof b.metadata?.updatedAt === 'number' ? b.metadata.updatedAt : -1;
  if (bt !== at) return bt - at;
  return b.digest.localeCompare(a.digest);
}

function metadataFor(record: LongTermMemoryRecord, key: string): Record<string, string | number | boolean | null> {
  return {
    source: MEMORY_SOURCE,
    contentType: MEMORY_CONTENT_TYPE,
    format: MEMORY_FORMAT,
    memoryKey: key,
    memoryIdDigest: digestDomain('memory-id', record.memoryId),
    scopeKind: record.scope.kind,
    scopeDigest: record.scope.idDigest,
    memoryClass: record.memoryClass,
    state: record.state,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recordActiveAt(record: LongTermMemoryRecord, at: number): boolean {
  if (record.state !== 'active') return false;
  if (record.validFrom > at) return false;
  if (record.validTo !== undefined && at >= record.validTo) return false;
  if (record.expiresAt !== undefined && at >= record.expiresAt) return false;
  return true;
}

function recencyScore(updatedAt: number, now: number): number {
  const ageDays = Math.max(0, now - updatedAt) / 86_400_000;
  return 1 / (1 + ageDays / 30);
}

async function parseHandle(store: RecoveryStore, handle: RecoveryHandle): Promise<LongTermMemoryRecord> {
  const verification = await store.verify(handle);
  if (!verification.ok || !verification.exists || !verification.digestMatches) {
    throw new Error('long-term memory Recovery revision failed integrity verification');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await store.get(handle))) as unknown;
  } catch {
    throw new Error('long-term memory Recovery revision cannot be decoded');
  }
  const record = validateRecord(parsed);
  const key = memoryKey(record.memoryId, record.scope);
  if (handle.metadata?.memoryKey !== key
    || handle.metadata?.version !== record.version
    || handle.metadata?.state !== record.state
    || handle.metadata?.scopeDigest !== record.scope.idDigest) {
    throw new Error('long-term memory Recovery metadata does not match its payload');
  }
  return record;
}

export function createLongTermMemoryStore(store: RecoveryStore): LongTermMemoryStore {
  if (!store || typeof store.put !== 'function' || typeof store.get !== 'function'
    || typeof store.verify !== 'function' || typeof store.list !== 'function'
    || typeof store.delete !== 'function') {
    throw new Error('long-term memory requires Recovery put/get/verify/list/delete support');
  }
  const list = store.list.bind(store);

  const handlesForKey = async (key: string, limit = MAX_HISTORY): Promise<readonly RecoveryHandle[]> => {
    const handles = await list({
      limit,
      metadata: {
        source: MEMORY_SOURCE,
        contentType: MEMORY_CONTENT_TYPE,
        memoryKey: key,
      },
    });
    return Object.freeze(
      handles
        .filter((handle) => handle.format === 'furypipe-recovery/v1' && handle.algorithm === 'sha256')
        .map((handle) => Object.freeze({ ...handle, metadata: handle.metadata ? { ...handle.metadata } : undefined }))
        .sort(compareHandleVersions),
    );
  };

  const recordsForKey = async (key: string, limit = MAX_HISTORY): Promise<readonly LongTermMemoryRecord[]> => {
    const handles = await handlesForKey(key, limit);
    const records: LongTermMemoryRecord[] = [];
    for (const handle of handles) records.push(await parseHandle(store, handle));
    records.sort((a, b) => b.version - a.version || b.updatedAt - a.updatedAt);
    if (records.length >= 2 && records[0]!.version === records[1]!.version) {
      throw new Error('long-term memory revision conflict detected');
    }
    return Object.freeze(records);
  };

  const latestFor = async (id: string, scoped: LongTermMemoryScope): Promise<LongTermMemoryRecord | undefined> => {
    const records = await recordsForKey(memoryKey(id, scoped));
    return records[0];
  };

  return {
    async apply(input) {
      if (!input || typeof input !== 'object') throw new Error('long-term memory mutation is required');
      if (!['ADD', 'UPDATE', 'DELETE', 'NOOP'].includes(input.operation)) {
        throw new Error('long-term memory operation is invalid');
      }
      const id = memoryId(input.memoryId);
      const scoped = scope(input.scope);
      const now = timestamp(input.now, 'long-term memory mutation now', Date.now());
      const reason = boundedText(input.reason, 'long-term memory mutation reason', MAX_REASON);
      const previous = await latestFor(id, scoped);

      if (input.operation === 'NOOP') {
        return Object.freeze({
          operation: 'NOOP',
          stored: false,
          ...(previous === undefined ? {} : { record: previous, previousVersion: previous.version }),
        });
      }
      if (input.operation === 'ADD' && previous !== undefined && previous.state === 'active') {
        throw new Error('long-term memory ADD requires a new or forgotten memory ID');
      }
      if (input.operation === 'UPDATE' && (previous === undefined || previous.state !== 'active')) {
        throw new Error('long-term memory UPDATE requires an active prior memory');
      }
      if (input.operation === 'DELETE' && (previous === undefined || previous.state !== 'active')) {
        throw new Error('long-term memory DELETE requires an active prior memory');
      }

      const version = (previous?.version ?? 0) + 1;
      const createdAt = previous?.createdAt ?? now;
      let record: LongTermMemoryRecord;

      if (input.operation === 'DELETE') {
        const cls = previous!.memoryClass;
        record = validateRecord({
          format: MEMORY_FORMAT,
          memoryId: id,
          version,
          memoryClass: cls,
          scope: scoped,
          state: 'tombstone',
          sourceDigest: digestDomain('source', input.source ?? 'explicit-delete'),
          reasonDigest: digestDomain('reason', reason),
          termDigests: [],
          importance: 0,
          confidence: 1,
          createdAt,
          updatedAt: now,
          validFrom: previous!.validFrom,
          supersedesVersion: previous!.version,
        });
      } else {
        const cls = memoryClass(input.memoryClass);
        const handle = boundedText(input.contentHandle, 'long-term memory contentHandle', MAX_HANDLE);
        const contentDigest = boundedText(input.contentDigest, 'long-term memory contentDigest', MAX_DIGEST_TEXT);
        const source = boundedText(input.source, 'long-term memory source', MAX_SOURCE);
        const terms = termDigests(input.terms, true);
        const importance = unit(input.importance, 'long-term memory importance', previous?.importance ?? 0.5);
        const confidence = unit(input.confidence, 'long-term memory confidence', previous?.confidence ?? 0.5);
        const validFrom = timestamp(input.validFrom, 'long-term memory validFrom', previous?.validFrom ?? now);
        const validTo = input.validTo === undefined
          ? (input.operation === 'UPDATE' ? previous?.validTo : undefined)
          : timestamp(input.validTo, 'long-term memory validTo');
        const expiresAt = input.expiresAt === undefined
          ? (input.operation === 'UPDATE' ? previous?.expiresAt : undefined)
          : timestamp(input.expiresAt, 'long-term memory expiresAt');
        validateTemporal(validFrom, validTo, expiresAt);

        record = validateRecord({
          format: MEMORY_FORMAT,
          memoryId: id,
          version,
          memoryClass: cls,
          scope: scoped,
          state: 'active',
          contentHandle: handle,
          contentDigest,
          sourceDigest: digestDomain('source', source),
          reasonDigest: digestDomain('reason', reason),
          termDigests: terms,
          importance,
          confidence,
          createdAt,
          updatedAt: now,
          validFrom,
          ...(validTo === undefined ? {} : { validTo }),
          ...(expiresAt === undefined ? {} : { expiresAt }),
          ...(previous === undefined ? {} : { supersedesVersion: previous.version }),
        });
      }

      const key = memoryKey(id, scoped);
      const persisted = await store.put(
        new TextEncoder().encode(JSON.stringify(record)),
        metadataFor(record, key),
      );

      const selected = await latestFor(id, scoped);
      if (!selected || selected.version !== record.version
        || selected.reasonDigest !== record.reasonDigest
        || selected.state !== record.state) {
        throw new Error('long-term memory write lost a concurrent revision race');
      }

      return Object.freeze({
        operation: input.operation,
        stored: true,
        record: selected,
        ...(previous === undefined ? {} : { previousVersion: previous.version }),
        handle: persisted,
      });
    },

    async recall(input) {
      if (!input || typeof input !== 'object') throw new Error('long-term memory recall input is required');
      if (!Array.isArray(input.scopes) || input.scopes.length < 1 || input.scopes.length > 16) {
        throw new Error('long-term memory recall requires between 1 and 16 scopes');
      }
      const scopes = input.scopes.map(scope);
      const scopeKeys = new Set(scopes.map((value) => `${value.kind}\0${value.idDigest}`));
      const queryTerms = termDigests(input.terms, true);
      const querySet = new Set(queryTerms);
      const classes = input.memoryClasses === undefined
        ? undefined
        : new Set(input.memoryClasses.map(memoryClass));
      const now = timestamp(input.now, 'long-term memory recall now', Date.now());
      const limit = input.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('long-term memory recall limit must be an integer from 1 to 100');
      }
      const minImportance = unit(input.minImportance, 'long-term memory minImportance', 0);
      const minConfidence = unit(input.minConfidence, 'long-term memory minConfidence', 0);

      const handles = await list({
        limit: MAX_RECORDS,
        metadata: {
          source: MEMORY_SOURCE,
          contentType: MEMORY_CONTENT_TYPE,
        },
      });

      const byKey = new Map<string, RecoveryHandle[]>();
      for (const handle of handles) {
        const key = handle.metadata?.memoryKey;
        if (typeof key !== 'string' || !/^[0-9a-f]{64}$/u.test(key)) continue;
        const bucket = byKey.get(key) ?? [];
        bucket.push(handle);
        byKey.set(key, bucket);
      }

      const hits: LongTermMemoryRecallHit[] = [];
      for (const bucket of byKey.values()) {
        bucket.sort(compareHandleVersions);
        if (bucket.length >= 2 && bucket[0]?.metadata?.version === bucket[1]?.metadata?.version) {
          throw new Error('long-term memory revision conflict detected during recall');
        }
        const latestHandle = bucket[0];
        if (!latestHandle) continue;
        const record = await parseHandle(store, latestHandle);
        if (!recordActiveAt(record, now)) continue;
        if (!scopeKeys.has(`${record.scope.kind}\0${record.scope.idDigest}`)) continue;
        if (classes && !classes.has(record.memoryClass)) continue;
        if (record.importance < minImportance || record.confidence < minConfidence) continue;

        const matchedTerms = record.termDigests.reduce((count, digest) => count + (querySet.has(digest) ? 1 : 0), 0);
        if (matchedTerms === 0) continue;
        const termCoverage = matchedTerms / queryTerms.length;
        const score = Math.round((
          termCoverage * 0.55
          + record.importance * 0.2
          + record.confidence * 0.2
          + recencyScore(record.updatedAt, now) * 0.05
        ) * 1_000_000) / 1_000_000;

        hits.push(Object.freeze({
          memoryId: record.memoryId,
          version: record.version,
          memoryClass: record.memoryClass,
          scope: record.scope,
          contentHandle: record.contentHandle!,
          contentDigest: record.contentDigest!,
          matchedTerms,
          score,
          importance: record.importance,
          confidence: record.confidence,
          updatedAt: record.updatedAt,
          validFrom: record.validFrom,
          ...(record.validTo === undefined ? {} : { validTo: record.validTo }),
          ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
        }));
      }

      hits.sort((a, b) =>
        b.score - a.score
        || b.matchedTerms - a.matchedTerms
        || b.importance - a.importance
        || b.confidence - a.confidence
        || b.updatedAt - a.updatedAt
        || a.memoryId.localeCompare(b.memoryId));
      return Object.freeze(hits.slice(0, limit));
    },

    async latest(rawMemoryId, rawScope) {
      return latestFor(memoryId(rawMemoryId), scope(rawScope));
    },

    async history(input) {
      const id = memoryId(input.memoryId);
      const scoped = scope(input.scope);
      const limit = input.limit ?? MAX_HISTORY;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY) {
        throw new RangeError(`long-term memory history limit must be an integer from 1 to ${MAX_HISTORY}`);
      }
      return recordsForKey(memoryKey(id, scoped), limit);
    },

    async purge(rawMemoryId, rawScope) {
      const id = memoryId(rawMemoryId);
      const scoped = scope(rawScope);
      const key = memoryKey(id, scoped);
      const handles = await handlesForKey(key, MAX_HISTORY);
      let deleted = 0;
      for (const handle of handles) {
        if (await store.delete(handle)) deleted += 1;
      }
      return Object.freeze({
        memoryId: id,
        scope: scoped,
        deletedRevisions: deleted,
      });
    },
  };
}

export async function promoteValidatedLessonToLongTermMemory(
  store: LongTermMemoryStore,
  input: PromoteLessonToLongTermMemoryInput,
): Promise<LongTermMemoryMutationResult> {
  const lesson = input.lesson;
  if (!lesson || lesson.format !== 'furypipe-agent-lesson/v1' || lesson.validation !== 'validated') {
    throw new Error('only validated agent lessons may be promoted to long-term memory');
  }
  if (lesson.memoryClass === 'Working') {
    throw new Error('Working memory cannot be promoted as long-term memory without reclassification');
  }
  const existing = await store.latest(lesson.lessonId, input.scope);
  const operation: LongTermMemoryOperation = existing?.state === 'active' ? 'UPDATE' : 'ADD';
  return store.apply({
    operation,
    memoryId: lesson.lessonId,
    scope: input.scope,
    now: input.now,
    reason: input.reason ?? 'validated-agent-lesson-promotion',
    memoryClass: lesson.memoryClass,
    contentHandle: lesson.contentHandle,
    contentDigest: lesson.lessonDigest,
    source: `agent-learning:${lesson.taskDigest}`,
    terms: input.terms,
    importance: input.importance ?? 0.75,
    confidence: input.confidence ?? 0.9,
  });
}

export const LONG_TERM_MEMORY_METADATA = Object.freeze({
  source: MEMORY_SOURCE,
  contentType: MEMORY_CONTENT_TYPE,
  format: MEMORY_FORMAT,
});
