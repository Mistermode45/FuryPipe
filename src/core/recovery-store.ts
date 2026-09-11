import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Serialize mutations from multiple namespace views sharing one root. */
const recoveryWriteChains = new Map<string, Promise<void>>();

export interface RecoveryMetadata {
  readonly contentType?: string;
  readonly source?: string;
  readonly tenant?: string;
  readonly namespace?: string;
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface RecoveryHandle {
  readonly format: 'furypipe-recovery/v1';
  readonly algorithm: 'sha256';
  readonly digest: string;
  readonly bytes: number;
  readonly metadata?: RecoveryMetadata;
}

export interface RecoveryVerification {
  readonly ok: boolean;
  readonly handle: string;
  readonly exists: boolean;
  readonly digestMatches: boolean;
  readonly bytes: number;
  readonly reason?: string;
}

export interface RecoveryStoreOptions {
  readonly namespace?: string;
  /** Optional hard limit for one immutable object. */
  readonly maxObjectBytes?: number;
  /** Optional hard limit for the namespace's stored object bytes. */
  readonly maxTotalBytes?: number;
  /** Optional hard limit across every namespace below this store root. */
  readonly maxGlobalBytes?: number;
}

export interface RecoveryBackupSummary {
  readonly format: 'furypipe-recovery-backup/v1';
  readonly namespace?: string;
  readonly objects: number;
  readonly manifests: number;
  readonly bytes: number;
}

export interface RecoveryStore {
  put(bytes: Uint8Array | ArrayBuffer, metadata?: RecoveryMetadata): Promise<RecoveryHandle>;
  get(handle: RecoveryHandle | string): Promise<Uint8Array>;
  fetchRange(handle: RecoveryHandle | string, start: number, endExclusive?: number): Promise<Uint8Array>;
  fetchLines(handle: RecoveryHandle | string, fromLine: number, toLine?: number): Promise<string>;
  verify(handle: RecoveryHandle | string): Promise<RecoveryVerification>;
  manifest(handle: RecoveryHandle | string): Promise<RecoveryHandle & { metadata?: RecoveryMetadata }>;
  delete(handle: RecoveryHandle | string): Promise<boolean>;
  gc(now?: Date): Promise<{ expired: number; orphaned: number; bytesFreed: number }>;
  backup(destination: string): Promise<RecoveryBackupSummary>;
  restore(source: string): Promise<RecoveryBackupSummary>;
}

const HANDLE = /^furypipe-recovery\/v1\/sha256\/([0-9a-f]{64})$/;

function digestBytes(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createHash('sha256').update(view).digest('hex');
}

function asUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function parseHandle(handle: RecoveryHandle | string): string {
  const value = typeof handle === 'string'
    ? handle
    : `furypipe-recovery/v1/${handle.algorithm}/${handle.digest}`;
  const match = HANDLE.exec(value);
  if (!match?.[1]) throw new Error('invalid recovery handle');
  return match[1];
}

function objectPath(root: string, digest: string): string {
  return join(root, 'objects', digest.slice(0, 2), digest);
}

function metadataPath(root: string, digest: string): string {
  return join(root, 'manifests', `${digest}.json`);
}

function validateNamespace(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('recovery namespace must be 1-64 ASCII letters, digits, _ or -');
  return value;
}

function makeHandle(digest: string, bytes: number, metadata?: RecoveryMetadata): RecoveryHandle {
  return {
    format: 'furypipe-recovery/v1',
    algorithm: 'sha256',
    digest,
    bytes,
    ...(metadata ? { metadata } : {}),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function totalObjectBytes(root: string): Promise<number> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) total += await totalObjectBytes(path);
      else if (entry.isFile() && !entry.name.endsWith('.tmp')) total += (await stat(path)).size;
    }
    return total;
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw caught;
  }
}

async function globalObjectBytes(root: string): Promise<number> {
  let total = await totalObjectBytes(join(root, 'objects'));
  try {
    for (const entry of await readdir(join(root, 'namespaces'), { withFileTypes: true })) {
      if (entry.isDirectory()) total += await totalObjectBytes(join(root, 'namespaces', entry.name, 'objects'));
    }
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught;
  }
  return total;
}

async function objectFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw caught;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output;
}

async function copyTree(source: string, destination: string, overwrite: boolean): Promise<{ files: number; bytes: number }> {
  try {
    const entries = await readdir(source, { withFileTypes: true });
    let files = 0;
    let bytes = 0;
    await mkdir(destination, { recursive: true });
    for (const entry of entries) {
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      if (entry.isDirectory()) {
        const nested = await copyTree(from, to, overwrite);
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        const size = (await stat(from)).size;
        if (!overwrite && await exists(to)) {
          const current = await readFile(to);
          const incoming = await readFile(from);
          if (digestBytes(current) !== digestBytes(incoming)) throw new Error(`recovery restore conflict at ${entry.name}`);
        } else {
          await copyFile(from, to);
        }
        files += 1;
        bytes += size;
      }
    }
    return { files, bytes };
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return { files: 0, bytes: 0 };
    throw caught;
  }
}

