import { createHash } from 'node:crypto';

import {
  FURY_CAPABILITY_INDEX_KINDS,
  type FuryCapabilityIndexKind,
} from './capability-index.js';

export const FURY_CAPABILITY_SIGNAL_FORMAT =
  'furypipe-capability-signal/v1' as const;
export const FURY_CAPABILITY_SIGNAL_SNAPSHOT_FORMAT =
  'furypipe-capability-signal-snapshot/v1' as const;

export const FURY_CAPABILITY_SIGNAL_EVIDENCE_KINDS = Object.freeze([
  'live-probe',
  'transport-result',
  'runtime-observation',
  'completed-operation',
] as const);

export const FURY_CAPABILITY_SIGNAL_HEALTH_STATES = Object.freeze([
  'ready',
  'degraded',
  'unavailable',
  'blocked',
] as const);

export type FuryCapabilitySignalEvidenceKind =
  (typeof FURY_CAPABILITY_SIGNAL_EVIDENCE_KINDS)[number];
export type FuryCapabilitySignalHealth =
  (typeof FURY_CAPABILITY_SIGNAL_HEALTH_STATES)[number];
export type FuryCapabilitySignalStatus = 'fresh' | 'stale' | 'unknown';

export interface FuryCapabilitySignalObservationInput {
  readonly format: typeof FURY_CAPABILITY_SIGNAL_FORMAT;
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly source: string;
  readonly evidenceKind: FuryCapabilitySignalEvidenceKind;
  readonly health?: FuryCapabilitySignalHealth;
  readonly latencyMs?: number;
  readonly observedCostUsd?: number;
  /**
   * Comparable workload/billing basis. Required when observedCostUsd exists.
   * Costs from different bases are never ordered against each other.
   */
  readonly costBasis?: string;
}

export interface FuryCapabilitySignalObservation
  extends FuryCapabilitySignalObservationInput {
  readonly fingerprintSha256: string;
  readonly authority: 'measured-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilitySignalView {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly status: FuryCapabilitySignalStatus;
  readonly observation?: FuryCapabilitySignalObservation;
  readonly authority: 'measured-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilitySignalSnapshotRecord {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly status: 'fresh' | 'stale';
  readonly observation: FuryCapabilitySignalObservation;
  readonly fingerprintSha256: string;
  readonly observedAt: number;
  readonly expiresAt: number;
}

export interface FuryCapabilitySignalSnapshot {
  readonly format: typeof FURY_CAPABILITY_SIGNAL_SNAPSHOT_FORMAT;
  readonly records: readonly FuryCapabilitySignalSnapshotRecord[];
  readonly count: number;
  readonly fresh: number;
  readonly stale: number;
  readonly digestSha256: string;
  readonly authority: 'measured-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilitySignalRegistryOptions {
  readonly maxRecords?: number;
  readonly now?: () => number;
}

export interface FuryCapabilitySignalRegistry {
  observe(
    observation: FuryCapabilitySignalObservationInput,
  ): FuryCapabilitySignalObservation;
  get(
    kind: FuryCapabilityIndexKind,
    id: string,
  ): FuryCapabilitySignalView;
  snapshot(): FuryCapabilitySignalSnapshot;
  remove(kind: FuryCapabilityIndexKind, id: string): boolean;
  size(): number;
}

const SIGNAL_REGISTRY_EVIDENCE = new WeakSet<object>();

const DEFAULT_MAX_RECORDS = 20_000;
const HARD_MAX_RECORDS = 100_000;
const MAX_SOURCE_CHARS = 200;
const MAX_COST_BASIS_CHARS = 200;
const MAX_LATENCY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COST_USD = 1_000_000_000;

