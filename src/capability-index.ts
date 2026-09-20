import { createHash } from 'node:crypto';

export const FURY_CAPABILITY_INDEX_ENTRY_FORMAT =
  'furypipe-capability-index-entry/v1' as const;
export const FURY_CAPABILITY_INDEX_SNAPSHOT_FORMAT =
  'furypipe-capability-index-snapshot/v1' as const;

export const FURY_CAPABILITY_INDEX_KINDS = Object.freeze([
  'skill',
  'plugin',
  'mcp-server',
  'mcp-tool',
  'model',
] as const);

export const FURY_CAPABILITY_INDEX_SOURCE_SYSTEMS = Object.freeze([
  'skill-registry',
  'plugin-registry',
  'mcp-host',
  'model-fabric',
  'native-tool',
  'host',
  'other',
] as const);

export const FURY_CAPABILITY_INDEX_TRUST_STATES = Object.freeze([
  'trusted',
  'verified',
  'unverified',
  'blocked',
  'unknown',
] as const);

export const FURY_CAPABILITY_INDEX_LICENSE_STATES = Object.freeze([
  'verified',
  'not-applicable',
  'unknown',
] as const);

export const FURY_CAPABILITY_INDEX_HEALTH_STATES = Object.freeze([
  'ready',
  'degraded',
  'unavailable',
  'blocked',
  'unknown',
] as const);

export const FURY_CAPABILITY_INDEX_RISK_CLASSES = Object.freeze([
  'none',
  'inspect',
  'read',
  'write',
  'process',
  'admin',
  'unknown',
] as const);

export type FuryCapabilityIndexKind =
  (typeof FURY_CAPABILITY_INDEX_KINDS)[number];
export type FuryCapabilityIndexSourceSystem =
  (typeof FURY_CAPABILITY_INDEX_SOURCE_SYSTEMS)[number];
export type FuryCapabilityIndexTrustState =
  (typeof FURY_CAPABILITY_INDEX_TRUST_STATES)[number];
export type FuryCapabilityIndexLicenseState =
  (typeof FURY_CAPABILITY_INDEX_LICENSE_STATES)[number];
export type FuryCapabilityIndexHealthState =
  (typeof FURY_CAPABILITY_INDEX_HEALTH_STATES)[number];
export type FuryCapabilityIndexRiskClass =
  (typeof FURY_CAPABILITY_INDEX_RISK_CLASSES)[number];

export interface FuryCapabilityIndexSource {
  readonly system: FuryCapabilityIndexSourceSystem;
  readonly sourceId: string;
  readonly sourceRevision?: string;
  readonly observedAt?: string;
}

export interface FuryCapabilityIndexEntryInput {
  readonly format: typeof FURY_CAPABILITY_INDEX_ENTRY_FORMAT;
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly families: readonly string[];
  readonly tags: readonly string[];
  readonly keywords: readonly string[];
  readonly trust: FuryCapabilityIndexTrustState;
  readonly license: FuryCapabilityIndexLicenseState;
  readonly health: FuryCapabilityIndexHealthState;
  readonly riskClass: FuryCapabilityIndexRiskClass;
  readonly requiredPermissions: readonly string[];
  readonly compatibility: readonly string[];
  readonly estimatedContextTokens?: number;
  readonly source: FuryCapabilityIndexSource;
}

export interface FuryCapabilityIndexRecord extends FuryCapabilityIndexEntryInput {
  readonly fingerprintSha256: string;
  readonly authority: 'routing-metadata-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilityIndexSnapshot {
  readonly format: typeof FURY_CAPABILITY_INDEX_SNAPSHOT_FORMAT;
  readonly records: readonly FuryCapabilityIndexRecord[];
  readonly count: number;
  readonly metadataBytes: number;
  readonly digestSha256: string;
  readonly authority: 'routing-metadata-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilityIndexOptions {
  readonly maxRecords?: number;
  readonly maxRecordBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface FuryCapabilityIndex {
  upsert(entry: FuryCapabilityIndexEntryInput): FuryCapabilityIndexRecord;
  remove(kind: FuryCapabilityIndexKind, id: string): boolean;
  get(kind: FuryCapabilityIndexKind, id: string): FuryCapabilityIndexRecord | undefined;
  list(kind?: FuryCapabilityIndexKind): readonly FuryCapabilityIndexRecord[];
  snapshot(): FuryCapabilityIndexSnapshot;
  size(): number;
  metadataBytes(): number;
}

interface StoredCapability {
  readonly record: FuryCapabilityIndexRecord;
  readonly bytes: number;
}

const DEFAULT_MAX_RECORDS = 20_000;
const HARD_MAX_RECORDS = 100_000;
const DEFAULT_MAX_RECORD_BYTES = 16 * 1024;
const HARD_MAX_RECORD_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

const MAX_ID_CHARS = 256;
const MAX_NAME_CHARS = 256;
const MAX_DESCRIPTION_CHARS = 4_096;
const MAX_SOURCE_ID_CHARS = 512;
const MAX_SOURCE_REVISION_CHARS = 512;
const MAX_FAMILIES = 24;
const MAX_TAGS = 48;
const MAX_KEYWORDS = 64;
const MAX_PERMISSIONS = 32;
const MAX_COMPATIBILITY = 48;
const MAX_METADATA_ITEM_CHARS = 128;
const MAX_KEYWORD_CHARS = 160;
const MAX_ESTIMATED_CONTEXT_TOKENS = 10_000_000;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,127}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu,
]);

