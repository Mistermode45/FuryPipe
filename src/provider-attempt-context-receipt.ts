import { createHash } from 'node:crypto';

import {
  FURY_CONTEXT_KINDS,
  FURY_CONTEXT_LEVELS,
  type FuryContextCacheClass,
  type FuryContextDeferredItem,
  type FuryContextExactness,
  type FuryContextIncludedItem,
  type FuryContextKind,
  type FuryContextOptimizerPlan,
} from './context-optimizer.js';
import type {
  FuryContextOptimizerProfileBlock,
  FuryContextOptimizerProfileBlockReason,
} from './context-optimizer-profile.js';
import { renderFuryContextInjection } from './context-prompt-injection.js';
import {
  compileFuryPrompt,
  FURY_PROMPT_SECTION_ORDER,
  type FuryPromptCompileInput,
} from './fury-prompt.js';
import type {
  FuryProviderAttemptContextProfileDisposition,
  FuryProviderAttemptContextRuntimeResult,
} from './provider-attempt-context-runtime.js';

export interface FuryProviderAttemptContextReceipt {
  readonly format: 'furypipe-provider-attempt-context-receipt/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly prompt: {
    readonly promptDigest: string;
    readonly sourceDigest: string;
    readonly compileInputDigest: string;
    readonly bytes: number;
    readonly level: string;
  };
  readonly context: {
    readonly planDigest: string;
    readonly includedCount: number;
    readonly deferredCount: number;
    readonly totalCandidateBytes: number;
    readonly preferredEligibleBytes: number;
    readonly includedBytes: number;
    readonly savedBytesVsPreferred: number;
    readonly stablePrefixBytes: number;
    readonly maxBytes: number;
    readonly maxItems: number;
    readonly cacheFriendlyOrderingApplied: boolean;
    readonly includedByKind: Readonly<Partial<Record<FuryContextKind, number>>>;
    readonly deferredByReason: Readonly<Record<FuryContextDeferredItem['reason'], number>>;
    readonly injection: {
      readonly injected: boolean;
      readonly bytes: number;
    };
    readonly tokenEstimate:
      | { readonly status: 'unknown' }
      | {
          readonly status: 'character-ratio-estimate';
          readonly before: number;
          readonly after: number;
          readonly saved: number;
          readonly charsPerToken: number;
        };
  };
  readonly profile: {
    readonly state: FuryProviderAttemptContextRuntimeResult['contextProfileState'];
    readonly disposition: FuryProviderAttemptContextProfileDisposition;
    readonly applied: boolean;
    readonly qualificationEvidence: 'verified' | 'none';
    readonly profileId?: string;
    readonly profileDigest?: string;
    readonly blockerReasons: readonly FuryContextOptimizerProfileBlockReason[];
  };
  readonly secretPolicy: {
    readonly allowSecret: boolean;
    readonly authority: 'host' | 'default-deny';
  };
  readonly execution: {
    readonly optimizerExecuted: true;
    readonly networkCallExecuted: false;
    readonly providerRequestExecuted: false;
    readonly executionAuthorized: false;
  };
  readonly verification: {
    readonly structuralConsistency: 'verified';
    readonly runtimeProvenance: 'not-verified';
    readonly currentContextResult: 'not-verified';
    readonly providerResult: 'not-executed';
  };
  readonly receiptDigest: string;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;
const MAX_PROFILE_ID_CHARS = 128;
const MAX_BLOCKERS = 1024;
const encoder = new TextEncoder();

