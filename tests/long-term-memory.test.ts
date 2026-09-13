import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import type { RecoveryHandle, RecoveryListOptions, RecoveryPutBound, RecoveryStore } from '../src/core/recovery-store.js';
import {
  createLongTermMemoryStore,
  promoteValidatedLessonToLongTermMemory,
} from '../src/long-term-memory.js';
import type { AgentLearningLessonRecord } from '../src/learning.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function memoryStore(namespace = 'ltm') {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-ltm-'));
  roots.push(root);
  const recovery = createRecoveryStore(root, { namespace });
  return { root, recovery, memory: createLongTermMemoryStore(recovery) };
}

const scope = { kind: 'project' as const, id: 'FuryPipe Secret Project' };

describe('long-term memory', () => {
  it('persists an active memory across process-style Recovery reopen and recalls by hashed terms', async () => {
    const { root, memory } = await memoryStore();

    const added = await memory.apply({
      operation: 'ADD',
      memoryId: 'provider-health-policy',
      scope,
      now: 1000,
      reason: 'validated architecture decision',
      memoryClass: 'Semantic',
      contentHandle: 'opaque://memory/provider-health-policy',
      contentDigest: 'decision_digest_v1',
      source: 'architecture-review',
      terms: ['provider health', 'fail closed', 'ttl'],
      importance: 0.9,
      confidence: 0.95,
    });

    expect(added.stored).toBe(true);
    expect(added.record).toMatchObject({
      version: 1,
      state: 'active',
      memoryClass: 'Semantic',
    });

    const reopened = createLongTermMemoryStore(createRecoveryStore(root, { namespace: 'ltm' }));
    const hits = await reopened.recall({
      scopes: [scope],
      terms: ['provider health', 'ttl'],
      now: 2000,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      memoryId: 'provider-health-policy',
      version: 1,
      contentHandle: 'opaque://memory/provider-health-policy',
      matchedTerms: 2,
    });
    expect(hits[0]!.score).toBeGreaterThan(0.8);
  });

  it('updates by immutable revision, keeps history, and NOOP writes nothing', async () => {
    const { memory } = await memoryStore();

    await memory.apply({
      operation: 'ADD',
      memoryId: 'm1',
      scope,
      now: 10,
      reason: 'first validated fact',
      memoryClass: 'Project',
      contentHandle: 'opaque://m1/v1',
      contentDigest: 'digest-v1',
      source: 'test',
      terms: ['alpha', 'beta'],
      importance: 0.4,
      confidence: 0.8,
    });
    const updated = await memory.apply({
      operation: 'UPDATE',
      memoryId: 'm1',
      scope,
      now: 20,
      reason: 'new evidence supersedes prior fact',
      memoryClass: 'Project',
      contentHandle: 'opaque://m1/v2',
      contentDigest: 'digest-v2',
      source: 'review',
      terms: ['alpha', 'gamma'],
      importance: 0.8,
      confidence: 0.95,
    });
    const noop = await memory.apply({
      operation: 'NOOP',
      memoryId: 'm1',
      scope,
      now: 30,
      reason: 'no material change',
    });

    expect(updated.record).toMatchObject({
      version: 2,
      supersedesVersion: 1,
      contentHandle: 'opaque://m1/v2',
    });
    expect(noop).toMatchObject({
      operation: 'NOOP',
      stored: false,
      previousVersion: 2,
    });

    const history = await memory.history({ memoryId: 'm1', scope });
    expect(history.map((record) => [record.version, record.contentHandle])).toEqual([
      [2, 'opaque://m1/v2'],
      [1, 'opaque://m1/v1'],
    ]);

    const oldTerm = await memory.recall({ scopes: [scope], terms: ['beta'], now: 40 });
    const newTerm = await memory.recall({ scopes: [scope], terms: ['gamma'], now: 40 });
    expect(oldTerm).toEqual([]);
    expect(newTerm.map((hit) => hit.version)).toEqual([2]);
  });

  it('finds and purges revisions beyond the public history page without silent truncation', async () => {
    const objects = new Map<string, { readonly handle: RecoveryHandle; readonly bytes: Uint8Array }>();
    const getDigest = (value: RecoveryHandle | string): string => typeof value === 'string'
      ? value.split('/').at(-1)!
      : value.digest;
    const recoveryStub = {
      async put(value: Uint8Array | ArrayBuffer, metadata?: Record<string, string | number | boolean | null | undefined>) {
        const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const handle: RecoveryHandle = { format: 'furypipe-recovery/v1', algorithm: 'sha256', digest, bytes: bytes.byteLength,
          ...(metadata ? { metadata } : {}) };
        objects.set(digest, { handle, bytes });
        return handle;
      },
      async putBounded(
        value: Uint8Array | ArrayBuffer,
        metadata: Record<string, string | number | boolean | null | undefined> | undefined,
        bound: RecoveryPutBound,
      ) {
        const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const existing = objects.get(digest);
        if (existing) return existing.handle;
        const matches = [...objects.values()].filter(({ handle }) => Object.entries(bound.metadata)
          .every(([key, expected]) => handle.metadata?.[key] === expected));
        if (matches.length >= bound.maxMatches) throw new Error('recovery bounded put matching-object limit exceeded');
        const handle: RecoveryHandle = { format: 'furypipe-recovery/v1', algorithm: 'sha256', digest, bytes: bytes.byteLength,
          ...(metadata ? { metadata } : {}) };
        objects.set(digest, { handle, bytes });
        return handle;
      },
      async get(value: RecoveryHandle | string) {
        const stored = objects.get(getDigest(value));
        if (!stored) throw new Error('missing recovery object');
        return new Uint8Array(stored.bytes);
      },
      async verify(value: RecoveryHandle | string) {
        const digest = getDigest(value);
        const stored = objects.get(digest);
        return { ok: stored !== undefined, handle: `furypipe-recovery/v1/sha256/${digest}`, exists: stored !== undefined,
          digestMatches: stored !== undefined && createHash('sha256').update(stored.bytes).digest('hex') === digest,
          bytes: stored?.bytes.byteLength ?? 0 };
      },
      async list(options: RecoveryListOptions = {}) {
        const matches = [...objects.values()].filter(({ handle }) => Object.entries(options.metadata ?? {})
          .every(([key, value]) => handle.metadata?.[key] === value));
        return matches.slice(0, options.limit ?? 10_000).map(({ handle }) => handle);
      },
      async delete(value: RecoveryHandle | string) { return objects.delete(getDigest(value)); },
    };
    const memory = createLongTermMemoryStore(recoveryStub as unknown as RecoveryStore);
    const initial = await memory.apply({
      operation: 'ADD', memoryId: 'many-revisions', scope, now: 1,
      reason: 'initial', memoryClass: 'Project', contentHandle: 'opaque://many/1',
      contentDigest: 'digest-1', source: 'test', terms: ['revision'],
    });
    const template = initial.record!;
    const metadata = initial.handle!.metadata!;
    const encoder = new TextEncoder();

    for (let version = 2; version <= 513; version += 1) {
      const record = {
        ...template,
        version,
        contentHandle: `opaque://many/${version}`,
        contentDigest: `digest-${version}`,
        updatedAt: version,
        supersedesVersion: version - 1,
      };
      await recoveryStub.put(encoder.encode(JSON.stringify(record)), {
        ...metadata,
        version,
        updatedAt: version,
        state: 'active',
      });
    }

    expect(await memory.latest('many-revisions', scope)).toMatchObject({ version: 513 });
    const history = await memory.history({ memoryId: 'many-revisions', scope });
    expect(history).toHaveLength(512);
    expect(history[0]?.version).toBe(513);
    expect(history.at(-1)?.version).toBe(2);
    expect((await memory.purge('many-revisions', scope)).deletedRevisions).toBe(513);
  });

  it('can purge a legacy saturated revision set even when reads fail closed', async () => {
    const objects = new Map<string, { readonly handle: RecoveryHandle; readonly bytes: Uint8Array }>();
    const digestOf = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    const getDigest = (value: RecoveryHandle | string): string => typeof value === 'string'
      ? value.split('/').at(-1)!
      : value.digest;
    const recoveryStub = {
      async put(value: Uint8Array | ArrayBuffer, metadata?: Record<string, string | number | boolean | null | undefined>) {
        const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
        const digest = digestOf(bytes);
        const existing = objects.get(digest);
        if (existing) return existing.handle;
        const handle: RecoveryHandle = { format: 'furypipe-recovery/v1', algorithm: 'sha256', digest, bytes: bytes.byteLength,
          ...(metadata ? { metadata } : {}) };
        objects.set(digest, { handle, bytes });
        return handle;
      },
      async putBounded(
        value: Uint8Array | ArrayBuffer,
        metadata: Record<string, string | number | boolean | null | undefined> | undefined,
        bound: RecoveryPutBound,
      ) {
        const matches = [...objects.values()].filter(({ handle }) => Object.entries(bound.metadata)
          .every(([key, expected]) => handle.metadata?.[key] === expected));
        if (matches.length >= bound.maxMatches) throw new Error('recovery bounded put matching-object limit exceeded');
        return this.put(value, metadata);
      },
      async get(value: RecoveryHandle | string) {
        const stored = objects.get(getDigest(value));
        if (!stored) throw new Error('missing recovery object');
        return new Uint8Array(stored.bytes);
      },
      async verify(value: RecoveryHandle | string) {
        const digest = getDigest(value);
        const stored = objects.get(digest);
        return { ok: stored !== undefined, handle: `furypipe-recovery/v1/sha256/${digest}`, exists: stored !== undefined,
          digestMatches: stored !== undefined, bytes: stored?.bytes.byteLength ?? 0 };
      },
      async list(options: RecoveryListOptions = {}) {
        const matches = [...objects.values()].filter(({ handle }) => Object.entries(options.metadata ?? {})
          .every(([key, expected]) => handle.metadata?.[key] === expected));
        return matches.slice(0, options.limit ?? 10_000).map(({ handle }) => handle);
      },
      async delete(value: RecoveryHandle | string) { return objects.delete(getDigest(value)); },
    };
    const memory = createLongTermMemoryStore(recoveryStub as unknown as RecoveryStore);
    const initial = await memory.apply({
      operation: 'ADD', memoryId: 'saturated-memory', scope, now: 1,
      reason: 'initial', memoryClass: 'Project', contentHandle: 'opaque://saturated/1',
      contentDigest: 'digest-1', source: 'test', terms: ['saturation'],
    });
    const template = initial.record!;
    const metadata = initial.handle!.metadata!;
    for (let version = 2; version <= 10_001; version += 1) {
      const record = {
        ...template,
        version,
        contentHandle: `opaque://saturated/${version}`,
        contentDigest: `digest-${version}`,
        updatedAt: version,
        supersedesVersion: version - 1,
      };
      await recoveryStub.put(new TextEncoder().encode(JSON.stringify(record)), {
        ...metadata,
        version,
        updatedAt: version,
      });
    }

    await expect(memory.latest('saturated-memory', scope)).rejects.toThrow(/safety limit/);
    expect((await memory.purge('saturated-memory', scope)).deletedRevisions).toBe(10_001);
    expect(await memory.latest('saturated-memory', scope)).toBeUndefined();
  });

  it('supports logical DELETE and explicit physical purge', async () => {
    const { recovery, memory } = await memoryStore();

    await memory.apply({
      operation: 'ADD',
      memoryId: 'forget-me',
      scope,
      now: 100,
      reason: 'initial',
      memoryClass: 'User',
      contentHandle: 'opaque://user/preference',
      contentDigest: 'pref-v1',
      source: 'user-confirmed',
      terms: ['preference'],
      confidence: 1,
      importance: 0.7,
    });
    const deleted = await memory.apply({
      operation: 'DELETE',
      memoryId: 'forget-me',
      scope,
      now: 200,
      reason: 'explicit forget request',
      source: 'user-request',
    });

    expect(deleted.record).toMatchObject({ state: 'tombstone', version: 2 });
    expect(deleted.record?.contentHandle).toBeUndefined();
    expect(await memory.recall({ scopes: [scope], terms: ['preference'], now: 201 })).toEqual([]);
    expect((await memory.history({ memoryId: 'forget-me', scope })).map((item) => item.state)).toEqual([
      'tombstone',
      'active',
    ]);

    const purge = await memory.purge('forget-me', scope);
    expect(purge.deletedRevisions).toBe(2);
    expect(await memory.latest('forget-me', scope)).toBeUndefined();

    const remaining = await recovery.list?.({
      metadata: { source: 'long-term-memory' },
      limit: 100,
    });
    expect(remaining ?? []).toHaveLength(0);
  });

  it('isolates identical memory IDs across scopes and never matches another scope', async () => {
    const { memory } = await memoryStore();

    for (const [scopeId, handle] of [['project-a', 'opaque://a'], ['project-b', 'opaque://b']] as const) {
      await memory.apply({
        operation: 'ADD',
        memoryId: 'architecture',
        scope: { kind: 'project', id: scopeId },
        now: 1,
        reason: 'scope fixture',
        memoryClass: 'Project',
        contentHandle: handle,
        contentDigest: handle,
        source: 'fixture',
        terms: ['architecture'],
        importance: 1,
        confidence: 1,
      });
    }

    expect((await memory.recall({
      scopes: [{ kind: 'project', id: 'project-a' }],
      terms: ['architecture'],
      now: 2,
    })).map((hit) => hit.contentHandle)).toEqual(['opaque://a']);

    expect((await memory.recall({
      scopes: [{ kind: 'project', id: 'project-b' }],
      terms: ['architecture'],
      now: 2,
    })).map((hit) => hit.contentHandle)).toEqual(['opaque://b']);
  });

  it('enforces valid-time and expiry windows during recall', async () => {
    const { memory } = await memoryStore();

    await memory.apply({
      operation: 'ADD',
      memoryId: 'temporal-fact',
      scope,
      now: 100,
      reason: 'time-bounded fact',
      memoryClass: 'Episodic',
      contentHandle: 'opaque://temporal',
      contentDigest: 'temporal-digest',
      source: 'event',
      terms: ['release window'],
      importance: 0.8,
      confidence: 0.9,
      validFrom: 200,
      validTo: 400,
      expiresAt: 500,
    });

    expect(await memory.recall({ scopes: [scope], terms: ['release window'], now: 199 })).toEqual([]);
    expect(await memory.recall({ scopes: [scope], terms: ['release window'], now: 200 })).toHaveLength(1);
    expect(await memory.recall({ scopes: [scope], terms: ['release window'], now: 399 })).toHaveLength(1);
    expect(await memory.recall({ scopes: [scope], terms: ['release window'], now: 400 })).toEqual([]);
    expect(await memory.recall({ scopes: [scope], terms: ['release window'], now: 500 })).toEqual([]);
  });

  it('ranks by term coverage, importance, confidence, recency and supports class filters', async () => {
    const { memory } = await memoryStore();

    await memory.apply({
      operation: 'ADD',
      memoryId: 'high',
      scope,
      now: 1000,
      reason: 'high quality',
      memoryClass: 'Semantic',
      contentHandle: 'opaque://high',
      contentDigest: 'high',
      source: 'review',
      terms: ['recovery', 'locking'],
      importance: 1,
      confidence: 1,
    });
    await memory.apply({
      operation: 'ADD',
      memoryId: 'low',
      scope,
      now: 1000,
      reason: 'lower quality',
      memoryClass: 'Episodic',
      contentHandle: 'opaque://low',
      contentDigest: 'low',
      source: 'observation',
      terms: ['recovery'],
      importance: 0.1,
      confidence: 0.2,
    });

    expect((await memory.recall({
      scopes: [scope],
      terms: ['recovery', 'locking'],
      now: 1001,
    })).map((hit) => hit.memoryId)).toEqual(['high', 'low']);

    expect((await memory.recall({
      scopes: [scope],
      terms: ['recovery'],
      memoryClasses: ['Episodic'],
      now: 1001,
    })).map((hit) => hit.memoryId)).toEqual(['low']);
  });

  it('persists only digests for raw scope IDs, terms, sources and reasons', async () => {
    const { recovery, memory } = await memoryStore();
    const secretScope = 'customer-secret-scope';
    const secretTerm = 'private internal architecture phrase';
    const secretSource = 'private-review-thread';
    const secretReason = 'sensitive operator explanation';

    const result = await memory.apply({
      operation: 'ADD',
      memoryId: 'privacy-check',
      scope: { kind: 'workspace', id: secretScope },
      now: 1,
      reason: secretReason,
      memoryClass: 'Semantic',
      contentHandle: 'opaque://privacy-check',
      contentDigest: 'content-digest',
      source: secretSource,
      terms: [secretTerm],
      importance: 0.5,
      confidence: 0.5,
    });

    const raw = new TextDecoder().decode(await recovery.get(result.handle!));
    const metadata = JSON.stringify((await recovery.manifest(result.handle!)).metadata);
    for (const secret of [secretScope, secretTerm, secretSource, secretReason]) {
      expect(raw).not.toContain(secret);
      expect(metadata).not.toContain(secret);
    }
  });

  it('promotes only validated non-Working lessons and updates an existing promoted lesson', async () => {
    const { memory } = await memoryStore();
    const lesson: AgentLearningLessonRecord = {
      format: 'furypipe-agent-lesson/v1',
      lessonId: 'lesson-1',
      memoryClass: 'Procedural',
      taskDigest: 'task_digest',
      lessonDigest: 'lesson_digest_v1',
      contentHandle: 'opaque://lesson/1',
      evidenceDigests: ['evidence_1'],
      validation: 'validated',
      reuseCount: 0,
    };

    const first = await promoteValidatedLessonToLongTermMemory(memory, {
      lesson,
      scope,
      terms: ['systematic debugging', 'root cause'],
      now: 100,
    });
    expect(first.operation).toBe('ADD');

    const second = await promoteValidatedLessonToLongTermMemory(memory, {
      lesson: { ...lesson, lessonDigest: 'lesson_digest_v2', reuseCount: 1 },
      scope,
      terms: ['systematic debugging', 'root cause'],
      now: 200,
    });
    expect(second.operation).toBe('UPDATE');
    expect(second.record?.version).toBe(2);

    await expect(promoteValidatedLessonToLongTermMemory(memory, {
      lesson: { ...lesson, memoryClass: 'Working' },
      scope,
      terms: ['temporary'],
    })).rejects.toThrow(/Working memory/);
  });

  it('prevents concurrent writers from persisting duplicate revision numbers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-ltm-race-'));
    roots.push(root);
    const initialRecovery = createRecoveryStore(root, { namespace: 'ltm' });
    const initial = createLongTermMemoryStore(initialRecovery);
    await initial.apply({
      operation: 'ADD',
      memoryId: 'race-memory',
      scope,
      now: 10,
      reason: 'initial',
      memoryClass: 'Project',
      contentHandle: 'opaque://race/v1',
      contentDigest: 'digest-v1',
      source: 'test',
      terms: ['race'],
    });

    let waiting = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const withSnapshotBarrier = (store: RecoveryStore): RecoveryStore => {
      let armed = true;
      return {
        ...store,
        async list(options: RecoveryListOptions = {}) {
          const handles = await store.list!(options);
          if (armed && typeof options.metadata?.memoryKey === 'string') {
            armed = false;
            waiting += 1;
            if (waiting === 2) releaseBarrier();
            await barrier;
          }
          return handles;
        },
      };
    };

    const first = createLongTermMemoryStore(withSnapshotBarrier(createRecoveryStore(root, { namespace: 'ltm' })));
    const second = createLongTermMemoryStore(withSnapshotBarrier(createRecoveryStore(root, { namespace: 'ltm' })));

    const updates = await Promise.allSettled([
      first.apply({
        operation: 'UPDATE',
        memoryId: 'race-memory',
        scope,
        now: 20,
        reason: 'writer-a',
        memoryClass: 'Project',
        contentHandle: 'opaque://race/a',
        contentDigest: 'digest-a',
        source: 'test-a',
        terms: ['race'],
      }),
      second.apply({
        operation: 'UPDATE',
        memoryId: 'race-memory',
        scope,
        now: 21,
        reason: 'writer-b',
        memoryClass: 'Project',
        contentHandle: 'opaque://race/b',
        contentDigest: 'digest-b',
        source: 'test-b',
        terms: ['race'],
      }),
    ]);

    expect(updates.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = updates.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(String(rejected.reason)).toMatch(/matching-object limit exceeded/);
    }

    const reopened = createLongTermMemoryStore(createRecoveryStore(root, { namespace: 'ltm' }));
    expect(await reopened.latest('race-memory', scope)).toMatchObject({ version: 2, state: 'active' });
    const history = await reopened.history({ memoryId: 'race-memory', scope, limit: 10 });
    expect(history).toHaveLength(2);
    expect(history.map((record) => record.version)).toEqual([2, 1]);
  });

  it('rejects malformed temporal windows and illegal mutation transitions', async () => {
    const { memory } = await memoryStore();

    await expect(memory.apply({
      operation: 'UPDATE',
      memoryId: 'missing',
      scope,
      reason: 'invalid transition',
      memoryClass: 'Semantic',
      contentHandle: 'opaque://missing',
      contentDigest: 'digest',
      source: 'test',
      terms: ['x'],
    })).rejects.toThrow(/requires an active prior memory/);

    await expect(memory.apply({
      operation: 'ADD',
      memoryId: 'bad-time',
      scope,
      now: 100,
      reason: 'bad window',
      memoryClass: 'Semantic',
      contentHandle: 'opaque://bad',
      contentDigest: 'digest',
      source: 'test',
      terms: ['time'],
      validFrom: 200,
      validTo: 200,
    })).rejects.toThrow(/validTo must be later/);
  });
});
