import {
  optimizeContext,
  type FuryContextItem,
  type FuryContextOptimizerPlan,
} from './context-optimizer.js';
import {
  createContextOptimizerProfileRegistry,
  type FuryContextOptimizerProfileBlock,
  type FuryContextOptimizerProfileBlockReason,
  type FuryContextOptimizerProfileOptions,
} from './context-optimizer-profile.js';
import {
  hasFuryPipeContextInjection,
  injectFuryContext,
  renderFuryContextInjection,
  FURYPIPE_CONTEXT_DATA_CLOSE,
} from './context-prompt-injection.js';
import { compileFuryPrompt } from './fury-prompt.js';
import type { FuryProviderAttemptPrompt } from './provider-attempt-adapter.js';
import {
  isGeneratedProviderAttemptPlan,
  type FuryProviderAttemptPlan,
} from './provider-attempt-planner.js';

export type FuryProviderAttemptContextProfileDisposition =
  | 'QUALIFIED_PROFILE_APPLIED'
  | 'BASELINE_IDENTITY'
  | 'BLOCKED_PROFILE_FALLBACK';

export interface FuryProviderAttemptContextSecurityPolicy {
  /** Explicit host authority only; benchmark profiles cannot set this field. */
  readonly allowSecret?: boolean;
}

export interface FuryProviderAttemptContextRuntimeInput {
  readonly attemptPlan: FuryProviderAttemptPlan;
  /** Host-owned inventory; item content remains untrusted data. */
  readonly items: readonly FuryContextItem[];
  readonly securityPolicy?: FuryProviderAttemptContextSecurityPolicy;
  /** Optional character-ratio estimate, never actual provider usage. */
  readonly charsPerTokenEstimate?: number;
}

export interface FuryProviderAttemptContextRuntimeResult {
  readonly format: 'furypipe-provider-attempt-context-runtime/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly prompt: FuryProviderAttemptPrompt;
  readonly contextPlan: FuryContextOptimizerPlan;
  readonly contextProfileState: FuryProviderAttemptPlan['contextProfileState'];
  readonly profileDisposition: FuryProviderAttemptContextProfileDisposition;
  readonly profileApplied: boolean;
  readonly profileId?: string;
  readonly profileDigest?: string;
  readonly profileBlockers: readonly FuryContextOptimizerProfileBlock[];
  readonly profileQualificationEvidence: 'verified' | 'none';
  /** A historic profile qualification does not verify this inventory's result. */
  readonly currentContextResultVerified: false;
  readonly contextInjected: boolean;
  readonly injectedContextBytes: number;
  readonly tokenEstimateStatus: 'CHARACTER_RATIO_ESTIMATE' | 'UNKNOWN';
  readonly secretPolicy: {
    readonly allowSecret: boolean;
    readonly authority: 'host' | 'default-deny';
  };
  readonly optimizerExecuted: true;
  readonly networkCallExecuted: false;
  readonly providerRequestExecuted: false;
  readonly executionAuthorized: false;
}

export type FuryProviderAttemptContextRuntimeErrorCode =
  | 'invalid-input'
  | 'invalid-attempt-plan'
  | 'preoptimized-context-conflict'
  | 'context-boundary-conflict';

export class FuryProviderAttemptContextRuntimeError extends Error {
  constructor(
    readonly code: FuryProviderAttemptContextRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FuryProviderAttemptContextRuntimeError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;
const PROFILE_BLOCK_REASONS = new Set<FuryContextOptimizerProfileBlockReason>([
  'missing-qualification',
  'invalid-qualification',
  'scope-mismatch',
  'digest-mismatch',
  'insufficient-repetitions',
  'quality-regression',
  'exactness-incomplete',
  'benchmark-errors',
  'no-token-improvement',
]);

function fail(
  code: FuryProviderAttemptContextRuntimeErrorCode,
  message: string,
): never {
  throw new FuryProviderAttemptContextRuntimeError(code, message);
}

function ownDataRecord(
  value: unknown,
  label: string,
  errorCode: 'invalid-input' | 'invalid-attempt-plan',
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(errorCode, `${label} must be a plain object`);
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail(errorCode, `${label} is not a readable plain object`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(errorCode, `${label} must be a plain object`);
  }

  const record = Object.create(null) as Record<string, unknown>;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail(errorCode, `${label} is not a readable plain object`);
  }
  for (const key of keys) {
    if (typeof key !== 'string') fail(errorCode, `${label} must not contain symbol keys`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(errorCode, `${label} is not a readable plain object`);
    }
    if (!descriptor || !('value' in descriptor)) {
      fail(errorCode, `${label}.${key} must be a data property`);
    }
    Object.defineProperty(record, key, { value: descriptor.value, enumerable: true });
  }
  return record;
}

function assertKnownKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
  errorCode: 'invalid-input' | 'invalid-attempt-plan',
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(errorCode, `${label} contains an unsupported field: ${key}`);
  }
}

