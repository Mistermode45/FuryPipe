import { createHash } from 'node:crypto';

import { createRecoveryStore, type RecoveryHandle, type RecoveryMetadata, type RecoveryStore } from './core/recovery-store.js';
import {
  FURY_ARTIFACT_FORMAT,
  createFuryArtifactStore,
  type FuryArtifact,
  type FuryArtifactKind,
  type FuryArtifactRestorePlan,
  type FuryArtifactStore,
  type FuryArtifactVersion,
} from './fury-artifacts.js';

export const FURY_ARTIFACT_RECORD_FORMAT = 'furypipe-artifact-record/v1' as const;
export const FURY_ARTIFACT_EXPORT_FORMAT = 'furypipe-artifact-export/v1' as const;
export const FURY_ARTIFACT_RESTORE_RECEIPT_FORMAT = 'furypipe-artifact-restore-receipt/v1' as const;

export interface FuryArtifactExport {
  readonly format: typeof FURY_ARTIFACT_EXPORT_FORMAT;
  readonly projectId: string;
  readonly artifacts: readonly FuryArtifact[];
  readonly bytes: number;
  readonly exportDigestSha256: string;
  readonly executionAuthorized: false;
}

export interface FuryArtifactRestoreReceipt {
  readonly format: typeof FURY_ARTIFACT_RESTORE_RECEIPT_FORMAT;
  readonly artifactId: string;
  readonly sourceVersion: number;
  readonly previousVersion: number;
  readonly restoredVersion: number;
  readonly contentSha256: string;
  readonly persistedDigestSha256: string;
  readonly operatorConfirmed: true;
  readonly writePerformed: true;
  readonly executionAuthorized: false;
}

export interface FuryArtifactRepository {
  create(input: {
    readonly id: string;
    readonly kind: FuryArtifactKind;
    readonly title: string;
    readonly content: string;
    readonly mediaType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly now: string;
  }): Promise<FuryArtifact>;
  appendVersion(input: {
    readonly artifactId: string;
    readonly content: string;
    readonly mediaType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly now: string;
  }): Promise<FuryArtifact>;
  get(id: string): Promise<FuryArtifact | undefined>;
  list(): Promise<readonly FuryArtifact[]>;
  search(query: string): Promise<readonly FuryArtifact[]>;
  planRestore(artifactId: string, sourceVersion: number): Promise<FuryArtifactRestorePlan>;
  executeRestore(input: {
    readonly plan: FuryArtifactRestorePlan;
    readonly confirm: true;
    readonly now: string;
  }): Promise<FuryArtifactRestoreReceipt>;
  exportProject(): Promise<FuryArtifactExport>;
}

interface FuryArtifactPersistedRecord {
  readonly format: typeof FURY_ARTIFACT_RECORD_FORMAT;
  readonly artifact: {
    readonly id: string;
    readonly kind: FuryArtifactKind;
    readonly title: string;
    readonly projectId: string;
    readonly createdAt: string;
  };
  readonly version: FuryArtifactVersion;
}

const ARTIFACT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const KINDS = new Set<FuryArtifactKind>(['text', 'markdown', 'json', 'code', 'image', 'audio', 'video', 'binary-reference']);
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_RECORDS_PER_PROJECT = 10_000;
const MAX_RECORDS_PER_ARTIFACT = 256;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function printable(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be bounded printable text');
  }
  return value;
}

function normalizedIso(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(label + ' must be an ISO timestamp');
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(label + ' must be an ISO timestamp');
  const normalized = new Date(time).toISOString();
  if (normalized !== value) throw new Error(label + ' must be normalized ISO');
  return normalized;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Readonly<Record<string, unknown>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function validateMetadata(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('artifact metadata is invalid');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) throw new Error('artifact metadata exceeds 32 entries');
  const normalized: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const k = printable(key, 'artifact metadata key', 64);
    normalized[k] = printable(raw, 'artifact metadata value', 512);
  }
  return Object.freeze(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
}

