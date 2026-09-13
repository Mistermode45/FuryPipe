import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, copyFile, link, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** Serialize operations from multiple namespace views sharing one root. */
const recoveryWriteChains = new Map<string, Promise<void>>();
const RECOVERY_LOCK_FILE = '.recovery.lock';
const RECOVERY_LOCK_STALE_MS = 60_000;
const RECOVERY_LOCK_WAIT_MS = 30_000;
const RECOVERY_LOCK_RETRY_MS = 25;
const RECOVERY_LOCK_HEARTBEAT_MS = 10_000;

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
  readonly storage?: RecoveryStorage;
}

export interface RecoveryStorage {
  readonly format: 'aes-256-gcm/v1';
  readonly keyId: string;
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
  /** Optional AES-256-GCM key ring owned by the host application. */
  readonly encryption?: RecoveryEncryptionOptions;
}

export interface RecoveryEncryptionOptions {
  /** Key used for new objects and explicit rekey operations. */
  readonly activeKeyId: string;
  /** Key IDs may be retained during rotation so older objects remain readable. */
  readonly keys: Readonly<Record<string, Uint8Array>>;
  /** Explicit compatibility escape hatch for pre-encryption plaintext objects. */
  readonly allowLegacyPlaintext?: boolean;
}

export interface RecoveryBackupSummary {
  readonly format: 'furypipe-recovery-backup/v1';
  readonly namespace?: string;
  readonly objects: number;
  readonly manifests: number;
  readonly bytes: number;
  readonly evidence: 'BACKUP_EXISTS' | 'RESTORE_VERIFIED';
}

export interface RecoveryRekeySummary {
  readonly format: 'furypipe-recovery-rekey/v1';
  readonly namespace?: string;
  readonly activeKeyId: string;
  readonly scanned: number;
  readonly migrated: number;
  readonly alreadyCurrent: number;
}

export interface RecoveryListOptions {
  /** Exact metadata values used to select manifests without reading payloads. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Hard-bounded result count. Defaults to 10,000. */
  readonly limit?: number;
}

export interface RecoveryCapacityBound {
  /** Exact metadata values counted under the same Recovery write lock. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  /** Reject creation of a new unique object once this many matching manifests exist. */
  readonly maxMatches: number;
}

export interface RecoveryPutBound extends RecoveryCapacityBound {
  /**
   * Additional capacity/uniqueness constraints evaluated atomically under the
   * same inter-process Recovery lock. This lets callers enforce both a broad
   * quota and a narrow uniqueness key without a list→put race.
   */
  readonly additionalBounds?: readonly RecoveryCapacityBound[];
}

export interface RecoveryStore {
  put(bytes: Uint8Array | ArrayBuffer, metadata?: RecoveryMetadata): Promise<RecoveryHandle>;
  /** Optional atomic capacity primitive; createRecoveryStore implements it. */
  putBounded?(bytes: Uint8Array | ArrayBuffer, metadata: RecoveryMetadata | undefined, bound: RecoveryPutBound): Promise<RecoveryHandle>;
  get(handle: RecoveryHandle | string): Promise<Uint8Array>;
  fetchRange(handle: RecoveryHandle | string, start: number, endExclusive?: number): Promise<Uint8Array>;
  fetchLines(handle: RecoveryHandle | string, fromLine: number, toLine?: number): Promise<string>;
  verify(handle: RecoveryHandle | string): Promise<RecoveryVerification>;
  manifest(handle: RecoveryHandle | string): Promise<RecoveryHandle & { metadata?: RecoveryMetadata }>;
  /** Optional for backward-compatible custom stores; createRecoveryStore implements it. */
  list?(options?: RecoveryListOptions): Promise<readonly (RecoveryHandle & { metadata?: RecoveryMetadata })[]>;
  delete(handle: RecoveryHandle | string): Promise<boolean>;
  gc(now?: Date): Promise<{ expired: number; orphaned: number; bytesFreed: number }>;
  backup(destination: string): Promise<RecoveryBackupSummary>;
  restore(source: string): Promise<RecoveryBackupSummary>;
  rekey(targetKeyId?: string): Promise<RecoveryRekeySummary>;
}

const HANDLE = /^furypipe-recovery\/v1\/sha256\/([0-9a-f]{64})$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/u;
const ENCRYPTED_MAGIC = Buffer.from('FURYENC1', 'ascii');
const ENCRYPTED_NONCE_BYTES = 12;
const ENCRYPTED_TAG_BYTES = 16;
const MANIFEST_BACKUP_MARKER = '.recovery-bak-';

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

