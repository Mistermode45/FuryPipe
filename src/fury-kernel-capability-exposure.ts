import { createHash } from 'node:crypto';

import {
  isGeneratedFuryCapabilityIndex,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexKind,
  type FuryCapabilityIndexRecord,
  type FuryCapabilityIndexRiskClass,
} from './capability-index.js';
import {
  isGeneratedFuryCapabilitySelectionPlan,
  type FuryCapabilitySelectionPlan,
  type FuryCapabilitySelectionReason,
  type FurySelectedCapabilitySignal,
} from './capability-autopilot.js';
import {
  isGeneratedFuryCapabilitySignalRegistry,
  type FuryCapabilitySignalRegistry,
} from './capability-signals.js';
import {
  revalidateFuryCapabilitySelection,
} from './capability-index-adapters.js';

export const FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT =
  'furypipe-kernel-capability-exposure/v1' as const;

export type FuryKernelCapabilityExposureBlockReason =
  | 'reselection-required'
  | 'signal-reselection-required'
  | 'selection-count-exceeds-limit'
  | 'descriptor-byte-limit'
  | 'total-byte-limit'
  | 'known-context-budget-exceeded';

export interface FuryKernelCapabilityDescriptor {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly families: readonly string[];
  readonly tags: readonly string[];
  readonly trust: FuryCapabilityIndexRecord['trust'];
  readonly license: FuryCapabilityIndexRecord['license'];
  readonly health: FuryCapabilityIndexRecord['health'];
  readonly riskClass: FuryCapabilityIndexRiskClass;
  readonly requiredPermissions: readonly string[];
  readonly source: FuryCapabilityIndexRecord['source'];
  readonly fingerprintSha256: string;
  readonly selectionReason: FuryCapabilitySelectionReason;
  readonly requestedExplicitly: boolean;
  readonly estimatedContextTokens?: number;
  readonly measuredSignal?: FurySelectedCapabilitySignal;
  readonly fullBodyLoaded: false;
  readonly activationAuthorized: false;
  readonly connectionAuthorized: false;
  readonly executionAuthorized: false;
  readonly authority: 'routing-metadata-only';
}

export interface FuryKernelCapabilityExposureReady {
  readonly format: typeof FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT;
  readonly status: 'ready';
  readonly selectionDigestSha256: string;
  readonly indexDigestSha256: string;
  readonly signalSnapshotDigestSha256?: string;
  readonly exposureDigestSha256: string;
  readonly descriptors: readonly FuryKernelCapabilityDescriptor[];
  readonly selectedCount: number;
  readonly exposedCount: number;
  readonly metadataBytes: number;
  readonly estimatedContextTokensKnown: number;
  readonly estimatedContextTokensUnknown: number;
  readonly contextEstimateComplete: boolean;
  readonly authority: 'exposure-metadata-only';
  readonly executionAuthority: false;
}

export interface FuryKernelCapabilityExposureBlocked {
  readonly format: typeof FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT;
  readonly status: 'blocked';
  readonly reason: FuryKernelCapabilityExposureBlockReason;
  readonly selectionDigestSha256: string;
  readonly indexDigestSha256: string;
  readonly signalSnapshotDigestSha256?: string;
  readonly descriptors: readonly [];
  readonly selectedCount: number;
  readonly exposedCount: 0;
  readonly metadataBytes: 0;
  readonly authority: 'exposure-metadata-only';
  readonly executionAuthority: false;
}

export type FuryKernelCapabilityExposurePlan =
  | FuryKernelCapabilityExposureReady
  | FuryKernelCapabilityExposureBlocked;

export interface FuryKernelCapabilityExposureOptions {
  readonly selection: FuryCapabilitySelectionPlan;
  readonly index: FuryCapabilityIndex;
  readonly signals?: FuryCapabilitySignalRegistry;
  readonly maxCapabilities?: number;
  readonly maxDescriptorBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxKnownContextTokens?: number;
}

const EXPOSURE_EVIDENCE = new WeakSet<object>();

const DEFAULT_MAX_CAPABILITIES = 8;
const HARD_MAX_CAPABILITIES = 64;
const DEFAULT_MAX_DESCRIPTOR_BYTES = 4 * 1024;
const HARD_MAX_DESCRIPTOR_BYTES = 16 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 24 * 1024;
const HARD_MAX_TOTAL_BYTES = 128 * 1024;
const DEFAULT_MAX_KNOWN_CONTEXT_TOKENS = 32_768;
const HARD_MAX_KNOWN_CONTEXT_TOKENS = 1_000_000;

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
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < min || (resolved as number) > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return resolved as number;
}

function cloneStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function cloneSource(
  source: FuryCapabilityIndexRecord['source'],
): FuryCapabilityIndexRecord['source'] {
  return Object.freeze({
    system: source.system,
    sourceId: source.sourceId,
    ...(source.sourceRevision === undefined ? {} : { sourceRevision: source.sourceRevision }),
    ...(source.observedAt === undefined ? {} : { observedAt: source.observedAt }),
  });
}