function exactScope(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_SCOPE_CHARS
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail('invalid-attempt-plan', `${label} is not a valid exact scope identifier`);
  }
  return value;
}

function validatePlanBlockers(value: unknown): readonly FuryContextOptimizerProfileBlock[] {
  if (!Array.isArray(value) || value.length > 1024) {
    fail('invalid-attempt-plan', 'provider attempt context profile blockers are invalid');
  }
  return Object.freeze(value.map((entry) => {
    const blocker = ownDataRecord(entry, 'provider attempt context profile blocker', 'invalid-attempt-plan');
    assertKnownKeys(blocker, ['id', 'reason'], 'provider attempt context profile blocker', 'invalid-attempt-plan');
    if (
      typeof blocker.id !== 'string'
      || blocker.id.length < 1
      || blocker.id.length > 128
      || blocker.id !== blocker.id.trim()
      || typeof blocker.reason !== 'string'
      || !PROFILE_BLOCK_REASONS.has(blocker.reason as FuryContextOptimizerProfileBlockReason)
    ) {
      fail('invalid-attempt-plan', 'provider attempt context profile blocker is malformed');
    }
    return Object.freeze({
      id: blocker.id,
      reason: blocker.reason as FuryContextOptimizerProfileBlockReason,
    });
  }));
}

function normalizeQualifiedOptions(
  profileId: string,
  rawOptions: unknown,
): FuryContextOptimizerProfileOptions {
  try {
    const registry = createContextOptimizerProfileRegistry([{
      id: profileId,
      options: rawOptions as FuryContextOptimizerProfileOptions,
    }]);
    const options = registry.inspect()[0]?.options;
    if (options === undefined) fail('invalid-attempt-plan', 'qualified context profile options are missing');
    return options;
  } catch (error) {
    if (error instanceof FuryProviderAttemptContextRuntimeError) throw error;
    fail('invalid-attempt-plan', 'qualified context profile options are invalid');
  }
}

