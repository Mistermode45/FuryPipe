import {
  FURY_CONTEXT_KINDS,
  FURY_CONTEXT_LEVELS,
  type FuryContextCacheClass,
  type FuryContextExactness,
  type FuryContextItem,
  type FuryContextKind,
  type FuryContextLevel,
} from './context-optimizer.js';
import type { ProviderRuntimeState } from './core/provider-runtime.js';
import {
  prepareProviderAttemptContext,
  type FuryProviderAttemptContextSecurityPolicy,
} from './provider-attempt-context-runtime.js';
import {
  createProviderAttemptPlanner,
  type FuryProviderAttemptPlannerInput,
} from './provider-attempt-planner.js';
import {
  createProviderExecutionGate,
  type FuryProviderExecutionPolicy,
} from './provider-execution-gate.js';
import {
  FuryGovernedProviderExecutorError,
  type FuryGovernedProviderExecutorErrorCode,
} from './provider-execution-errors.js';
import {
  canonicalProviderId,
  exactIdentifier,
  MAX_PROVIDER_EXECUTION_PERMIT_TTL_MS,
  ownDataRecord,
  safeTimestamp,
} from './provider-execution-internal.js';
import {
  createGovernedProviderExecutor,
  isGeneratedGovernedProviderExecutionResult,
  type GovernedProviderExecutionResult,
} from './governed-provider-executor.js';
import { prepareProviderRequestEnvelope } from './provider-request-envelope.js';
import type { ProviderTransportRegistry } from './provider-transport.js';

export type FuryProviderSafeContinuationReason =
  | 'provider-not-registered'
  | 'provider-health-not-fresh'
  | 'provider-unavailable'
  | 'model-not-supported'
  | 'model-family-mismatch'
  | 'transport-not-registered'
  | 'network-not-executed';

export interface FuryProviderRetryFallbackContinuationPolicy {
  readonly format: 'furypipe-provider-retry-fallback-continuation-policy/v1';
  /** Exact reasons that may continue to another identical provider/model attempt. */
  readonly retryOn: readonly FuryProviderSafeContinuationReason[];
  /** Exact reasons that may continue to the next provider/model candidate. */
  readonly fallbackOn: readonly FuryProviderSafeContinuationReason[];
  /** Exact HTTP rejection statuses that may retry the same provider/model. */
  readonly retryHttpStatuses: readonly number[];
  /** Exact HTTP rejection statuses that may move to another model/provider. */
  readonly fallbackHttpStatuses: readonly number[];
  /** Required for a transition whose next provider differs from the current provider. */
  readonly allowCrossProviderFallback: boolean;
}

export interface FuryProviderRetryFallbackAttempt {
  readonly providerId: string;
  readonly model: string;
  /**
   * Explicit host authority for this exact provider/model/workload attempt.
   * Repeated attempts require distinct policy identities.
   */
  readonly policy: FuryProviderExecutionPolicy;
}

export interface FuryProviderRetryFallbackRunInput {
  readonly workloadId: string;
  /**
   * Exact ordered sequence. FuryPipe never discovers, appends, or reorders an
   * attempt. Repeating the same provider/model is an explicit retry request.
   */
  readonly attempts: readonly FuryProviderRetryFallbackAttempt[];
  readonly continuationPolicy: FuryProviderRetryFallbackContinuationPolicy;
  /** Host-owned inventory copied before the first network-capable operation. */
  readonly items: readonly FuryContextItem[];
  readonly securityPolicy?: FuryProviderAttemptContextSecurityPolicy;
  /** Optional character-ratio estimate; never provider token evidence. */
  readonly charsPerTokenEstimate?: number;
  readonly signal?: AbortSignal;
}

export interface FuryProviderRetryFallbackOrchestratorOptions {
  /** Captures one model-neutral BASE prompt plus adapter/profile registries. */
  readonly planner: FuryProviderAttemptPlannerInput;
  readonly providerRuntime: ProviderRuntimeState;
  readonly transports: ProviderTransportRegistry;
  readonly now?: () => number;
}

export type FuryProviderRetryFallbackOutcome =
  | 'SUCCEEDED'
  | 'STOPPED'
  | 'EXHAUSTED'
  | 'BLOCKED'
  | 'AMBIGUOUS_STOP'
  | 'RETRY_DELAY_REQUIRED'
  | 'CANCELLED';

export type FuryProviderRetryFallbackAttemptStage =
  | 'plan'
  | 'context'
  | 'request'
  | 'authorize'
  | 'execute';

export type FuryProviderRetryFallbackAttemptDecision =
  | 'STOP_SUCCEEDED'
  | 'CONTINUE_PRE_EXECUTION'
  | 'CONTINUE_PROVIDER_REJECTED'
  | 'CONTINUE_NETWORK_NOT_EXECUTED'
  | 'STOP_POLICY'
  | 'STOP_BLOCKED'
  | 'STOP_AMBIGUOUS'
  | 'STOP_RETRY_DELAY'
  | 'STOP_CANCELLED';

