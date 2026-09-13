import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryAgentMemoryStore, runAgent } from '../src/agent-runtime.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';

const roots: string[] = [];

async function runRecoveryWorker(request: Record<string, unknown>): Promise<{ code: number; stdout: string; stderr: string }> {
  const worker = fileURLToPath(new URL('./fixtures/recovery-worker.ts', import.meta.url));
  const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsx, worker, JSON.stringify(request)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const [result] = await once(child, 'close') as [number | null, string];
  return { code: result ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
}

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

  it('lists bounded manifests by exact metadata without exposing payloads', async () => {
    const { store } = await createStoreFixture();
    await store.put(new TextEncoder().encode('first'), { source: 'agent-runtime', runId: 'run-1', stage: 'research' });
    await store.put(new TextEncoder().encode('second'), { source: 'agent-runtime', runId: 'run-2', stage: 'plan' });
    const matches = await store.list?.({ metadata: { source: 'agent-runtime', runId: 'run-1' }, limit: 1 });
    expect(matches).toHaveLength(1);
    expect(matches?.[0]).toMatchObject({ metadata: { source: 'agent-runtime', runId: 'run-1', stage: 'research' } });
    expect((matches?.[0] as Record<string, unknown>)['payload']).toBeUndefined();
    await expect(store.list?.({ limit: 0 })).rejects.toThrow('list limit');
  });

  it('atomically bounds unique objects by metadata while preserving idempotent puts', async () => {
    const { store } = await createStoreFixture();
    expect(typeof store.putBounded).toBe('function');
    const bound = { metadata: { source: 'bounded-claims' }, maxMatches: 1 };

    const first = await store.putBounded!(
      new TextEncoder().encode('claim-one'),
      { source: 'bounded-claims', token: 'first' },
      bound,
    );
    const duplicate = await store.putBounded!(
      new TextEncoder().encode('claim-one'),
      { source: 'bounded-claims', token: 'second' },
      bound,
    );
    expect(duplicate.digest).toBe(first.digest);
    expect(duplicate.metadata?.token).toBe('first');

    await expect(store.putBounded!(
      new TextEncoder().encode('claim-two'),
      { source: 'bounded-claims', token: 'third' },
      bound,
    )).rejects.toThrow(/matching-object limit/);

    expect(await store.list?.({ metadata: { source: 'bounded-claims' } })).toHaveLength(1);
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

  it('refuses to overwrite an object variant left without its manifest', async () => {
    const { root, store } = await createStoreFixture();
    const bytes = new TextEncoder().encode('orphan encrypted variant');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const objectDirectory = join(root, 'namespaces', 'test-tenant', 'objects', digest.slice(0, 2));
    const orphan = join(objectDirectory, `${digest}.enc-key-v1`);
    await mkdir(objectDirectory, { recursive: true });
    await writeFile(orphan, 'orphan', { flag: 'wx' });
    await expect(store.put(bytes)).rejects.toThrow('no manifest');
    expect(await readFile(orphan, 'utf8')).toBe('orphan');
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
    expect(summary).toMatchObject({ format: 'furypipe-recovery-backup/v1', namespace: 'backup', objects: 1, manifests: 1, bytes: 10, evidence: 'BACKUP_EXISTS' });
    await source.delete(handle);
    const restored = await source.restore(destination);
    expect(restored).toMatchObject({ ...summary, evidence: 'RESTORE_VERIFIED' });
    expect(restored.evidence).not.toBe(summary.evidence);
    expect(new TextDecoder().decode(await source.get(handle))).toBe('recover me');
    await expect(source.restore(destination)).resolves.toMatchObject({ ...summary, evidence: 'RESTORE_VERIFIED' });
  });

  it('encrypts objects at rest, reads retained key versions, and rekeys explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-encrypted-'));
    roots.push(root);
    const keyOne = new Uint8Array(32).fill(1);
    const keyTwo = new Uint8Array(32).fill(2);
    const first = createRecoveryStore(root, {
      namespace: 'encrypted',
      encryption: { activeKeyId: 'key-v1', keys: { 'key-v1': keyOne } },
    });
    const handle = await first.put(new TextEncoder().encode('secret at rest'), { source: 'encrypted-test' });
    expect(handle.storage).toEqual({ format: 'aes-256-gcm/v1', keyId: 'key-v1' });
    const objectDirectory = join(root, 'namespaces', 'encrypted', 'objects', handle.digest.slice(0, 2));
    const encryptedFile = join(objectDirectory, `${handle.digest}.enc-key-v1`);
    expect(await readFile(encryptedFile, 'utf8')).not.toContain('secret at rest');

    const rotated = createRecoveryStore(root, {
      namespace: 'encrypted',
      encryption: { activeKeyId: 'key-v2', keys: { 'key-v1': keyOne, 'key-v2': keyTwo } },
    });
    expect(new TextDecoder().decode(await rotated.get(handle))).toBe('secret at rest');
    await expect(rotated.rekey()).resolves.toMatchObject({ activeKeyId: 'key-v2', scanned: 1, migrated: 1, alreadyCurrent: 0 });
    expect(await readdir(objectDirectory)).toEqual(expect.arrayContaining([`${handle.digest}.enc-key-v2`]));
    await rotated.gc();
    expect(await readdir(objectDirectory)).not.toContain(`${handle.digest}.enc-key-v1`);

    const strictRotated = createRecoveryStore(root, {
      namespace: 'encrypted',
      encryption: { activeKeyId: 'key-v2', keys: { 'key-v2': keyTwo } },
    });
    expect(new TextDecoder().decode(await strictRotated.get(handle))).toBe('secret at rest');
  });

  it('keeps namespace and global quotas when rekey would grow stored bytes beyond the limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-rekey-quota-'));
    roots.push(root);
    const key = new Uint8Array(32).fill(7);
    const plaintext = new TextEncoder().encode('1234');
    const unencrypted = createRecoveryStore(root, {
      namespace: 'rekey-quota', maxTotalBytes: 39, maxGlobalBytes: 39,
    });
    const handle = await unencrypted.put(plaintext);
    const encrypted = createRecoveryStore(root, {
      namespace: 'rekey-quota', maxTotalBytes: 39, maxGlobalBytes: 39,
      encryption: { activeKeyId: 'key-v2', keys: { 'key-v2': key }, allowLegacyPlaintext: true },
    });

    await expect(encrypted.rekey()).rejects.toThrow(/quota during rekey/);
    expect(await unencrypted.get(handle)).toEqual(plaintext);
    expect(await readdir(join(root, 'namespaces', 'rekey-quota', 'objects', handle.digest.slice(0, 2))))
      .toEqual([handle.digest]);
  });

  it('fails closed on missing keys, tampered ciphertext and legacy plaintext until rekey', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-encryption-fail-'));
    roots.push(root);
    const key = new Uint8Array(32).fill(3);
    const plain = createRecoveryStore(root, { namespace: 'legacy' });
    const legacyHandle = await plain.put(new TextEncoder().encode('legacy content'));
    const strict = createRecoveryStore(root, {
      namespace: 'legacy',
      encryption: { activeKeyId: 'key-v1', keys: { 'key-v1': key } },
    });
    await expect(strict.get(legacyHandle)).rejects.toThrow('explicit rekey migration');
    await expect(strict.backup(join(root, 'legacy-backup'))).rejects.toThrow('explicit rekey migration');
    await expect(strict.rekey()).resolves.toMatchObject({ migrated: 1 });
    expect(new TextDecoder().decode(await strict.get(legacyHandle))).toBe('legacy content');

    const encryptedHandle = await strict.put(new TextEncoder().encode('tamper me'));
    const encryptedPath = join(root, 'namespaces', 'legacy', 'objects', encryptedHandle.digest.slice(0, 2), `${encryptedHandle.digest}.enc-key-v1`);
    const tampered = await readFile(encryptedPath);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    await writeFile(encryptedPath, tampered);
    expect(await strict.verify(encryptedHandle)).toMatchObject({ ok: false, exists: true, digestMatches: false });
    await expect(strict.get(encryptedHandle)).rejects.toThrow('cannot be opened');

    const noKey = createRecoveryStore(root, {
      namespace: 'legacy',
      encryption: { activeKeyId: 'key-v2', keys: { 'key-v2': new Uint8Array(32).fill(4) } },
    });
    await expect(noKey.get(legacyHandle)).rejects.toThrow('encryption key is unavailable');
  });

  it('recovers a manifest backup after a simulated process interruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-restart-'));
    roots.push(root);
    const key = new Uint8Array(32).fill(5);
    const store = createRecoveryStore(root, {
      namespace: 'restart',
      encryption: { activeKeyId: 'key-v1', keys: { 'key-v1': key } },
    });
    const handle = await store.put(new TextEncoder().encode('restart-safe'));
    const manifest = join(root, 'namespaces', 'restart', 'manifests', `${handle.digest}.json`);
    const backup = `${manifest}.recovery-bak-simulated`;
    await rename(manifest, backup);
    const reopened = createRecoveryStore(root, {
      namespace: 'restart',
      encryption: { activeKeyId: 'key-v1', keys: { 'key-v1': key } },
    });
    expect(new TextDecoder().decode(await reopened.get(handle))).toBe('restart-safe');
  });

  it('recovers from a real killed process and removes atomic temp residue before the next operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-process-crash-'));
    roots.push(root);

    const crashed = await runRecoveryWorker({ root, namespace: 'crash', operation: 'crash-temp' });
    expect(crashed.code).not.toBe(0);
    const { tempPath } = JSON.parse(crashed.stdout) as { tempPath: string };
    expect(await readFile(tempPath, 'utf8')).toBe('crash-residue');

    const staleLock = join(root, '.recovery.lock');
    const staleTime = new Date(Date.now() - 120_000);
    await utimes(staleLock, staleTime, staleTime);

    const reopened = createRecoveryStore(root, { namespace: 'crash' });
    const handle = await reopened.put(new TextEncoder().encode('after-real-crash'), { source: 'crash-recovery-test' });
    expect(new TextDecoder().decode(await reopened.get(handle))).toBe('after-real-crash');
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes real separate-process put/get/delete/backup/restore and rekey operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-recovery-process-'));
    const backupRoot = await mkdtemp(join(tmpdir(), 'furypipe-recovery-process-backup-'));
    roots.push(root, backupRoot);
    const backup = join(backupRoot, 'snapshot');

    const quotaRace = await Promise.all([
      runRecoveryWorker({ root, namespace: 'process', operation: 'put', value: '1234', maxGlobalBytes: 5 }),
      runRecoveryWorker({ root, namespace: 'process', operation: 'put', value: '5678', maxGlobalBytes: 5 }),
    ]);
    expect(quotaRace.filter((result) => result.code === 0)).toHaveLength(1);
    expect(quotaRace.filter((result) => result.code !== 0)).toHaveLength(1);
    expect(quotaRace.find((result) => result.code !== 0)?.stderr).toContain('global quota');
    const winnerIndex = quotaRace.findIndex((result) => result.code === 0);
    const winnerValue = ['1234', '5678'][winnerIndex]!;
    const first = JSON.parse(quotaRace.find((result) => result.code === 0)!.stdout) as { handle: { digest: string } };
    const firstHandle = `furypipe-recovery/v1/sha256/${first.handle.digest}`;

    expect((await runRecoveryWorker({ root, namespace: 'process', operation: 'get', handle: firstHandle })).stdout).toBe(winnerValue);
    expect(JSON.parse((await runRecoveryWorker({ root, namespace: 'process', operation: 'backup', path: backup })).stdout)).toMatchObject({ evidence: 'BACKUP_EXISTS' });
    expect(JSON.parse((await runRecoveryWorker({ root, namespace: 'process', operation: 'delete', handle: firstHandle })).stdout)).toEqual({ deleted: true });
    expect(JSON.parse((await runRecoveryWorker({ root, namespace: 'process', operation: 'restore', path: backup })).stdout)).toMatchObject({ evidence: 'RESTORE_VERIFIED' });
    expect((await runRecoveryWorker({ root, namespace: 'process', operation: 'get', handle: firstHandle })).stdout).toBe(winnerValue);

    const encrypted = await runRecoveryWorker({ root, namespace: 'encrypted-process', operation: 'put', value: 'rotate-me', profile: 'v1' });
    expect(encrypted.code).toBe(0);
    const encryptedHandle = (JSON.parse(encrypted.stdout) as { handle: { digest: string } }).handle;
    expect((await runRecoveryWorker({ root, namespace: 'encrypted-process', operation: 'rekey', profile: 'both', targetKeyId: 'key-v2' })).code).toBe(0);
    expect((await runRecoveryWorker({ root, namespace: 'encrypted-process', operation: 'get', profile: 'v2', handle: `furypipe-recovery/v1/sha256/${encryptedHandle.digest}` })).stdout).toBe('rotate-me');

    const staleLock = join(root, '.recovery.lock');
    await writeFile(staleLock, JSON.stringify({ token: 'crashed-process', pid: 1, createdAt: '2020-01-01T00:00:00.000Z' }));
    const staleTime = new Date(Date.now() - 120_000);
    await utimes(staleLock, staleTime, staleTime);
    expect((await runRecoveryWorker({ root, namespace: 'process', operation: 'put', value: 'after-restart' })).code).toBe(0);
  });

  it('resumes an agent with Recovery memory in a separate process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-agent-process-'));
    roots.push(root);
    const memory = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent-process' }));
    const objective = 'Resume from a durable handoff without persisting the prompt.';
    const paused = await runAgent({
      objective,
      runId: 'agent-process-resume',
      memory,
      executors: {
        research: async () => ({ status: 'handoff_required', evidence: ['parent-handoff'], consumedTokens: 1 }),
      },
    });
    expect(paused.status).toBe('handoff_required');
    const resumed = await runRecoveryWorker({
      root, namespace: 'agent-process', operation: 'agent-resume', objective,
      runId: 'agent-process-resume', snapshot: paused.snapshot,
    });
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({ status: 'completed', runId: 'agent-process-resume' });
    expect(await memory.list('agent-process-resume')).toHaveLength(6);
    expect(resumed.stdout).not.toContain(objective);
  });
});
