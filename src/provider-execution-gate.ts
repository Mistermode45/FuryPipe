import type { ProviderRuntimeState } from './core/provider-runtime.js';
import type { FuryProviderRequestEnvelope } from './provider-request-envelope.js';
import { isGeneratedProviderRequestEnvelope } from './provider-request-envelope.js';
import {
  assertKnownKeys,
  canonicalProviderId,
  exactIdentifier,
  fail,
  MAX_PROVIDER_EXECUTION_PERMIT_TTL_MS,
  ownDataRecord,
  safeTimestamp,
} from './provider-execution-internal.js';

export interface FuryProviderExecutionPolicy {
  readonly format: 'furypipe-provider-execution-policy/v1';
  readonly policyId: string;
  readonly allowProviderRequest: boolean;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  /** Required explicit lifetime; no implicit or eternal permits are issued. */
  readonly expiresInMs: number;
}

export interface FuryProviderExecutionPermit {
  readonly format: 'furypipe-provider-execution-permit/v1';
  readonly permitId: string;
  readonly policyId: string;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface FuryProviderExecutionGate {
  authorize(
    request: FuryProviderRequestEnvelope,
    policy: FuryProviderExecutionPolicy,
  ): FuryProviderExecutionPermit;
}

export interface FuryProviderExecutionGateOptions {
  readonly providerRuntime: ProviderRuntimeState;
  readonly now?: () => number;
}

interface PermitState {
  readonly requestDigest: string;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  consumed: boolean;
}

const PERMIT_STATE = new WeakMap<object, PermitState>();
const POLICY_KEYS = [
  'format', 'policyId', 'allowProviderRequest', 'providerId', 'model', 'workloadId', 'expiresInMs',
] as const;

export function isGeneratedProviderExecutionPermit(value: unknown): value is FuryProviderExecutionPermit {
  return value !== null && typeof value === 'object' && PERMIT_STATE.has(value);
}

/** Reuse Provider Runtime's authoritative health, availability and exact-model assessment. */
function assertRuntimeEligible(
  runtime: ProviderRuntimeState,
  request: FuryProviderRequestEnvelope,
  now: number,
): number {
  let provider;
  try {
    provider = runtime.registry(now).get(request.providerId);
  } catch {
    fail('provider-not-registered');
  }
  if (!provider || provider.id !== request.providerId || provider.status !== 'registered') {
    fail('provider-not-registered');
  }

  let decision;
  try {
    decision = runtime.selectFallback([{ providerId: request.providerId, model: request.model }], now);
  } catch {
    fail('provider-health-not-fresh');
  }
  if (!decision || !Array.isArray(decision.assessments)) fail('provider-health-not-fresh');
  const assessment = decision.assessments[0];
  if (!assessment) fail('provider-health-not-fresh');
  switch (assessment.reason) {
    case 'eligible':
      if (
        !decision.selected
        || decision.selected.providerId !== request.providerId
        || decision.selected.model !== request.model
      ) fail('model-not-supported');
      let health;
      try {
        health = runtime.health(request.providerId, now);
      } catch {
        fail('provider-health-not-fresh');
      }
      if (
        health.providerId !== request.providerId
        || !health.fresh
        || health.availability !== 'available'
        || typeof health.observedAt !== 'number'
        || !Number.isFinite(health.observedAt)
        || health.observedAt < 0
        || health.observedAt > now
        || typeof health.expiresAt !== 'number'
        || !Number.isFinite(health.expiresAt)
        || health.expiresAt > Number.MAX_SAFE_INTEGER
        || health.expiresAt < now
      ) {
        fail('provider-health-not-fresh');
      }
      return health.expiresAt;
    case 'unknown_provider': fail('provider-not-registered');
    case 'health_not_fresh': fail('provider-health-not-fresh');
    case 'provider_unavailable': fail('provider-unavailable');
    case 'model_family_mismatch': fail('model-family-mismatch');
    case 'model_not_supported': fail('model-not-supported');
  }
  fail('provider-health-not-fresh');
}

export function createProviderExecutionGate(
  options: FuryProviderExecutionGateOptions,
): FuryProviderExecutionGate {
  if (!options || typeof options !== 'object' || !options.providerRuntime) {
    throw new TypeError('provider execution gate requires ProviderRuntimeState');
  }
  const runtime = options.providerRuntime;
  if (
    typeof runtime.registry !== 'function'
    || typeof runtime.health !== 'function'
    || typeof runtime.selectFallback !== 'function'
  ) {
    throw new TypeError('provider execution gate requires a compatible ProviderRuntimeState');
  }
  const nowSource = options.now ?? Date.now;
  if (typeof nowSource !== 'function') throw new TypeError('provider execution gate clock must be a function');

  return Object.freeze({
    authorize(request: FuryProviderRequestEnvelope, policy: FuryProviderExecutionPolicy): FuryProviderExecutionPermit {
      if (!isGeneratedProviderRequestEnvelope(request)) fail('invalid-prepared-attempt');

      let authority: Readonly<Record<string, unknown>>;
      try {
        authority = ownDataRecord(policy);
        assertKnownKeys(authority, POLICY_KEYS);
      } catch {
        fail('execution-not-authorized');
      }

      if (
        authority.format !== 'furypipe-provider-execution-policy/v1'
        || authority.allowProviderRequest !== true
        || !exactIdentifier(authority.policyId, 128)
        || !canonicalProviderId(authority.providerId)
        || !exactIdentifier(authority.model)
        || !exactIdentifier(authority.workloadId)
        || !Number.isSafeInteger(authority.expiresInMs)
        || (authority.expiresInMs as number) < 1
        || (authority.expiresInMs as number) > MAX_PROVIDER_EXECUTION_PERMIT_TTL_MS
        || authority.providerId !== request.providerId
        || authority.model !== request.model
        || authority.workloadId !== request.workloadId
      ) {
        fail('execution-not-authorized');
      }

      let now: number;
      try {
        now = nowSource();
      } catch {
        fail('invalid-input');
      }
      if (!safeTimestamp(now)) fail('invalid-input');
      const policyExpiresAt = now + (authority.expiresInMs as number);
      if (!safeTimestamp(policyExpiresAt)) fail('invalid-input');
      const healthExpiresAt = assertRuntimeEligible(runtime, request, now);
      const expiresAt = Math.min(policyExpiresAt, healthExpiresAt);

      const permit: FuryProviderExecutionPermit = Object.freeze({
        format: 'furypipe-provider-execution-permit/v1',
        permitId: `fpexec_${crypto.randomUUID()}`,
        policyId: authority.policyId as string,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        requestDigest: request.requestDigest,
        issuedAt: now,
        expiresAt,
      });
      PERMIT_STATE.set(permit, {
        requestDigest: request.requestDigest,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        consumed: false,
      });
      return permit;
    },
  });
}

/** Internal shared-state accessor used by the executor; callers cannot forge its result. */
export function consumeProviderExecutionPermit(
  request: FuryProviderRequestEnvelope,
  permit: FuryProviderExecutionPermit,
  now: number,
): void {
  if (!isGeneratedProviderExecutionPermit(permit)) fail('execution-not-authorized');
  const state = PERMIT_STATE.get(permit)!;
  if (
    permit.format !== 'furypipe-provider-execution-permit/v1'
    || state.requestDigest !== request.requestDigest
    || permit.requestDigest !== request.requestDigest
    || state.providerId !== request.providerId
    || state.model !== request.model
    || state.workloadId !== request.workloadId
    || permit.providerId !== request.providerId
    || permit.model !== request.model
    || permit.workloadId !== request.workloadId
  ) fail('permit-request-mismatch');
  if (now >= permit.expiresAt) fail('permit-expired');
  if (state.consumed) fail('permit-already-consumed');
  // This write is synchronous and precedes every await and transport callback.
  state.consumed = true;
}