export type FuryProviderRetryFallbackAttemptErrorCode =
  | FuryGovernedProviderExecutorErrorCode
  | 'attempt-planning-failed'
  | 'context-preparation-failed'
  | 'request-preparation-failed'
  | 'execution-result-provenance-failed';

export interface FuryProviderRetryFallbackAttemptRecord {
  readonly format: 'furypipe-provider-retry-fallback-attempt/v1';
  readonly index: number;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly stage: FuryProviderRetryFallbackAttemptStage;
  readonly decision: FuryProviderRetryFallbackAttemptDecision;
  /** Every record was rebuilt by a planner captured from the original BASE. */
  readonly rebuiltFromCapturedBase: true;
  readonly transportInvoked: boolean;
  readonly requestDigest?: string;
  readonly promptDigest?: string;
  readonly adapterState?: 'IDENTITY' | 'APPLIED' | 'BLOCKED';
  readonly adapterId?: string;
  readonly contextProfileState?: 'IDENTITY' | 'QUALIFIED' | 'BLOCKED';
  readonly contextProfileId?: string;
  readonly errorCode?: FuryProviderRetryFallbackAttemptErrorCode;
  readonly network?: GovernedProviderExecutionResult['network'];
  readonly providerRequest?: GovernedProviderExecutionResult['providerRequest'];
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
}

export interface FuryProviderRetryFallbackResult {
  readonly format: 'furypipe-provider-retry-fallback-result/v1';
  readonly workloadId: string;
  readonly outcome: FuryProviderRetryFallbackOutcome;
  readonly attemptsPlanned: number;
  readonly attemptsProcessed: number;
  readonly transportInvocations: number;
  /** Metadata only: no prompt/context/credentials/response bytes/policy identifiers. */
  readonly attempts: readonly FuryProviderRetryFallbackAttemptRecord[];
  /**
   * Application result returned only after explicit transport-reported provider
   * acceptance. This may contain response bytes and is not a plaintext-free receipt.
   */
  readonly execution?: GovernedProviderExecutionResult;
  readonly retryAfterMs?: number;
}

export interface FuryProviderRetryFallbackOrchestrator {
  run(input: FuryProviderRetryFallbackRunInput): Promise<FuryProviderRetryFallbackResult>;
}

export type FuryProviderRetryFallbackOrchestratorErrorCode =
  | 'invalid-input'
  | 'invalid-attempt-sequence'
  | 'invalid-continuation-policy'
  | 'execution-policy-mismatch';

const SAFE_ORCHESTRATOR_MESSAGES: Readonly<
  Record<FuryProviderRetryFallbackOrchestratorErrorCode, string>
> = Object.freeze({
  'invalid-input': 'Provider retry/fallback orchestration input is invalid.',
  'invalid-attempt-sequence': 'Provider retry/fallback attempt sequence is invalid.',
  'invalid-continuation-policy': 'Provider retry/fallback continuation policy is invalid.',
  'execution-policy-mismatch': 'An execution policy does not match its exact provider attempt.',
});

export class FuryProviderRetryFallbackOrchestratorError extends Error {
  constructor(readonly code: FuryProviderRetryFallbackOrchestratorErrorCode) {
    super(SAFE_ORCHESTRATOR_MESSAGES[code]);
    this.name = 'FuryProviderRetryFallbackOrchestratorError';
  }
}

const MAX_ATTEMPTS = 32;
const MAX_CONTEXT_ITEMS = 4096;
const MAX_CONTEXT_REPRESENTATION_BYTES = 256 * 1024;
const MAX_TOTAL_CONTEXT_BYTES = 16 * 1024 * 1024;
const ITEM_KEYS = Object.freeze([
  'id', 'kind', 'representations', 'required', 'selected', 'discoverable',
  'relevance', 'importance', 'reuseProbability', 'cacheClass', 'exactness',
  'minimumLevel', 'preferredLevel',
]);
const REPRESENTATION_KEYS = Object.freeze(['level', 'content']);
const ATTEMPT_KEYS = Object.freeze(['providerId', 'model', 'policy']);
const POLICY_KEYS = Object.freeze([
  'format', 'policyId', 'allowProviderRequest', 'providerId', 'model', 'workloadId', 'expiresInMs',
]);
const CONTINUATION_POLICY_KEYS = Object.freeze([
  'format', 'retryOn', 'fallbackOn', 'retryHttpStatuses', 'fallbackHttpStatuses',
  'allowCrossProviderFallback',
]);
const SECURITY_POLICY_KEYS = Object.freeze(['allowSecret']);
const RUN_KEYS = Object.freeze([
  'workloadId', 'attempts', 'continuationPolicy', 'items', 'securityPolicy',
  'charsPerTokenEstimate', 'signal',
]);
const CACHE_CLASSES = new Set<FuryContextCacheClass>([
  'stable', 'semi-stable', 'dynamic', 'not-cacheable',
]);
const EXACTNESS_VALUES = new Set<FuryContextExactness>(['normal', 'exact', 'secret']);
const SAFE_CONTINUATION_REASONS = new Set<FuryProviderSafeContinuationReason>([
  'provider-not-registered',
  'provider-health-not-fresh',
  'provider-unavailable',
  'model-not-supported',
  'model-family-mismatch',
  'transport-not-registered',
  'network-not-executed',
]);
const PRE_EXECUTION_CONTINUATION_ERRORS = new Set<FuryGovernedProviderExecutorErrorCode>([
  'provider-not-registered',
  'provider-health-not-fresh',
  'provider-unavailable',
  'model-not-supported',
  'model-family-mismatch',
  'transport-not-registered',
]);
const LEVEL_RANK: Readonly<Record<FuryContextLevel, number>> = Object.freeze({
  metadata: 0,
  summary: 1,
  full: 2,
  executable: 3,
});
const encoder = new TextEncoder();
const GENERATED_ORCHESTRATION_RESULTS = new WeakSet<object>();

