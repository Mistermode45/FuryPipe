import { createHash } from 'node:crypto';

import {
  FURY_CAPABILITY_INDEX_KINDS,
  isGeneratedFuryCapabilityIndex,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexKind,
  type FuryCapabilityIndexRecord,
} from './capability-index.js';
import {
  isGeneratedFuryCapabilitySignalRegistry,
  type FuryCapabilitySignalEvidenceKind,
  type FuryCapabilitySignalHealth,
  type FuryCapabilitySignalRegistry,
  type FuryCapabilitySignalSnapshotRecord,
  type FuryCapabilitySignalStatus,
} from './capability-signals.js';

export const FURY_CAPABILITY_SELECTION_FORMAT =
  'furypipe-capability-selection/v1' as const;

export const FURY_CAPABILITY_SELECTION_BLOCK_REASONS = Object.freeze([
  'trust-blocked',
  'trust-unverified',
  'trust-unknown',
  'license-unknown',
  'health-blocked',
  'health-unavailable',
  'health-unknown',
  'compatibility-unproven',
  'compatibility-mismatch',
  'missing-permission',
  'below-threshold',
  'kind-cap',
  'global-cap',
] as const);

export type FuryCapabilitySelectionBlockReason =
  (typeof FURY_CAPABILITY_SELECTION_BLOCK_REASONS)[number];

export type FuryCapabilitySelectionReason =
  | 'explicit-request'
  | 'family-match'
  | 'task-relevance';

export interface FuryCapabilityExplicitRequest {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
}

export interface FuryCapabilitySelectionOptions {
  readonly minScore?: number;
  readonly maxSelected?: number;
  readonly maxSelectedByKind?: Readonly<
    Partial<Record<FuryCapabilityIndexKind, number>>
  >;
  readonly maxBlockedDetails?: number;
  readonly maxCandidates?: number;
}

export interface FuryCapabilitySelectionInput {
  readonly objective: string;
  readonly index: FuryCapabilityIndex;
  readonly explicitRequests?: readonly FuryCapabilityExplicitRequest[];
  /**
   * Host/runtime compatibility facts. Capability compatibility metadata is
   * treated as a required set, never as descriptive marketing tags.
   */
  readonly hostCompatibility?: readonly string[];
  /** Permissions already available to the current planning context. */
  readonly availablePermissions?: readonly string[];
  /** Optional family hints from a trusted deterministic classifier/host. */
  readonly requiredFamilies?: readonly string[];
  /**
   * Optional process-local measured evidence. Signals can refine current
   * health and deterministic tie-breaking but never grant authority.
   */
  readonly signals?: FuryCapabilitySignalRegistry;
  readonly options?: FuryCapabilitySelectionOptions;
}

export interface FurySelectedCapabilitySignal {
  readonly status: FuryCapabilitySignalStatus;
  readonly fingerprintSha256?: string;
  readonly health?: FuryCapabilitySignalHealth;
  readonly latencyMs?: number;
  readonly observedCostUsd?: number;
  readonly costBasis?: string;
  readonly observedAt?: number;
  readonly expiresAt?: number;
  readonly source?: string;
  readonly evidenceKind?: FuryCapabilitySignalEvidenceKind;
}

export interface FurySelectedCapability {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly fingerprintSha256: string;
  readonly score: number;
  readonly relevanceScore: number;
  readonly penalty: number;
  readonly reason: FuryCapabilitySelectionReason;
  readonly requestedExplicitly: boolean;
  readonly requiredPermissions: readonly string[];
  readonly estimatedContextTokens?: number;
  readonly measuredSignal?: FurySelectedCapabilitySignal;
}

export interface FuryBlockedCapability {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly reason: FuryCapabilitySelectionBlockReason;
  readonly requestedExplicitly: boolean;
}

export interface FuryMissingExplicitCapability {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
}

