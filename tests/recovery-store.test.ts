import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore, type RecoveryHandle } from '../src/core/recovery-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStoreFixture() {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-'));
  roots.push(root);
  return { root, store: createRecoveryStore(root, { namespace: 'test-tenant' }) };
}

describe('Recovery Store', () => {
  it('puts, reads, ranges and verifies content by SHA-256 handle', async () => {
    const { store } = await createStoreFixture();
    const handle = await store.put(new TextEncoder().encode('alpha\nbeta\ngamma'), {
      contentType: 'text/plain',
      source: 'test-fixture',
    });
    expect(handle.algorithm).toBe('sha256');
    expect(await store.get(handle)).toEqual(new TextEncoder().encode('alpha\nbeta\ngamma'));
    expect(new TextDecoder().decode(await store.fetchRange(handle, 6, 10))).toBe('beta');
    expect(await store.fetchLines(handle, 2, 3)).toBe('beta\ngamma');
    expect(await store.verify(handle)).toMatchObject({ ok: true, exists: true, digestMatches: true, bytes: 16 });
    expect(await store.manifest(handle)).toMatchObject({ metadata: { source: 'test-fixture' } });
  });

  it('keeps a collision-free immutable object and rejects malformed handles', async () => {
    const { root, store } = await createStoreFixture();
    const bytes = new TextEncoder().encode('same content');
    const first = await store.put(bytes);
    const second = await store.put(bytes, { source: 'second-write' });
    expect(second.digest).toBe(first.digest);
    await expect(store.get('furypipe-recovery/v1/sha256/not-a-digest')).rejects.toThrow('invalid recovery handle');
    await writeFile(join(root, 'namespaces', 'test-tenant', 'objects', first.digest.slice(0, 2), first.digest), 'tampered');
    expect((await store.verify(first)).ok).toBe(false);
    await expect(store.get(first)).rejects.toThrow('integrity check failed');
  });

  it('isolates namespaces and deletes only the addressed object', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-isolation-'));
    roots.push(root);
    const one = createRecoveryStore(root, { namespace: 'one' });
    const two = createRecoveryStore(root, { namespace: 'two' });
    const first = await one.put(new TextEncoder().encode('private'));
    await expect(two.get(first)).rejects.toBeDefined();
    expect(await one.delete(first)).toBe(true);
    expect((await one.verify(first)).exists).toBe(false);
  });

  it('rejects namespaces that could escape the store root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-namespace-'));
    roots.push(root);
    expect(() => createRecoveryStore(root, { namespace: '..\\outside' })).toThrow('recovery namespace');
  });

  it('enforces object and namespace quotas without replacing existing content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-quota-'));
    roots.push(root);
    const store = createRecoveryStore(root, { namespace: 'quota', maxObjectBytes: 4, maxTotalBytes: 5 });
    const first = await store.put(new TextEncoder().encode('1234'));
    await expect(store.put(new TextEncoder().encode('12345'))).rejects.toThrow('object quota');
    await expect(store.put(new TextEncoder().encode('5678'))).rejects.toThrow('total quota');
    expect(await store.get(first)).toEqual(new TextEncoder().encode('1234'));
  });

  it('enforces a shared global quota across namespace views', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-global-quota-'));
    roots.push(root);
    const one = createRecoveryStore(root, { namespace: 'one', maxGlobalBytes: 5 });
    const two = createRecoveryStore(root, { namespace: 'two', maxGlobalBytes: 5 });
    const outcomes = await Promise.allSettled([
      one.put(new TextEncoder().encode('1234')),
      two.put(new TextEncoder().encode('56')),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ message: expect.stringContaining('global quota') });
  });

  it('garbage-collects expired manifests and their immutable objects', async () => {
    const { store } = await createStoreFixture();
    const handle = await store.put(new TextEncoder().encode('temporary'), { expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(await store.gc(new Date('2026-09-11T00:00:00.000Z'))).toMatchObject({ expired: 1, bytesFreed: 9 });
    expect((await store.verify(handle)).exists).toBe(false);
  });

  it('removes unreferenced object files without touching valid manifests', async () => {
    const { root, store } = await createStoreFixture();
    const live = await store.put(new TextEncoder().encode('live'), { source: 'kept' });
    const orphanBytes = new TextEncoder().encode('orphan');
    const orphanDigest = createHash('sha256').update(orphanBytes).digest('hex');
    const orphanPath = join(root, 'namespaces', 'test-tenant', 'objects', orphanDigest.slice(0, 2), orphanDigest);
    await mkdir(join(root, 'namespaces', 'test-tenant', 'objects', orphanDigest.slice(0, 2)), { recursive: true });
    await writeFile(orphanPath, orphanBytes, { flag: 'wx' });
    expect(await store.gc(new Date('2026-09-11T00:00:00.000Z'))).toMatchObject({ orphaned: 1, bytesFreed: 6 });
    expect((await store.verify(live)).ok).toBe(true);
  });

  it('creates a verified backup and restores it without overwriting conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-backup-'));
    const backup = await mkdtemp(join(tmpdir(), 'furypipe-recovery-backup-target-'));
    roots.push(root, backup);
    const source = createRecoveryStore(root, { namespace: 'backup' });
    const handle = await source.put(new TextEncoder().encode('recover me'), { source: 'backup-test' });
    const destination = join(backup, 'snapshot');
    const summary = await source.backup(destination);
    expect(summary).toMatchObject({ format: 'furypipe-recovery-backup/v1', namespace: 'backup', objects: 1, manifests: 1, bytes: 10 });
    await source.delete(handle);
    const restored = await source.restore(destination);
    expect(restored).toEqual(summary);
    expect(new TextDecoder().decode(await source.get(handle))).toBe('recover me');
    await expect(source.restore(destination)).resolves.toEqual(summary);
  });
});
