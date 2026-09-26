import { createHash } from 'node:crypto';

export const FURY_ARTIFACT_STORE_FORMAT = 'furypipe-artifact-store/v1' as const;
export const FURY_ARTIFACT_EXPORT_FORMAT = 'furypipe-artifact-export/v1' as const;

export type FuryArtifactKind = 'document' | 'image' | 'video' | 'audio' | 'code' | 'data' | 'other';

export interface FuryArtifactWrite {
  readonly artifactId: string;
  readonly label: string;
  readonly kind: FuryArtifactKind;
  readonly mediaType: string;
  readonly payload: string | Uint8Array;
  readonly tags?: readonly string[];
  readonly recordedAt: string;
  readonly provenance?: string;
}

export interface FuryArtifactRevision {
  readonly artifactId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly label: string;
  readonly kind: FuryArtifactKind;
  readonly mediaType: string;
  readonly contentSha256: string;
  readonly byteSize: number;
  readonly tags: readonly string[];
  readonly recordedAt: string;
  readonly provenance?: string;
  readonly restoredFromRevision?: number;
}

export interface FuryArtifactExport {
  readonly format: typeof FURY_ARTIFACT_EXPORT_FORMAT;
  readonly artifact: FuryArtifactRevision;
  readonly payloadBase64: string;
  readonly exportDigestSha256: string;
  readonly filesystemAuthorized: false;
  readonly networkAuthorized: false;
  readonly executionAuthorized: false;
}

export interface FuryArtifactSearch {
  readonly query?: string;
  readonly kind?: FuryArtifactKind;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface FuryArtifactStore {
  readonly format: typeof FURY_ARTIFACT_STORE_FORMAT;
  readonly authority: 'process-local-artifact-store';
  readonly persistenceAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly networkAuthorized: false;
  readonly executionAuthorized: false;
  create(input: FuryArtifactWrite): FuryArtifactRevision;
  revise(artifactId: string, input: Omit<FuryArtifactWrite, 'artifactId' | 'kind' | 'mediaType'>): FuryArtifactRevision;
  restore(artifactId: string, revision: number, recordedAt: string): FuryArtifactRevision;
  get(artifactId: string): FuryArtifactRevision | undefined;
  history(artifactId: string): readonly FuryArtifactRevision[];
  search(input?: FuryArtifactSearch): readonly FuryArtifactRevision[];
  export(artifactId: string, revision?: number): FuryArtifactExport;
}

interface StoredRevision {
  readonly metadata: FuryArtifactRevision;
  readonly payload: Uint8Array;
}

const ARTIFACT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACTS = 1024;
const MAX_REVISIONS = 128;
const MAX_TAGS = 32;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bounded(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }
  return trimmed;
}

function timestamp(value: string): string {
  const normalized = bounded(value, 'recordedAt', 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new Error('recordedAt must be an ISO-8601 UTC timestamp');
  }
  return normalized;
}

function payloadBytes(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error('artifact payload exceeds 8 MiB bound');
  return Uint8Array.from(bytes);
}