function metadataPath(root: string, digest: string): string {
  return join(root, 'manifests', `${digest}.json`);
}

function validateNamespace(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('recovery namespace must be 1-64 ASCII letters, digits, _ or -');
  return value;
}

function boundedListLimit(value: number | undefined): number {
  if (value === undefined) return 10_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RangeError('recovery list limit must be an integer from 1 to 10000');
  }
  return value;
}

function makeHandle(digest: string, bytes: number, metadata?: RecoveryMetadata, storage?: RecoveryStorage): RecoveryHandle {
  return {
    format: 'furypipe-recovery/v1',
    algorithm: 'sha256',
    digest,
    bytes,
    ...(metadata ? { metadata } : {}),
    ...(storage ? { storage } : {}),
  };
}

function validateKeyId(value: string): string {
  if (!KEY_ID.test(value)) throw new Error('recovery encryption key ID must be 1-64 ASCII letters, digits, _, ., or -');
  return value;
}

function normalizeEncryption(options: RecoveryEncryptionOptions | undefined): {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
  readonly allowLegacyPlaintext: boolean;
} | undefined {
  if (options === undefined) return undefined;
  const activeKeyId = validateKeyId(options.activeKeyId.trim());
  const keys = new Map<string, Uint8Array>();
  for (const [rawId, rawKey] of Object.entries(options.keys)) {
    const keyId = validateKeyId(rawId.trim());
    if (!(rawKey instanceof Uint8Array) || rawKey.byteLength !== 32) {
      throw new RangeError(`recovery encryption key ${keyId} must be exactly 32 bytes`);
    }
    keys.set(keyId, new Uint8Array(rawKey));
  }
  if (!keys.has(activeKeyId)) throw new Error(`active recovery encryption key is missing: ${activeKeyId}`);
  return { activeKeyId, keys, allowLegacyPlaintext: options.allowLegacyPlaintext === true };
}

function storageFileName(digest: string, storage?: RecoveryStorage): string {
  return storage === undefined ? digest : `${digest}.enc-${storage.keyId}`;
}

function objectPathFor(root: string, digest: string, storage?: RecoveryStorage): string {
  return join(root, 'objects', digest.slice(0, 2), storageFileName(digest, storage));
}

function encryptionAad(digest: string): Buffer {
  return Buffer.from(`furypipe-recovery/v1:${digest}`, 'utf8');
}

function encryptBytes(bytes: Uint8Array, digest: string, key: Uint8Array): Buffer {
  const nonce = randomBytes(ENCRYPTED_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(encryptionAad(digest));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([ENCRYPTED_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptBytes(envelope: Uint8Array, digest: string, keyId: string, key: Uint8Array): Uint8Array {
  const minimum = ENCRYPTED_MAGIC.byteLength + ENCRYPTED_NONCE_BYTES + ENCRYPTED_TAG_BYTES;
  if (envelope.byteLength < minimum || !Buffer.from(envelope.subarray(0, ENCRYPTED_MAGIC.byteLength)).equals(ENCRYPTED_MAGIC)) {
    throw new Error('recovery encrypted object envelope is invalid');
  }
  const nonceStart = ENCRYPTED_MAGIC.byteLength;
  const tagStart = nonceStart + ENCRYPTED_NONCE_BYTES;
  const ciphertextStart = tagStart + ENCRYPTED_TAG_BYTES;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(nonceStart, tagStart));
    decipher.setAAD(encryptionAad(digest));
    decipher.setAuthTag(envelope.subarray(tagStart, ciphertextStart));
    return new Uint8Array(Buffer.concat([decipher.update(envelope.subarray(ciphertextStart)), decipher.final()]));
  } catch {
    throw new Error(`recovery encrypted object cannot be opened with key ${keyId}`);
  }
}

function manifestStorage(value: unknown): RecoveryStorage | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('recovery manifest storage is invalid');
  const storage = value as Record<string, unknown>;
  if (storage.format !== 'aes-256-gcm/v1' || typeof storage.keyId !== 'string') throw new Error('recovery manifest storage is invalid');
  return { format: storage.format, keyId: validateKeyId(storage.keyId) };
}

function normalizeManifest(value: unknown): RecoveryHandle & { metadata?: RecoveryMetadata } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('recovery manifest is invalid');
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== 'furypipe-recovery/v1' || manifest.algorithm !== 'sha256'
    || typeof manifest.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(manifest.digest)
    || typeof manifest.bytes !== 'number' || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 0) {
    throw new Error('recovery manifest is invalid');
  }
  const metadata = manifest.metadata === undefined ? undefined : manifest.metadata as RecoveryMetadata;
  const storage = manifestStorage(manifest.storage);
  return makeHandle(manifest.digest, manifest.bytes, metadata, storage);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  try {
    await chmod(path, 0o700);
  } catch {
    // Windows ACLs are host-managed; chmod there only toggles the read-only bit.
  }
}