function validateAttemptPlan(value: unknown): {
  readonly plan: FuryProviderAttemptPlan;
  readonly profileOptions?: FuryContextOptimizerProfileOptions;
  readonly blockers: readonly FuryContextOptimizerProfileBlock[];
} {
  if (!isGeneratedProviderAttemptPlan(value)) {
    fail('invalid-attempt-plan', 'attempt plan must be an immutable plan generated by FuryPipe in this process');
  }
  const record = ownDataRecord(value, 'provider attempt plan', 'invalid-attempt-plan');
  assertKnownKeys(record, [
    'format',
    'providerId',
    'model',
    'workloadId',
    'prompt',
    'adapter',
    'contextProfile',
    'contextProfileState',
    'networkCallExecuted',
    'providerRequestExecuted',
    'optimizerExecuted',
    'executionAuthorized',
  ], 'provider attempt plan', 'invalid-attempt-plan');
  if (record.format !== 'furypipe-provider-attempt-plan/v1') {
    fail('invalid-attempt-plan', 'provider attempt plan format is invalid');
  }
  const providerId = exactScope(record.providerId, 'providerId');
  const model = exactScope(record.model, 'model');
  const workloadId = exactScope(record.workloadId, 'workloadId');
  if (
    record.networkCallExecuted !== false
    || record.providerRequestExecuted !== false
    || record.optimizerExecuted !== false
    || record.executionAuthorized !== false
  ) {
    fail('invalid-attempt-plan', 'provider attempt plan execution flags are contradictory');
  }

  const adapter = ownDataRecord(record.adapter, 'provider attempt adapter plan', 'invalid-attempt-plan');
  assertKnownKeys(adapter, [
    'format', 'providerId', 'model', 'workloadId', 'adapterState', 'adapterId',
    'adapterDigest', 'prompt', 'blocked', 'evidence', 'networkCallExecuted', 'providerRequestExecuted',
  ], 'provider attempt adapter plan', 'invalid-attempt-plan');
  if (
    adapter.format !== 'furypipe-provider-attempt-adapter-plan/v1'
    || adapter.providerId !== providerId
    || adapter.model !== model
    || adapter.workloadId !== workloadId
    || adapter.prompt !== record.prompt
    || adapter.networkCallExecuted !== false
    || adapter.providerRequestExecuted !== false
    || !['IDENTITY', 'APPLIED', 'BLOCKED'].includes(String(adapter.adapterState))
  ) {
    fail('invalid-attempt-plan', 'provider attempt adapter plan contradicts its attempt');
  }
  if (adapter.adapterState === 'APPLIED') {
    if (typeof adapter.adapterId !== 'string' || typeof adapter.adapterDigest !== 'string' || !HEX64.test(adapter.adapterDigest)) {
      fail('invalid-attempt-plan', 'applied model adapter identity is incomplete');
    }
    if (adapter.evidence !== 'verified') fail('invalid-attempt-plan', 'applied model adapter evidence is invalid');
  } else if (adapter.adapterId !== undefined || adapter.adapterDigest !== undefined || adapter.evidence !== 'none') {
    fail('invalid-attempt-plan', 'non-applied model adapter carries applied identity or evidence');
  }
  if (!Array.isArray(adapter.blocked)) {
    fail('invalid-attempt-plan', 'provider attempt adapter blockers are invalid');
  }
  if (record.prompt === null || typeof record.prompt !== 'object' || Array.isArray(record.prompt)) {
    fail('invalid-attempt-plan', 'provider attempt prompt is invalid');
  }

  const profile = ownDataRecord(record.contextProfile, 'provider attempt context profile plan', 'invalid-attempt-plan');
  assertKnownKeys(profile, [
    'format', 'provider', 'model', 'workloadId', 'profileId', 'profileDigest', 'options',
    'evidence', 'blocked', 'optimizerExecuted', 'providerCallExecuted', 'executionAuthorized',
  ], 'provider attempt context profile plan', 'invalid-attempt-plan');
  const blockers = validatePlanBlockers(profile.blocked);
  if (
    profile.format !== 'furypipe-context-optimizer-profile-plan/v1'
    || profile.provider !== providerId
    || profile.model !== model
    || profile.workloadId !== workloadId
    || profile.optimizerExecuted !== false
    || profile.providerCallExecuted !== false
    || profile.executionAuthorized !== false
  ) {
    fail('invalid-attempt-plan', 'provider attempt context profile plan contradicts its attempt');
  }

  let profileOptions: FuryContextOptimizerProfileOptions | undefined;
  if (record.contextProfileState === 'QUALIFIED') {
    if (
      typeof profile.profileId !== 'string'
      || profile.profileId.length < 1
      || profile.profileId.length > 128
      || profile.profileId !== profile.profileId.trim()
      || typeof profile.profileDigest !== 'string'
      || !HEX64.test(profile.profileDigest)
      || profile.evidence !== 'verified'
      || profile.options === undefined
    ) {
      fail('invalid-attempt-plan', 'qualified context profile identity, options, or evidence is incomplete');
    }
    profileOptions = normalizeQualifiedOptions(profile.profileId, profile.options);
  } else if (record.contextProfileState === 'IDENTITY') {
    if (
      profile.profileId !== undefined
      || profile.profileDigest !== undefined
      || profile.options !== undefined
      || profile.evidence !== 'none'
      || blockers.some((entry) => entry.reason !== 'missing-qualification')
    ) {
      fail('invalid-attempt-plan', 'identity context profile carries qualification state');
    }
  } else if (record.contextProfileState === 'BLOCKED') {
    if (
      profile.profileId !== undefined
      || profile.profileDigest !== undefined
      || profile.options !== undefined
      || profile.evidence !== 'none'
      || !blockers.some((entry) => entry.reason !== 'missing-qualification')
    ) {
      fail('invalid-attempt-plan', 'blocked context profile state is inconsistent');
    }
  } else {
    fail('invalid-attempt-plan', 'provider attempt context profile state is invalid');
  }

  return {
    plan: value,
    ...(profileOptions === undefined ? {} : { profileOptions }),
    blockers,
  };
}