const KIND_SET = new Set<string>(FURY_CAPABILITY_INDEX_KINDS);
const EVIDENCE_KIND_SET = new Set<string>(
  FURY_CAPABILITY_SIGNAL_EVIDENCE_KINDS,
);
const HEALTH_SET = new Set<string>(FURY_CAPABILITY_SIGNAL_HEALTH_STATES);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu,
]);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function finiteTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a safe non-negative timestamp`);
  }
  return value as number;
}

function finiteNonNegative(
  value: unknown,
  max: number,
  label: string,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > max
  ) {
    throw new RangeError(`${label} must be finite, non-negative and <= ${max}`);
  }
  return value;
}

function boundedSafeText(
  value: unknown,
  maxChars: number,
  label: string,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length === 0
    || CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    throw new Error(`${label} contains unsafe credential-like material`);
  }
  return normalized;
}

function identity(kind: FuryCapabilityIndexKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function validateIdentity(
  kind: unknown,
  id: unknown,
): {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
} {
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    throw new TypeError('capability signal kind is unsupported');
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new TypeError('capability signal id is invalid');
  }
  return Object.freeze({
    kind: kind as FuryCapabilityIndexKind,
    id,
  });
}

function normalizeObservation(
  value: FuryCapabilitySignalObservationInput,
): FuryCapabilitySignalObservation {
  const record = exactPlainRecord(
    value,
    [
      'format',
      'kind',
      'id',
      'observedAt',
      'expiresAt',
      'source',
      'evidenceKind',
      'health',
      'latencyMs',
      'observedCostUsd',
      'costBasis',
    ],
    [
      'format',
      'kind',
      'id',
      'observedAt',
      'expiresAt',
      'source',
      'evidenceKind',
    ],
    'capability signal observation',
  );
  if (record.format !== FURY_CAPABILITY_SIGNAL_FORMAT) {
    throw new TypeError('capability signal format is unsupported');
  }
  const identityValue = validateIdentity(record.kind, record.id);
  const observedAt = finiteTimestamp(
    record.observedAt,
    'capability signal observedAt',
  );
  const expiresAt = finiteTimestamp(
    record.expiresAt,
    'capability signal expiresAt',
  );
  if (expiresAt <= observedAt) {
    throw new RangeError(
      'capability signal expiresAt must be later than observedAt',
    );
  }
  const source = boundedSafeText(
    record.source,
    MAX_SOURCE_CHARS,
    'capability signal source',
  );
  if (
    typeof record.evidenceKind !== 'string'
    || !EVIDENCE_KIND_SET.has(record.evidenceKind)
  ) {
    throw new TypeError('capability signal evidenceKind is unsupported');
  }
  let health: FuryCapabilitySignalHealth | undefined;
  if (record.health !== undefined) {
    if (typeof record.health !== 'string' || !HEALTH_SET.has(record.health)) {
      throw new TypeError('capability signal health is unsupported');
    }
    health = record.health as FuryCapabilitySignalHealth;
  }
  const latencyMs = record.latencyMs === undefined
    ? undefined
    : finiteNonNegative(
        record.latencyMs,
        MAX_LATENCY_MS,
        'capability signal latencyMs',
      );
  const observedCostUsd = record.observedCostUsd === undefined
    ? undefined
    : finiteNonNegative(
        record.observedCostUsd,
        MAX_COST_USD,
        'capability signal observedCostUsd',
      );
  const costBasis = record.costBasis === undefined
    ? undefined
    : boundedSafeText(
        record.costBasis,
        MAX_COST_BASIS_CHARS,
        'capability signal costBasis',
      );

  if ((observedCostUsd === undefined) !== (costBasis === undefined)) {
    throw new Error(
      'capability signal observedCostUsd and costBasis must be provided together',
    );
  }
  if (
    health === undefined
    && latencyMs === undefined
    && observedCostUsd === undefined
  ) {
    throw new Error(
      'capability signal must contain at least one measured health, latency, or cost signal',
    );
  }

  const normalized = Object.freeze({
    format: FURY_CAPABILITY_SIGNAL_FORMAT,
    kind: identityValue.kind,
    id: identityValue.id,
    observedAt,
    expiresAt,
    source,
    evidenceKind: record.evidenceKind as FuryCapabilitySignalEvidenceKind,
    ...(health === undefined ? {} : { health }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(observedCostUsd === undefined ? {} : { observedCostUsd }),
    ...(costBasis === undefined ? {} : { costBasis }),
  });
  const fingerprintSha256 = sha256(JSON.stringify(normalized));
  return Object.freeze({
    ...normalized,
    fingerprintSha256,
    authority: 'measured-evidence-only' as const,
    executionAuthority: false as const,
  });
}

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Capability signal registry clock is invalid');
  }
  return value;
}

function viewFor(
  observation: FuryCapabilitySignalObservation | undefined,
  kind: FuryCapabilityIndexKind,
  id: string,
  now: number,
): FuryCapabilitySignalView {
  if (!observation) {
    return Object.freeze({
      kind,
      id,
      status: 'unknown' as const,
      authority: 'measured-evidence-only' as const,
      executionAuthority: false as const,
    });
  }
  return Object.freeze({
    kind,
    id,
    status: now < observation.expiresAt ? 'fresh' as const : 'stale' as const,
    observation,
    authority: 'measured-evidence-only' as const,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryCapabilitySignalRegistry(
  value: unknown,
): value is FuryCapabilitySignalRegistry {
  return typeof value === 'object'
    && value !== null
    && SIGNAL_REGISTRY_EVIDENCE.has(value);
}

export function createFuryCapabilitySignalRegistry(
  options: FuryCapabilitySignalRegistryOptions = {},
): FuryCapabilitySignalRegistry {
  const root = exactPlainRecord(
    options,
    ['maxRecords', 'now'],
    [],
    'Capability signal registry options',
  );
  const maxRecords = boundedInteger(
    root.maxRecords as number | undefined,
    DEFAULT_MAX_RECORDS,
    1,
    HARD_MAX_RECORDS,
    'maxRecords',
  );
  if (root.now !== undefined && typeof root.now !== 'function') {
    throw new TypeError('Capability signal registry now must be a function');
  }
  const now = (root.now as (() => number) | undefined) ?? Date.now;
  finiteNow(now);
  const records = new Map<string, FuryCapabilitySignalObservation>();

  const api: FuryCapabilitySignalRegistry = Object.freeze({
    observe(
      observation: FuryCapabilitySignalObservationInput,
    ): FuryCapabilitySignalObservation {
      const normalized = normalizeObservation(observation);
      const key = identity(normalized.kind, normalized.id);
      const previous = records.get(key);
      if (!previous && records.size >= maxRecords) {
        throw new RangeError('Capability signal registry capacity exceeded');
      }
      if (previous) {
        if (normalized.observedAt < previous.observedAt) {
          throw new Error('Capability signal observation is older than current evidence');
        }
        if (
          normalized.observedAt === previous.observedAt
          && normalized.fingerprintSha256 !== previous.fingerprintSha256
        ) {
          throw new Error(
            'Capability signal observation conflicts at the same timestamp',
          );
        }
        if (normalized.fingerprintSha256 === previous.fingerprintSha256) {
          return previous;
        }
      }
      records.set(key, normalized);
      return normalized;
    },

    get(
      kind: FuryCapabilityIndexKind,
      id: string,
    ): FuryCapabilitySignalView {
      const valid = validateIdentity(kind, id);
      return viewFor(
        records.get(identity(valid.kind, valid.id)),
        valid.kind,
        valid.id,
        finiteNow(now),
      );
    },

    snapshot(): FuryCapabilitySignalSnapshot {
      const at = finiteNow(now);
      const values = [...records.values()]
        .sort((a, b) =>
          a.kind.localeCompare(b.kind)
          || a.id.localeCompare(b.id)
          || a.fingerprintSha256.localeCompare(b.fingerprintSha256));
      const snapshotRecords = Object.freeze(values.map((record) =>
        Object.freeze({
          kind: record.kind,
          id: record.id,
          status: at < record.expiresAt ? 'fresh' as const : 'stale' as const,
          observation: record,
          fingerprintSha256: record.fingerprintSha256,
          observedAt: record.observedAt,
          expiresAt: record.expiresAt,
        })));
      const fresh = snapshotRecords.filter((record) =>
        record.status === 'fresh').length;
      const digestSha256 = sha256(JSON.stringify(snapshotRecords.map((record) => [
        record.kind,
        record.id,
        record.status,
        record.fingerprintSha256,
      ])));
      return Object.freeze({
        format: FURY_CAPABILITY_SIGNAL_SNAPSHOT_FORMAT,
        records: snapshotRecords,
        count: snapshotRecords.length,
        fresh,
        stale: snapshotRecords.length - fresh,
        digestSha256,
        authority: 'measured-evidence-only' as const,
        executionAuthority: false as const,
      });
    },

    remove(kind: FuryCapabilityIndexKind, id: string): boolean {
      const valid = validateIdentity(kind, id);
      return records.delete(identity(valid.kind, valid.id));
    },

    size(): number {
      return records.size;
    },
  });

  SIGNAL_REGISTRY_EVIDENCE.add(api);
  return api;
}