async function writePrivateFile(path: string, data: string | Uint8Array, flag: 'w' | 'wx' = 'w'): Promise<void> {
  const file = await open(path, flag, 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows ACLs are host-managed; see the explicit security documentation.
  }
}

interface RecoveryLockRecord {
  readonly token: string;
  readonly pid: number;
  readonly createdAt: string;
}

function isErrno(caught: unknown, code: string): boolean {
  return caught instanceof Error && (caught as NodeJS.ErrnoException).code === code;
}

function waitForRecoveryLock(): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, RECOVERY_LOCK_RETRY_MS));
}

/**
 * Acquire a root-wide inter-process lock using exclusive file creation.
 * A bounded stale-lock lease makes a process crash recoverable without an
 * unbounded retry or a forced deletion of a live lock.
 */
async function acquireRecoveryLock(storeRoot: string): Promise<() => Promise<void>> {
  await ensurePrivateDirectory(storeRoot);
  const lockPath = join(storeRoot, RECOVERY_LOCK_FILE);
  const token = randomUUID();
  const startedAt = Date.now();
  const record: RecoveryLockRecord = { token, pid: process.pid, createdAt: new Date().toISOString() };

  while (Date.now() - startedAt < RECOVERY_LOCK_WAIT_MS) {
    try {
      const file = await open(lockPath, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(record) + '\n');
        await file.sync();
      } catch (error) {
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      } finally {
        await file.close();
      }
      try {
        await chmod(lockPath, 0o600);
      } catch {
        // Windows ACLs are host-managed; see the explicit security documentation.
      }

      const heartbeat = setInterval(() => {
        void utimes(lockPath, new Date(), new Date()).catch(() => undefined);
      }, RECOVERY_LOCK_HEARTBEAT_MS);
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<RecoveryLockRecord>;
          if (current.token === token) await rm(lockPath, { force: true });
        } catch (caught) {
          if (!isErrno(caught, 'ENOENT')) throw caught;
        }
      };
    } catch (caught) {
      if (!isErrno(caught, 'EEXIST')) throw caught;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs >= RECOVERY_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (isErrno(statError, 'ENOENT')) continue;
        throw statError;
      }
      await waitForRecoveryLock();
    }
  }
  throw new Error('recovery store lock acquisition timed out');
}