export interface FuryCapabilitySelectionPlan {
  readonly format: typeof FURY_CAPABILITY_SELECTION_FORMAT;
  readonly objectiveDigestSha256: string;
  readonly indexDigestSha256: string;
  readonly signalSnapshotDigestSha256?: string;
  readonly selectionDigestSha256: string;
  readonly selected: readonly FurySelectedCapability[];
  readonly blocked: readonly FuryBlockedCapability[];
  readonly blockedCounts: Readonly<
    Partial<Record<FuryCapabilitySelectionBlockReason, number>>
  >;
  readonly missingExplicitRequests: readonly FuryMissingExplicitCapability[];
  readonly candidatesConsidered: number;
  readonly signalRecordsConsidered?: number;
  readonly signalFreshRecords?: number;
  readonly signalStaleRecords?: number;
  readonly selectedCount: number;
  readonly estimatedContextTokensKnown: number;
  readonly estimatedContextTokensUnknown: number;
  readonly authority: 'selection-only';
  readonly executionAuthority: false;
}

interface ScoredCapability {
  readonly record: FuryCapabilityIndexRecord;
  readonly requestedExplicitly: boolean;
  readonly relevanceScore: number;
  readonly penalty: number;
  readonly score: number;
  readonly reason: FuryCapabilitySelectionReason;
  readonly signal?: FuryCapabilitySignalSnapshotRecord;
}

const CAPABILITY_SELECTION_EVIDENCE = new WeakSet<object>();

const DEFAULT_MIN_SCORE = 1.5;
const DEFAULT_MAX_SELECTED = 8;
const HARD_MAX_SELECTED = 64;
const DEFAULT_MAX_BLOCKED_DETAILS = 32;
const HARD_MAX_BLOCKED_DETAILS = 128;
const DEFAULT_MAX_CANDIDATES = 50_000;
const HARD_MAX_CANDIDATES = 100_000;
const MAX_OBJECTIVE_CHARS = 64_000;
const MAX_EXPLICIT_REQUESTS = 64;
const MAX_HOST_FACTS = 256;
const MAX_FACT_CHARS = 128;

const DEFAULT_KIND_CAPS: Readonly<Record<FuryCapabilityIndexKind, number>> =
  Object.freeze({
    model: 2,
    provider: 0,
    skill: 3,
    'skill-pack': 0,
    instruction: 0,
    plugin: 1,
    mcp: 0,
    'mcp-server': 2,
    'mcp-tool': 4,
    connector: 0,
    tool: 0,
    agent: 0,
    workflow: 0,
    automation: 0,
    'memory-provider': 0,
    'search-provider': 0,
    'browser-provider': 0,
    'image-provider': 0,
    'video-provider': 0,
    'audio-provider': 0,
    'voice-provider': 0,
    'embedding-provider': 0,
    reranker: 0,
    'code-runtime': 0,
    sandbox: 0,
  });

const RISK_PENALTIES: Readonly<Record<FuryCapabilityIndexRecord['riskClass'], number>> =
  Object.freeze({
    none: 0,
    inspect: 0.1,
    read: 0.25,
    write: 0.75,
    process: 1.25,
    admin: 2,
    unknown: 1,
  });

const FIELD_WEIGHTS = Object.freeze({
  identity: 6,
  keyword: 5,
  family: 4,
  tag: 3,
  description: 1,
  compatibility: 1,
});

const KIND_SET = new Set<string>(FURY_CAPABILITY_INDEX_KINDS);
const SAFE_FACT_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,127}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function boundedScore(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_SCORE;
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new RangeError('minScore must be a finite number from 0 to 1000000');
  }
  return value;
}

function normalizeObjective(value: string): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_OBJECTIVE_CHARS
    || value.includes('\0')
  ) {
    throw new Error('Capability Autopilot objective must be bounded non-empty text');
  }
  return value.normalize('NFKC').trim();
}

function tokens(value: string): readonly string[] {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, "'");
  const found = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}._+~-]*/gu) ?? [];
  return Object.freeze(
    [...new Set(found.filter((token) => token.length > 1))].sort((a, b) =>
      a.localeCompare(b)),
  );
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

