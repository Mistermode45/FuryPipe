import type {
  ProviderHealthObservation,
  ProviderRuntimeState,
} from './core/provider-runtime.js';
import type { ProviderAvailability } from './core/provider-fabric.js';
import {
  canonicalProviderId,
  exactIdentifier,
  ownDataRecord,
  safeTimestamp,
} from './provider-execution-internal.js';

export const MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS = 900_000;

export type ProviderTransportHealthReason =
  | 'accepted-http-response'
  | 'explicit-negative-http-status'
  | 'transport-evidence-insufficient'
  | 'http-status-missing'
  | 'http-status-inconsistent'
  | 'rejection-not-classified';

export interface ProviderTransportHealthPolicy {
  /** FuryPipe-local freshness window for accepted HTTP results. No default is inferred. */
  readonly availableTtlMs: number;
  /**
   * Exact rejected HTTP statuses that the host explicitly treats as temporary
   * provider unavailability. Empty/omitted means no negative health inference.
   */
  readonly unavailableHttpStatuses?: readonly number[];
  /** Required when unavailableHttpStatuses is non-empty. */
  readonly unavailableTtlMs?: number;
}

export interface ProviderTransportHealthTiming {
  readonly startedAt: number;
  readonly finishedAt: number;
}

export interface ProviderTransportHealthAssessment {
  readonly format: 'furypipe-provider-transport-health-assessment/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
  readonly observedAt: number;
  readonly latencyMs: number;
  readonly availability: ProviderAvailability;
  readonly reason: ProviderTransportHealthReason;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly expiresAt?: number;
  readonly evidenceKind: 'transport-result';
  /**
   * The assessment object was generated in this process, but its execution
   * result input is not a signed/persistent provenance claim.
   */
  readonly assessmentProvenance: 'process-local';
  readonly sourceProvenance: 'not-verified';
}

const generatedAssessments = new WeakSet<object>();

function healthTtl(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0
    || (value as number) > MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS) {
    throw new RangeError(`${name} must be an integer from 1 to ${MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS} ms`);
  }
  return value as number;
}

function checkedHttpStatus(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 100 || (value as number) > 599) {
    throw new TypeError('provider transport health httpStatus is invalid');
  }
  return value as number;
}

function checkedRetryAfter(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 604_800_000) {
    throw new TypeError('provider transport health retryAfterMs is invalid');
  }
  return value as number;
}

function exactNegativeStatuses(value: readonly number[] | undefined): ReadonlySet<number> {
  if (value === undefined) return new Set<number>();
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError('unavailableHttpStatuses must contain at most 32 exact HTTP statuses');
  }
  const statuses = new Set<number>();
  for (const status of value) {
    if (!Number.isSafeInteger(status) || status < 400 || status > 599) {
      throw new TypeError('unavailableHttpStatuses entries must be exact HTTP rejection statuses');
    }
    if (statuses.has(status)) throw new TypeError('unavailableHttpStatuses entries must be unique');
    statuses.add(status);
  }
  return statuses;
}

function statusEvidence(value: unknown, label: string): {
  readonly status: string;
  readonly evidence: string;
} {
  const record = ownDataRecord(value);
  const status = record.status;
  const evidence = record.evidence;
  if (typeof status !== 'string' || typeof evidence !== 'string') {
    throw new TypeError(`${label} evidence is invalid`);
  }
  return { status, evidence };
}

function addExpiry(observedAt: number, ttlMs: number): number {
  const expiresAt = observedAt + ttlMs;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= observedAt) {
    throw new RangeError('provider transport health expiry is outside the safe timestamp range');
  }
  return expiresAt;
}

/**
 * Convert one governed execution result into conservative provider-health
 * evidence. This never performs network I/O and never mutates ProviderRuntime.
 */