const KINDS = new Set<string>(FURY_CAPABILITY_INDEX_KINDS);
const SOURCE_SYSTEMS = new Set<string>(FURY_CAPABILITY_INDEX_SOURCE_SYSTEMS);
const TRUST_STATES = new Set<string>(FURY_CAPABILITY_INDEX_TRUST_STATES);
const LICENSE_STATES = new Set<string>(FURY_CAPABILITY_INDEX_LICENSE_STATES);
const HEALTH_STATES = new Set<string>(FURY_CAPABILITY_INDEX_HEALTH_STATES);
const RISK_CLASSES = new Set<string>(FURY_CAPABILITY_INDEX_RISK_CLASSES);

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return resolved;
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new TypeError(`${label} contains unsupported or unsafe fields`);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TypeError(`${label} is missing required field: ${key}`);
    }
  }
  return record;
}

function credentialLike(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

function boundedText(
  value: unknown,
  label: string,
  maxChars: number,
  options: {
    readonly allowEmpty?: boolean;
    readonly rejectCredentials?: boolean;
  } = {},
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (
    (!options.allowEmpty && normalized.length === 0)
    || normalized.length > maxChars
    || CONTROL_RE.test(normalized)
  ) {
    throw new RangeError(`${label} must be bounded printable text`);
  }
  if (options.rejectCredentials !== false && credentialLike(normalized)) {
    throw new Error(`${label} contains credential-like material`);
  }
  return normalized;
}

function boundedId(value: unknown, label: string): string {
  const normalized = boundedText(value, label, MAX_ID_CHARS);
  if (!ID_RE.test(normalized)) {
    throw new RangeError(`${label} must be a bounded safe identifier`);
  }
  return normalized;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new TypeError(`${label} is unsupported`);
  }
  return value as T;
}

function canonicalMetadataList(
  value: unknown,
  label: string,
  maxItems: number,
  maxItemChars: number,
  tokenOnly = true,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RangeError(`${label} must contain at most ${maxItems} items`);
  }
  const values = value.map((item) => {
    const normalized = boundedText(item, label, maxItemChars)
      .toLocaleLowerCase('en-US');
    if (tokenOnly && !TOKEN_RE.test(normalized)) {
      throw new RangeError(`${label} contains an invalid metadata token`);
    }
    return normalized;
  });
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return Object.freeze([...values].sort((a, b) => a.localeCompare(b)));
}

