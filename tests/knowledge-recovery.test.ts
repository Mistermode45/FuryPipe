import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { createKnowledgeIndex } from '../src/knowledge.js';
import {
  createRecoveryKnowledgeStore,
  KNOWLEDGE_RECOVERY_METADATA,
} from '../src/knowledge-recovery.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function entry(id: string, term: string) {
  return {
    format: 'furypipe-knowledge-entry/v1' as const,
    id,
    memoryClass: 'Procedural' as const,
    taskDigest: `task_${id}`,
    lessonDigest: `lesson_${id}`,
    contentHandle: `opaque://${id}`,
    evidenceDigests: [`evidence_${id}`],
    termDigests: [term.repeat(64)],
    reuseCount: 0,
  };
}

describe('Recovery-backed Knowledge snapshots', () => {
  it('persists and reopens a complete graph without plaintext terms or edge evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-knowledge-recovery-'));
    roots.push(root);
    const raw = createRecoveryStore(root, { namespace: 'knowledge' });
    const durable = createRecoveryKnowledgeStore(raw, { now: () => 1000 });
    const index = createKnowledgeIndex();
    index.addEntry(entry('lesson-a', 'a'));
    index.addEntry(entry('lesson-b', 'b'));
    index.link({
      from: 'lesson-a',
      to: 'lesson-b',
      relation: 'supports',
      evidence: 'PRIVATE RELATIONSHIP EVIDENCE',
    });

    const handle = await durable.save(index);
    expect(handle.metadata).toMatchObject({
      source: 'knowledge-index',
      contentType: 'application/vnd.furypipe.knowledge-snapshot+json',
      createdAt: 1000,
      entries: 2,
      edges: 1,
    });

    const stored = new TextDecoder().decode(await raw.get(handle));
    expect(stored).not.toContain('PRIVATE RELATIONSHIP EVIDENCE');
    expect(stored).not.toContain('recovery');
    expect(stored).toContain('opaque://lesson-a');

    const reopened = await createRecoveryKnowledgeStore(
      createRecoveryStore(root, { namespace: 'knowledge' }),
      { now: () => 2000 },
    ).loadLatest();

    expect(reopened?.createdAt).toBe(1000);
    expect(reopened?.index.stats()).toEqual({ entries: 2, edges: 1, indexedTermDigests: 2 });
    expect(reopened?.index.neighbors('lesson-a', 'supports')).toHaveLength(1);
    expect(reopened?.index.get('lesson-b')).toMatchObject({ contentHandle: 'opaque://lesson-b' });
  });

  it('selects the newest immutable snapshot by createdAt with deterministic digest tie-break', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-knowledge-latest-'));
    roots.push(root);
    const raw = createRecoveryStore(root, { namespace: 'knowledge' });
    let now = 10;
    const durable = createRecoveryKnowledgeStore(raw, { now: () => now });

    const first = createKnowledgeIndex();
    first.addEntry(entry('lesson-a', 'a'));
    await durable.save(first);

    now = 20;
    const second = createKnowledgeIndex();
    second.addEntry(entry('lesson-a', 'a'));
    second.addEntry(entry('lesson-b', 'b'));
    const secondHandle = await durable.save(second);

    const handles = await durable.listSnapshots();
    expect(handles).toHaveLength(2);
    expect(handles[0]?.digest).toBe(secondHandle.digest);

    const latest = await durable.loadLatest();
    expect(latest?.createdAt).toBe(20);
    expect(latest?.index.stats().entries).toBe(2);
  });

  it('fails closed when the newest matching snapshot is malformed instead of silently rolling back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-knowledge-corrupt-'));
    roots.push(root);
    const raw = createRecoveryStore(root, { namespace: 'knowledge' });
    const durable = createRecoveryKnowledgeStore(raw, { now: () => 10 });

    const good = createKnowledgeIndex();
    good.addEntry(entry('lesson-a', 'a'));
    await durable.save(good);

    await raw.put(new TextEncoder().encode('{ definitely-not-valid-json'), {
      ...KNOWLEDGE_RECOVERY_METADATA,
      createdAt: 20,
      format: 'furypipe-knowledge-snapshot/v1',
      entries: 999,
      edges: 999,
    });

    await expect(durable.loadLatest()).rejects.toThrow(/cannot be decoded/);
  });

  it('rejects structurally forged snapshots even when Recovery integrity itself is valid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-knowledge-forged-'));
    roots.push(root);
    const raw = createRecoveryStore(root, { namespace: 'knowledge' });
    const durable = createRecoveryKnowledgeStore(raw);

    const forged = {
      format: 'furypipe-knowledge-snapshot/v1',
      entries: [entry('lesson-a', 'a')],
      edges: [{
        format: 'furypipe-knowledge-edge/v1',
        id: 'edge_' + 'a'.repeat(32),
        from: 'lesson-a',
        to: 'lesson-a',
        relation: 'supports',
        evidenceDigest: 'b'.repeat(64),
      }],
    };
    await raw.put(new TextEncoder().encode(JSON.stringify(forged)), {
      ...KNOWLEDGE_RECOVERY_METADATA,
      createdAt: 30,
    });

    await expect(durable.loadLatest()).rejects.toThrow(/self-edge|does not match/);
  });

  it('returns undefined when no Knowledge snapshot exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-knowledge-empty-'));
    roots.push(root);
    const durable = createRecoveryKnowledgeStore(createRecoveryStore(root, { namespace: 'knowledge' }));
    expect(await durable.loadLatest()).toBeUndefined();
    expect(await durable.listSnapshots()).toEqual([]);
  });
});