export function assessProviderTransportHealth(
  execution: unknown,
  policy: ProviderTransportHealthPolicy,
  timing: ProviderTransportHealthTiming,
): ProviderTransportHealthAssessment {
  const result = ownDataRecord(execution);
  if (result.format !== 'furypipe-governed-provider-execution-result/v1'
    || result.state !== 'TRANSPORT_RESULT'
    || result.transportInvoked !== true
    || !canonicalProviderId(result.providerId)
    || !exactIdentifier(result.model, 256)
    || !exactIdentifier(result.workloadId, 256)
    || typeof result.requestDigest !== 'string'
    || !/^[a-f0-9]{64}$/u.test(result.requestDigest)) {
    throw new TypeError('governed provider execution result is invalid for health assessment');
  }

  const startedAt = timing?.startedAt;
  const finishedAt = timing?.finishedAt;
  if (!safeTimestamp(startedAt) || !safeTimestamp(finishedAt) || finishedAt < startedAt) {
    throw new RangeError('provider transport health timing must contain ordered safe timestamps');
  }
  const latencyMs = finishedAt - startedAt;
  if (!Number.isSafeInteger(latencyMs)) throw new RangeError('provider transport health latency is invalid');

  const availableTtlMs = healthTtl(policy?.availableTtlMs, 'availableTtlMs');
  const negativeStatuses = exactNegativeStatuses(policy?.unavailableHttpStatuses);
  const unavailableTtlMs = negativeStatuses.size === 0
    ? undefined
    : healthTtl(policy?.unavailableTtlMs, 'unavailableTtlMs');

  const network = statusEvidence(result.network, 'network');
  const providerRequest = statusEvidence(result.providerRequest, 'provider request');
  const httpStatus = checkedHttpStatus(result.httpStatus);
  const retryAfterMs = checkedRetryAfter(result.retryAfterMs);

  let availability: ProviderAvailability = 'unknown';
  let reason: ProviderTransportHealthReason = 'transport-evidence-insufficient';
  let expiresAt: number | undefined;

  const networkExecuted = network.status === 'executed' && network.evidence === 'transport-reported';
  const requestReported = providerRequest.evidence === 'transport-reported';

  if (networkExecuted && requestReported && providerRequest.status === 'accepted') {
    if (httpStatus === undefined) {
      reason = 'http-status-missing';
    } else if (httpStatus >= 200 && httpStatus < 300) {
      availability = 'available';
      reason = 'accepted-http-response';
      expiresAt = addExpiry(finishedAt, availableTtlMs);
    } else {
      reason = 'http-status-inconsistent';
    }
  } else if (networkExecuted && requestReported && providerRequest.status === 'rejected') {
    if (httpStatus === undefined) {
      reason = 'http-status-missing';
    } else if (negativeStatuses.has(httpStatus)) {
      availability = 'unavailable';
      reason = 'explicit-negative-http-status';
      expiresAt = addExpiry(finishedAt, unavailableTtlMs!);
    } else {
      reason = 'rejection-not-classified';
    }
  }

  const assessment = Object.freeze({
    format: 'furypipe-provider-transport-health-assessment/v1' as const,
    providerId: result.providerId,
    model: result.model,
    workloadId: result.workloadId,
    requestDigest: result.requestDigest,
    observedAt: finishedAt,
    latencyMs,
    availability,
    reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    evidenceKind: 'transport-result' as const,
    assessmentProvenance: 'process-local' as const,
    sourceProvenance: 'not-verified' as const,
  });
  generatedAssessments.add(assessment);
  return assessment;
}

/**
 * Explicitly promote a process-local assessment into ProviderRuntime health.
 * Unknown assessments are not applied. The source remains transport-result,
 * never live-probe/operator-config.
 */
export function applyProviderTransportHealthAssessment(
  runtime: ProviderRuntimeState,
  assessment: ProviderTransportHealthAssessment,
): boolean {
  if (!runtime || typeof runtime.observeHealth !== 'function') {
    throw new TypeError('ProviderRuntimeState is required');
  }
  if (!assessment || typeof assessment !== 'object' || !generatedAssessments.has(assessment)) {
    throw new TypeError('provider transport health assessment lacks process-local provenance');
  }
  if (assessment.availability === 'unknown' || assessment.expiresAt === undefined) return false;

  const observation: ProviderHealthObservation = Object.freeze({
    providerId: assessment.providerId,
    availability: assessment.availability,
    observedAt: assessment.observedAt,
    expiresAt: assessment.expiresAt,
    latencyMs: assessment.latencyMs,
    source: 'governed-provider-transport-result',
    evidenceKind: 'transport-result',
  });
  runtime.observeHealth(observation);
  return true;
}