interface NormalizedContinuationPolicy {
  readonly retryOn: ReadonlySet<FuryProviderSafeContinuationReason>;
  readonly fallbackOn: ReadonlySet<FuryProviderSafeContinuationReason>;
  readonly retryHttpStatuses: ReadonlySet<number>;
  readonly fallbackHttpStatuses: ReadonlySet<number>;
  readonly allowCrossProviderFallback: boolean;
}

type AttemptTransition = 'retry' | 'fallback';

export function isGeneratedProviderRetryFallbackResult(
  value: unknown,
): value is FuryProviderRetryFallbackResult {
  return value !== null
    && typeof value === 'object'
    && GENERATED_ORCHESTRATION_RESULTS.has(value);
}

function orchestrationFail(code: FuryProviderRetryFallbackOrchestratorErrorCode): never {
  throw new FuryProviderRetryFallbackOrchestratorError(code);
}

function knownKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: FuryProviderRetryFallbackOrchestratorErrorCode = 'invalid-input',
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) orchestrationFail(code);
  }
}

function unit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    orchestrationFail('invalid-input');
  }
  return value;
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') orchestrationFail('invalid-input');
  return value;
}

function contextLevel(value: unknown): FuryContextLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !FURY_CONTEXT_LEVELS.includes(value as FuryContextLevel)) {
    orchestrationFail('invalid-input');
  }
  return value as FuryContextLevel;
}

function snapshotContextItems(value: unknown): readonly FuryContextItem[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_ITEMS) orchestrationFail('invalid-input');
  const ids = new Set<string>();
  const output: FuryContextItem[] = [];
  let totalBytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) orchestrationFail('invalid-input');
    let item: Readonly<Record<string, unknown>>;
    try {
      item = ownDataRecord(value[index]);
    } catch {
      orchestrationFail('invalid-input');
    }
    knownKeys(item, ITEM_KEYS);
    if (
      typeof item.id !== 'string'
      || item.id.length < 1
      || item.id.length > 160
      || item.id !== item.id.trim()
      || item.id.includes('\0')
      || ids.has(item.id)
      || typeof item.kind !== 'string'
      || !FURY_CONTEXT_KINDS.includes(item.kind as FuryContextKind)
      || !Array.isArray(item.representations)
      || item.representations.length < 1
      || item.representations.length > FURY_CONTEXT_LEVELS.length
    ) orchestrationFail('invalid-input');
    ids.add(item.id);

    const levels = new Set<FuryContextLevel>();
    const representations: { readonly level: FuryContextLevel; readonly content: string }[] = [];
    for (let representationIndex = 0; representationIndex < item.representations.length; representationIndex += 1) {
      if (!Object.hasOwn(item.representations, representationIndex)) orchestrationFail('invalid-input');
      let representation: Readonly<Record<string, unknown>>;
      try {
        representation = ownDataRecord(item.representations[representationIndex]);
      } catch {
        orchestrationFail('invalid-input');
      }
      knownKeys(representation, REPRESENTATION_KEYS);
      const level = contextLevel(representation.level);
      if (
        level === undefined
        || levels.has(level)
        || typeof representation.content !== 'string'
        || representation.content.includes('\0')
      ) orchestrationFail('invalid-input');
      levels.add(level);
      const size = encoder.encode(representation.content).byteLength;
      if (size > MAX_CONTEXT_REPRESENTATION_BYTES) orchestrationFail('invalid-input');
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_CONTEXT_BYTES) orchestrationFail('invalid-input');
      representations.push(Object.freeze({ level, content: representation.content }));
    }

    const required = booleanValue(item.required);
    const selected = booleanValue(item.selected);
    const discoverable = booleanValue(item.discoverable);
    const relevance = unit(item.relevance);
    const importance = unit(item.importance);
    const reuseProbability = unit(item.reuseProbability);
    let cacheClass: FuryContextCacheClass | undefined;
    if (item.cacheClass !== undefined) {
      if (typeof item.cacheClass !== 'string' || !CACHE_CLASSES.has(item.cacheClass as FuryContextCacheClass)) {
        orchestrationFail('invalid-input');
      }
      cacheClass = item.cacheClass as FuryContextCacheClass;
    }
    let exactness: FuryContextExactness | undefined;
    if (item.exactness !== undefined) {
      if (typeof item.exactness !== 'string' || !EXACTNESS_VALUES.has(item.exactness as FuryContextExactness)) {
        orchestrationFail('invalid-input');
      }
      exactness = item.exactness as FuryContextExactness;
    }
    const minimumLevel = contextLevel(item.minimumLevel);
    const preferredLevel = contextLevel(item.preferredLevel);
    if (
      minimumLevel !== undefined
      && preferredLevel !== undefined
      && LEVEL_RANK[minimumLevel] > LEVEL_RANK[preferredLevel]
    ) orchestrationFail('invalid-input');

    output.push(Object.freeze({
      id: item.id,
      kind: item.kind as FuryContextKind,
      representations: Object.freeze(representations),
      ...(required === undefined ? {} : { required }),
      ...(selected === undefined ? {} : { selected }),
      ...(discoverable === undefined ? {} : { discoverable }),
      ...(relevance === undefined ? {} : { relevance }),
      ...(importance === undefined ? {} : { importance }),
      ...(reuseProbability === undefined ? {} : { reuseProbability }),
      ...(cacheClass === undefined ? {} : { cacheClass }),
      ...(exactness === undefined ? {} : { exactness }),
      ...(minimumLevel === undefined ? {} : { minimumLevel }),
      ...(preferredLevel === undefined ? {} : { preferredLevel }),
    }));
  }
  return Object.freeze(output);
}

