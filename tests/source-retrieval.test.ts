import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryIndex, createRecoveryStore } from '../src/core/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('source-aware recovery retrieval', () => {
  it('returns exact locations and handles without returning matched plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-retrieval-'));
    roots.push(root);
    const index = createRecoveryIndex(createRecoveryStore(root));
    const handle = await index.add(new TextEncoder().encode('alpha\nneedle value\nneedle again'), { source: 'fixture.log' });
    const hits = await index.search('needle');

    expect(index.size).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.handle).toContain(handle.digest);
    expect(hits[0]?.source).toBe('fixture.log');
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.matchCount).toBe(2);
    expect(JSON.stringify(hits)).not.toContain('needle');
  });

  it('filters sources, rejects unbounded queries, and skips binary objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-retrieval-'));
    roots.push(root);
    const index = createRecoveryIndex(createRecoveryStore(root));
    await index.add(new TextEncoder().encode('same needle'), { source: 'a.txt' });
    await index.add(new TextEncoder().encode('same needle'), { source: 'b.txt' });
    await index.add(new Uint8Array([0xff, 0xfe]), { source: 'binary.bin' });

    expect(await index.search('needle', { source: 'b.txt' })).toHaveLength(1);
    await expect(index.search('')).rejects.toThrow('must not be empty');
    await expect(index.search('x'.repeat(257))).rejects.toThrow('exceeds 256');
    expect(await index.search('needle', { source: 'binary.bin' })).toEqual([]);
  });

  it('searches a stable index snapshot while new handles are added', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-retrieval-snapshot-'));
    roots.push(root);
    const backingStore = createRecoveryStore(root);
    let releaseRead!: () => void;
    let signalRead!: () => void;
    const readEntered = new Promise<void>((resolve) => { signalRead = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let pauseNextRead = true;
    const delayedStore = {
      ...backingStore,
      async get(handle: Parameters<typeof backingStore.get>[0]) {
        if (pauseNextRead) {
          pauseNextRead = false;
          signalRead();
          await readGate;
        }
        return backingStore.get(handle);
      },
    };
    const index = createRecoveryIndex(delayedStore);
    await index.add(new TextEncoder().encode('needle first'), { source: 'first.txt' });

    const pendingSearch = index.search('needle');
    await readEntered;
    await index.add(new TextEncoder().encode('needle second'), { source: 'second.txt' });
    releaseRead();

    expect(await pendingSearch).toHaveLength(1);
    expect(index.size).toBe(2);
  });
});