async function writeExclusiveAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writePrivateFile(temporary, data, 'wx');
    try {
      // A hard link publishes the fully fsynced temporary file without
      // replacing an object or manifest that another writer already created.
      await link(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Replace a manifest while leaving a recoverable backup if the process stops between renames. */
async function replaceManifestAtomic(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const backup = `${path}${MANIFEST_BACKUP_MARKER}${randomUUID()}`;
  await writePrivateFile(temporary, data, 'wx');
  try {
    await rename(path, backup);
    try {
      await rename(temporary, path);
    } catch (error) {
      if (!(await exists(path)) && await exists(backup)) await rename(backup, path);
      throw error;
    }
    await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (!(await exists(path)) && await exists(backup)) {
      await rename(backup, path).catch(() => undefined);
    }
    throw error;
  }
}

const RECOVERY_TEMP_FILE = /\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u;

async function cleanupRecoveryTemporaryFiles(root: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (caught) {
    if (isErrno(caught, 'ENOENT')) return 0;
    throw caught;
  }

  let removed = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      removed += await cleanupRecoveryTemporaryFiles(path);
      continue;
    }
    if (entry.isFile() && RECOVERY_TEMP_FILE.test(entry.name)) {
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

async function recoverManifestBackups(manifestRoot: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(manifestRoot);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw caught;
  }
  for (const name of entries) {
    const marker = name.indexOf(MANIFEST_BACKUP_MARKER);
    if (marker < 0) continue;
    const original = join(manifestRoot, name.slice(0, marker));
    const backup = join(manifestRoot, name);
    if (await exists(original)) await rm(backup, { force: true });
    else await rename(backup, original);
  }
}

function objectFileNameForPath(path: string): string {
  return basename(path);
}

function objectFileMatchesDigest(path: string, digest: string): boolean {
  const name = objectFileNameForPath(path);
  return name === digest || name.startsWith(`${digest}.enc-`);
}

function objectDigestFromPath(path: string): string | undefined {
  const match = /^([0-9a-f]{64})(?:\.enc-[A-Za-z0-9._-]+)?$/u.exec(objectFileNameForPath(path));
  return match?.[1];
}

function objectReferenceKey(digest: string, path: string): string {
  return `${digest.slice(0, 2)}/${objectFileNameForPath(path)}`;
}

async function objectVariants(root: string, digest: string): Promise<string[]> {
  const directory = join(root, 'objects', digest.slice(0, 2));
  let entries;
  try {
    entries = await readdir(directory);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw caught;
  }
  return entries.filter((name) => objectFileMatchesDigest(name, digest)).map((name) => join(directory, name));
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
    await ensurePrivateDirectory(destination);
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
          try {
            await chmod(to, 0o600);
          } catch {
            // Windows ACLs are host-managed.
          }
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
 * File-system content-addressed store. SHA-256 and an uncompressed payload are
 * intentional in this portable first slice: Node's standard library has no
 * BLAKE3/zstd API. Encryption is opt-in and uses the host-provided key ring;
 * compression and alternate backends remain explicit follow-up work.
 */
export function createRecoveryStore(root: string, options: RecoveryStoreOptions = {}): RecoveryStore {
  const storeRoot = resolve(root);
  const namespace = options.namespace === undefined ? undefined : validateNamespace(options.namespace.trim());
  const maxObjectBytes = options.maxObjectBytes ?? Number.MAX_SAFE_INTEGER;
  const maxTotalBytes = options.maxTotalBytes ?? Number.MAX_SAFE_INTEGER;
  const maxGlobalBytes = options.maxGlobalBytes ?? Number.MAX_SAFE_INTEGER;
  const encryption = normalizeEncryption(options.encryption);
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 0) throw new RangeError('maxObjectBytes must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) throw new RangeError('maxTotalBytes must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxGlobalBytes) || maxGlobalBytes < 0) throw new RangeError('maxGlobalBytes must be a non-negative safe integer');
  const scopedRoot = namespace ? join(storeRoot, 'namespaces', namespace) : storeRoot;
  async function recoverPendingManifestReplacements(): Promise<void> {
    await recoverManifestBackups(join(scopedRoot, 'manifests'));
    await cleanupRecoveryTemporaryFiles(join(scopedRoot, 'objects'));
    await cleanupRecoveryTemporaryFiles(join(scopedRoot, 'manifests'));
  }
  let readyPromise: Promise<void> | undefined;
  function ensureReady(): Promise<void> {
    readyPromise ??= recoverPendingManifestReplacements();
    return readyPromise;
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = recoveryWriteChains.get(storeRoot) ?? Promise.resolve();
    const next = previous.then(async () => {
      const release = await acquireRecoveryLock(storeRoot);
      try {
        await ensureReady();
        return await operation();
      } finally {
        await release();
      }
    });
    recoveryWriteChains.set(storeRoot, next.then(() => undefined, () => undefined));
    return next;
  }

  async function readManifest(digest: string): Promise<(RecoveryHandle & { metadata?: RecoveryMetadata }) | undefined> {
    try {
      return normalizeManifest(JSON.parse(await readFile(metadataPath(scopedRoot, digest), 'utf8')) as unknown);
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (caught instanceof Error && (caught.message === 'recovery manifest is invalid' || caught.message === 'recovery manifest storage is invalid')) throw caught;
      throw new Error('recovery manifest cannot be read');
    }
  }

  async function readStored(digest: string, manifest?: RecoveryHandle & { metadata?: RecoveryMetadata }, allowLegacyPlaintext = false): Promise<Uint8Array> {
    const storage = manifest?.storage;
    if (storage !== undefined) {
      if (manifest === undefined) throw new Error('recovery encrypted object manifest is missing');
      if (encryption === undefined) throw new Error('recovery encryption key ring is required');
      const key = encryption.keys.get(storage.keyId);
      if (key === undefined) throw new Error(`recovery encryption key is unavailable: ${storage.keyId}`);
      const envelope = new Uint8Array(await readFile(objectPathFor(scopedRoot, digest, storage)));
      const bytes = decryptBytes(envelope, digest, storage.keyId, key);
      if (digestBytes(bytes) !== digest || bytes.byteLength !== manifest.bytes) throw new Error('recovery object integrity check failed');
      return bytes;
    }
    if (encryption !== undefined && !allowLegacyPlaintext && !encryption.allowLegacyPlaintext) {
      throw new Error('recovery object is plaintext; explicit rekey migration is required');
    }
    const bytes = new Uint8Array(await readFile(objectPathFor(scopedRoot, digest)));
    if (digestBytes(bytes) !== digest) throw new Error('recovery object integrity check failed');
    if (manifest !== undefined && bytes.byteLength !== manifest.bytes) throw new Error('recovery object size does not match its manifest');
    return bytes;
  }

  async function writeManifest(path: string, handle: RecoveryHandle): Promise<void> {
    await writeExclusiveAtomic(path, JSON.stringify(handle) + '\n');
  }

  async function verifyScope(): Promise<{ objects: number; manifests: number; bytes: number }> {
    const manifestRoot = join(scopedRoot, 'manifests');
    let entries;
    try {
      entries = await readdir(manifestRoot);
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return { objects: 0, manifests: 0, bytes: 0 };
      throw caught;
    }
    let objects = 0;
    let manifests = 0;
    let bytes = 0;
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const digest = name.slice(0, -'.json'.length);
      if (!/^[0-9a-f]{64}$/u.test(digest)) continue;
      const manifest = await readManifest(digest);
      if (manifest === undefined) continue;
      await readStored(digest, manifest);
      objects += 1;
      manifests += 1;
      bytes += (await stat(objectPathFor(scopedRoot, digest, manifest.storage))).size;
    }
    return { objects, manifests, bytes };
  }

  async function verifyHandle(handle: RecoveryHandle | string): Promise<RecoveryVerification> {
    const digest = parseHandle(handle);
    const manifest = await readManifest(digest);
    const object = objectPathFor(scopedRoot, digest, manifest?.storage);
    if (!(await exists(object))) return { ok: false, handle: `furypipe-recovery/v1/sha256/${digest}`, exists: false, digestMatches: false, bytes: 0, reason: 'object missing' };
    try {
      const bytes = await readStored(digest, manifest);
      return {
        ok: true,
        handle: `furypipe-recovery/v1/sha256/${digest}`,
        exists: true,
        digestMatches: true,
        bytes: bytes.byteLength,
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'recovery object verification failed';
      return {
        ok: false,
        handle: `furypipe-recovery/v1/sha256/${digest}`,
        exists: true,
        digestMatches: false,
        bytes: manifest?.bytes ?? 0,
        reason: message.slice(0, 256),
      };
    }
  }

  async function countMatchingManifests(
    filters: Readonly<Record<string, string | number | boolean | null>>,
    stopAt: number,
  ): Promise<number> {
    const manifestRoot = join(scopedRoot, 'manifests');
    let names: string[];
    try {
      names = (await readdir(manifestRoot)).filter((name) => name.endsWith('.json')).sort();
    } catch (caught) {
      if (isErrno(caught, 'ENOENT')) return 0;
      throw caught;
    }
    let matches = 0;
    for (const name of names) {
      const digest = name.slice(0, -'.json'.length);
      if (!/^[0-9a-f]{64}$/u.test(digest)) continue;
      const manifest = await readManifest(digest);
      if (manifest === undefined) continue;
      const manifestMetadata = manifest.metadata ?? {};
      if (Object.entries(filters).some(([key, value]) => manifestMetadata[key] !== value)) continue;
      matches += 1;
      if (matches >= stopAt) break;
    }
    return matches;
  }

  async function putUnlocked(
    bytes: Uint8Array | ArrayBuffer,
    metadata?: RecoveryMetadata,
    bound?: RecoveryPutBound,
  ): Promise<RecoveryHandle> {
    const view = asUint8Array(bytes);
    if (view.byteLength > maxObjectBytes) throw new Error('recovery object exceeds the configured object quota');
    let capacityBounds: readonly RecoveryCapacityBound[] = [];
    if (bound !== undefined) {
      if (!bound || typeof bound !== 'object'
        || (bound.additionalBounds !== undefined
          && (!Array.isArray(bound.additionalBounds) || bound.additionalBounds.length > 7))) {
        throw new RangeError('recovery bounded put additionalBounds must contain at most 7 constraints');
      }
      capacityBounds = [bound, ...(bound.additionalBounds ?? [])];
      for (const capacityBound of capacityBounds) {
        if (!capacityBound || typeof capacityBound !== 'object'
          || !capacityBound.metadata || typeof capacityBound.metadata !== 'object'
          || Array.isArray(capacityBound.metadata) || !Number.isSafeInteger(capacityBound.maxMatches)
          || capacityBound.maxMatches < 1 || capacityBound.maxMatches > 10_000) {
          throw new RangeError('recovery bounded put maxMatches must be an integer from 1 to 10000');
        }
        if (Object.entries(capacityBound.metadata).some(([key, value]) => metadata?.[key] !== value)) {
          throw new Error('recovery bounded put metadata must satisfy every capacity filter');
        }
      }
    }
    const digest = digestBytes(view);
    const manifestFile = metadataPath(scopedRoot, digest);
    const existingManifest = await readManifest(digest);
    const existingVariants = await objectVariants(scopedRoot, digest);
    const existingStorage = existingManifest?.storage;
    if (existingManifest !== undefined || existingVariants.length > 0) {
      if (existingManifest === undefined) {
        throw new Error('recovery object has no manifest; refusing migration by overwrite');
      }
      const existing = await readStored(digest, existingManifest, true);
      if (digestBytes(existing) !== digest) throw new Error('recovery object integrity check failed');
      if (encryption !== undefined && existingStorage === undefined && !encryption.allowLegacyPlaintext) {
        throw new Error('recovery object is plaintext; explicit rekey migration is required');
      }
      if (capacityBounds.some((capacityBound) =>
        Object.entries(capacityBound.metadata).some(([key, value]) => existingManifest.metadata?.[key] !== value))) {
        throw new Error('recovery bounded put existing object is outside one of its capacity filters');
      }
      return makeHandle(digest, existing.byteLength, existingManifest?.metadata, existingStorage);
    }

    for (const capacityBound of capacityBounds) {
      const matches = await countMatchingManifests(capacityBound.metadata, capacityBound.maxMatches);
      if (matches >= capacityBound.maxMatches) {
        throw new Error('recovery bounded put matching-object limit exceeded');
      }
    }

    const storage: RecoveryStorage | undefined = encryption === undefined
      ? undefined
      : { format: 'aes-256-gcm/v1', keyId: encryption.activeKeyId };
    let stored: Uint8Array;
    if (storage === undefined) {
      stored = view;
    } else {
      const key = encryption?.keys.get(storage.keyId);
      if (key === undefined) throw new Error(`recovery encryption key is unavailable: ${storage.keyId}`);
      stored = encryptBytes(view, digest, key);
    }
    const target = objectPathFor(scopedRoot, digest, storage);
    if ((await totalObjectBytes(join(scopedRoot, 'objects'))) + stored.byteLength > maxTotalBytes) {
      throw new Error('recovery namespace exceeds the configured total quota');
    }
    if ((await globalObjectBytes(storeRoot)) + stored.byteLength > maxGlobalBytes) {
      throw new Error('recovery store exceeds the configured global quota');
    }
    await ensurePrivateDirectory(dirname(target));
    await ensurePrivateDirectory(dirname(manifestFile));
    await writeExclusiveAtomic(target, stored);
    const handle = makeHandle(digest, view.byteLength, metadata, storage);
    try {
      await writeManifest(manifestFile, handle);
    } catch (error) {
      // The object is intentionally left as a GC-visible orphan. A failed
      // manifest write must never pretend the content was committed.
      throw error;
    }
    return handle;
  }

  return {
    put(bytes, metadata) {
      return enqueue(() => putUnlocked(bytes, metadata));
    },

    putBounded(bytes, metadata, bound) {
      return enqueue(() => putUnlocked(bytes, metadata, bound));
    },

    get(handle) {
      return enqueue(async () => {
        const digest = parseHandle(handle);
        return readStored(digest, await readManifest(digest));
      });
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

    verify(handle) {
      return enqueue(async () => verifyHandle(handle));
    },

    manifest(handle) {
      return enqueue(async () => {
        const digest = parseHandle(handle);
        const current = await readManifest(digest);
        if (current !== undefined) return current;
        if (encryption !== undefined) throw new Error('recovery manifest is required when encryption is configured');
        const verification = await verifyHandle(handle);
        if (!verification.exists) throw new Error('recovery manifest and object missing');
        return makeHandle(digest, verification.bytes);
      });
    },

    list(options = {}) {
      return enqueue(async () => {
        const limit = boundedListLimit(options.limit);
        const filters = options.metadata ?? {};
        const manifestRoot = join(scopedRoot, 'manifests');
        let names: string[];
        try {
          names = (await readdir(manifestRoot)).filter((name) => name.endsWith('.json')).sort();
        } catch (caught) {
          if (isErrno(caught, 'ENOENT')) return [];
          throw caught;
        }
        const matches: Array<RecoveryHandle & { metadata?: RecoveryMetadata }> = [];
        for (const name of names) {
          const digest = name.slice(0, -'.json'.length);
          if (!/^[0-9a-f]{64}$/u.test(digest)) continue;
          const manifest = await readManifest(digest);
          if (manifest === undefined) continue;
          const metadata = manifest.metadata ?? {};
          if (Object.entries(filters).some(([key, value]) => metadata[key] !== value)) continue;
          matches.push(manifest);
          if (matches.length >= limit) break;
        }
        return matches;
      });
    },

    delete(handle) {
      return enqueue(async () => {
        const digest = parseHandle(handle);
        const manifest = metadataPath(scopedRoot, digest);
        const variants = await objectVariants(scopedRoot, digest);
        const existed = variants.length > 0 || await exists(manifest);
        await Promise.all(variants.map((variant) => rm(variant, { force: true })));
        await rm(manifest, { force: true });
        return existed;
      });
    },

    gc(now = new Date()) {
      return enqueue(async () => {
        const manifestRoot = join(scopedRoot, 'manifests');
        let expired = 0;
        let orphaned = 0;
        let bytesFreed = 0;
        const referenced = new Set<string>();
        const protectedDigests = new Set<string>();
        try {
          for (const name of await readdir(manifestRoot)) {
            if (!name.endsWith('.json')) continue;
            const digest = name.slice(0, -'.json'.length);
            if (!/^[0-9a-f]{64}$/.test(digest)) continue;
            const file = join(manifestRoot, name);
            let manifest: RecoveryHandle & { metadata?: RecoveryMetadata };
            try {
              manifest = normalizeManifest(JSON.parse(await readFile(file, 'utf8')) as unknown);
            } catch {
              protectedDigests.add(digest);
              continue;
            }
            if (manifest.digest !== digest) {
              protectedDigests.add(digest);
              continue;
            }
            const expiresAt = manifest.metadata?.expiresAt;
            if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) > now.getTime()) {
              referenced.add(objectReferenceKey(digest, objectPathFor(scopedRoot, digest, manifest.storage)));
              continue;
            }
            for (const object of await objectVariants(scopedRoot, digest)) {
              try { bytesFreed += (await stat(object)).size; } catch { /* manifest-only corruption */ }
              await rm(object, { force: true });
            }
            await rm(file, { force: true });
            expired += 1;
          }
        } catch (caught) {
          if (!isErrno(caught, 'ENOENT')) throw caught;
        }
        for (const object of await objectFiles(join(scopedRoot, 'objects'))) {
          const digest = objectDigestFromPath(object);
          if (digest === undefined || protectedDigests.has(digest) || referenced.has(objectReferenceKey(digest, object))) continue;
          bytesFreed += (await stat(object)).size;
          await rm(object, { force: true });
          orphaned += 1;
        }
        return { expired, orphaned, bytesFreed };
      });
    },

    backup(destination) {
      return enqueue(async () => {
        await verifyScope();
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          await ensurePrivateDirectory(temporary);
          const objects = await copyTree(join(scopedRoot, 'objects'), join(temporary, 'objects'), true);
          const manifests = await copyTree(join(scopedRoot, 'manifests'), join(temporary, 'manifests'), true);
          const summary: RecoveryBackupSummary = {
            format: 'furypipe-recovery-backup/v1',
            ...(namespace ? { namespace } : {}),
            objects: objects.files,
            manifests: manifests.files,
            bytes: objects.bytes,
            evidence: 'BACKUP_EXISTS',
          };
          await writePrivateFile(join(temporary, 'backup.json'), JSON.stringify(summary) + '\n', 'wx');
          await ensurePrivateDirectory(dirname(destination));
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
        const parsed = JSON.parse(await readFile(summaryFile, 'utf8')) as Partial<RecoveryBackupSummary>;
        const summary: RecoveryBackupSummary = {
          format: parsed.format as RecoveryBackupSummary['format'],
          ...(parsed.namespace !== undefined ? { namespace: parsed.namespace } : {}),
          objects: parsed.objects ?? -1,
          manifests: parsed.manifests ?? -1,
          bytes: parsed.bytes ?? -1,
          evidence: 'BACKUP_EXISTS',
        };
        if (summary.format !== 'furypipe-recovery-backup/v1'
          || (summary.namespace !== undefined && summary.namespace !== namespace)
          || !Number.isSafeInteger(summary.objects) || summary.objects < 0
          || !Number.isSafeInteger(summary.manifests) || summary.manifests < 0
          || !Number.isSafeInteger(summary.bytes) || summary.bytes < 0
          || (parsed.evidence !== undefined && parsed.evidence !== 'BACKUP_EXISTS')) {
          throw new Error('invalid recovery backup manifest');
        }
        await ensurePrivateDirectory(join(scopedRoot, 'objects'));
        await ensurePrivateDirectory(join(scopedRoot, 'manifests'));
        const objects = await copyTree(join(source, 'objects'), join(scopedRoot, 'objects'), false);
        const manifests = await copyTree(join(source, 'manifests'), join(scopedRoot, 'manifests'), false);
        if (objects.files !== summary.objects || manifests.files !== summary.manifests || objects.bytes !== summary.bytes) {
          throw new Error('recovery backup verification failed');
        }
        await verifyScope();
        return { ...summary, evidence: 'RESTORE_VERIFIED' };
      });
    },

    rekey(targetKeyId) {
      return enqueue(async () => {
        if (encryption === undefined) throw new Error('recovery encryption is not configured');
        const activeKeyId = validateKeyId((targetKeyId ?? encryption.activeKeyId).trim());
        const activeKey = encryption.keys.get(activeKeyId);
        if (activeKey === undefined) throw new Error(`recovery encryption key is unavailable: ${activeKeyId}`);
        const manifestRoot = join(scopedRoot, 'manifests');
        let entries;
        try {
          entries = await readdir(manifestRoot);
        } catch (caught) {
          if (isErrno(caught, 'ENOENT')) {
            return {
              format: 'furypipe-recovery-rekey/v1',
              ...(namespace ? { namespace } : {}),
              activeKeyId,
              scanned: 0,
              migrated: 0,
              alreadyCurrent: 0,
            } satisfies RecoveryRekeySummary;
          }
          throw caught;
        }
        let scanned = 0;
        let migrated = 0;
        let alreadyCurrent = 0;
        for (const name of entries) {
          if (!name.endsWith('.json')) continue;
          const digest = name.slice(0, -'.json'.length);
          if (!/^[0-9a-f]{64}$/u.test(digest)) continue;
          const current = await readManifest(digest);
          if (current === undefined) continue;
          scanned += 1;
          if (current.storage?.keyId === activeKeyId) {
            alreadyCurrent += 1;
            continue;
          }
          const bytes = await readStored(digest, current, true);
          const storage: RecoveryStorage = { format: 'aes-256-gcm/v1', keyId: activeKeyId };
          const target = objectPathFor(scopedRoot, digest, storage);
          const updated = makeHandle(digest, bytes.byteLength, current.metadata, storage);
          await ensurePrivateDirectory(dirname(target));
          if (await exists(target)) {
            await readStored(digest, updated);
          } else {
            const encrypted = encryptBytes(bytes, digest, activeKey);
            if ((await totalObjectBytes(join(scopedRoot, 'objects'))) + encrypted.byteLength > maxTotalBytes) {
              throw new Error('recovery namespace exceeds the configured total quota during rekey');
            }
            if ((await globalObjectBytes(storeRoot)) + encrypted.byteLength > maxGlobalBytes) {
              throw new Error('recovery store exceeds the configured global quota during rekey');
            }
            await writeExclusiveAtomic(target, encrypted);
          }
          await replaceManifestAtomic(metadataPath(scopedRoot, digest), JSON.stringify(updated) + '\n');
          migrated += 1;
        }
        return {
          format: 'furypipe-recovery-rekey/v1',
          ...(namespace ? { namespace } : {}),
          activeKeyId,
          scanned,
          migrated,
          alreadyCurrent,
        } satisfies RecoveryRekeySummary;
      });
    },
  };
}
