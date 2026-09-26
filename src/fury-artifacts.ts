import { createHash } from 'node:crypto';

export const FURY_ARTIFACT_FORMAT = 'furypipe-artifact/v1' as const;
export const FURY_ARTIFACT_RESTORE_PLAN_FORMAT = 'furypipe-artifact-restore-plan/v1' as const;

export type FuryArtifactKind = 'text' | 'markdown' | 'json' | 'code' | 'image' | 'audio' | 'video' | 'binary-reference';

export interface FuryArtifactVersion {
  readonly version: number;
  readonly createdAt: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentSha256: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface FuryArtifact {
  readonly format: typeof FURY_ARTIFACT_FORMAT;
  readonly id: string;
  readonly kind: FuryArtifactKind;
  readonly title: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly FuryArtifactVersion[];
}

export interface FuryArtifactRestorePlan {
  readonly format: typeof FURY_ARTIFACT_RESTORE_PLAN_FORMAT;
  readonly artifactId: string;
  readonly sourceVersion: number;
  readonly currentVersion: number;
  readonly plannedVersion: number;
  readonly contentSha256: string;
  readonly requiresApproval: true;
  readonly writeAuthorized: false;
  readonly executionAuthorized: false;
}

export interface FuryArtifactStore {
  create(input: {
    readonly id: string;
    readonly kind: FuryArtifactKind;
    readonly title: string;
    readonly projectId: string;
    readonly content: string;
    readonly mediaType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly now: string;
  }): FuryArtifact;
  appendVersion(input: {
    readonly artifactId: string;
    readonly content: string;
    readonly mediaType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly now: string;
  }): FuryArtifact;
  get(id: string): FuryArtifact | undefined;
  list(): readonly FuryArtifact[];
  search(query: string, projectId?: string): readonly FuryArtifact[];
  planRestore(artifactId: string, sourceVersion: number): FuryArtifactRestorePlan;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const KINDS = new Set<FuryArtifactKind>(['text', 'markdown', 'json', 'code', 'image', 'audio', 'video', 'binary-reference']);

function printable(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded printable text`);
  }
  return value;
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('now must be an ISO-compatible timestamp');
  return new Date(parsed).toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function metadata(input: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  const entries = Object.entries(input ?? {});
  if (entries.length > 32) throw new Error('artifact metadata exceeds 32 entries');
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    const k = printable(key, 'artifact metadata key', 64);
    const v = printable(value, 'artifact metadata value', 512);
    out[k] = v;
  }
  return Object.freeze(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))));
}

function buildVersion(
  version: number,
  content: string,
  now: string,
  mediaType = 'text/plain',
  meta?: Readonly<Record<string, string>>,
): FuryArtifactVersion {
  if (!Number.isInteger(version) || version < 1) throw new Error('artifact version must be a positive integer');
  if (typeof content !== 'string' || content.length > 4 * 1024 * 1024) throw new Error('artifact content exceeds 4 MiB');
  const createdAt = iso(now);
  const normalizedMediaType = printable(mediaType, 'artifact mediaType', 128).toLowerCase();
  return Object.freeze({
    version,
    createdAt,
    mediaType: normalizedMediaType,
    byteLength: Buffer.byteLength(content, 'utf8'),
    contentSha256: sha256(content),
    content,
    metadata: metadata(meta),
  });
}

function cloneArtifact(artifact: FuryArtifact): FuryArtifact {
  return Object.freeze({
    ...artifact,
    versions: Object.freeze([...artifact.versions]),
  });
}

export function createFuryArtifactStore(initial: readonly FuryArtifact[] = []): FuryArtifactStore {
  const artifacts = new Map<string, FuryArtifact>();

  const putInitial = (artifact: FuryArtifact): void => {
    if (artifact.format !== FURY_ARTIFACT_FORMAT) throw new Error('artifact format is invalid');
    if (!ID.test(artifact.id)) throw new Error('artifact id is invalid');
    if (!KINDS.has(artifact.kind)) throw new Error('artifact kind is invalid');
    if (artifacts.has(artifact.id)) throw new Error(`artifact already exists: ${artifact.id}`);
    if (artifact.versions.length < 1 || artifact.versions.length > 256) throw new Error('artifact version history is invalid');
    artifacts.set(artifact.id, cloneArtifact(artifact));
  };

  for (const artifact of initial) putInitial(artifact);

  return Object.freeze({
    create(input) {
      if (!ID.test(input.id)) throw new Error('artifact id is invalid');
      if (!KINDS.has(input.kind)) throw new Error('artifact kind is invalid');
      if (artifacts.has(input.id)) throw new Error(`artifact already exists: ${input.id}`);
      const createdAt = iso(input.now);
      const artifact: FuryArtifact = Object.freeze({
        format: FURY_ARTIFACT_FORMAT,
        id: input.id,
        kind: input.kind,
        title: printable(input.title, 'artifact title', 256),
        projectId: printable(input.projectId, 'artifact projectId', 256),
        createdAt,
        updatedAt: createdAt,
        versions: Object.freeze([buildVersion(1, input.content, input.now, input.mediaType, input.metadata)]),
      });
      artifacts.set(input.id, artifact);
      return artifact;
    },

    appendVersion(input) {
      const current = artifacts.get(input.artifactId);
      if (!current) throw new Error(`unknown artifact: ${input.artifactId}`);
      if (current.versions.length >= 256) throw new Error('artifact version history limit reached');
      const version = buildVersion(current.versions.length + 1, input.content, input.now, input.mediaType, input.metadata);
      const updated: FuryArtifact = Object.freeze({
        ...current,
        updatedAt: version.createdAt,
        versions: Object.freeze([...current.versions, version]),
      });
      artifacts.set(current.id, updated);
      return updated;
    },

    get(id) {
      return artifacts.get(id);
    },

    list() {
      return Object.freeze([...artifacts.values()].sort((a, b) => a.id.localeCompare(b.id)));
    },

    search(query, projectId) {
      const needle = printable(query.trim(), 'artifact search query', 512).toLowerCase();
      return Object.freeze([...artifacts.values()]
        .filter((artifact) => projectId === undefined || artifact.projectId === projectId)
        .filter((artifact) => {
          const latest = artifact.versions.at(-1);
          return artifact.id.toLowerCase().includes(needle)
            || artifact.title.toLowerCase().includes(needle)
            || artifact.kind.includes(needle)
            || latest?.content.toLowerCase().includes(needle) === true
            || Object.entries(latest?.metadata ?? {}).some(([key, value]) => key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle));
        })
        .sort((a, b) => a.id.localeCompare(b.id)));
    },

    planRestore(artifactId, sourceVersion) {
      const artifact = artifacts.get(artifactId);
      if (!artifact) throw new Error(`unknown artifact: ${artifactId}`);
      if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > artifact.versions.length) {
        throw new Error('sourceVersion is outside artifact history');
      }
      const source = artifact.versions[sourceVersion - 1];
      if (!source) throw new Error('sourceVersion is unavailable');
      return Object.freeze({
        format: FURY_ARTIFACT_RESTORE_PLAN_FORMAT,
        artifactId,
        sourceVersion,
        currentVersion: artifact.versions.length,
        plannedVersion: artifact.versions.length + 1,
        contentSha256: source.contentSha256,
        requiresApproval: true,
        writeAuthorized: false,
        executionAuthorized: false,
      });
    },
  });
}
