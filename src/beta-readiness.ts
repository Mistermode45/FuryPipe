import { createHash } from 'node:crypto';

export const FURY_BETA_READINESS_SUBSYSTEM_FORMAT = 'furypipe-beta-readiness-subsystem/v1' as const;
export const FURY_BETA_READINESS_SNAPSHOT_FORMAT = 'furypipe-beta-readiness-snapshot/v1' as const;

export const FURY_BETA_READINESS_STATES = Object.freeze([
  'ready', 'degraded', 'unconfigured', 'unavailable', 'blocked', 'unsupported',
] as const);

export const FURY_BETA_READINESS_DIMENSION_STATES = Object.freeze([
  ...FURY_BETA_READINESS_STATES,
  'unknown',
  'not-applicable',
] as const);

export type FuryBetaReadinessState = (typeof FURY_BETA_READINESS_STATES)[number];
export type FuryBetaReadinessDimensionState = (typeof FURY_BETA_READINESS_DIMENSION_STATES)[number];
export type FuryBetaReadinessRequirement = 'required' | 'optional';
export type FuryBetaReadinessOverallStatus = 'ready' | 'degraded' | 'blocked';

export interface FuryBetaReadinessDimensions {
  readonly discovery: FuryBetaReadinessDimensionState;
  readonly compatibility: FuryBetaReadinessDimensionState;
  readonly health: FuryBetaReadinessDimensionState;
  readonly policy: FuryBetaReadinessDimensionState;
  readonly authentication: FuryBetaReadinessDimensionState;
  readonly connection: FuryBetaReadinessDimensionState;
  readonly executionAuthority: FuryBetaReadinessDimensionState;
}

export interface FuryBetaReadinessSubsystemInput {
  readonly format: typeof FURY_BETA_READINESS_SUBSYSTEM_FORMAT;
  readonly id: string;
  readonly requirement: FuryBetaReadinessRequirement;
  readonly evidenceDigestSha256: string;
  readonly observedAt: number;
  readonly expiresAt?: number;
  readonly dimensions: FuryBetaReadinessDimensions;
  readonly reasonCodes?: readonly string[];
}

export interface FuryBetaReadinessSubsystemObservation {
  readonly format: typeof FURY_BETA_READINESS_SUBSYSTEM_FORMAT;
  readonly id: string;
  readonly requirement: FuryBetaReadinessRequirement;
  readonly evidenceDigestSha256: string;
  readonly observedAt: number;
  readonly expiresAt?: number;
  readonly dimensions: FuryBetaReadinessDimensions;
  readonly status: FuryBetaReadinessState;
  readonly stale: boolean;
  readonly reasonCodes: readonly string[];
  readonly authority: 'readiness-observation-only';
  readonly executionAuthority: false;
  readonly repairAuthority: false;
}

export interface FuryBetaReadinessIssue {
  readonly subsystemId: string;
  readonly requirement: FuryBetaReadinessRequirement;
  readonly status: FuryBetaReadinessState;
  readonly reasonCodes: readonly string[];
}

export interface FuryBetaReadinessStatusCounts {
  readonly ready: number;
  readonly degraded: number;
  readonly unconfigured: number;
  readonly unavailable: number;
  readonly blocked: number;
  readonly unsupported: number;
}

export interface FuryBetaReadinessSnapshot {
  readonly format: typeof FURY_BETA_READINESS_SNAPSHOT_FORMAT;
  readonly observedAt: number;
  readonly overallStatus: FuryBetaReadinessOverallStatus;
  readonly taskReady: boolean;
  readonly subsystemCount: number;
  readonly requiredSubsystems: number;
  readonly optionalSubsystems: number;
  readonly statusCounts: FuryBetaReadinessStatusCounts;
  readonly blockers: readonly FuryBetaReadinessIssue[];
  readonly degradations: readonly FuryBetaReadinessIssue[];
  readonly subsystems: readonly FuryBetaReadinessSubsystemObservation[];
  readonly digestSha256: string;
  readonly authority: 'readiness-observation-only';
  readonly executionAuthority: false;
  readonly repairAuthority: false;
  readonly selectionAuthority: false;
}

export interface FuryBetaReadinessInput {
  readonly observedAt: number;
  readonly subsystems: readonly FuryBetaReadinessSubsystemInput[];
  readonly maxSubsystems?: number;
}