function cloneMeasuredSignal(
  signal: FurySelectedCapabilitySignal,
): FurySelectedCapabilitySignal {
  return Object.freeze({
    status: signal.status,
    ...(signal.fingerprintSha256 === undefined
      ? {}
      : { fingerprintSha256: signal.fingerprintSha256 }),
    ...(signal.health === undefined ? {} : { health: signal.health }),
    ...(signal.latencyMs === undefined ? {} : { latencyMs: signal.latencyMs }),
    ...(signal.observedCostUsd === undefined
      ? {}
      : { observedCostUsd: signal.observedCostUsd }),
    ...(signal.costBasis === undefined ? {} : { costBasis: signal.costBasis }),
    ...(signal.observedAt === undefined ? {} : { observedAt: signal.observedAt }),
    ...(signal.expiresAt === undefined ? {} : { expiresAt: signal.expiresAt }),
    ...(signal.source === undefined ? {} : { source: signal.source }),
    ...(signal.evidenceKind === undefined
      ? {}
      : { evidenceKind: signal.evidenceKind }),
  });
}

function descriptorFor(
  record: FuryCapabilityIndexRecord,
  selected: FuryCapabilitySelectionPlan['selected'][number],
): FuryKernelCapabilityDescriptor {
  return Object.freeze({
    kind: record.kind,
    id: record.id,
    name: record.name,
    description: record.description,
    families: cloneStrings(record.families),
    tags: cloneStrings(record.tags),
    trust: record.trust,
    license: record.license,
    health: record.health,
    riskClass: record.riskClass,
    requiredPermissions: cloneStrings(record.requiredPermissions),
    source: cloneSource(record.source),
    fingerprintSha256: record.fingerprintSha256,
    selectionReason: selected.reason,
    requestedExplicitly: selected.requestedExplicitly,
    ...(record.estimatedContextTokens === undefined
      ? {}
      : { estimatedContextTokens: record.estimatedContextTokens }),
    ...(selected.measuredSignal === undefined
      ? {}
      : { measuredSignal: cloneMeasuredSignal(selected.measuredSignal) }),
    fullBodyLoaded: false as const,
    activationAuthorized: false as const,
    connectionAuthorized: false as const,
    executionAuthorized: false as const,
    authority: 'routing-metadata-only' as const,
  });
}

function blocked(
  reason: FuryKernelCapabilityExposureBlockReason,
  selection: FuryCapabilitySelectionPlan,
  indexDigestSha256: string,
  signalSnapshotDigestSha256?: string,
): FuryKernelCapabilityExposureBlocked {
  const value: FuryKernelCapabilityExposureBlocked = Object.freeze({
    format: FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT,
    status: 'blocked',
    reason,
    selectionDigestSha256: selection.selectionDigestSha256,
    indexDigestSha256,
    ...(signalSnapshotDigestSha256 === undefined
      ? {}
      : { signalSnapshotDigestSha256 }),
    descriptors: Object.freeze([]) as readonly [],
    selectedCount: selection.selectedCount,
    exposedCount: 0,
    metadataBytes: 0,
    authority: 'exposure-metadata-only' as const,
    executionAuthority: false as const,
  });
  EXPOSURE_EVIDENCE.add(value);
  return value;
}

export function isGeneratedFuryKernelCapabilityExposurePlan(
  value: unknown,
): value is FuryKernelCapabilityExposurePlan {
  return typeof value === 'object'
    && value !== null
    && EXPOSURE_EVIDENCE.has(value);
}