function normalizeSource(value: unknown): FuryCapabilityIndexSource {
  const record = exactPlainRecord(
    value,
    ['system', 'sourceId', 'sourceRevision', 'observedAt'],
    ['system', 'sourceId'],
    'capability index source',
  );
  const system = enumValue<FuryCapabilityIndexSourceSystem>(
    record.system,
    SOURCE_SYSTEMS,
    'capability index source.system',
  );
  const sourceId = boundedText(
    record.sourceId,
    'capability index source.sourceId',
    MAX_SOURCE_ID_CHARS,
  );
  const sourceRevision = record.sourceRevision === undefined
    ? undefined
    : boundedText(
        record.sourceRevision,
        'capability index source.sourceRevision',
        MAX_SOURCE_REVISION_CHARS,
      );
  let observedAt: string | undefined;
  if (record.observedAt !== undefined) {
    observedAt = boundedText(
      record.observedAt,
      'capability index source.observedAt',
      64,
      { rejectCredentials: false },
    );
    if (!ISO_DATE_RE.test(observedAt) || Number.isNaN(Date.parse(observedAt))) {
      throw new RangeError('capability index source.observedAt must be an ISO UTC timestamp');
    }
  }
  return Object.freeze({
    system,
    sourceId,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(observedAt === undefined ? {} : { observedAt }),
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalRecordPayload(
  entry: Omit<
    FuryCapabilityIndexRecord,
    'fingerprintSha256' | 'authority' | 'executionAuthority'
  >,
): string {
  return JSON.stringify(entry);
}

function normalizeEntry(
  value: FuryCapabilityIndexEntryInput,
): FuryCapabilityIndexRecord {
  const record = exactPlainRecord(
    value,
    [
      'format',
      'kind',
      'id',
      'name',
      'description',
      'families',
      'tags',
      'keywords',
      'trust',
      'license',
      'health',
      'riskClass',
      'requiredPermissions',
      'compatibility',
      'estimatedContextTokens',
      'source',
    ],
    [
      'format',
      'kind',
      'id',
      'name',
      'description',
      'families',
      'tags',
      'keywords',
      'trust',
      'license',
      'health',
      'riskClass',
      'requiredPermissions',
      'compatibility',
      'source',
    ],
    'capability index entry',
  );
  if (record.format !== FURY_CAPABILITY_INDEX_ENTRY_FORMAT) {
    throw new TypeError('capability index entry format is unsupported');
  }

  const kind = enumValue<FuryCapabilityIndexKind>(
    record.kind,
    KINDS,
    'capability index kind',
  );
  const id = boundedId(record.id, 'capability index id');
  const name = boundedText(record.name, 'capability index name', MAX_NAME_CHARS);
  const description = boundedText(
    record.description,
    'capability index description',
    MAX_DESCRIPTION_CHARS,
  );
  const families = canonicalMetadataList(
    record.families,
    'capability index families',
    MAX_FAMILIES,
    MAX_METADATA_ITEM_CHARS,
  );
  const tags = canonicalMetadataList(
    record.tags,
    'capability index tags',
    MAX_TAGS,
    MAX_METADATA_ITEM_CHARS,
  );
  const keywords = canonicalMetadataList(
    record.keywords,
    'capability index keywords',
    MAX_KEYWORDS,
    MAX_KEYWORD_CHARS,
    false,
  );
  const trust = enumValue<FuryCapabilityIndexTrustState>(
    record.trust,
    TRUST_STATES,
    'capability index trust',
  );
  const license = enumValue<FuryCapabilityIndexLicenseState>(
    record.license,
    LICENSE_STATES,
    'capability index license',
  );
  const health = enumValue<FuryCapabilityIndexHealthState>(
    record.health,
    HEALTH_STATES,
    'capability index health',
  );
  const riskClass = enumValue<FuryCapabilityIndexRiskClass>(
    record.riskClass,
    RISK_CLASSES,
    'capability index riskClass',
  );
  const requiredPermissions = canonicalMetadataList(
    record.requiredPermissions,
    'capability index requiredPermissions',
    MAX_PERMISSIONS,
    MAX_METADATA_ITEM_CHARS,
  );
  const compatibility = canonicalMetadataList(
    record.compatibility,
    'capability index compatibility',
    MAX_COMPATIBILITY,
    MAX_METADATA_ITEM_CHARS,
  );
  let estimatedContextTokens: number | undefined;
  if (record.estimatedContextTokens !== undefined) {
    if (
      !Number.isSafeInteger(record.estimatedContextTokens)
      || (record.estimatedContextTokens as number) < 0
      || (record.estimatedContextTokens as number) > MAX_ESTIMATED_CONTEXT_TOKENS
    ) {
      throw new RangeError(
        `capability index estimatedContextTokens must be an integer from 0 to ${MAX_ESTIMATED_CONTEXT_TOKENS}`,
      );
    }
    estimatedContextTokens = record.estimatedContextTokens as number;
  }
  const source = normalizeSource(record.source);

  const normalized = Object.freeze({
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind,
    id,
    name,
    description,
    families,
    tags,
    keywords,
    trust,
    license,
    health,
    riskClass,
    requiredPermissions,
    compatibility,
    ...(estimatedContextTokens === undefined ? {} : { estimatedContextTokens }),
    source,
  });
  const fingerprintSha256 = sha256(canonicalRecordPayload(normalized));
  if (!SHA256_RE.test(fingerprintSha256)) {
    throw new Error('capability index fingerprint generation failed');
  }
  return Object.freeze({
    ...normalized,
    fingerprintSha256,
    authority: 'routing-metadata-only' as const,
    executionAuthority: false as const,
  });
}

function identity(kind: FuryCapabilityIndexKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function normalizeLookup(
  kind: FuryCapabilityIndexKind,
  id: string,
): { readonly kind: FuryCapabilityIndexKind; readonly id: string } {
  return Object.freeze({
    kind: enumValue<FuryCapabilityIndexKind>(
      kind,
      KINDS,
      'capability index lookup kind',
    ),
    id: boundedId(id, 'capability index lookup id'),
  });
}

function sortedRecords(
  records: Iterable<StoredCapability>,
  kind?: FuryCapabilityIndexKind,
): readonly FuryCapabilityIndexRecord[] {
  const values = [...records]
    .map((item) => item.record)
    .filter((record) => kind === undefined || record.kind === kind)
    .sort((a, b) =>
      a.kind.localeCompare(b.kind)
      || a.id.localeCompare(b.id)
      || a.fingerprintSha256.localeCompare(b.fingerprintSha256));
  return Object.freeze(values);
}

export function createFuryCapabilityIndex(
  options: FuryCapabilityIndexOptions = {},
): FuryCapabilityIndex {
  const maxRecords = boundedInteger(
    options.maxRecords,
    DEFAULT_MAX_RECORDS,
    1,
    HARD_MAX_RECORDS,
    'maxRecords',
  );
  const maxRecordBytes = boundedInteger(
    options.maxRecordBytes,
    DEFAULT_MAX_RECORD_BYTES,
    512,
    HARD_MAX_RECORD_BYTES,
    'maxRecordBytes',
  );
  const maxTotalBytes = boundedInteger(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    maxRecordBytes,
    HARD_MAX_TOTAL_BYTES,
    'maxTotalBytes',
  );

  const records = new Map<string, StoredCapability>();
  let totalBytes = 0;

  return Object.freeze({
    upsert(entry: FuryCapabilityIndexEntryInput): FuryCapabilityIndexRecord {
      const normalized = normalizeEntry(entry);
      const encoded = JSON.stringify(normalized);
      const bytes = Buffer.byteLength(encoded, 'utf8');
      if (bytes > maxRecordBytes) {
        throw new RangeError('capability index record exceeds maxRecordBytes');
      }

      const key = identity(normalized.kind, normalized.id);
      const previous = records.get(key);
      if (!previous && records.size >= maxRecords) {
        throw new RangeError('capability index record capacity exceeded');
      }
      const projectedBytes = totalBytes - (previous?.bytes ?? 0) + bytes;
      if (projectedBytes > maxTotalBytes) {
        throw new RangeError('capability index metadata byte capacity exceeded');
      }

      records.set(key, Object.freeze({ record: normalized, bytes }));
      totalBytes = projectedBytes;
      return normalized;
    },

    remove(kind: FuryCapabilityIndexKind, id: string): boolean {
      const valid = normalizeLookup(kind, id);
      const key = identity(valid.kind, valid.id);
      const previous = records.get(key);
      if (!previous) return false;
      records.delete(key);
      totalBytes -= previous.bytes;
      return true;
    },

    get(kind: FuryCapabilityIndexKind, id: string): FuryCapabilityIndexRecord | undefined {
      const valid = normalizeLookup(kind, id);
      return records.get(identity(valid.kind, valid.id))?.record;
    },

    list(kind?: FuryCapabilityIndexKind): readonly FuryCapabilityIndexRecord[] {
      const validKind = kind === undefined
        ? undefined
        : enumValue<FuryCapabilityIndexKind>(
            kind,
            KINDS,
            'capability index list kind',
          );
      return sortedRecords(records.values(), validKind);
    },

    snapshot(): FuryCapabilityIndexSnapshot {
      const values = sortedRecords(records.values());
      const digestSha256 = sha256(JSON.stringify(
        values.map((record) => [
          record.kind,
          record.id,
          record.fingerprintSha256,
        ]),
      ));
      return Object.freeze({
        format: FURY_CAPABILITY_INDEX_SNAPSHOT_FORMAT,
        records: values,
        count: values.length,
        metadataBytes: totalBytes,
        digestSha256,
        authority: 'routing-metadata-only' as const,
        executionAuthority: false as const,
      });
    },

    size(): number {
      return records.size;
    },

    metadataBytes(): number {
      return totalBytes;
    },
  });
}
