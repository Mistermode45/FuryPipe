import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
}

export interface RecoveryStore {
  put(bytes: Uint8Array | ArrayBuffer, metadata?: RecoveryMetadata): Promise<RecoveryHandle>;
  get(handle: RecoveryHandle | string): Promise<Uint8Array>;
  fetchRange(handle: RecoveryHandle | string, start: number, endExclusive?: number): Promise<Uint8Array>;
  fetchLines(handle: RecoveryHandle | string, fromLine: number, toLine?: number): Promise<string>;
  verify(handle: RecoveryHandle | string): Promise<RecoveryVerification>;
  manifest(handle: RecoveryHandle | string): Promise<RecoveryHandle & { metadata?: RecoveryMetadata }>;
  delete(handle: RecoveryHandle | string): Promise<boolean>;
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

/**
 * File-system content-addressed store. SHA-256 and raw bytes are intentional in
 * this portable first slice: Node's standard library has no BLAKE3/zstd API.
 * Compression and alternate backends remain explicit follow-up work.
 */
export function createRecoveryStore(root: string, options: RecoveryStoreOptions = {}): RecoveryStore {
  const namespace = options.namespace === undefined ? undefined : validateNamespace(options.namespace.trim());
  const scopedRoot = namespace ? join(root, 'namespaces', namespace) : root;

  return {
    async put(bytes, metadata) {
      const view = asUint8Array(bytes);
      const digest = digestBytes(view);
      const target = objectPath(scopedRoot, digest);
      const manifest = metadataPath(scopedRoot, digest);
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
      if (metadata !== undefined && !(await exists(manifest))) {
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
      const digest = parseHandle(handle);
      const object = objectPath(scopedRoot, digest);
      const manifest = metadataPath(scopedRoot, digest);
      const existed = await exists(object) || await exists(manifest);
      await rm(object, { force: true });
      await rm(manifest, { force: true });
      return existed;
    },
  };
}
