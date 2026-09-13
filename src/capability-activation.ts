import {
  FURY_SCORE_FORMAT,
  FURY_SCORE_POLICY_VERSION,
  type FuryCapabilityScore,
  type FuryScoreRoutingState,
} from './fury-score.js';

export const FURY_CAPABILITY_ACTIVATION_FORMAT = 'furypipe-capability-activation/v1' as const;
export const FURY_CAPABILITY_ACTIVATION_POLICY_VERSION = 'capability-activation-v1' as const;

export type FuryCapabilityCatalogDisposition =
  | 'RECOMMENDED'
  | 'REVIEW_REQUIRED'
  | 'REFERENCE_ONLY'
  | 'BLOCKED';

export type FuryCapabilityRegistrationState = 'UNREGISTERED' | 'REGISTERED';
export type FuryCapabilityConnectionState = 'DISCONNECTED' | 'CONNECTED';
export type FuryCapabilityApprovalState = 'NOT_APPROVED' | 'APPROVED';

export type FuryCapabilityReadinessState =
  | 'BLOCKED'
  | 'REFERENCE_ONLY'
  | 'NEEDS_REGISTRATION'
  | 'NEEDS_CONNECTION'
  | 'NEEDS_APPROVAL'
  | 'READY_FOR_POLICY_AUTHORIZATION';

export interface FuryCapabilityActivationInput {
  readonly score: FuryCapabilityScore;
  /** True only when the capability exists in the host's real runtime inventory. */
  readonly registered: boolean;
  /** True only when the registered capability is actually connected/mounted for this host. */
  readonly connected?: boolean;
  /** Explicit host/operator approval assertion. This module does not authenticate the approver. */
  readonly approved?: boolean;
  /** Observation only. Must carry a bounded receipt reference and can never authorize execution. */
  readonly executed?: boolean;
  readonly executionReceiptId?: string;
  /** Verification is an observation about an already executed capability, not an execution permission. */
  readonly verified?: boolean;
  readonly verificationEvidence?: readonly string[];
}

export interface FuryCapabilityActivationContract {
  readonly format: typeof FURY_CAPABILITY_ACTIVATION_FORMAT;
  readonly policyVersion: typeof FURY_CAPABILITY_ACTIVATION_POLICY_VERSION;
  readonly candidateId: string;
  readonly routingState: FuryScoreRoutingState;
  readonly catalogDisposition: FuryCapabilityCatalogDisposition;
  readonly registrationState: FuryCapabilityRegistrationState;
  readonly connectionState: FuryCapabilityConnectionState;
  readonly approvalState: FuryCapabilityApprovalState;
  readonly readinessState: FuryCapabilityReadinessState;
  /**
   * Means only that catalog/trust state plus caller-supplied host lifecycle state
   * is sufficient to ask the governed policy/runtime layer for authorization.
   */
  readonly readyForPolicyAuthorization: boolean;
  readonly executed: boolean;
  readonly executionReceiptId?: string;
  readonly verified: boolean;
  readonly verificationEvidence: readonly string[];
  /** This pure contract never authorizes execution. */
  readonly executionAuthorized: false;
  readonly blockers: readonly string[];
}

const MAX_REFERENCE_CHARS = 512;
const MAX_VERIFICATION_EVIDENCE = 64;

function strictBoolean(value: unknown, label: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function boundedReference(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REFERENCE_CHARS || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }
  return trimmed;
}

function validateScore(value: unknown): FuryCapabilityScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('capability activation requires a FuryScore result');
  }
  const score = value as FuryCapabilityScore;
  if (
    score.format !== FURY_SCORE_FORMAT
    || score.policyVersion !== FURY_SCORE_POLICY_VERSION
    || score.executionAuthorized !== false
    || typeof score.candidateId !== 'string'
    || !score.candidateId
    || !['RANKED', 'REVIEW_REQUIRED', 'REFERENCE_ONLY', 'BLOCKED'].includes(score.routingState)
  ) {
    throw new Error('capability activation requires a valid FuryScore result');
  }
  return score;
}

function disposition(state: FuryScoreRoutingState): FuryCapabilityCatalogDisposition {
  if (state === 'RANKED') return 'RECOMMENDED';
  return state;
}