function snapshotSecurityPolicy(
  value: unknown,
): FuryProviderAttemptContextSecurityPolicy | undefined {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
  } catch {
    orchestrationFail('invalid-input');
  }
  knownKeys(record, SECURITY_POLICY_KEYS);
  if (record.allowSecret !== undefined && typeof record.allowSecret !== 'boolean') {
    orchestrationFail('invalid-input');
  }
  return Object.freeze({
    ...(record.allowSecret === undefined ? {} : { allowSecret: record.allowSecret as boolean }),
  });
}

function snapshotSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as AbortSignal).aborted !== 'boolean'
    || typeof (value as AbortSignal).addEventListener !== 'function'
    || typeof (value as AbortSignal).removeEventListener !== 'function'
  ) orchestrationFail('invalid-input');
  return value as AbortSignal;
}

function snapshotPolicy(
  value: unknown,
  providerId: string,
  model: string,
  workloadId: string,
): FuryProviderExecutionPolicy {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
  } catch {
    orchestrationFail('invalid-attempt-sequence');
  }
  knownKeys(record, POLICY_KEYS, 'invalid-attempt-sequence');
  if (
    record.format !== 'furypipe-provider-execution-policy/v1'
    || !exactIdentifier(record.policyId, 128)
    || typeof record.allowProviderRequest !== 'boolean'
    || !canonicalProviderId(record.providerId)
    || !exactIdentifier(record.model)
    || !exactIdentifier(record.workloadId)
    || !Number.isSafeInteger(record.expiresInMs)
    || (record.expiresInMs as number) < 1
    || (record.expiresInMs as number) > MAX_PROVIDER_EXECUTION_PERMIT_TTL_MS
  ) orchestrationFail('invalid-attempt-sequence');
  if (
    record.providerId !== providerId
    || record.model !== model
    || record.workloadId !== workloadId
  ) orchestrationFail('execution-policy-mismatch');

  return Object.freeze({
    format: 'furypipe-provider-execution-policy/v1',
    policyId: record.policyId,
    allowProviderRequest: record.allowProviderRequest,
    providerId,
    model,
    workloadId,
    expiresInMs: record.expiresInMs,
  }) as FuryProviderExecutionPolicy;
}

function snapshotAttempts(
  value: unknown,
  workloadId: string,
): readonly FuryProviderRetryFallbackAttempt[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ATTEMPTS) {
    orchestrationFail('invalid-attempt-sequence');
  }
  const output: FuryProviderRetryFallbackAttempt[] = [];
  const policyIds = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) orchestrationFail('invalid-attempt-sequence');
    let record: Readonly<Record<string, unknown>>;
    try {
      record = ownDataRecord(value[index]);
    } catch {
      orchestrationFail('invalid-attempt-sequence');
    }
    knownKeys(record, ATTEMPT_KEYS, 'invalid-attempt-sequence');
    if (!canonicalProviderId(record.providerId) || !exactIdentifier(record.model)) {
      orchestrationFail('invalid-attempt-sequence');
    }
    const policy = snapshotPolicy(record.policy, record.providerId, record.model, workloadId);
    if (policyIds.has(policy.policyId)) orchestrationFail('invalid-attempt-sequence');
    policyIds.add(policy.policyId);
    output.push(Object.freeze({
      providerId: record.providerId,
      model: record.model,
      policy,
    }));
  }
  return Object.freeze(output);
}