function validateVersion(value: unknown, expectedVersion: number): FuryArtifactVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('artifact version record is invalid');
  const raw = value as Record<string, unknown>;
  if (raw.version !== expectedVersion) throw new Error('artifact version history is not contiguous');
  const createdAt = normalizedIso(raw.createdAt, 'artifact version createdAt');
  const mediaType = printable(raw.mediaType, 'artifact mediaType', 128);
  if (mediaType !== mediaType.toLowerCase()) throw new Error('artifact mediaType must be normalized lowercase');
  if (typeof raw.content !== 'string' || raw.content.length > 4 * 1024 * 1024) throw new Error('artifact content exceeds 4 MiB');
  const bytes = Buffer.byteLength(raw.content, 'utf8');
  if (raw.byteLength !== bytes) throw new Error('artifact byteLength does not match content');
  const contentSha256 = sha256(raw.content);
  if (raw.contentSha256 !== contentSha256 || !SHA256.test(contentSha256)) throw new Error('artifact content digest does not match content');
  return Object.freeze({
    version: expectedVersion,
    createdAt,
    mediaType,
    byteLength: bytes,
    contentSha256,
    content: raw.content,
    metadata: validateMetadata(raw.metadata),
  });
}

function parseRecord(bytes: Uint8Array): FuryArtifactPersistedRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('artifact persisted record is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('artifact persisted record is invalid');
  const record = raw as Record<string, unknown>;
  if (record.format !== FURY_ARTIFACT_RECORD_FORMAT || !record.artifact || typeof record.artifact !== 'object' || Array.isArray(record.artifact)) {
    throw new Error('artifact persisted record format is invalid');
  }
  const artifact = record.artifact as Record<string, unknown>;
  const id = printable(artifact.id, 'artifact id', 128);
  if (!ARTIFACT_ID.test(id)) throw new Error('artifact id is invalid');
  if (typeof artifact.kind !== 'string' || !KINDS.has(artifact.kind as FuryArtifactKind)) throw new Error('artifact kind is invalid');
  const projectId = printable(artifact.projectId, 'artifact projectId', 256);
  const title = printable(artifact.title, 'artifact title', 256);
  const createdAt = normalizedIso(artifact.createdAt, 'artifact createdAt');
  const versionNumber = (record.version as Record<string, unknown> | undefined)?.version;
  if (!Number.isInteger(versionNumber) || Number(versionNumber) < 1 || Number(versionNumber) > MAX_RECORDS_PER_ARTIFACT) {
    throw new Error('artifact persisted version number is invalid');
  }
  const version = validateVersion(record.version, Number(versionNumber));
  return Object.freeze({
    format: FURY_ARTIFACT_RECORD_FORMAT,
    artifact: Object.freeze({ id, kind: artifact.kind as FuryArtifactKind, title, projectId, createdAt }),
    version,
  });
}

function buildArtifact(records: readonly FuryArtifactPersistedRecord[]): FuryArtifact {
  if (records.length < 1 || records.length > MAX_RECORDS_PER_ARTIFACT) throw new Error('artifact persisted history is invalid');
  const first = records[0]!;
  const versions = records.map((record, index) => {
    if (record.artifact.id !== first.artifact.id
      || record.artifact.kind !== first.artifact.kind
      || record.artifact.title !== first.artifact.title
      || record.artifact.projectId !== first.artifact.projectId
      || record.artifact.createdAt !== first.artifact.createdAt) {
      throw new Error('artifact persisted records disagree on immutable metadata');
    }
    if (record.version.version !== index + 1) throw new Error('artifact persisted history has a gap');
    return record.version;
  });
  if (versions[0]!.createdAt !== first.artifact.createdAt) throw new Error('artifact createdAt does not match version 1');
  const artifact: FuryArtifact = Object.freeze({
    format: FURY_ARTIFACT_FORMAT,
    id: first.artifact.id,
    kind: first.artifact.kind,
    title: first.artifact.title,
    projectId: first.artifact.projectId,
    createdAt: first.artifact.createdAt,
    updatedAt: versions.at(-1)!.createdAt,
    versions: Object.freeze(versions),
  });
  createFuryArtifactStore([artifact]);
  return artifact;
}

