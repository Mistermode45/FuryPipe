import type {
  ModelFabricRegistry,
} from './core/model-fabric.js';
import type {
  ProviderRuntimeHealth,
  ProviderRuntimeState,
} from './core/provider-runtime.js';
import {
  FURY_CAPABILITY_SIGNAL_FORMAT,
  isGeneratedFuryCapabilitySignalRegistry,
  type FuryCapabilitySignalHealth,
  type FuryCapabilitySignalRegistry,
} from './capability-signals.js';

export const FURY_CAPABILITY_SIGNAL_PROJECTION_FORMAT =
  'furypipe-capability-signal-projection/v1' as const;

export interface FuryCapabilitySignalProjectionReport {
  readonly format: typeof FURY_CAPABILITY_SIGNAL_PROJECTION_FORMAT;
  readonly source: 'provider-runtime';
  readonly observed: number;
  readonly skippedUnmeasured: number;
  readonly skippedUnregisteredProvider: number;
  readonly skippedInvalidIdentity: number;
  readonly authority: 'projection-only';
  readonly executionAuthority: false;
}

export interface ProjectProviderRuntimeModelSignalsOptions {
  readonly now?: number;
}

const MODEL_CAPABILITY_ID_RE =
  /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u;

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
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
  const allowed = new Set(allowedKeys);
  const record = value as Record<string, unknown>;
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
  return record;
}

function finiteTimestamp(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${label} must be a safe non-negative timestamp`);
  }
  return resolved;
}

function measuredHealth(
  health: ProviderRuntimeHealth,
): health is ProviderRuntimeHealth & {
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly source: string;
  readonly evidenceKind: 'live-probe' | 'transport-result';
} {
  return health.fresh === true
    && health.observedAt !== undefined
    && health.expiresAt !== undefined
    && health.source !== undefined
    && (
      health.evidenceKind === 'live-probe'
      || health.evidenceKind === 'transport-result'
    );
}

function signalHealth(
  health: ProviderRuntimeHealth,
): FuryCapabilitySignalHealth | undefined {
  if (health.availability === 'available') return 'ready';
  if (health.availability === 'unavailable') return 'unavailable';
  return undefined;
}

export function projectProviderRuntimeModelSignals(
  signals: FuryCapabilitySignalRegistry,
  providerRuntime: ProviderRuntimeState,
  models: ModelFabricRegistry,
  options: ProjectProviderRuntimeModelSignalsOptions = {},
): FuryCapabilitySignalProjectionReport {
  if (!isGeneratedFuryCapabilitySignalRegistry(signals)) {
    throw new TypeError(
      'provider runtime signal projection requires a process-local signal registry',
    );
  }
  if (
    !providerRuntime
    || typeof providerRuntime !== 'object'
    || typeof providerRuntime.health !== 'function'
    || typeof providerRuntime.registry !== 'function'
  ) {
    throw new TypeError(
      'provider runtime signal projection requires ProviderRuntimeState',
    );
  }
  if (
    !models
    || typeof models !== 'object'
    || typeof models.list !== 'function'
  ) {
    throw new TypeError(
      'provider runtime signal projection requires ModelFabricRegistry',
    );
  }

  const root = exactPlainRecord(
    options,
    ['now'],
    'provider runtime signal projection options',
  );
  const now = finiteTimestamp(
    root.now as number | undefined,
    Date.now(),
    'signal projection now',
  );
  let observed = 0;
  let skippedUnmeasured = 0;
  let skippedUnregisteredProvider = 0;
  let skippedInvalidIdentity = 0;
  const runtimeRegistry = providerRuntime.registry(now);

  for (const model of models.list()) {
    const capabilityId = `${model.provider}/${model.id}`;
    if (!MODEL_CAPABILITY_ID_RE.test(capabilityId)) {
      skippedInvalidIdentity += 1;
      continue;
    }

    if (!runtimeRegistry.get(model.provider)) {
      skippedUnregisteredProvider += 1;
      continue;
    }

    const health = providerRuntime.health(model.provider, now);
    if (!measuredHealth(health)) {
      skippedUnmeasured += 1;
      continue;
    }
    const projectedHealth = signalHealth(health);
    if (projectedHealth === undefined) {
      skippedUnmeasured += 1;
      continue;
    }

    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'model',
      id: capabilityId,
      observedAt: health.observedAt,
      expiresAt: health.expiresAt,
      source: health.source,
      evidenceKind: health.evidenceKind,
      health: projectedHealth,
      ...(health.latencyMs === undefined ? {} : { latencyMs: health.latencyMs }),
    });
    observed += 1;
  }

  return Object.freeze({
    format: FURY_CAPABILITY_SIGNAL_PROJECTION_FORMAT,
    source: 'provider-runtime' as const,
    observed,
    skippedUnmeasured,
    skippedUnregisteredProvider,
    skippedInvalidIdentity,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}
