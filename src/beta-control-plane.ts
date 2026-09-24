import { createHash } from 'node:crypto';

import {
  isGeneratedFuryBetaConfigObservation,
  type FuryBetaConfigObservation,
} from './beta-config.js';
import {
  collectFuryBetaOnboarding,
  isGeneratedFuryBetaOnboardingSnapshot,
  type FuryBetaOnboardingRuntimeInput,
  type FuryBetaOnboardingSnapshot,
} from './beta-onboarding.js';
import {
  resolveFuryBetaEntry,
  type FuryBetaEntrySnapshot,
  type FuryBetaRequestedEntry,
} from './beta-experience.js';
import { isGeneratedFuryBetaReadinessSnapshot, type FuryBetaReadinessSnapshot } from './beta-readiness.js';

export const FURY_BETA_CONTROL_PLANE_FORMAT = 'furypipe-beta-control-plane/v1' as const;

export type FuryBetaEvidenceState = 'observed' | 'not-observed' | 'unknown' | 'not-applicable';

export interface FuryBetaOperationalEvidence {
  readonly approvals: FuryBetaEvidenceState;
  readonly policy: FuryBetaEvidenceState;
  readonly recovery: FuryBetaEvidenceState;
  readonly unknownOutcomes: FuryBetaEvidenceState;
  readonly reasonCodes: readonly string[];
}

export interface FuryBetaControlPlaneSnapshot {
  readonly format: typeof FURY_BETA_CONTROL_PLANE_FORMAT;
  readonly generatedAt: number;
  readonly entry: FuryBetaEntrySnapshot;
  readonly readiness: FuryBetaReadinessSnapshot;
  readonly onboarding: FuryBetaOnboardingSnapshot;
  readonly operations: FuryBetaOperationalEvidence;
  readonly authority: 'dashboard-observation-only';
  readonly executionAuthority: false;
  readonly mutationAuthority: false;
  readonly digestSha256: string;
}

export interface CreateFuryBetaControlPlaneInput {
  readonly generatedAt: number;
  readonly config: FuryBetaConfigObservation;
  readonly readiness: FuryBetaReadinessSnapshot;
  readonly onboarding?: FuryBetaOnboardingSnapshot;
  readonly onboardingInput?: FuryBetaOnboardingRuntimeInput;
  readonly requestedEntry?: FuryBetaRequestedEntry;
  readonly operations?: Partial<FuryBetaOperationalEvidence>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function operationState(value: FuryBetaEvidenceState | undefined, label: string): FuryBetaEvidenceState {
  if (value === undefined) return 'not-observed';
  if (!['observed', 'not-observed', 'unknown', 'not-applicable'].includes(value)) {
    throw new TypeError(`beta control-plane ${label} state is invalid`);
  }
  return value;
}

function operationReasons(value: readonly string[] | undefined): readonly string[] {
  const reasons = value ?? [];
  if (!Array.isArray(reasons) || reasons.length > 24) {
    throw new RangeError('beta control-plane operation reasons are too numerous');
  }
  const normalized = reasons.map((reason) => {
    if (typeof reason !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(reason)) {
      throw new TypeError('beta control-plane operation reason is invalid');
    }
    return reason;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('beta control-plane operation reasons contain duplicates');
  }
  return Object.freeze(normalized);
}

/**
 * Compose the CLI/Web beta projection. It is intentionally a projection only:
 * the snapshot contains no bearer, permit, installation, approval or mutation
 * authority and can safely be rendered by an untrusted dashboard client.
 */
export function createFuryBetaControlPlaneSnapshot(
  input: CreateFuryBetaControlPlaneInput,
): FuryBetaControlPlaneSnapshot {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new RangeError('beta control-plane generatedAt must be a non-negative safe integer timestamp');
  }
  if (!input.config || !isGeneratedFuryBetaConfigObservation(input.config)) {
    throw new TypeError('beta control-plane requires a generated configuration observation');
  }
  if (!input.readiness || !isGeneratedFuryBetaReadinessSnapshot(input.readiness)
    || input.readiness.executionAuthority !== false) {
    throw new TypeError('beta control-plane requires observation-only readiness');
  }
  const entry = resolveFuryBetaEntry(input.config, input.requestedEntry ?? 'default');
  if (input.onboarding !== undefined && !isGeneratedFuryBetaOnboardingSnapshot(input.onboarding)) {
    throw new TypeError('beta control-plane requires generated onboarding evidence');
  }
  const onboarding = input.onboarding ?? collectFuryBetaOnboarding({
    ...(input.onboardingInput ?? {}),
    observedAt: input.generatedAt,
    readiness: input.readiness,
  });
  const operations: FuryBetaOperationalEvidence = Object.freeze({
    approvals: operationState(input.operations?.approvals, 'approvals'),
    policy: operationState(input.operations?.policy, 'policy'),
    recovery: operationState(input.operations?.recovery, 'recovery'),
    unknownOutcomes: operationState(input.operations?.unknownOutcomes, 'unknownOutcomes'),
    reasonCodes: Object.freeze([
      ...operationReasons(input.operations?.reasonCodes),
      'dashboard-cannot-authorize',
      'execution-receipts-not-injected',
    ].filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a.localeCompare(b))),
  });
  const canonical = {
    format: FURY_BETA_CONTROL_PLANE_FORMAT,
    generatedAt: input.generatedAt,
    entry,
    readiness: input.readiness,
    onboarding,
    operations,
  };
  return Object.freeze({
    ...canonical,
    authority: 'dashboard-observation-only',
    executionAuthority: false,
    mutationAuthority: false,
    digestSha256: sha256(JSON.stringify(canonical)),
  });
}