function readiness(
  state: FuryScoreRoutingState,
  registered: boolean,
  connected: boolean,
  approved: boolean,
): FuryCapabilityReadinessState {
  if (state === 'BLOCKED') return 'BLOCKED';
  if (state === 'REFERENCE_ONLY') return 'REFERENCE_ONLY';
  if (!registered) return 'NEEDS_REGISTRATION';
  if (!connected) return 'NEEDS_CONNECTION';
  if (!approved) return 'NEEDS_APPROVAL';
  return 'READY_FOR_POLICY_AUTHORIZATION';
}

function blockersFor(state: FuryCapabilityReadinessState): readonly string[] {
  const blockers = state === 'BLOCKED'
    ? ['routing-blocked']
    : state === 'REFERENCE_ONLY'
      ? ['reference-only']
      : state === 'NEEDS_REGISTRATION'
        ? ['not-registered']
        : state === 'NEEDS_CONNECTION'
          ? ['not-connected']
          : state === 'NEEDS_APPROVAL'
            ? ['approval-required']
            : ['policy-authorization-required'];
  return Object.freeze(blockers);
}

/**
 * Build a fail-closed lifecycle contract from an existing FuryScore result and
 * host-supplied runtime observations.
 *
 * This function never installs, connects, approves, executes, verifies, or
 * grants authority. READY_FOR_POLICY_AUTHORIZATION is explicitly not execution
 * authorization; the governed runtime/policy layer must still decide.
 */
export function resolveFuryCapabilityActivation(
  input: FuryCapabilityActivationInput,
): FuryCapabilityActivationContract {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('capability activation input is required');
  }

  const score = validateScore(input.score);
  const registered = strictBoolean(input.registered, 'registered');
  const connected = strictBoolean(input.connected, 'connected');
  const approved = strictBoolean(input.approved, 'approved');
  const executed = strictBoolean(input.executed, 'executed');
  const verified = strictBoolean(input.verified, 'verified');

  if (connected && !registered) {
    throw new Error('connected capability must first be registered');
  }

  const readinessState = readiness(score.routingState, registered, connected, approved);
  const readyForPolicyAuthorization = readinessState === 'READY_FOR_POLICY_AUTHORIZATION';

  if (executed && !readyForPolicyAuthorization) {
    throw new Error('executed capability must first be ready for policy authorization');
  }
  if (verified && !executed) {
    throw new Error('verified capability must first have an execution observation');
  }

  const executionReceiptId = input.executionReceiptId === undefined
    ? undefined
    : boundedReference(input.executionReceiptId, 'executionReceiptId');
  if (executed && executionReceiptId === undefined) {
    throw new Error('executed capability requires an executionReceiptId');
  }
  if (!executed && executionReceiptId !== undefined) {
    throw new Error('executionReceiptId requires an execution observation');
  }

  if (input.verificationEvidence !== undefined && !Array.isArray(input.verificationEvidence)) {
    throw new TypeError('verificationEvidence must be an array');
  }
  const verificationEvidence = Object.freeze(
    [...(input.verificationEvidence ?? [])].map((item, index) =>
      boundedReference(item, `verificationEvidence[${index}]`)),
  );
  if (verificationEvidence.length > MAX_VERIFICATION_EVIDENCE) {
    throw new Error(`verificationEvidence accepts at most ${MAX_VERIFICATION_EVIDENCE} references`);
  }
  if (new Set(verificationEvidence).size !== verificationEvidence.length) {
    throw new Error('verificationEvidence contains duplicate references');
  }
  if (verified && verificationEvidence.length === 0) {
    throw new Error('verified capability requires verification evidence');
  }
  if (!verified && verificationEvidence.length > 0) {
    throw new Error('verification evidence requires a verified observation');
  }

  return Object.freeze({
    format: FURY_CAPABILITY_ACTIVATION_FORMAT,
    policyVersion: FURY_CAPABILITY_ACTIVATION_POLICY_VERSION,
    candidateId: score.candidateId,
    routingState: score.routingState,
    catalogDisposition: disposition(score.routingState),
    registrationState: registered ? 'REGISTERED' : 'UNREGISTERED',
    connectionState: connected ? 'CONNECTED' : 'DISCONNECTED',
    approvalState: approved ? 'APPROVED' : 'NOT_APPROVED',
    readinessState,
    readyForPolicyAuthorization,
    executed,
    ...(executionReceiptId === undefined ? {} : { executionReceiptId }),
    verified,
    verificationEvidence,
    executionAuthorized: false,
    blockers: blockersFor(readinessState),
  });
}