export function createFuryKernelCapabilityExposurePlan(
  input: FuryKernelCapabilityExposureOptions,
): FuryKernelCapabilityExposurePlan {
  const root = exactPlainRecord(
    input,
    [
      'selection',
      'index',
      'signals',
      'maxCapabilities',
      'maxDescriptorBytes',
      'maxTotalBytes',
      'maxKnownContextTokens',
    ],
    ['selection', 'index'],
    'Fury Kernel capability exposure input',
  );

  if (!isGeneratedFuryCapabilitySelectionPlan(root.selection)) {
    throw new TypeError(
      'Fury Kernel capability exposure requires a process-local Autopilot selection',
    );
  }
  if (!isGeneratedFuryCapabilityIndex(root.index)) {
    throw new TypeError(
      'Fury Kernel capability exposure requires a process-local capability index',
    );
  }

  let signals: FuryCapabilitySignalRegistry | undefined;
  if (root.signals !== undefined) {
    if (!isGeneratedFuryCapabilitySignalRegistry(root.signals)) {
      throw new TypeError(
        'Fury Kernel capability exposure requires a process-local signal registry',
      );
    }
    signals = root.signals;
  }

  const selection = root.selection;
  const index = root.index;
  const maxCapabilities = boundedInteger(
    root.maxCapabilities,
    DEFAULT_MAX_CAPABILITIES,
    1,
    HARD_MAX_CAPABILITIES,
    'maxCapabilities',
  );
  const maxDescriptorBytes = boundedInteger(
    root.maxDescriptorBytes,
    DEFAULT_MAX_DESCRIPTOR_BYTES,
    256,
    HARD_MAX_DESCRIPTOR_BYTES,
    'maxDescriptorBytes',
  );
  const maxTotalBytes = boundedInteger(
    root.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    maxDescriptorBytes,
    HARD_MAX_TOTAL_BYTES,
    'maxTotalBytes',
  );
  const maxKnownContextTokens = boundedInteger(
    root.maxKnownContextTokens,
    DEFAULT_MAX_KNOWN_CONTEXT_TOKENS,
    1,
    HARD_MAX_KNOWN_CONTEXT_TOKENS,
    'maxKnownContextTokens',
  );

  const revalidation = revalidateFuryCapabilitySelection(selection, index);
  if (!revalidation.validForExposure) {
    return blocked(
      'reselection-required',
      selection,
      revalidation.currentIndexDigestSha256,
    );
  }

  let currentSignalDigest: string | undefined;
  if (selection.signalSnapshotDigestSha256 !== undefined) {
    if (!signals) {
      return blocked(
        'signal-reselection-required',
        selection,
        revalidation.currentIndexDigestSha256,
      );
    }
    currentSignalDigest = signals.snapshot().digestSha256;
    if (currentSignalDigest !== selection.signalSnapshotDigestSha256) {
      return blocked(
        'signal-reselection-required',
        selection,
        revalidation.currentIndexDigestSha256,
        currentSignalDigest,
      );
    }
  }

  if (selection.selected.length > maxCapabilities) {
    return blocked(
      'selection-count-exceeds-limit',
      selection,
      revalidation.currentIndexDigestSha256,
    );
  }

  const descriptors: FuryKernelCapabilityDescriptor[] = [];
  let metadataBytes = 0;
  let estimatedContextTokensKnown = 0;
  let estimatedContextTokensUnknown = 0;

  for (const selected of selection.selected) {
    const record = index.get(selected.kind, selected.id);
    if (!record || record.fingerprintSha256 !== selected.fingerprintSha256) {
      return blocked(
        'reselection-required',
        selection,
        revalidation.currentIndexDigestSha256,
      );
    }

    const descriptor = descriptorFor(record, selected);
    const bytes = Buffer.byteLength(JSON.stringify(descriptor), 'utf8');
    if (bytes > maxDescriptorBytes) {
      return blocked(
        'descriptor-byte-limit',
        selection,
        revalidation.currentIndexDigestSha256,
      );
    }
    if (metadataBytes + bytes > maxTotalBytes) {
      return blocked(
        'total-byte-limit',
        selection,
        revalidation.currentIndexDigestSha256,
      );
    }

    if (record.estimatedContextTokens === undefined) {
      estimatedContextTokensUnknown += 1;
    } else {
      estimatedContextTokensKnown += record.estimatedContextTokens;
      if (estimatedContextTokensKnown > maxKnownContextTokens) {
        return blocked(
          'known-context-budget-exceeded',
          selection,
          revalidation.currentIndexDigestSha256,
        );
      }
    }

    descriptors.push(descriptor);
    metadataBytes += bytes;
  }

  const exposureDigestSha256 = sha256(JSON.stringify({
    format: FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT,
    selectionDigestSha256: selection.selectionDigestSha256,
    indexDigestSha256: revalidation.currentIndexDigestSha256,
    ...(currentSignalDigest === undefined
      ? {}
      : { signalSnapshotDigestSha256: currentSignalDigest }),
    descriptors: descriptors.map((descriptor) => [
      descriptor.kind,
      descriptor.id,
      descriptor.fingerprintSha256,
      descriptor.measuredSignal?.status ?? null,
      descriptor.measuredSignal?.fingerprintSha256 ?? null,
    ]),
  }));

  const value: FuryKernelCapabilityExposureReady = Object.freeze({
    format: FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT,
    status: 'ready' as const,
    selectionDigestSha256: selection.selectionDigestSha256,
    indexDigestSha256: revalidation.currentIndexDigestSha256,
    ...(currentSignalDigest === undefined
      ? {}
      : { signalSnapshotDigestSha256: currentSignalDigest }),
    exposureDigestSha256,
    descriptors: Object.freeze(descriptors),
    selectedCount: selection.selectedCount,
    exposedCount: descriptors.length,
    metadataBytes,
    estimatedContextTokensKnown,
    estimatedContextTokensUnknown,
    contextEstimateComplete: estimatedContextTokensUnknown === 0,
    authority: 'exposure-metadata-only' as const,
    executionAuthority: false as const,
  });
  EXPOSURE_EVIDENCE.add(value);
  return value;
}