const CACHE_CLASSES = new Set<FuryContextCacheClass>([
  'stable',
  'semi-stable',
  'dynamic',
  'not-cacheable',
]);
const EXACTNESS_VALUES = new Set<FuryContextExactness>(['normal', 'exact', 'secret']);
const INCLUDED_REASONS = new Set<FuryContextIncludedItem['reason']>(['required', 'selected', 'discovery']);
const DEFERRED_REASONS = Object.freeze([
  'not-selected',
  'below-discovery-threshold',
  'secret-policy',
  'item-limit',
  'byte-budget',
  'kind-byte-budget',
] as const satisfies readonly FuryContextDeferredItem['reason'][]);
const DEFERRED_REASON_SET = new Set<FuryContextDeferredItem['reason']>(DEFERRED_REASONS);
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('context receipt canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw new Error('context receipt canonical JSON contains an unsupported value');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('context receipt canonical JSON requires plain objects');
  }
  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('context receipt canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function exactIdentifier(value: unknown, label: string, maxChars = MAX_SCOPE_CHARS): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maxChars
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be an exact bounded printable identifier`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const integer = nonNegativeSafeInteger(value, label);
  if (integer < 1) throw new Error(`${label} must be a positive safe integer`);
  return integer;
}

function promptCompileInputDigest(input: FuryPromptCompileInput): string {
  const sections = FURY_PROMPT_SECTION_ORDER.flatMap((section) => {
    const value = input.sections[section];
    if (value === undefined) return [];
    return [{
      id: section,
      values: typeof value === 'string' ? [value] : [...value],
    }];
  });
  return sha256(canonicalJson({
    sections,
    level: input.level ?? null,
    securityCritical: input.securityCritical ?? null,
    exactGuardMode: input.exactGuardMode ?? null,
  }));
}

function validateProfileBlockers(
  value: readonly FuryContextOptimizerProfileBlock[],
): readonly FuryContextOptimizerProfileBlockReason[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKERS) {
    throw new Error(`context profile blockers must contain at most ${MAX_BLOCKERS} entries`);
  }
  const reasons: FuryContextOptimizerProfileBlockReason[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`context profile blocker ${index} must be an object`);
    }
    exactIdentifier(entry.id, `context profile blocker ${index} id`, MAX_PROFILE_ID_CHARS);
    if (!PROFILE_BLOCK_REASONS.has(entry.reason)) {
      throw new Error(`context profile blocker ${index} reason is invalid`);
    }
    reasons.push(entry.reason);
  }
  return Object.freeze(reasons);
}

function validateIncluded(
  value: readonly FuryContextIncludedItem[],
): {
  readonly includedBytes: number;
  readonly stablePrefixBytes: number;
  readonly byKind: Readonly<Partial<Record<FuryContextKind, number>>>;
  readonly digestEntries: readonly Readonly<Record<string, unknown>>[];
  readonly ids: ReadonlySet<string>;
} {
  if (!Array.isArray(value) || value.length > 1024) {
    throw new Error('context plan included items must contain at most 1024 entries');
  }

  const ids = new Set<string>();
  const byKind: Partial<Record<FuryContextKind, number>> = {};
  const digestEntries: Readonly<Record<string, unknown>>[] = [];
  let includedBytes = 0;
  let stablePrefixBytes = 0;
  let stablePrefixOpen = true;

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`context included item ${index} must be an object`);
    }
    const id = exactIdentifier(item.id, `context included item ${index} id`, 256);
    if (ids.has(id)) throw new Error('context included item ids must be unique');
    ids.add(id);
    if (!FURY_CONTEXT_KINDS.includes(item.kind)) {
      throw new Error(`context included item ${index} kind is invalid`);
    }
    const kind = item.kind as FuryContextKind;
    if (!FURY_CONTEXT_LEVELS.includes(item.level)) {
      throw new Error(`context included item ${index} level is invalid`);
    }
    if (typeof item.content !== 'string' || item.content.length < 1) {
      throw new Error(`context included item ${index} content is invalid`);
    }
    const bytes = nonNegativeSafeInteger(item.bytes, `context included item ${index} bytes`);
    const chars = nonNegativeSafeInteger(item.chars, `context included item ${index} chars`);
    if (encoder.encode(item.content).byteLength !== bytes || item.content.length !== chars) {
      throw new Error(`context included item ${index} content metrics are inconsistent`);
    }
    if (!CACHE_CLASSES.has(item.cacheClass)) {
      throw new Error(`context included item ${index} cache class is invalid`);
    }
    if (!EXACTNESS_VALUES.has(item.exactness)) {
      throw new Error(`context included item ${index} exactness is invalid`);
    }
    if (!INCLUDED_REASONS.has(item.reason)) {
      throw new Error(`context included item ${index} reason is invalid`);
    }

    includedBytes += bytes;
    if (!Number.isSafeInteger(includedBytes)) throw new Error('context included bytes overflow safe integer range');
    byKind[kind] = (byKind[kind] ?? 0) + 1;

    if (stablePrefixOpen) {
      if (item.cacheClass === 'dynamic' || item.cacheClass === 'not-cacheable') {
        stablePrefixOpen = false;
      } else {
        stablePrefixBytes += bytes;
      }
    }

    digestEntries.push(Object.freeze({
      idDigest: sha256(id),
      kind,
      level: item.level,
      contentDigest: sha256(item.content),
      bytes,
      chars,
      cacheClass: item.cacheClass,
      exactness: item.exactness,
      reason: item.reason,
    }));
  }

  return Object.freeze({
    includedBytes,
    stablePrefixBytes,
    byKind: Object.freeze({ ...byKind }),
    digestEntries: Object.freeze(digestEntries),
    ids,
  });
}

function validateDeferred(
  value: readonly FuryContextDeferredItem[],
  includedIds: ReadonlySet<string>,
): {
  readonly counts: Readonly<Record<FuryContextDeferredItem['reason'], number>>;
  readonly digestEntries: readonly Readonly<Record<string, unknown>>[];
} {
  if (!Array.isArray(value) || value.length > 1024) {
    throw new Error('context plan deferred items must contain at most 1024 entries');
  }

  const ids = new Set<string>();
  const counts = Object.fromEntries(
    DEFERRED_REASONS.map((reason) => [reason, 0]),
  ) as Record<FuryContextDeferredItem['reason'], number>;
  const digestEntries: Readonly<Record<string, unknown>>[] = [];

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`context deferred item ${index} must be an object`);
    }
    const id = exactIdentifier(item.id, `context deferred item ${index} id`, 256);
    if (ids.has(id) || includedIds.has(id)) {
      throw new Error('context plan item ids must be unique across included and deferred entries');
    }
    ids.add(id);
    if (!FURY_CONTEXT_KINDS.includes(item.kind)) {
      throw new Error(`context deferred item ${index} kind is invalid`);
    }
    const kind = item.kind as FuryContextKind;
    if (!DEFERRED_REASON_SET.has(item.reason)) {
      throw new Error(`context deferred item ${index} reason is invalid`);
    }
    const reason = item.reason as FuryContextDeferredItem['reason'];
    counts[reason] += 1;
    digestEntries.push(Object.freeze({
      idDigest: sha256(id),
      kind,
      reason,
    }));
  }

  return Object.freeze({
    counts: Object.freeze({ ...counts }),
    digestEntries: Object.freeze(digestEntries),
  });
}

function validateContextPlan(
  plan: FuryContextOptimizerPlan,
): {
  readonly summary: FuryProviderAttemptContextReceipt['context'];
  readonly renderedBlocks: readonly string[];
} {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('context optimizer plan must be an object');
  }
  if (plan.format !== 'furypipe-context-optimizer-plan/v1') {
    throw new Error('context optimizer plan format is invalid');
  }

  const included = validateIncluded(plan.included);
  const deferred = validateDeferred(plan.deferred, included.ids);
  const totalCandidateBytes = nonNegativeSafeInteger(plan.totalCandidateBytes, 'context totalCandidateBytes');
  const preferredEligibleBytes = nonNegativeSafeInteger(plan.preferredEligibleBytes, 'context preferredEligibleBytes');
  const includedBytes = nonNegativeSafeInteger(plan.includedBytes, 'context includedBytes');
  const savedBytesVsPreferred = nonNegativeSafeInteger(plan.savedBytesVsPreferred, 'context savedBytesVsPreferred');
  const stablePrefixBytes = nonNegativeSafeInteger(plan.stablePrefixBytes, 'context stablePrefixBytes');
  const maxBytes = positiveSafeInteger(plan.maxBytes, 'context maxBytes');
  const maxItems = positiveSafeInteger(plan.maxItems, 'context maxItems');

  if (typeof plan.cacheFriendlyOrderingApplied !== 'boolean') {
    throw new Error('context cacheFriendlyOrderingApplied must be boolean');
  }
  if (includedBytes !== included.includedBytes) {
    throw new Error('context includedBytes does not match included item bytes');
  }
  if (stablePrefixBytes !== included.stablePrefixBytes) {
    throw new Error('context stablePrefixBytes does not match included item ordering');
  }
  if (includedBytes > maxBytes || plan.included.length > maxItems) {
    throw new Error('context plan exceeds its declared budgets');
  }
  if (savedBytesVsPreferred !== Math.max(0, preferredEligibleBytes - includedBytes)) {
    throw new Error('context savedBytesVsPreferred is inconsistent');
  }

  let tokenEstimate: FuryProviderAttemptContextReceipt['context']['tokenEstimate'];
  let estimatedTokensForDigest: Readonly<Record<string, unknown>> | null = null;
  if (plan.estimatedTokens === undefined) {
    tokenEstimate = Object.freeze({ status: 'unknown' });
  } else {
    const before = nonNegativeSafeInteger(plan.estimatedTokens.before, 'context estimated tokens before');
    const after = nonNegativeSafeInteger(plan.estimatedTokens.after, 'context estimated tokens after');
    const saved = nonNegativeSafeInteger(plan.estimatedTokens.saved, 'context estimated tokens saved');
    const charsPerToken = plan.estimatedTokens.charsPerToken;
    if (!Number.isFinite(charsPerToken) || charsPerToken < 1 || charsPerToken > 16) {
      throw new Error('context charsPerToken estimate is invalid');
    }
    if (saved !== Math.max(0, before - after)) {
      throw new Error('context token estimate savings are inconsistent');
    }
    tokenEstimate = Object.freeze({
      status: 'character-ratio-estimate',
      before,
      after,
      saved,
      charsPerToken,
    });
    estimatedTokensForDigest = Object.freeze({ before, after, saved, charsPerToken });
  }

  const rendered = renderFuryContextInjection(plan);
  const planDigest = `ctx_${sha256(canonicalJson({
    format: plan.format,
    included: included.digestEntries,
    deferred: deferred.digestEntries,
    totalCandidateBytes,
    preferredEligibleBytes,
    includedBytes,
    savedBytesVsPreferred,
    stablePrefixBytes,
    cacheFriendlyOrderingApplied: plan.cacheFriendlyOrderingApplied,
    maxBytes,
    maxItems,
    estimatedTokens: estimatedTokensForDigest,
  }))}`;

  return Object.freeze({
    summary: Object.freeze({
      planDigest,
      includedCount: plan.included.length,
      deferredCount: plan.deferred.length,
      totalCandidateBytes,
      preferredEligibleBytes,
      includedBytes,
      savedBytesVsPreferred,
      stablePrefixBytes,
      maxBytes,
      maxItems,
      cacheFriendlyOrderingApplied: plan.cacheFriendlyOrderingApplied,
      includedByKind: included.byKind,
      deferredByReason: deferred.counts,
      injection: Object.freeze({
        injected: plan.included.length > 0,
        bytes: rendered.bytes,
      }),
      tokenEstimate,
    }),
    renderedBlocks: rendered.blocks,
  });
}

function contextSectionValues(input: FuryPromptCompileInput): readonly string[] {
  const context = input.sections.context;
  if (context === undefined) return Object.freeze([]);
  return Object.freeze(typeof context === 'string' ? [context] : [...context]);
}

function assertRenderedContextTail(
  result: FuryProviderAttemptContextRuntimeResult,
  renderedBlocks: readonly string[],
): void {
  const context = contextSectionValues(result.prompt);
  if (renderedBlocks.length === 0) return;
  if (context.length < renderedBlocks.length) {
    throw new Error('context runtime prompt is missing generated context blocks');
  }
  const tail = context.slice(context.length - renderedBlocks.length);
  if (tail.some((value, index) => value !== renderedBlocks[index])) {
    throw new Error('context runtime prompt does not end with the generated context blocks');
  }
}

function validateProfile(
  result: FuryProviderAttemptContextRuntimeResult,
): FuryProviderAttemptContextReceipt['profile'] {
  const blockerReasons = validateProfileBlockers(result.profileBlockers);
  const validState = result.contextProfileState === 'IDENTITY'
    || result.contextProfileState === 'QUALIFIED'
    || result.contextProfileState === 'BLOCKED';
  if (!validState) throw new Error('context runtime profile state is invalid');

  const expectedDisposition: FuryProviderAttemptContextProfileDisposition =
    result.contextProfileState === 'QUALIFIED'
      ? 'QUALIFIED_PROFILE_APPLIED'
      : result.contextProfileState === 'BLOCKED'
        ? 'BLOCKED_PROFILE_FALLBACK'
        : 'BASELINE_IDENTITY';

  if (result.profileDisposition !== expectedDisposition) {
    throw new Error('context runtime profile disposition is inconsistent');
  }

  if (result.contextProfileState === 'QUALIFIED') {
    if (
      result.profileApplied !== true
      || result.profileQualificationEvidence !== 'verified'
      || typeof result.profileId !== 'string'
      || typeof result.profileDigest !== 'string'
      || !HEX64.test(result.profileDigest)
    ) {
      throw new Error('qualified context runtime profile evidence is incomplete');
    }
    exactIdentifier(result.profileId, 'context runtime profileId', MAX_PROFILE_ID_CHARS);
  } else {
    if (
      result.profileApplied !== false
      || result.profileQualificationEvidence !== 'none'
      || result.profileId !== undefined
      || result.profileDigest !== undefined
    ) {
      throw new Error('non-qualified context runtime profile carries applied evidence');
    }
    const substantive = blockerReasons.some((reason) => reason !== 'missing-qualification');
    if (result.contextProfileState === 'IDENTITY' && substantive) {
      throw new Error('identity context runtime profile carries substantive blockers');
    }
    if (result.contextProfileState === 'BLOCKED' && !substantive) {
      throw new Error('blocked context runtime profile requires a substantive blocker');
    }
  }

  return Object.freeze({
    state: result.contextProfileState,
    disposition: result.profileDisposition,
    applied: result.profileApplied,
    qualificationEvidence: result.profileQualificationEvidence,
    ...(result.profileId === undefined ? {} : { profileId: result.profileId }),
    ...(result.profileDigest === undefined ? {} : { profileDigest: result.profileDigest }),
    blockerReasons,
  });
}

function validateSecretPolicy(
  value: FuryProviderAttemptContextRuntimeResult['secretPolicy'],
): FuryProviderAttemptContextReceipt['secretPolicy'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('context runtime secret policy is invalid');
  }
  if (typeof value.allowSecret !== 'boolean') {
    throw new Error('context runtime secret allowSecret must be boolean');
  }
  if (value.authority !== 'host' && value.authority !== 'default-deny') {
    throw new Error('context runtime secret policy authority is invalid');
  }
  if (value.authority === 'default-deny' && value.allowSecret !== false) {
    throw new Error('default-deny secret policy cannot allow secrets');
  }
  return Object.freeze({
    allowSecret: value.allowSecret,
    authority: value.authority,
  });
}

function receiptCore(
  result: FuryProviderAttemptContextRuntimeResult,
): Omit<FuryProviderAttemptContextReceipt, 'receiptDigest'> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('provider attempt context runtime result is required');
  }
  if (result.format !== 'furypipe-provider-attempt-context-runtime/v1') {
    throw new Error('provider attempt context runtime result format is invalid');
  }

  const providerId = exactIdentifier(result.providerId, 'providerId');
  const model = exactIdentifier(result.model, 'model');
  const workloadId = exactIdentifier(result.workloadId, 'workloadId');

  if (
    result.optimizerExecuted !== true
    || result.networkCallExecuted !== false
    || result.providerRequestExecuted !== false
    || result.executionAuthorized !== false
    || result.currentContextResultVerified !== false
  ) {
    throw new Error('context runtime execution/evidence flags are contradictory');
  }

  const compilation = compileFuryPrompt(result.prompt);
  const compileInputDigest = promptCompileInputDigest(result.prompt);
  const context = validateContextPlan(result.contextPlan);
  const shouldInject = result.contextPlan.included.length > 0;
  if (result.contextInjected !== shouldInject) {
    throw new Error('context runtime contextInjected flag is inconsistent');
  }
  if (result.injectedContextBytes !== context.summary.injection.bytes) {
    throw new Error('context runtime injectedContextBytes is inconsistent');
  }
  if (
    result.tokenEstimateStatus
      !== (result.contextPlan.estimatedTokens === undefined ? 'UNKNOWN' : 'CHARACTER_RATIO_ESTIMATE')
  ) {
    throw new Error('context runtime token estimate status is inconsistent');
  }
  assertRenderedContextTail(result, context.renderedBlocks);

  const profile = validateProfile(result);
  const secretPolicy = validateSecretPolicy(result.secretPolicy);

  return Object.freeze({
    format: 'furypipe-provider-attempt-context-receipt/v1',
    providerId,
    model,
    workloadId,
    prompt: Object.freeze({
      promptDigest: compilation.promptDigest,
      sourceDigest: compilation.source.contentDigest,
      compileInputDigest,
      bytes: compilation.promptBytes,
      level: compilation.level,
    }),
    context: context.summary,
    profile,
    secretPolicy,
    execution: Object.freeze({
      optimizerExecuted: true,
      networkCallExecuted: false,
      providerRequestExecuted: false,
      executionAuthorized: false,
    }),
    verification: Object.freeze({
      structuralConsistency: 'verified',
      runtimeProvenance: 'not-verified',
      currentContextResult: 'not-verified',
      providerResult: 'not-executed',
    }),
  });
}

function digestReceiptCore(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function createProviderAttemptContextReceipt(
  result: FuryProviderAttemptContextRuntimeResult,
): FuryProviderAttemptContextReceipt {
  const core = receiptCore(result);
  return Object.freeze({
    ...core,
    receiptDigest: digestReceiptCore(core),
  });
}

export function verifyProviderAttemptContextReceipt(
  receipt: FuryProviderAttemptContextReceipt,
  result: FuryProviderAttemptContextRuntimeResult,
): boolean {
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    const prototype = Object.getPrototypeOf(receipt);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (!HEX64.test(receipt.receiptDigest)) return false;

    const suppliedCore: Record<string, unknown> = {};
    for (const key of Object.keys(receipt)) {
      if (key === 'receiptDigest') continue;
      const descriptor = Object.getOwnPropertyDescriptor(receipt, key);
      if (!descriptor || !('value' in descriptor)) return false;
      suppliedCore[key] = descriptor.value;
    }

    const expected = createProviderAttemptContextReceipt(result);
    return digestReceiptCore(suppliedCore) === receipt.receiptDigest
      && receipt.receiptDigest === expected.receiptDigest;
  } catch {
    return false;
  }
}