const SNAPSHOTS = new WeakSet<object>();
const DIMENSION_STATE_SET = new Set<string>(FURY_BETA_READINESS_DIMENSION_STATES);
const DIMENSION_KEYS = Object.freeze([
  'discovery', 'compatibility', 'health', 'policy', 'authentication', 'connection', 'executionAuthority',
] as const);
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9._:/@+~-]{0,127}$/u;
const REASON = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const DEFAULT_MAX_SUBSYSTEMS = 128;
const HARD_MAX_SUBSYSTEMS = 1024;
const MAX_REASONS = 24;
const BLOCKING_REQUIRED = new Set<FuryBetaReadinessState>([
  'unconfigured', 'unavailable', 'blocked', 'unsupported',
]);

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !allowed.has(key)) {
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

function safeTime(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer timestamp`);
  }
  return value as number;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function exactArray<T>(value: readonly T[], label: string, maxItems: number): readonly T[] {
  if (!Array.isArray(value) || value.length > maxItems || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new RangeError(`${label} must contain at most ${maxItems} plain entries`);
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
    throw new TypeError(`${label} contains unsupported array properties`);
  }
  const output: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} contains sparse, hidden, or accessor entries`);
    }
    output.push(descriptor.value as T);
  }
  return Object.freeze(output);
}

function normalizeDimensions(value: FuryBetaReadinessDimensions): FuryBetaReadinessDimensions {
  const record = exactRecord(value, DIMENSION_KEYS, DIMENSION_KEYS, 'beta readiness dimensions');
  const out: Record<string, FuryBetaReadinessDimensionState> = {};
  for (const key of DIMENSION_KEYS) {
    const state = record[key];
    if (typeof state !== 'string' || !DIMENSION_STATE_SET.has(state)) {
      throw new TypeError(`beta readiness dimension ${key} is invalid`);
    }
    out[key] = state as FuryBetaReadinessDimensionState;
  }
  return Object.freeze(out as unknown as FuryBetaReadinessDimensions);
}

function normalizeReasonCodes(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const input = exactArray(value, 'beta readiness reasonCodes', MAX_REASONS);
  const normalized = input.map((reason) => {
    if (typeof reason !== 'string' || !REASON.test(reason)) {
      throw new TypeError('beta readiness reasonCode must be a bounded lowercase token');
    }
    return reason;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('beta readiness reasonCodes must not contain duplicates');
  }
  return Object.freeze([...normalized].sort((a, b) => a.localeCompare(b)));
}

function derivedStatus(dimensions: FuryBetaReadinessDimensions, stale: boolean): FuryBetaReadinessState {
  if (stale) return 'unavailable';
  const states = DIMENSION_KEYS.map((key) => dimensions[key]);
  if (states.includes('blocked')) return 'blocked';
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('unconfigured')) return 'unconfigured';
  if (states.includes('unsupported')) return 'unsupported';
  if (states.includes('degraded') || states.includes('unknown')) return 'degraded';
  return 'ready';
}

function derivedReasonCodes(
  dimensions: FuryBetaReadinessDimensions,
  stale: boolean,
  supplied: readonly string[],
): readonly string[] {
  const reasons = new Set<string>(supplied);
  if (stale) reasons.add('stale-evidence');
  for (const key of DIMENSION_KEYS) {
    const state = dimensions[key];
    if (state !== 'ready' && state !== 'not-applicable') {
      reasons.add(`dimension-${key.replace(/[A-Z]/g, (v) => `-${v.toLowerCase()}`)}-${state}`);
    }
  }
  return Object.freeze([...reasons].sort((a, b) => a.localeCompare(b)));
}

function normalizeSubsystem(
  value: FuryBetaReadinessSubsystemInput,
  snapshotObservedAt: number,
): FuryBetaReadinessSubsystemObservation {
  const record = exactRecord(
    value,
    ['format', 'id', 'requirement', 'evidenceDigestSha256', 'observedAt', 'expiresAt', 'dimensions', 'reasonCodes'],
    ['format', 'id', 'requirement', 'evidenceDigestSha256', 'observedAt', 'dimensions'],
    'beta readiness subsystem',
  );
  if (record.format !== FURY_BETA_READINESS_SUBSYSTEM_FORMAT) {
    throw new TypeError('beta readiness subsystem format is invalid');
  }
  if (typeof record.id !== 'string' || !ID.test(record.id)) {
    throw new TypeError('beta readiness subsystem id is invalid');
  }
  if (record.requirement !== 'required' && record.requirement !== 'optional') {
    throw new TypeError('beta readiness subsystem requirement is invalid');
  }
  if (typeof record.evidenceDigestSha256 !== 'string' || !SHA256.test(record.evidenceDigestSha256)) {
    throw new TypeError('beta readiness subsystem evidence digest is invalid');
  }
  const observedAt = safeTime(record.observedAt, 'beta readiness subsystem observedAt');
  if (observedAt > snapshotObservedAt) {
    throw new RangeError('beta readiness subsystem evidence cannot be from the future');
  }
  const expiresAt = record.expiresAt === undefined ? undefined : safeTime(record.expiresAt, 'beta readiness subsystem expiresAt');
  if (expiresAt !== undefined && expiresAt < observedAt) {
    throw new RangeError('beta readiness subsystem expiresAt cannot precede observedAt');
  }
  const dimensions = normalizeDimensions(record.dimensions as FuryBetaReadinessDimensions);
  const stale = expiresAt !== undefined && expiresAt <= snapshotObservedAt;
  const suppliedReasons = normalizeReasonCodes(record.reasonCodes as readonly string[] | undefined);
  const status = derivedStatus(dimensions, stale);
  const reasonCodes = derivedReasonCodes(dimensions, stale, suppliedReasons);
  return Object.freeze({
    format: FURY_BETA_READINESS_SUBSYSTEM_FORMAT,
    id: record.id,
    requirement: record.requirement,
    evidenceDigestSha256: record.evidenceDigestSha256,
    observedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    dimensions,
    status,
    stale,
    reasonCodes,
    authority: 'readiness-observation-only' as const,
    executionAuthority: false as const,
    repairAuthority: false as const,
  });
}