function recordFor(artifact: FuryArtifact): FuryArtifactPersistedRecord {
  const version = artifact.versions.at(-1);
  if (!version) throw new Error('artifact has no current version');
  return Object.freeze({
    format: FURY_ARTIFACT_RECORD_FORMAT,
    artifact: Object.freeze({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      projectId: artifact.projectId,
      createdAt: artifact.createdAt,
    }),
    version,
  });
}

function recordMetadata(projectId: string, artifactId: string, version: number): RecoveryMetadata {
  return Object.freeze({
    recordFormat: FURY_ARTIFACT_RECORD_FORMAT,
    projectId,
    artifactId,
    version,
  });
}

function comparePlan(a: FuryArtifactRestorePlan, b: FuryArtifactRestorePlan): boolean {
  return a.format === b.format
    && a.artifactId === b.artifactId
    && a.sourceVersion === b.sourceVersion
    && a.currentVersion === b.currentVersion
    && a.plannedVersion === b.plannedVersion
    && a.contentSha256 === b.contentSha256
    && a.requiresApproval === true
    && a.writeAuthorized === false
    && a.executionAuthorized === false;
}

export function createFuryArtifactRepository(options: {
  readonly root: string;
  readonly projectId: string;
  readonly recovery?: RecoveryStore;
}): FuryArtifactRepository {
  const projectId = printable(options.projectId, 'artifact repository projectId', 256);
  const recovery = options.recovery ?? createRecoveryStore(options.root, {
    namespace: 'artifacts',
    maxObjectBytes: 5 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
  });
  if (!recovery.list || !recovery.putBounded) throw new Error('artifact repository requires RecoveryStore list and putBounded support');

  let store: FuryArtifactStore | undefined;
  let loadPromise: Promise<void> | undefined;
  let writeChain = Promise.resolve();

  const load = async (): Promise<void> => {
    const handles = await recovery.list!({
      metadata: { recordFormat: FURY_ARTIFACT_RECORD_FORMAT, projectId },
      limit: MAX_RECORDS_PER_PROJECT,
    });
    const byArtifact = new Map<string, Map<number, RecoveryHandle>>();
    for (const handle of handles) {
      const artifactId = handle.metadata?.artifactId;
      const version = handle.metadata?.version;
      if (typeof artifactId !== 'string' || !ARTIFACT_ID.test(artifactId)
        || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_RECORDS_PER_ARTIFACT) {
        throw new Error('artifact recovery metadata is invalid');
      }
      const versions = byArtifact.get(artifactId) ?? new Map<number, RecoveryHandle>();
      const existing = versions.get(version);
      if (existing && existing.digest !== handle.digest) throw new Error('artifact recovery history contains conflicting versions');
      versions.set(version, handle);
      byArtifact.set(artifactId, versions);
    }

    const artifacts: FuryArtifact[] = [];
    for (const artifactId of [...byArtifact.keys()].sort()) {
      const versions = byArtifact.get(artifactId)!;
      const records: FuryArtifactPersistedRecord[] = [];
      for (let version = 1; version <= versions.size; version += 1) {
        const handle = versions.get(version);
        if (!handle) throw new Error('artifact recovery history has a gap');
        const record = parseRecord(await recovery.get(handle));
        if (record.artifact.projectId !== projectId || record.artifact.id !== artifactId || record.version.version !== version) {
          throw new Error('artifact recovery metadata does not match persisted content');
        }
        records.push(record);
      }
      artifacts.push(buildArtifact(records));
    }
    store = createFuryArtifactStore(artifacts);
  };

  const ensureLoaded = async (): Promise<FuryArtifactStore> => {
    loadPromise ??= load();
    await loadPromise;
    if (!store) throw new Error('artifact repository failed to initialize');
    return store;
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(operation, operation);
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const persistCurrent = async (artifact: FuryArtifact): Promise<RecoveryHandle> => {
    const record = recordFor(artifact);
    const bytes = Buffer.from(JSON.stringify(record), 'utf8');
    const metadata = recordMetadata(projectId, artifact.id, record.version.version);
    return recovery.putBounded!(bytes, metadata, {
      metadata: { recordFormat: FURY_ARTIFACT_RECORD_FORMAT, projectId },
      maxMatches: MAX_RECORDS_PER_PROJECT,
      additionalBounds: [
        {
          metadata: { recordFormat: FURY_ARTIFACT_RECORD_FORMAT, projectId, artifactId: artifact.id },
          maxMatches: MAX_RECORDS_PER_ARTIFACT,
        },
        {
          metadata: { recordFormat: FURY_ARTIFACT_RECORD_FORMAT, projectId, artifactId: artifact.id, version: record.version.version },
          maxMatches: 1,
        },
      ],
    });
  };

  return Object.freeze({
    create(input: {
      readonly id: string;
      readonly kind: FuryArtifactKind;
      readonly title: string;
      readonly content: string;
      readonly mediaType?: string;
      readonly metadata?: Readonly<Record<string, string>>;
      readonly now: string;
    }) {
      return enqueue(async () => {
        const current = await ensureLoaded();
        const artifact = current.create({ ...input, projectId });
        try {
          await persistCurrent(artifact);
        } catch (error) {
          loadPromise = undefined;
          store = undefined;
          throw error;
        }
        return artifact;
      });
    },

    appendVersion(input: {
      readonly artifactId: string;
      readonly content: string;
      readonly mediaType?: string;
      readonly metadata?: Readonly<Record<string, string>>;
      readonly now: string;
    }) {
      return enqueue(async () => {
        const current = await ensureLoaded();
        const artifact = current.appendVersion(input);
        try {
          await persistCurrent(artifact);
        } catch (error) {
          loadPromise = undefined;
          store = undefined;
          throw error;
        }
        return artifact;
      });
    },

    async get(id: string) {
      await writeChain;
      return (await ensureLoaded()).get(id);
    },

    async list() {
      await writeChain;
      return (await ensureLoaded()).list();
    },

    async search(query: string) {
      await writeChain;
      return (await ensureLoaded()).search(query, projectId);
    },

    async planRestore(artifactId: string, sourceVersion: number) {
      await writeChain;
      return (await ensureLoaded()).planRestore(artifactId, sourceVersion);
    },

    executeRestore(input: {
      readonly plan: FuryArtifactRestorePlan;
      readonly confirm: true;
      readonly now: string;
    }) {
      return enqueue(async () => {
        if (input.confirm !== true) throw new Error('artifact restore requires explicit confirmation');
        const current = await ensureLoaded();
        const expected = current.planRestore(input.plan.artifactId, input.plan.sourceVersion);
        if (!comparePlan(input.plan, expected)) throw new Error('artifact restore plan is stale or forged');
        const artifact = current.get(expected.artifactId);
        const source = artifact?.versions[expected.sourceVersion - 1];
        if (!artifact || !source) throw new Error('artifact restore source is unavailable');
        const restored = current.appendVersion({
          artifactId: artifact.id,
          content: source.content,
          mediaType: source.mediaType,
          metadata: Object.freeze({
            ...source.metadata,
            restoredFromVersion: String(source.version),
          }),
          now: input.now,
        });
        let handle: RecoveryHandle;
        try {
          handle = await persistCurrent(restored);
        } catch (error) {
          loadPromise = undefined;
          store = undefined;
          throw error;
        }
        return Object.freeze({
          format: FURY_ARTIFACT_RESTORE_RECEIPT_FORMAT,
          artifactId: artifact.id,
          sourceVersion: source.version,
          previousVersion: expected.currentVersion,
          restoredVersion: restored.versions.length,
          contentSha256: source.contentSha256,
          persistedDigestSha256: handle.digest,
          operatorConfirmed: true,
          writePerformed: true,
          executionAuthorized: false,
        });
      });
    },

    async exportProject() {
      await writeChain;
      const artifacts = (await ensureLoaded()).list();
      const payload = Object.freeze({
        format: FURY_ARTIFACT_EXPORT_FORMAT,
        projectId,
        artifacts,
      });
      const encoded = canonical(payload);
      return Object.freeze({
        ...payload,
        bytes: Buffer.byteLength(encoded, 'utf8'),
        exportDigestSha256: sha256(encoded),
        executionAuthorized: false,
      });
    },
  });
}