function tags(values: readonly string[] | undefined): readonly string[] {
  const source = values ?? [];
  if (!Array.isArray(source) || source.length > MAX_TAGS) throw new Error('artifact tags exceed bound');
  const normalized = source.map((value) => bounded(value, 'artifact tag', 80).toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('artifact tags contain duplicates');
  return Object.freeze([...normalized].sort());
}

function validateKind(kind: FuryArtifactKind): FuryArtifactKind {
  if (!['document','image','video','audio','code','data','other'].includes(kind)) throw new Error('artifact kind is invalid');
  return kind;
}

function makeRevision(input: {
  artifactId: string;
  revision: number;
  label: string;
  kind: FuryArtifactKind;
  mediaType: string;
  payload: Uint8Array;
  tags: readonly string[];
  recordedAt: string;
  provenance?: string;
  restoredFromRevision?: number;
}): FuryArtifactRevision {
  const contentSha256 = sha256(input.payload);
  const revisionId = `${input.artifactId}@${input.revision}:${contentSha256.slice(0,16)}`;
  return Object.freeze({
    artifactId: input.artifactId,
    revision: input.revision,
    revisionId,
    label: input.label,
    kind: input.kind,
    mediaType: input.mediaType,
    contentSha256,
    byteSize: input.payload.byteLength,
    tags: input.tags,
    recordedAt: input.recordedAt,
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
    ...(input.restoredFromRevision === undefined ? {} : { restoredFromRevision: input.restoredFromRevision }),
  });
}

export function createFuryArtifactStore(): FuryArtifactStore {
  const records = new Map<string, StoredRevision[]>();

  const requireId = (artifactId: string): string => {
    if (!ARTIFACT_ID.test(artifactId)) throw new Error('artifactId is invalid');
    return artifactId;
  };

  const append = (artifactId: string, source: {
    label: string;
    kind: FuryArtifactKind;
    mediaType: string;
    payload: Uint8Array;
    tags: readonly string[];
    recordedAt: string;
    provenance?: string;
    restoredFromRevision?: number;
  }): FuryArtifactRevision => {
    const revisions = records.get(artifactId) ?? [];
    if (revisions.length >= MAX_REVISIONS) throw new Error('artifact revision bound reached');
    const metadata = makeRevision({ artifactId, revision: revisions.length + 1, ...source });
    revisions.push(Object.freeze({ metadata, payload: Uint8Array.from(source.payload) }));
    records.set(artifactId, revisions);
    return metadata;
  };

  const store: FuryArtifactStore = {
    format: FURY_ARTIFACT_STORE_FORMAT,
    authority: 'process-local-artifact-store',
    persistenceAuthorized: false,
    filesystemAuthorized: false,
    networkAuthorized: false,
    executionAuthorized: false,

    create(input) {
      const artifactId = requireId(input.artifactId);
      if (records.has(artifactId)) throw new Error('artifact already exists');
      if (records.size >= MAX_ARTIFACTS) throw new Error('artifact store bound reached');
      const mediaType = bounded(input.mediaType, 'mediaType', 160).toLowerCase();
      if (!MEDIA_TYPE.test(mediaType)) throw new Error('mediaType is invalid');
      return append(artifactId, {
        label: bounded(input.label, 'artifact label', 256),
        kind: validateKind(input.kind),
        mediaType,
        payload: payloadBytes(input.payload),
        tags: tags(input.tags),
        recordedAt: timestamp(input.recordedAt),
        ...(input.provenance === undefined ? {} : { provenance: bounded(input.provenance, 'provenance', 512) }),
      });
    },

    revise(artifactId, input) {
      const id = requireId(artifactId);
      const revisions = records.get(id);
      if (!revisions?.length) throw new Error('artifact does not exist');
      const head = revisions[revisions.length - 1]!.metadata;
      return append(id, {
        label: bounded(input.label, 'artifact label', 256),
        kind: head.kind,
        mediaType: head.mediaType,
        payload: payloadBytes(input.payload),
        tags: tags(input.tags),
        recordedAt: timestamp(input.recordedAt),
        ...(input.provenance === undefined ? {} : { provenance: bounded(input.provenance, 'provenance', 512) }),
      });
    },

    restore(artifactId, revision, recordedAt) {
      const id = requireId(artifactId);
      const revisions = records.get(id);
      if (!revisions?.length) throw new Error('artifact does not exist');
      if (!Number.isInteger(revision) || revision < 1 || revision > revisions.length) throw new Error('artifact revision is invalid');
      const target = revisions[revision - 1]!;
      return append(id, {
        label: target.metadata.label,
        kind: target.metadata.kind,
        mediaType: target.metadata.mediaType,
        payload: Uint8Array.from(target.payload),
        tags: target.metadata.tags,
        recordedAt: timestamp(recordedAt),
        ...(target.metadata.provenance === undefined ? {} : { provenance: target.metadata.provenance }),
        restoredFromRevision: revision,
      });
    },

    get(artifactId) {
      const revisions = records.get(requireId(artifactId));
      return revisions?.[revisions.length - 1]?.metadata;
    },

    history(artifactId) {
      const revisions = records.get(requireId(artifactId)) ?? [];
      return Object.freeze(revisions.map((entry) => entry.metadata));
    },

    search(input = {}) {
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('artifact search limit must be 1..100');
      const query = input.query?.trim().toLowerCase() ?? '';
      const requestedTags = tags(input.tags);
      const kind = input.kind === undefined ? undefined : validateKind(input.kind);
      const heads = [...records.values()]
        .map((revisions) => revisions[revisions.length - 1]!.metadata)
        .filter((artifact) => kind === undefined || artifact.kind === kind)
        .filter((artifact) => requestedTags.every((tag) => artifact.tags.includes(tag)))
        .filter((artifact) => !query || `${artifact.artifactId} ${artifact.label} ${artifact.tags.join(' ')}`.toLowerCase().includes(query))
        .sort((a,b) => a.artifactId.localeCompare(b.artifactId))
        .slice(0, limit);
      return Object.freeze(heads);
    },

    export(artifactId, revision) {
      const id = requireId(artifactId);
      const revisions = records.get(id);
      if (!revisions?.length) throw new Error('artifact does not exist');
      const index = revision === undefined ? revisions.length - 1 : revision - 1;
      if (!Number.isInteger(index) || index < 0 || index >= revisions.length) throw new Error('artifact revision is invalid');
      const target = revisions[index]!;
      const payloadBase64 = Buffer.from(target.payload).toString('base64');
      const digestInput = `${target.metadata.revisionId}\0${payloadBase64}`;
      return Object.freeze({
        format: FURY_ARTIFACT_EXPORT_FORMAT,
        artifact: target.metadata,
        payloadBase64,
        exportDigestSha256: createHash('sha256').update(digestInput,'utf8').digest('hex'),
        filesystemAuthorized: false,
        networkAuthorized: false,
        executionAuthorized: false,
      });
    },
  };
  return Object.freeze(store);
}