function issueFor(subsystem: FuryBetaReadinessSubsystemObservation): FuryBetaReadinessIssue {
  return Object.freeze({
    subsystemId: subsystem.id,
    requirement: subsystem.requirement,
    status: subsystem.status,
    reasonCodes: subsystem.reasonCodes,
  });
}

function statusCounts(subsystems: readonly FuryBetaReadinessSubsystemObservation[]): FuryBetaReadinessStatusCounts {
  const counts: Record<FuryBetaReadinessState, number> = {
    ready: 0,
    degraded: 0,
    unconfigured: 0,
    unavailable: 0,
    blocked: 0,
    unsupported: 0,
  };
  for (const subsystem of subsystems) counts[subsystem.status] += 1;
  return Object.freeze(counts);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isGeneratedFuryBetaReadinessSnapshot(value: unknown): value is FuryBetaReadinessSnapshot {
  return typeof value === 'object' && value !== null && SNAPSHOTS.has(value);
}

export function createFuryBetaReadinessSnapshot(input: FuryBetaReadinessInput): FuryBetaReadinessSnapshot {
  const record = exactRecord(input, ['observedAt', 'subsystems', 'maxSubsystems'], ['observedAt', 'subsystems'], 'beta readiness input');
  const observedAt = safeTime(record.observedAt, 'beta readiness observedAt');
  const maxSubsystems = boundedInteger(record.maxSubsystems as number | undefined, DEFAULT_MAX_SUBSYSTEMS, 1, HARD_MAX_SUBSYSTEMS, 'maxSubsystems');
  const values = exactArray(record.subsystems as readonly FuryBetaReadinessSubsystemInput[], 'beta readiness subsystems', maxSubsystems);
  if (values.length === 0) throw new RangeError('beta readiness requires at least one subsystem');
  const subsystems = values.map((value) => normalizeSubsystem(value, observedAt)).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const subsystem of subsystems) {
    if (ids.has(subsystem.id)) throw new Error(`duplicate beta readiness subsystem id: ${subsystem.id}`);
    ids.add(subsystem.id);
  }

  const blockers = Object.freeze(subsystems
    .filter((subsystem) => subsystem.requirement === 'required' && BLOCKING_REQUIRED.has(subsystem.status))
    .map(issueFor));
  const degradations = Object.freeze(subsystems
    .filter((subsystem) => (subsystem.requirement === 'required' && subsystem.status === 'degraded')
      || (subsystem.requirement === 'optional' && subsystem.status !== 'ready'))
    .map(issueFor));
  const overallStatus: FuryBetaReadinessOverallStatus = blockers.length > 0
    ? 'blocked'
    : degradations.length > 0 ? 'degraded' : 'ready';
  const counts = statusCounts(subsystems);
  const requiredSubsystems = subsystems.filter((subsystem) => subsystem.requirement === 'required').length;
  const optionalSubsystems = subsystems.length - requiredSubsystems;
  const canonical = {
    observedAt,
    overallStatus,
    subsystemCount: subsystems.length,
    requiredSubsystems,
    optionalSubsystems,
    statusCounts: counts,
    blockers,
    degradations,
    subsystems,
  };
  const snapshot: FuryBetaReadinessSnapshot = Object.freeze({
    format: FURY_BETA_READINESS_SNAPSHOT_FORMAT,
    observedAt,
    overallStatus,
    taskReady: blockers.length === 0,
    subsystemCount: subsystems.length,
    requiredSubsystems,
    optionalSubsystems,
    statusCounts: counts,
    blockers,
    degradations,
    subsystems: Object.freeze(subsystems),
    digestSha256: sha256(JSON.stringify(canonical)),
    authority: 'readiness-observation-only' as const,
    executionAuthority: false as const,
    repairAuthority: false as const,
    selectionAuthority: false as const,
  });
  SNAPSHOTS.add(snapshot);
  return snapshot;
}