function securityPolicy(value: unknown): {
  readonly allowSecret: boolean;
  readonly authority: 'host' | 'default-deny';
} {
  if (value === undefined) {
    return Object.freeze({ allowSecret: false, authority: 'default-deny' });
  }
  const record = ownDataRecord(value, 'host security policy', 'invalid-input');
  assertKnownKeys(record, ['allowSecret'], 'host security policy', 'invalid-input');
  if (record.allowSecret !== undefined && typeof record.allowSecret !== 'boolean') {
    fail('invalid-input', 'host security policy allowSecret must be a boolean');
  }
  return Object.freeze({
    allowSecret: record.allowSecret === true,
    authority: 'host',
  });
}

/** Run one exact attempt's local Context Optimizer pass and inject data safely. */
export function prepareProviderAttemptContext(
  input: FuryProviderAttemptContextRuntimeInput,
): FuryProviderAttemptContextRuntimeResult {
  const record = ownDataRecord(input, 'provider attempt context runtime input', 'invalid-input');
  assertKnownKeys(record, [
    'attemptPlan', 'items', 'securityPolicy', 'charsPerTokenEstimate',
  ], 'provider attempt context runtime input', 'invalid-input');
  if (!Array.isArray(record.items)) fail('invalid-input', 'host context inventory must be an array');

  const { plan, profileOptions, blockers } = validateAttemptPlan(record.attemptPlan);
  const profileApplied = plan.contextProfileState === 'QUALIFIED';
  const secretPolicy = securityPolicy(record.securityPolicy);
  if (record.items.length > 0 && hasFuryPipeContextInjection(plan.prompt)) {
    fail(
      'preoptimized-context-conflict',
      'attempt prompt already contains a FuryPipe context injection; refusing to optimize and inject another inventory',
    );
  }

  const contextPlan = optimizeContext({
    ...(profileApplied ? profileOptions : {}),
    items: record.items as readonly FuryContextItem[],
    allowSecret: secretPolicy.allowSecret,
    ...(record.charsPerTokenEstimate === undefined
      ? {}
      : { charsPerTokenEstimate: record.charsPerTokenEstimate as number }),
  });

  if (contextPlan.included.some((item) => item.content.includes(FURYPIPE_CONTEXT_DATA_CLOSE))) {
    fail(
      'context-boundary-conflict',
      'selected context contains a FuryPipe closing marker; refusing ambiguous prompt injection',
    );
  }

  const rendered = renderFuryContextInjection(contextPlan);
  const prompt = injectFuryContext(plan.prompt, rendered) as FuryProviderAttemptPrompt;
  // Enforce FuryPrompt's existing section and aggregate input limits after injection.
  compileFuryPrompt(prompt);

  const contextProfileState = plan.contextProfileState;
  const profileDisposition: FuryProviderAttemptContextProfileDisposition =
    contextProfileState === 'QUALIFIED'
      ? 'QUALIFIED_PROFILE_APPLIED'
      : contextProfileState === 'BLOCKED'
        ? 'BLOCKED_PROFILE_FALLBACK'
        : 'BASELINE_IDENTITY';

  return Object.freeze({
    format: 'furypipe-provider-attempt-context-runtime/v1',
    providerId: plan.providerId,
    model: plan.model,
    workloadId: plan.workloadId,
    prompt,
    contextPlan,
    contextProfileState,
    profileDisposition,
    profileApplied,
    ...(profileApplied ? {
      profileId: plan.contextProfile.profileId!,
      profileDigest: plan.contextProfile.profileDigest!,
    } : {}),
    profileBlockers: blockers,
    profileQualificationEvidence: profileApplied ? 'verified' : 'none',
    currentContextResultVerified: false,
    contextInjected: contextPlan.included.length > 0,
    injectedContextBytes: rendered.bytes,
    tokenEstimateStatus: contextPlan.estimatedTokens === undefined
      ? 'UNKNOWN'
      : 'CHARACTER_RATIO_ESTIMATE',
    secretPolicy,
    optimizerExecuted: true,
    networkCallExecuted: false,
    providerRequestExecuted: false,
    executionAuthorized: false,
  });
}