/**
 * File-system content-addressed store. SHA-256 and raw bytes are intentional in
 * this portable first slice: Node's standard library has no BLAKE3/zstd API.
 * Compression and alternate backends remain explicit follow-up work.
 */
export function createRecoveryStore(root: string, options: RecoveryStoreOptions = {}): RecoveryStore {
  const storeRoot = resolve(root);
  const namespace = options.namespace === undefined ? undefined : validateNamespace(options.namespace.trim());
  const maxObjectBytes = options.maxObjectBytes ?? Number.MAX_SAFE_INTEGER;
  const maxTotalBytes = options.maxTotalBytes ?? Number.MAX_SAFE_INTEGER;
  const maxGlobalBytes = options.maxGlobalBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 0) throw new RangeError('maxObjectBytes must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) throw new RangeError('maxTotalBytes must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxGlobalBytes) || maxGlobalBytes < 0) throw new RangeError('maxGlobalBytes must be a non-negative safe integer');
  const scopedRoot = namespace ? join(storeRoot, 'namespaces', namespace) : storeRoot;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = recoveryWriteChains.get(storeRoot) ?? Promise.resolve();
    const next = previous.then(operation);
    recoveryWriteChains.set(storeRoot, next.then(() => undefined, () => undefined));
    return next;
  }

  return {
    put(bytes, metadata) {
      return enqueue(async () => {
      const view = asUint8Array(bytes);
      if (view.byteLength > maxObjectBytes) throw new Error('recovery object exceeds the configured object quota');
      const digest = digestBytes(view);
      const target = objectPath(scopedRoot, digest);
      const manifest = metadataPath(scopedRoot, digest);
      if (!(await exists(target)) && (await totalObjectBytes(join(scopedRoot, 'objects'))) + view.byteLength > maxTotalBytes) {
        throw new Error('recovery namespace exceeds the configured total quota');
      }
      if (!(await exists(target)) && (await globalObjectBytes(storeRoot)) + view.byteLength > maxGlobalBytes) {
        throw new Error('recovery store exceeds the configured global quota');
      }
      await mkdir(dirname(target), { recursive: true });
      await mkdir(dirname(manifest), { recursive: true });
      if (!(await exists(target))) {
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, view, { flag: 'wx' });
        try {
          await rename(temporary, target);
        } catch (error) {
          await rm(temporary, { force: true });
          if (!(await exists(target))) throw error;
        }
      }
      const handle = makeHandle(digest, view.byteLength, metadata);
      if (!(await exists(manifest))) {
        const temporary = `${manifest}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(handle) + '\n', { encoding: 'utf8', flag: 'wx' });
        try {
          await rename(temporary, manifest);
        } catch (error) {
          await rm(temporary, { force: true });
          if (!(await exists(manifest))) throw error;
        }
      }
      return handle;
      });
    },

    async get(handle) {
      const digest = parseHandle(handle);
      const bytes = new Uint8Array(await readFile(objectPath(scopedRoot, digest)));
      if (digestBytes(bytes) !== digest) throw new Error('recovery object integrity check failed');
      return bytes;
    },

    async fetchRange(handle, start, endExclusive) {
      if (!Number.isSafeInteger(start) || start < 0 || (endExclusive !== undefined && (!Number.isSafeInteger(endExclusive) || endExclusive < start))) {
        throw new RangeError('invalid recovery byte range');
      }
      const bytes = await this.get(handle);
      return bytes.slice(start, endExclusive);
    },

    async fetchLines(handle, fromLine, toLine) {
      if (!Number.isSafeInteger(fromLine) || fromLine < 1 || (toLine !== undefined && (!Number.isSafeInteger(toLine) || toLine < fromLine))) {
        throw new RangeError('recovery lines are 1-based and inclusive');
      }
      const text = new TextDecoder().decode(await this.get(handle));
      const lines = text.split(/\r?\n/);
      return lines.slice(fromLine - 1, toLine).join('\n');
    },

    async verify(handle) {
      const digest = parseHandle(handle);
      const object = objectPath(scopedRoot, digest);
      if (!(await exists(object))) return { ok: false, handle: `furypipe-recovery/v1/sha256/${digest}`, exists: false, digestMatches: false, bytes: 0, reason: 'object missing' };
      const bytes = new Uint8Array(await readFile(object));
      const digestMatches = digestBytes(bytes) === digest;
      return {
        ok: digestMatches,
        handle: `furypipe-recovery/v1/sha256/${digest}`,
        exists: true,
        digestMatches,
        bytes: bytes.byteLength,
        ...(digestMatches ? {} : { reason: 'digest mismatch' }),
      };
    },

    async manifest(handle) {
      const digest = parseHandle(handle);
      const file = metadataPath(scopedRoot, digest);
      try {
        return JSON.parse(await readFile(file, 'utf8')) as RecoveryHandle & { metadata?: RecoveryMetadata };
      } catch {
        const verification = await this.verify(handle);
        if (!verification.exists) throw new Error('recovery manifest and object missing');
        return makeHandle(digest, verification.bytes);
      }
    },

    async delete(handle) {
      return enqueue(async () => {
        const digest = parseHandle(handle);
        const object = objectPath(scopedRoot, digest);
        const manifest = metadataPath(scopedRoot, digest);
        const existed = await exists(object) || await exists(manifest);
        await rm(object, { force: true });
        await rm(manifest, { force: true });
        return existed;
      });
    },

    async gc(now = new Date()) {
      return enqueue(async () => {
        const manifestRoot = join(scopedRoot, 'manifests');
        let expired = 0;
        let orphaned = 0;
        let bytesFreed = 0;
        const referenced = new Set<string>();
        try {
          for (const name of await readdir(manifestRoot)) {
            if (!name.endsWith('.json')) continue;
            const digest = name.slice(0, -'.json'.length);
            if (!/^[0-9a-f]{64}$/.test(digest)) continue;
            const file = join(manifestRoot, name);
            referenced.add(digest);
            let manifest: RecoveryHandle & { metadata?: RecoveryMetadata };
            try {
              manifest = JSON.parse(await readFile(file, 'utf8')) as RecoveryHandle & { metadata?: RecoveryMetadata };
            } catch {
              continue;
            }
            if (manifest.digest !== digest) continue;
            const expiresAt = manifest.metadata?.expiresAt;
            if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) > now.getTime()) continue;
            const object = objectPath(scopedRoot, digest);
            try { bytesFreed += (await stat(object)).size; } catch { /* manifest-only corruption */ }
            await rm(object, { force: true });
            await rm(file, { force: true });
            referenced.delete(digest);
            expired += 1;
          }
        } catch (caught) {
          if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught;
        }
        for (const object of await objectFiles(join(scopedRoot, 'objects'))) {
          const digest = object.split(/[\\/]/).pop() ?? '';
          if (!/^[0-9a-f]{64}$/.test(digest) || referenced.has(digest)) continue;
          if (await exists(metadataPath(scopedRoot, digest))) continue;
          bytesFreed += (await stat(object)).size;
          await rm(object, { force: true });
          orphaned += 1;
        }
        return { expired, orphaned, bytesFreed };
      });
    },

    backup(destination) {
      return enqueue(async () => {
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          await mkdir(temporary, { recursive: true });
          const objects = await copyTree(join(scopedRoot, 'objects'), join(temporary, 'objects'), true);
          const manifests = await copyTree(join(scopedRoot, 'manifests'), join(temporary, 'manifests'), true);
          const summary: RecoveryBackupSummary = {
            format: 'furypipe-recovery-backup/v1',
            ...(namespace ? { namespace } : {}),
            objects: objects.files,
            manifests: manifests.files,
            bytes: objects.bytes,
          };
          await writeFile(join(temporary, 'backup.json'), JSON.stringify(summary) + '\n', { encoding: 'utf8', flag: 'wx' });
          await mkdir(dirname(destination), { recursive: true });
          await rename(temporary, destination);
          return summary;
        } catch (caught) {
          await rm(temporary, { recursive: true, force: true });
          throw caught;
      }
      });
    },

    restore(source) {
      return enqueue(async () => {
        const summaryFile = join(source, 'backup.json');
        const summary = JSON.parse(await readFile(summaryFile, 'utf8')) as RecoveryBackupSummary;
        if (summary.format !== 'furypipe-recovery-backup/v1' || (summary.namespace !== undefined && summary.namespace !== namespace)) {
          throw new Error('invalid recovery backup manifest');
        }
        const objects = await copyTree(join(source, 'objects'), join(scopedRoot, 'objects'), false);
        const manifests = await copyTree(join(source, 'manifests'), join(scopedRoot, 'manifests'), false);
        if (objects.files !== summary.objects || manifests.files !== summary.manifests || objects.bytes !== summary.bytes) {
          throw new Error('recovery backup verification failed');
        }
        return summary;
      });
    },
  };
}