function exactReasonArray(
  value: unknown,
): readonly FuryProviderSafeContinuationReason[] {
  if (!Array.isArray(value) || value.length > SAFE_CONTINUATION_REASONS.size) {
    orchestrationFail('invalid-continuation-policy');
  }
  const seen = new Set<FuryProviderSafeContinuationReason>();
  const output: FuryProviderSafeContinuationReason[] = [];
  for (const reason of value as readonly unknown[]) {
    if (typeof reason !== 'string' || !SAFE_CONTINUATION_REASONS.has(reason as FuryProviderSafeContinuationReason)) {
      orchestrationFail('invalid-continuation-policy');
    }
    const typed = reason as FuryProviderSafeContinuationReason;
    if (seen.has(typed)) orchestrationFail('invalid-continuation-policy');
    seen.add(typed);
    output.push(typed);
  }
  return Object.freeze(output);
}

function exactHttpStatusArray(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length > 32) orchestrationFail('invalid-continuation-policy');
  const seen = new Set<number>();
  const output: number[] = [];
  for (const status of value as readonly unknown[]) {
    if (
      typeof status !== 'number'
      || !Number.isSafeInteger(status)
      || status < 400
      || status > 599
      || seen.has(status)
    ) orchestrationFail('invalid-continuation-policy');
    seen.add(status);
    output.push(status);
  }
  return Object.freeze(output);
}

function snapshotContinuationPolicy(value: unknown): NormalizedContinuationPolicy {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
  } catch {
    orchestrationFail('invalid-continuation-policy');
  }
  knownKeys(record, CONTINUATION_POLICY_KEYS, 'invalid-continuation-policy');
  if (
    record.format !== 'furypipe-provider-retry-fallback-continuation-policy/v1'
    || typeof record.allowCrossProviderFallback !== 'boolean'
  ) orchestrationFail('invalid-continuation-policy');

  return Object.freeze({
    retryOn: new Set(exactReasonArray(record.retryOn)),
    fallbackOn: new Set(exactReasonArray(record.fallbackOn)),
    retryHttpStatuses: new Set(exactHttpStatusArray(record.retryHttpStatuses)),
    fallbackHttpStatuses: new Set(exactHttpStatusArray(record.fallbackHttpStatuses)),
    allowCrossProviderFallback: record.allowCrossProviderFallback,
  });
}

function snapshotRunInput(input: FuryProviderRetryFallbackRunInput): {
  readonly workloadId: string;
  readonly attempts: readonly FuryProviderRetryFallbackAttempt[];
  readonly continuationPolicy: NormalizedContinuationPolicy;
  readonly items: readonly FuryContextItem[];
  readonly securityPolicy?: FuryProviderAttemptContextSecurityPolicy;
  readonly charsPerTokenEstimate?: number;
  readonly signal?: AbortSignal;
} {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(input);
  } catch {
    orchestrationFail('invalid-input');
  }
  knownKeys(record, RUN_KEYS);
  if (!exactIdentifier(record.workloadId)) orchestrationFail('invalid-input');
  const attempts = snapshotAttempts(record.attempts, record.workloadId);
  const continuationPolicy = snapshotContinuationPolicy(record.continuationPolicy);
  const items = snapshotContextItems(record.items);
  const securityPolicy = snapshotSecurityPolicy(record.securityPolicy);
  if (
    record.charsPerTokenEstimate !== undefined
    && (
      typeof record.charsPerTokenEstimate !== 'number'
      || !Number.isFinite(record.charsPerTokenEstimate)
      || record.charsPerTokenEstimate < 1
      || record.charsPerTokenEstimate > 16
    )
  ) orchestrationFail('invalid-input');
  const signal = snapshotSignal(record.signal);
  return Object.freeze({
    workloadId: record.workloadId,
    attempts,
    continuationPolicy,
    items,
    ...(securityPolicy === undefined ? {} : { securityPolicy }),
    ...(record.charsPerTokenEstimate === undefined
      ? {}
      : { charsPerTokenEstimate: record.charsPerTokenEstimate as number }),
    ...(signal === undefined ? {} : { signal }),
  });
}

function transitionFor(
  current: FuryProviderRetryFallbackAttempt,
  next: FuryProviderRetryFallbackAttempt,
): AttemptTransition {
  return current.providerId === next.providerId && current.model === next.model
    ? 'retry'
    : 'fallback';
}

function crossProviderBlocked(
  policy: NormalizedContinuationPolicy,
  current: FuryProviderRetryFallbackAttempt,
  next: FuryProviderRetryFallbackAttempt,
): boolean {
  return current.providerId !== next.providerId && !policy.allowCrossProviderFallback;
}

function reasonAllows(
  policy: NormalizedContinuationPolicy,
  transition: AttemptTransition,
  reason: FuryProviderSafeContinuationReason,
): boolean {
  return transition === 'retry'
    ? policy.retryOn.has(reason)
    : policy.fallbackOn.has(reason);
}

function httpStatusAllows(
  policy: NormalizedContinuationPolicy,
  transition: AttemptTransition,
  status: number,
): boolean {
  return transition === 'retry'
    ? policy.retryHttpStatuses.has(status)
    : policy.fallbackHttpStatuses.has(status);
}