function dataArrayValues(
  value: unknown,
  label: string,
  maxItems: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RangeError(`${label} must contain at most ${maxItems} items`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} contains unsupported symbol properties`);
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) =>
    name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name)
  )) {
    throw new TypeError(`${label} contains unsupported array properties`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw new TypeError(`${label} contains sparse, hidden, or accessor entries`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function normalizeFactList(
  value: readonly string[] | undefined,
  label: string,
): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  const input = dataArrayValues(value, label, MAX_HOST_FACTS);
  const output = new Set<string>();
  for (const item of input) {
    if (
      typeof item !== 'string'
      || item.length === 0
      || item.length > MAX_FACT_CHARS
      || CONTROL_RE.test(item)
    ) {
      throw new TypeError(`${label} contains invalid text`);
    }
    const normalized = item.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (!SAFE_FACT_RE.test(normalized) || output.has(normalized)) {
      throw new Error(`${label} contains invalid or duplicate facts`);
    }
    output.add(normalized);
  }
  return output;
}

function normalizeExplicitRequests(
  value: readonly FuryCapabilityExplicitRequest[] | undefined,
): {
  readonly keys: ReadonlySet<string>;
  readonly values: readonly FuryCapabilityExplicitRequest[];
} {
  if (value === undefined) {
    return Object.freeze({
      keys: new Set<string>(),
      values: Object.freeze([]),
    });
  }
  const input = dataArrayValues(
    value,
    'explicitRequests',
    MAX_EXPLICIT_REQUESTS,
  );
  const keys = new Set<string>();
  const values: FuryCapabilityExplicitRequest[] = [];
  for (const item of input) {
    const record = exactPlainRecord(
      item,
      ['kind', 'id'],
      ['kind', 'id'],
      'explicit capability request',
    );
    if (typeof record.kind !== 'string' || !KIND_SET.has(record.kind)) {
      throw new TypeError('explicit capability request kind is unsupported');
    }
    if (
      typeof record.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u.test(record.id)
    ) {
      throw new TypeError('explicit capability request id is invalid');
    }
    const normalized = Object.freeze({
      kind: record.kind as FuryCapabilityIndexKind,
      id: record.id,
    });
    const key = identity(normalized.kind, normalized.id);
    if (keys.has(key)) {
      throw new Error('explicit capability requests must be unique');
    }
    keys.add(key);
    values.push(normalized);
  }
  values.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return Object.freeze({
    keys,
    values: Object.freeze(values),
  });
}

function identity(kind: FuryCapabilityIndexKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function normalizeKindCaps(
  value: FuryCapabilitySelectionOptions['maxSelectedByKind'],
): Readonly<Record<FuryCapabilityIndexKind, number>> {
  if (value === undefined) return DEFAULT_KIND_CAPS;
  const record = exactPlainRecord(
    value,
    FURY_CAPABILITY_INDEX_KINDS,
    [],
    'maxSelectedByKind',
  );
  const output: Record<FuryCapabilityIndexKind, number> = {
    ...DEFAULT_KIND_CAPS,
  };
  for (const kind of FURY_CAPABILITY_INDEX_KINDS) {
    if (record[kind] === undefined) continue;
    output[kind] = boundedInteger(
      record[kind] as number,
      DEFAULT_KIND_CAPS[kind],
      0,
      HARD_MAX_SELECTED,
      `maxSelectedByKind.${kind}`,
    );
  }
  return Object.freeze(output);
}

function candidateTokenWeights(
  record: FuryCapabilityIndexRecord,
): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  const add = (values: readonly string[], weight: number): void => {
    for (const value of values) {
      for (const token of tokens(value)) {
        weights.set(token, Math.max(weight, weights.get(token) ?? 0));
      }
    }
  };
  add([record.id.replace(/[._:/@+~-]+/gu, ' '), record.name], FIELD_WEIGHTS.identity);
  add(record.keywords, FIELD_WEIGHTS.keyword);
  add(record.families, FIELD_WEIGHTS.family);
  add(record.tags, FIELD_WEIGHTS.tag);
  add([record.description], FIELD_WEIGHTS.description);
  add(record.compatibility, FIELD_WEIGHTS.compatibility);
  return weights;
}

function measuredHealth(
  signal: FuryCapabilitySignalSnapshotRecord | undefined,
): FuryCapabilitySignalHealth | undefined {
  return signal?.status === 'fresh'
    ? signal.observation.health
    : undefined;
}

function blockReasonFor(
  record: FuryCapabilityIndexRecord,
  signal: FuryCapabilitySignalSnapshotRecord | undefined,
  hostCompatibility: ReadonlySet<string> | undefined,
  availablePermissions: ReadonlySet<string>,
): FuryCapabilitySelectionBlockReason | undefined {
  if (record.trust === 'blocked') return 'trust-blocked';
  if (record.trust === 'unverified') return 'trust-unverified';
  if (record.trust === 'unknown') return 'trust-unknown';
  if (record.license === 'unknown') return 'license-unknown';

  // Source-of-truth health cannot be improved by runtime metrics.
  if (record.health === 'blocked') return 'health-blocked';
  if (record.health === 'unavailable') return 'health-unavailable';

  // Fresh measured evidence may worsen health, or resolve an indexed
  // "unknown". Stale evidence never resolves unknown health.
  const signalHealth = measuredHealth(signal);
  if (signalHealth === 'blocked') return 'health-blocked';
  if (signalHealth === 'unavailable') return 'health-unavailable';
  if (
    record.health === 'unknown'
    && signalHealth !== 'ready'
    && signalHealth !== 'degraded'
  ) {
    return 'health-unknown';
  }

  if (record.compatibility.length > 0) {
    if (hostCompatibility === undefined) return 'compatibility-unproven';
    if (record.compatibility.some((fact) => !hostCompatibility.has(fact))) {
      return 'compatibility-mismatch';
    }
  }
  if (record.requiredPermissions.some((permission) =>
    !availablePermissions.has(permission))) {
    return 'missing-permission';
  }
  return undefined;
}

function riskPenalty(
  record: FuryCapabilityIndexRecord,
  signal: FuryCapabilitySignalSnapshotRecord | undefined,
): number {
  const contextPenalty = record.estimatedContextTokens === undefined
    ? 0
    : Math.min(4, record.estimatedContextTokens / 2_048);
  const signalHealth = measuredHealth(signal);
  const healthPenalty =
    record.health === 'degraded' || signalHealth === 'degraded'
      ? 0.5
      : 0;
  return Number((
    RISK_PENALTIES[record.riskClass] + healthPenalty + contextPenalty
  ).toFixed(6));
}

function signalSummary(
  signal: FuryCapabilitySignalSnapshotRecord | undefined,
): FurySelectedCapabilitySignal {
  if (!signal) {
    return Object.freeze({
      status: 'unknown' as const,
    });
  }
  const observation = signal.observation;
  return Object.freeze({
    status: signal.status,
    fingerprintSha256: observation.fingerprintSha256,
    ...(observation.health === undefined ? {} : { health: observation.health }),
    ...(observation.latencyMs === undefined ? {} : { latencyMs: observation.latencyMs }),
    ...(observation.observedCostUsd === undefined
      ? {}
      : { observedCostUsd: observation.observedCostUsd }),
    ...(observation.costBasis === undefined ? {} : { costBasis: observation.costBasis }),
    observedAt: observation.observedAt,
    expiresAt: observation.expiresAt,
    source: observation.source,
    evidenceKind: observation.evidenceKind,
  });
}

function compareMeasuredCost(
  a: FuryCapabilitySignalSnapshotRecord | undefined,
  b: FuryCapabilitySignalSnapshotRecord | undefined,
): number {
  if (a?.status !== 'fresh' || b?.status !== 'fresh') return 0;
  const ao = a.observation;
  const bo = b.observation;
  if (
    ao.observedCostUsd === undefined
    || bo.observedCostUsd === undefined
    || ao.costBasis === undefined
    || bo.costBasis === undefined
    || ao.costBasis !== bo.costBasis
  ) {
    return 0;
  }
  return ao.observedCostUsd - bo.observedCostUsd;
}

function compareMeasuredLatency(
  a: FuryCapabilitySignalSnapshotRecord | undefined,
  b: FuryCapabilitySignalSnapshotRecord | undefined,
): number {
  if (a?.status !== 'fresh' || b?.status !== 'fresh') return 0;
  const aLatency = a.observation.latencyMs;
  const bLatency = b.observation.latencyMs;
  if (aLatency === undefined || bLatency === undefined) return 0;
  return aLatency - bLatency;
}

function relevantReason(
  requestedExplicitly: boolean,
  familyMatches: number,
): FuryCapabilitySelectionReason {
  if (requestedExplicitly) return 'explicit-request';
  if (familyMatches > 0) return 'family-match';
  return 'task-relevance';
}

function increment(
  counts: Map<FuryCapabilitySelectionBlockReason, number>,
  reason: FuryCapabilitySelectionBlockReason,
): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

function blockDetail(
  details: FuryBlockedCapability[],
  max: number,
  record: FuryCapabilityIndexRecord,
  reason: FuryCapabilitySelectionBlockReason,
  requestedExplicitly: boolean,
): void {
  if (details.length >= max) return;
  details.push(Object.freeze({
    kind: record.kind,
    id: record.id,
    reason,
    requestedExplicitly,
  }));
}

function blockedCountsObject(
  counts: Map<FuryCapabilitySelectionBlockReason, number>,
): FuryCapabilitySelectionPlan['blockedCounts'] {
  return Object.freeze(Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  )) as FuryCapabilitySelectionPlan['blockedCounts'];
}

export function isGeneratedFuryCapabilitySelectionPlan(
  value: unknown,
): value is FuryCapabilitySelectionPlan {
  return typeof value === 'object'
    && value !== null
    && CAPABILITY_SELECTION_EVIDENCE.has(value);
}

export function selectFuryCapabilitiesForTask(
  input: FuryCapabilitySelectionInput,
): FuryCapabilitySelectionPlan {
  const root = exactPlainRecord(
    input,
    [
      'objective',
      'index',
      'explicitRequests',
      'hostCompatibility',
      'availablePermissions',
      'requiredFamilies',
      'signals',
      'options',
    ],
    ['objective', 'index'],
    'Capability Autopilot selection input',
  );
  if (!isGeneratedFuryCapabilityIndex(root.index)) {
    throw new TypeError(
      'Capability Autopilot selection requires a process-local FuryPipe index',
    );
  }
  const index = root.index;

  const objective = normalizeObjective(root.objective as string);
  const objectiveTokens = new Set(tokens(objective));
  const explicit = normalizeExplicitRequests(
    root.explicitRequests as readonly FuryCapabilityExplicitRequest[] | undefined,
  );
  const hostCompatibility = normalizeFactList(
    root.hostCompatibility as readonly string[] | undefined,
    'hostCompatibility',
  );
  const availablePermissions = normalizeFactList(
    (root.availablePermissions as readonly string[] | undefined) ?? [],
    'availablePermissions',
  ) ?? new Set<string>();
  const requiredFamilies = normalizeFactList(
    (root.requiredFamilies as readonly string[] | undefined) ?? [],
    'requiredFamilies',
  ) ?? new Set<string>();

  let signals: FuryCapabilitySignalRegistry | undefined;
  if (root.signals !== undefined) {
    if (!isGeneratedFuryCapabilitySignalRegistry(root.signals)) {
      throw new TypeError(
        'Capability Autopilot selection requires a process-local signal registry',
      );
    }
    signals = root.signals;
  }

  const options = root.options === undefined
    ? {}
    : exactPlainRecord(
        root.options,
        [
          'minScore',
          'maxSelected',
          'maxSelectedByKind',
          'maxBlockedDetails',
          'maxCandidates',
        ],
        [],
        'Capability Autopilot selection options',
      );
  const minScore = boundedScore(options.minScore as number | undefined);
  const maxSelected = boundedInteger(
    options.maxSelected as number | undefined,
    DEFAULT_MAX_SELECTED,
    1,
    HARD_MAX_SELECTED,
    'maxSelected',
  );
  const maxBlockedDetails = boundedInteger(
    options.maxBlockedDetails as number | undefined,
    DEFAULT_MAX_BLOCKED_DETAILS,
    0,
    HARD_MAX_BLOCKED_DETAILS,
    'maxBlockedDetails',
  );
  const maxCandidates = boundedInteger(
    options.maxCandidates as number | undefined,
    DEFAULT_MAX_CANDIDATES,
    1,
    HARD_MAX_CANDIDATES,
    'maxCandidates',
  );
  const kindCaps = normalizeKindCaps(
    options.maxSelectedByKind as FuryCapabilitySelectionOptions['maxSelectedByKind'],
  );

  const snapshot = index.snapshot();
  if (snapshot.count > maxCandidates) {
    throw new RangeError('Capability Autopilot candidate bound exceeded');
  }
  const signalSnapshot = signals?.snapshot();
  const signalByIdentity = new Map<string, FuryCapabilitySignalSnapshotRecord>();
  for (const signal of signalSnapshot?.records ?? []) {
    signalByIdentity.set(identity(signal.kind, signal.id), signal);
  }

  const requestedFound = new Set<string>();
  const tokenWeights = new Map<string, ReadonlyMap<string, number>>();
  const documentFrequency = new Map<string, number>();
  for (const record of snapshot.records) {
    const weights = candidateTokenWeights(record);
    tokenWeights.set(identity(record.kind, record.id), weights);
    for (const token of weights.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const scored: ScoredCapability[] = [];
  const blocked: FuryBlockedCapability[] = [];
  const blockedCounts = new Map<FuryCapabilitySelectionBlockReason, number>();

  for (const record of snapshot.records) {
    const key = identity(record.kind, record.id);
    const requestedExplicitly = explicit.keys.has(key);
    if (requestedExplicitly) requestedFound.add(key);
    const signal = signalByIdentity.get(key);

    const hardBlock = blockReasonFor(
      record,
      signal,
      hostCompatibility,
      availablePermissions,
    );
    if (hardBlock !== undefined) {
      increment(blockedCounts, hardBlock);
      if (requestedExplicitly || maxBlockedDetails > blocked.length) {
        blockDetail(
          blocked,
          maxBlockedDetails,
          record,
          hardBlock,
          requestedExplicitly,
        );
      }
      continue;
    }

    let relevance = 0;
    const weights = tokenWeights.get(key) ?? new Map<string, number>();
    for (const token of objectiveTokens) {
      const weight = weights.get(token);
      if (weight === undefined) continue;
      const df = documentFrequency.get(token) ?? 0;
      const idf = 1 + Math.log((snapshot.count + 1) / (df + 1));
      relevance += weight * idf;
    }

    let familyMatches = 0;
    for (const family of requiredFamilies) {
      if (record.families.includes(family)) {
        familyMatches += 1;
        relevance += 10;
      }
    }

    relevance = Number(relevance.toFixed(6));
    const penalty = riskPenalty(record, signal);
    const score = Number((
      (requestedExplicitly ? 1_000_000 : 0) + relevance - penalty
    ).toFixed(6));

    if (!requestedExplicitly && score < minScore) {
      increment(blockedCounts, 'below-threshold');
      // Below-threshold details are intentionally omitted unless there is
      // room and the candidate had some task relevance.
      if (relevance > 0) {
        blockDetail(
          blocked,
          maxBlockedDetails,
          record,
          'below-threshold',
          false,
        );
      }
      continue;
    }

    scored.push(Object.freeze({
      record,
      requestedExplicitly,
      relevanceScore: relevance,
      penalty,
      score,
      reason: relevantReason(requestedExplicitly, familyMatches),
      ...(signal === undefined ? {} : { signal }),
    }));
  }

  scored.sort((a, b) =>
    Number(b.requestedExplicitly) - Number(a.requestedExplicitly)
    || b.score - a.score
    || a.penalty - b.penalty
    || compareMeasuredCost(a.signal, b.signal)
    || compareMeasuredLatency(a.signal, b.signal)
    || (a.record.estimatedContextTokens ?? Number.MAX_SAFE_INTEGER)
      - (b.record.estimatedContextTokens ?? Number.MAX_SAFE_INTEGER)
    || a.record.kind.localeCompare(b.record.kind)
    || a.record.id.localeCompare(b.record.id));

  const selected: FurySelectedCapability[] = [];
  const selectedByKind = new Map<FuryCapabilityIndexKind, number>();
  for (const candidate of scored) {
    if (selected.length >= maxSelected) {
      increment(blockedCounts, 'global-cap');
      blockDetail(
        blocked,
        maxBlockedDetails,
        candidate.record,
        'global-cap',
        candidate.requestedExplicitly,
      );
      continue;
    }
    const used = selectedByKind.get(candidate.record.kind) ?? 0;
    if (used >= kindCaps[candidate.record.kind]) {
      increment(blockedCounts, 'kind-cap');
      blockDetail(
        blocked,
        maxBlockedDetails,
        candidate.record,
        'kind-cap',
        candidate.requestedExplicitly,
      );
      continue;
    }

    selectedByKind.set(candidate.record.kind, used + 1);
    selected.push(Object.freeze({
      kind: candidate.record.kind,
      id: candidate.record.id,
      fingerprintSha256: candidate.record.fingerprintSha256,
      score: candidate.score,
      relevanceScore: candidate.relevanceScore,
      penalty: candidate.penalty,
      reason: candidate.reason,
      requestedExplicitly: candidate.requestedExplicitly,
      requiredPermissions: candidate.record.requiredPermissions,
      ...(candidate.record.estimatedContextTokens === undefined
        ? {}
        : { estimatedContextTokens: candidate.record.estimatedContextTokens }),
      ...(signals === undefined
        ? {}
        : { measuredSignal: signalSummary(candidate.signal) }),
    }));
  }

  const missingExplicitRequests = explicit.values
    .filter((request) => !requestedFound.has(identity(request.kind, request.id)))
    .map((request) => Object.freeze({ ...request }));

  blocked.sort((a, b) =>
    Number(b.requestedExplicitly) - Number(a.requestedExplicitly)
    || a.reason.localeCompare(b.reason)
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id));

  let estimatedContextTokensKnown = 0;
  let estimatedContextTokensUnknown = 0;
  for (const item of selected) {
    if (item.estimatedContextTokens === undefined) {
      estimatedContextTokensUnknown += 1;
    } else {
      estimatedContextTokensKnown += item.estimatedContextTokens;
    }
  }

  const objectiveDigestSha256 = sha256(objective);
  const selectionDigestSha256 = sha256(JSON.stringify({
    objectiveDigestSha256,
    indexDigestSha256: snapshot.digestSha256,
    ...(signalSnapshot === undefined
      ? {}
      : { signalSnapshotDigestSha256: signalSnapshot.digestSha256 }),
    selected: selected.map((item) => [
      item.kind,
      item.id,
      item.fingerprintSha256,
      item.score,
      item.measuredSignal?.status ?? null,
      item.measuredSignal?.fingerprintSha256 ?? null,
    ]),
  }));

  const plan: FuryCapabilitySelectionPlan = Object.freeze({
    format: FURY_CAPABILITY_SELECTION_FORMAT,
    objectiveDigestSha256,
    indexDigestSha256: snapshot.digestSha256,
    ...(signalSnapshot === undefined
      ? {}
      : { signalSnapshotDigestSha256: signalSnapshot.digestSha256 }),
    selectionDigestSha256,
    selected: Object.freeze(selected),
    blocked: Object.freeze(blocked.slice(0, maxBlockedDetails)),
    blockedCounts: blockedCountsObject(blockedCounts),
    missingExplicitRequests: Object.freeze(missingExplicitRequests),
    candidatesConsidered: snapshot.count,
    ...(signalSnapshot === undefined
      ? {}
      : {
          signalRecordsConsidered: signalSnapshot.count,
          signalFreshRecords: signalSnapshot.fresh,
          signalStaleRecords: signalSnapshot.stale,
        }),
    selectedCount: selected.length,
    estimatedContextTokensKnown,
    estimatedContextTokensUnknown,
    authority: 'selection-only' as const,
    executionAuthority: false as const,
  });
  CAPABILITY_SELECTION_EVIDENCE.add(plan);
  return plan;
}