function attemptRecord(input: {
  readonly index: number;
  readonly attempt: FuryProviderRetryFallbackAttempt;
  readonly workloadId: string;
  readonly stage: FuryProviderRetryFallbackAttemptStage;
  readonly decision: FuryProviderRetryFallbackAttemptDecision;
  readonly transportInvoked: boolean;
  readonly requestDigest?: string;
  readonly promptDigest?: string;
  readonly adapterState?: 'IDENTITY' | 'APPLIED' | 'BLOCKED';
  readonly adapterId?: string;
  readonly contextProfileState?: 'IDENTITY' | 'QUALIFIED' | 'BLOCKED';
  readonly contextProfileId?: string;
  readonly errorCode?: FuryProviderRetryFallbackAttemptErrorCode;
  readonly execution?: GovernedProviderExecutionResult;
}): FuryProviderRetryFallbackAttemptRecord {
  const execution = input.execution;
  return Object.freeze({
    format: 'furypipe-provider-retry-fallback-attempt/v1' as const,
    index: input.index,
    providerId: input.attempt.providerId,
    model: input.attempt.model,
    workloadId: input.workloadId,
    stage: input.stage,
    decision: input.decision,
    rebuiltFromCapturedBase: true as const,
    transportInvoked: input.transportInvoked,
    ...(input.requestDigest === undefined ? {} : { requestDigest: input.requestDigest }),
    ...(input.promptDigest === undefined ? {} : { promptDigest: input.promptDigest }),
    ...(input.adapterState === undefined ? {} : { adapterState: input.adapterState }),
    ...(input.adapterId === undefined ? {} : { adapterId: input.adapterId }),
    ...(input.contextProfileState === undefined ? {} : { contextProfileState: input.contextProfileState }),
    ...(input.contextProfileId === undefined ? {} : { contextProfileId: input.contextProfileId }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(execution === undefined ? {} : {
      network: execution.network,
      providerRequest: execution.providerRequest,
      ...(execution.httpStatus === undefined ? {} : { httpStatus: execution.httpStatus }),
      ...(execution.retryAfterMs === undefined ? {} : { retryAfterMs: execution.retryAfterMs }),
    }),
  });
}

function finalResult(input: {
  readonly workloadId: string;
  readonly attemptsPlanned: number;
  readonly outcome: FuryProviderRetryFallbackOutcome;
  readonly attempts: readonly FuryProviderRetryFallbackAttemptRecord[];
  readonly execution?: GovernedProviderExecutionResult;
  readonly retryAfterMs?: number;
}): FuryProviderRetryFallbackResult {
  const attempts = Object.freeze([...input.attempts]);
  const result: FuryProviderRetryFallbackResult = Object.freeze({
    format: 'furypipe-provider-retry-fallback-result/v1',
    workloadId: input.workloadId,
    outcome: input.outcome,
    attemptsPlanned: input.attemptsPlanned,
    attemptsProcessed: attempts.length,
    transportInvocations: attempts.filter((entry) => entry.transportInvoked).length,
    attempts,
    ...(input.execution === undefined ? {} : { execution: input.execution }),
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
  });
  GENERATED_ORCHESTRATION_RESULTS.add(result);
  return result;
}

function stageFailureCode(
  stage: FuryProviderRetryFallbackAttemptStage,
): FuryProviderRetryFallbackAttemptErrorCode {
  switch (stage) {
    case 'plan': return 'attempt-planning-failed';
    case 'context': return 'context-preparation-failed';
    case 'request': return 'request-preparation-failed';
    case 'authorize':
    case 'execute':
      return 'invalid-input';
  }
}

function contradictoryExecution(result: GovernedProviderExecutionResult): boolean {
  if (
    result.network.status === 'not-executed'
    && (
      result.providerRequest.status !== 'unknown'
      || result.httpStatus !== undefined
      || result.providerRequestId !== undefined
    )
  ) return true;
  if (
    result.providerRequest.status === 'accepted'
    && result.httpStatus !== undefined
    && (result.httpStatus < 200 || result.httpStatus >= 300)
  ) return true;
  if (
    result.providerRequest.status === 'rejected'
    && result.httpStatus !== undefined
    && result.httpStatus >= 200
    && result.httpStatus < 300
  ) return true;
  return false;
}

function executionState(
  result: GovernedProviderExecutionResult,
): 'accepted' | 'rejected' | 'not-executed' | 'ambiguous' {
  if (contradictoryExecution(result)) return 'ambiguous';
  if (
    result.providerRequest.status === 'accepted'
    && result.providerRequest.evidence === 'transport-reported'
  ) return 'accepted';
  if (
    result.providerRequest.status === 'rejected'
    && result.providerRequest.evidence === 'transport-reported'
  ) return 'rejected';
  if (
    result.network.status === 'not-executed'
    && result.network.evidence === 'transport-reported'
    && result.providerRequest.status === 'unknown'
  ) return 'not-executed';
  return 'ambiguous';
}

interface FuryProviderRetryFallbackPlanMetadata {
  readonly adapterState?: 'IDENTITY' | 'APPLIED' | 'BLOCKED';
  readonly adapterId?: string;
  readonly contextProfileState?: 'IDENTITY' | 'QUALIFIED' | 'BLOCKED';
  readonly contextProfileId?: string;
}

function planMetadata(
  plan: ReturnType<ReturnType<typeof createProviderAttemptPlanner>['plan']>,
): FuryProviderRetryFallbackPlanMetadata {
  return {
    adapterState: plan.adapter.adapterState,
    ...(plan.adapter.adapterId === undefined ? {} : { adapterId: plan.adapter.adapterId }),
    contextProfileState: plan.contextProfileState,
    ...(plan.contextProfile.profileId === undefined
      ? {}
      : { contextProfileId: plan.contextProfile.profileId }),
  };
}

/**
 * Sequence explicit governed attempts above the single-attempt executor.
 *
 * The Provider Attempt Planner captures one model-neutral BASE prompt at
 * construction time. Every loop iteration calls planner.plan() independently,
 * then rebuilds context -> request -> permit -> exact transport. A previous
 * attempt's provider-specific prompt/request/permit is never accepted as input.
 */
export function createProviderRetryFallbackOrchestrator(
  options: FuryProviderRetryFallbackOrchestratorOptions,
): FuryProviderRetryFallbackOrchestrator {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('provider retry/fallback orchestrator options are required');
  }
  const planner = createProviderAttemptPlanner(options.planner);
  const gate = createProviderExecutionGate({
    providerRuntime: options.providerRuntime,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const executor = createGovernedProviderExecutor({
    transports: options.transports,
    providerRuntime: options.providerRuntime,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const nowSource = options.now ?? Date.now;
  if (typeof nowSource !== 'function') {
    throw new TypeError('provider retry/fallback orchestrator clock must be a function');
  }

  return Object.freeze({
    async run(input: FuryProviderRetryFallbackRunInput): Promise<FuryProviderRetryFallbackResult> {
      const run = snapshotRunInput(input);
      const records: FuryProviderRetryFallbackAttemptRecord[] = [];

      if (run.signal?.aborted) {
        return finalResult({
          workloadId: run.workloadId,
          attemptsPlanned: run.attempts.length,
          outcome: 'CANCELLED',
          attempts: records,
        });
      }

      for (let index = 0; index < run.attempts.length; index += 1) {
        const attempt = run.attempts[index]!;
        const next = run.attempts[index + 1];
        if (run.signal?.aborted) {
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'CANCELLED',
            attempts: records,
          });
        }

        let stage: FuryProviderRetryFallbackAttemptStage = 'plan';
        let requestDigest: string | undefined;
        let promptDigest: string | undefined;
        let metadata: FuryProviderRetryFallbackPlanMetadata = {};
        let execution: unknown;

        try {
          const plan = planner.plan({
            providerId: attempt.providerId,
            model: attempt.model,
            workloadId: run.workloadId,
          });
          metadata = planMetadata(plan);

          stage = 'context';
          const context = prepareProviderAttemptContext({
            attemptPlan: plan,
            items: run.items,
            ...(run.securityPolicy === undefined ? {} : { securityPolicy: run.securityPolicy }),
            ...(run.charsPerTokenEstimate === undefined
              ? {}
              : { charsPerTokenEstimate: run.charsPerTokenEstimate }),
          });

          stage = 'request';
          let now: number;
          try {
            now = nowSource();
          } catch {
            orchestrationFail('invalid-input');
          }
          if (!safeTimestamp(now)) orchestrationFail('invalid-input');
          const request = prepareProviderRequestEnvelope(
            context,
            options.providerRuntime.registry(now),
          );
          requestDigest = request.requestDigest;
          promptDigest = request.promptDigest;

          stage = 'authorize';
          const permit = gate.authorize(request, attempt.policy);

          stage = 'execute';
          execution = await executor.execute(
            request,
            permit,
            run.signal === undefined ? undefined : { signal: run.signal },
          );
        } catch (error) {
          if (error instanceof FuryProviderRetryFallbackOrchestratorError) throw error;

          if (error instanceof FuryGovernedProviderExecutorError) {
            if (error.transportInvoked) {
              records.push(attemptRecord({
                index,
                attempt,
                workloadId: run.workloadId,
                stage,
                decision: 'STOP_AMBIGUOUS',
                transportInvoked: true,
                ...(requestDigest === undefined ? {} : { requestDigest }),
                ...(promptDigest === undefined ? {} : { promptDigest }),
                ...metadata,
                errorCode: error.code,
              }));
              return finalResult({
                workloadId: run.workloadId,
                attemptsPlanned: run.attempts.length,
                outcome: 'AMBIGUOUS_STOP',
                attempts: records,
              });
            }

            if (PRE_EXECUTION_CONTINUATION_ERRORS.has(error.code)) {
              const reason = error.code as FuryProviderSafeContinuationReason;
              if (next === undefined) {
                records.push(attemptRecord({
                  index,
                  attempt,
                  workloadId: run.workloadId,
                  stage,
                  decision: 'STOP_POLICY',
                  transportInvoked: false,
                  ...(requestDigest === undefined ? {} : { requestDigest }),
                  ...(promptDigest === undefined ? {} : { promptDigest }),
                  ...metadata,
                  errorCode: error.code,
                }));
                return finalResult({
                  workloadId: run.workloadId,
                  attemptsPlanned: run.attempts.length,
                  outcome: 'EXHAUSTED',
                  attempts: records,
                });
              }
              const transition = transitionFor(attempt, next);
              const allowed = !crossProviderBlocked(run.continuationPolicy, attempt, next)
                && reasonAllows(run.continuationPolicy, transition, reason);
              records.push(attemptRecord({
                index,
                attempt,
                workloadId: run.workloadId,
                stage,
                decision: allowed ? 'CONTINUE_PRE_EXECUTION' : 'STOP_POLICY',
                transportInvoked: false,
                ...(requestDigest === undefined ? {} : { requestDigest }),
                ...(promptDigest === undefined ? {} : { promptDigest }),
                ...metadata,
                errorCode: error.code,
              }));
              if (allowed) continue;
              return finalResult({
                workloadId: run.workloadId,
                attemptsPlanned: run.attempts.length,
                outcome: 'STOPPED',
                attempts: records,
              });
            }

            records.push(attemptRecord({
              index,
              attempt,
              workloadId: run.workloadId,
              stage,
              decision: 'STOP_BLOCKED',
              transportInvoked: false,
              ...(requestDigest === undefined ? {} : { requestDigest }),
              ...(promptDigest === undefined ? {} : { promptDigest }),
              ...metadata,
              errorCode: error.code,
            }));
            return finalResult({
              workloadId: run.workloadId,
              attemptsPlanned: run.attempts.length,
              outcome: 'BLOCKED',
              attempts: records,
            });
          }

          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage,
            decision: 'STOP_BLOCKED',
            transportInvoked: false,
            ...(requestDigest === undefined ? {} : { requestDigest }),
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            errorCode: stageFailureCode(stage),
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'BLOCKED',
            attempts: records,
          });
        }

        if (!isGeneratedGovernedProviderExecutionResult(execution)) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_BLOCKED',
            transportInvoked: true,
            ...(requestDigest === undefined ? {} : { requestDigest }),
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            errorCode: 'execution-result-provenance-failed',
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'BLOCKED',
            attempts: records,
          });
        }

        const state = executionState(execution);
        if (state === 'accepted') {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_SUCCEEDED',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'SUCCEEDED',
            attempts: records,
            execution,
          });
        }

        if (state === 'ambiguous') {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_AMBIGUOUS',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'AMBIGUOUS_STOP',
            attempts: records,
          });
        }

        if (run.signal?.aborted) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_CANCELLED',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'CANCELLED',
            attempts: records,
          });
        }

        if (next === undefined) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_POLICY',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'EXHAUSTED',
            attempts: records,
          });
        }

        const transition = transitionFor(attempt, next);
        if (crossProviderBlocked(run.continuationPolicy, attempt, next)) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_POLICY',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'STOPPED',
            attempts: records,
          });
        }

        let continuationAllowed = false;
        let decision: FuryProviderRetryFallbackAttemptDecision;
        if (state === 'rejected') {
          continuationAllowed = execution.httpStatus !== undefined
            && httpStatusAllows(run.continuationPolicy, transition, execution.httpStatus);
          decision = continuationAllowed ? 'CONTINUE_PROVIDER_REJECTED' : 'STOP_POLICY';
        } else {
          continuationAllowed = reasonAllows(
            run.continuationPolicy,
            transition,
            'network-not-executed',
          );
          decision = continuationAllowed ? 'CONTINUE_NETWORK_NOT_EXECUTED' : 'STOP_POLICY';
        }

        if (!continuationAllowed) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision,
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'STOPPED',
            attempts: records,
          });
        }

        if (
          execution.retryAfterMs !== undefined
          && execution.retryAfterMs > 0
          && next.providerId === attempt.providerId
        ) {
          records.push(attemptRecord({
            index,
            attempt,
            workloadId: run.workloadId,
            stage: 'execute',
            decision: 'STOP_RETRY_DELAY',
            transportInvoked: true,
            requestDigest: execution.requestDigest,
            ...(promptDigest === undefined ? {} : { promptDigest }),
            ...metadata,
            execution,
          }));
          return finalResult({
            workloadId: run.workloadId,
            attemptsPlanned: run.attempts.length,
            outcome: 'RETRY_DELAY_REQUIRED',
            attempts: records,
            retryAfterMs: execution.retryAfterMs,
          });
        }

        records.push(attemptRecord({
          index,
          attempt,
          workloadId: run.workloadId,
          stage: 'execute',
          decision,
          transportInvoked: true,
          requestDigest: execution.requestDigest,
          ...(promptDigest === undefined ? {} : { promptDigest }),
          ...metadata,
          execution,
        }));
      }

      return finalResult({
        workloadId: run.workloadId,
        attemptsPlanned: run.attempts.length,
        outcome: 'EXHAUSTED',
        attempts: records,
      });
    },
  });
}
