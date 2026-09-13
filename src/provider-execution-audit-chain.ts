import { createHash } from 'node:crypto';

import type { FuryProviderAttemptPlanReceipt } from './provider-attempt-receipt.js';
import type { FuryProviderAttemptContextReceipt } from './provider-attempt-context-receipt.js';
import type { FuryGovernedProviderExecutionReceipt } from './governed-provider-execution-receipt.js';

export interface FuryProviderExecutionAuditChain {
  readonly format: 'furypipe-provider-execution-audit-chain/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly receipts: {
    readonly planning: string;
    readonly context: string;
    readonly execution: string;
  };
  readonly continuity: {
    readonly exactScope: 'verified';
    readonly contextProfile: 'verified';
    readonly planningToContextPrompt:
      | 'verified-identical'
      | 'context-transformed-not-verifiable-from-receipts';
    readonly planningToContextCompileInput: 'not-comparable-across-receipt-v1-formats';
    readonly contextToExecutionPrompt: 'verified';
  };
  readonly execution: {
    readonly protocol: FuryGovernedProviderExecutionReceipt['protocol'];
    readonly requestDigest: string;
    readonly outcome: FuryGovernedProviderExecutionReceipt['outcome']['kind'];
    readonly providerResult: FuryGovernedProviderExecutionReceipt['verification']['providerResult'];
  };
  readonly provenance: {
    readonly planningReceipt: FuryProviderAttemptPlanReceipt['verification']['plannerProvenance'];
    readonly contextRuntimeReceipt: FuryProviderAttemptContextReceipt['verification']['runtimeProvenance'];
    readonly executionRequestReceipt: FuryGovernedProviderExecutionReceipt['verification']['requestProvenance'];
    readonly executionPermitReceipt: FuryGovernedProviderExecutionReceipt['verification']['permitProvenance'];
    readonly executionOutcomeReceipt: FuryGovernedProviderExecutionReceipt['verification']['outcomeProvenance'];
    readonly chainProvenance: 'not-verified';
  };
  readonly verification: {
    readonly receiptDigestIntegrity: 'verified';
    readonly structuralContinuity: 'verified';
    readonly sourceObjectProvenance: 'not-verified';
  };
  readonly chainDigest: string;
}

export interface FuryProviderExecutionAuditChainInput {
  readonly planning: FuryProviderAttemptPlanReceipt;
  readonly context: FuryProviderAttemptContextReceipt;
  readonly execution: FuryGovernedProviderExecutionReceipt;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const FURY_PROMPT_DIGEST = /^fp_[0-9a-f]{64}$/u;
const FURY_SOURCE_DIGEST = /^fp_src_[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('audit chain canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') throw new Error('audit chain canonical JSON contains an unsupported value');

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('audit chain canonical JSON requires plain objects');
  }

  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('audit chain canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported or missing fields`);
  }
}

function exactScope(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_SCOPE_CHARS
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error(`${label} must be an exact bounded printable identifier`);
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function verifyReceiptDigest(
  receipt: Readonly<Record<string, unknown>>,
  label: string,
): string {
  const digest = receipt.receiptDigest;
  if (typeof digest !== 'string' || !HEX64.test(digest)) {
    throw new Error(`${label} receiptDigest must be lowercase SHA-256`);
  }

  const core: Record<string, unknown> = {};
  for (const key of Object.keys(receipt)) {
    if (key === 'receiptDigest') continue;
    const descriptor = Object.getOwnPropertyDescriptor(receipt, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`${label} receipt contains an accessor or unsupported field`);
    }
    core[key] = descriptor.value;
  }

  if (sha256(canonicalJson(core)) !== digest) {
    throw new Error(`${label} receipt digest integrity check failed`);
  }
  return digest;
}

function validatePrompt(
  value: unknown,
  label: string,
): Readonly<{
  promptDigest: string;
  sourceDigest: string;
  compileInputDigest: string;
  bytes: number;
  level: string;
}> {
  const prompt = plainRecord(value, label);
  assertExactKeys(
    prompt,
    ['promptDigest', 'sourceDigest', 'compileInputDigest', 'bytes', 'level'],
    label,
  );
  if (typeof prompt.promptDigest !== 'string' || !FURY_PROMPT_DIGEST.test(prompt.promptDigest)) {
    throw new Error(`${label} promptDigest is invalid`);
  }
  if (typeof prompt.sourceDigest !== 'string' || !FURY_SOURCE_DIGEST.test(prompt.sourceDigest)) {
    throw new Error(`${label} sourceDigest is invalid`);
  }
  if (typeof prompt.compileInputDigest !== 'string' || !HEX64.test(prompt.compileInputDigest)) {
    throw new Error(`${label} compileInputDigest is invalid`);
  }
  const bytes = nonNegativeSafeInteger(prompt.bytes, `${label} bytes`);
  const level = exactScope(prompt.level, `${label} level`);

  return Object.freeze({
    promptDigest: prompt.promptDigest,
    sourceDigest: prompt.sourceDigest,
    compileInputDigest: prompt.compileInputDigest,
    bytes,
    level,
  });
}

function validatePlanningReceipt(
  receipt: FuryProviderAttemptPlanReceipt,
): {
  readonly scope: readonly [string, string, string];
  readonly prompt: ReturnType<typeof validatePrompt>;
  readonly profile: Readonly<{ state: string; profileId?: string; profileDigest?: string }>;
  readonly digest: string;
  readonly plannerProvenance: FuryProviderAttemptPlanReceipt['verification']['plannerProvenance'];
} {
  const record = plainRecord(receipt, 'planning receipt');
  assertExactKeys(
    record,
    [
      'format', 'providerId', 'model', 'workloadId', 'prompt', 'adapter',
      'contextProfile', 'authority', 'verification', 'receiptDigest',
    ],
    'planning receipt',
  );
  if (record.format !== 'furypipe-provider-attempt-plan-receipt/v1') {
    throw new Error('planning receipt format is invalid');
  }

  const providerId = exactScope(record.providerId, 'planning providerId');
  const model = exactScope(record.model, 'planning model');
  const workloadId = exactScope(record.workloadId, 'planning workloadId');
  const prompt = validatePrompt(record.prompt, 'planning prompt');

  const profile = plainRecord(record.contextProfile, 'planning contextProfile');
  const state = profile.state;
  if (state !== 'IDENTITY' && state !== 'QUALIFIED' && state !== 'BLOCKED') {
    throw new Error('planning context profile state is invalid');
  }
  let profileId: string | undefined;
  let profileDigest: string | undefined;
  if (profile.profileId !== undefined) profileId = exactScope(profile.profileId, 'planning profileId');
  if (profile.profileDigest !== undefined) {
    if (typeof profile.profileDigest !== 'string' || !HEX64.test(profile.profileDigest)) {
      throw new Error('planning profileDigest is invalid');
    }
    profileDigest = profile.profileDigest;
  }

  const verification = plainRecord(record.verification, 'planning verification');
  if (
    verification.structuralConsistency !== 'verified'
    || verification.plannerProvenance !== 'not-verified'
    || verification.providerResult !== 'not-executed'
    || verification.currentContextResult !== 'not-verified'
  ) {
    throw new Error('planning verification semantics are invalid');
  }

  return Object.freeze({
    scope: Object.freeze([providerId, model, workloadId] as const),
    prompt,
    profile: Object.freeze({
      state,
      ...(profileId === undefined ? {} : { profileId }),
      ...(profileDigest === undefined ? {} : { profileDigest }),
    }),
    digest: verifyReceiptDigest(record, 'planning'),
    plannerProvenance: 'not-verified',
  });
}

function validateContextReceipt(
  receipt: FuryProviderAttemptContextReceipt,
): {
  readonly scope: readonly [string, string, string];
  readonly prompt: ReturnType<typeof validatePrompt>;
  readonly profile: Readonly<{ state: string; profileId?: string; profileDigest?: string }>;
  readonly injected: boolean;
  readonly digest: string;
  readonly runtimeProvenance: FuryProviderAttemptContextReceipt['verification']['runtimeProvenance'];
} {
  const record = plainRecord(receipt, 'context receipt');
  assertExactKeys(
    record,
    [
      'format', 'providerId', 'model', 'workloadId', 'prompt', 'context',
      'profile', 'secretPolicy', 'execution', 'verification', 'receiptDigest',
    ],
    'context receipt',
  );
  if (record.format !== 'furypipe-provider-attempt-context-receipt/v1') {
    throw new Error('context receipt format is invalid');
  }

  const providerId = exactScope(record.providerId, 'context providerId');
  const model = exactScope(record.model, 'context model');
  const workloadId = exactScope(record.workloadId, 'context workloadId');
  const prompt = validatePrompt(record.prompt, 'context prompt');

  const context = plainRecord(record.context, 'context summary');
  const injection = plainRecord(context.injection, 'context injection');
  if (typeof injection.injected !== 'boolean') throw new Error('context injection state is invalid');

  const profile = plainRecord(record.profile, 'context profile');
  const state = profile.state;
  if (state !== 'IDENTITY' && state !== 'QUALIFIED' && state !== 'BLOCKED') {
    throw new Error('context profile state is invalid');
  }
  let profileId: string | undefined;
  let profileDigest: string | undefined;
  if (profile.profileId !== undefined) profileId = exactScope(profile.profileId, 'context profileId');
  if (profile.profileDigest !== undefined) {
    if (typeof profile.profileDigest !== 'string' || !HEX64.test(profile.profileDigest)) {
      throw new Error('context profileDigest is invalid');
    }
    profileDigest = profile.profileDigest;
  }

  const verification = plainRecord(record.verification, 'context verification');
  if (
    verification.structuralConsistency !== 'verified'
    || verification.runtimeProvenance !== 'not-verified'
    || verification.currentContextResult !== 'not-verified'
    || verification.providerResult !== 'not-executed'
  ) {
    throw new Error('context verification semantics are invalid');
  }

  return Object.freeze({
    scope: Object.freeze([providerId, model, workloadId] as const),
    prompt,
    profile: Object.freeze({
      state,
      ...(profileId === undefined ? {} : { profileId }),
      ...(profileDigest === undefined ? {} : { profileDigest }),
    }),
    injected: injection.injected,
    digest: verifyReceiptDigest(record, 'context'),
    runtimeProvenance: 'not-verified',
  });
}

function validateExecutionReceipt(
  receipt: FuryGovernedProviderExecutionReceipt,
): {
  readonly scope: readonly [string, string, string];
  readonly request: Readonly<{
    requestDigest: string;
    promptDigest: string;
    sourceDigest: string;
    bytes: number;
  }>;
  readonly protocol: FuryGovernedProviderExecutionReceipt['protocol'];
  readonly outcome: FuryGovernedProviderExecutionReceipt['outcome']['kind'];
  readonly providerResult: FuryGovernedProviderExecutionReceipt['verification']['providerResult'];
  readonly digest: string;
  readonly provenance: FuryGovernedProviderExecutionReceipt['verification'];
} {
  const record = plainRecord(receipt, 'execution receipt');
  assertExactKeys(
    record,
    [
      'format', 'providerId', 'model', 'workloadId', 'protocol', 'request',
      'authorization', 'outcome', 'verification', 'receiptDigest',
    ],
    'execution receipt',
  );
  if (record.format !== 'furypipe-governed-provider-execution-receipt/v1') {
    throw new Error('execution receipt format is invalid');
  }

  const providerId = exactScope(record.providerId, 'execution providerId');
  const model = exactScope(record.model, 'execution model');
  const workloadId = exactScope(record.workloadId, 'execution workloadId');
  if (record.protocol !== 'openai' && record.protocol !== 'anthropic' && record.protocol !== 'google') {
    throw new Error('execution protocol is invalid');
  }

  const request = plainRecord(record.request, 'execution request');
  assertExactKeys(
    request,
    ['requestDigest', 'promptDigest', 'promptSourceDigest', 'promptBytes'],
    'execution request',
  );
  if (typeof request.requestDigest !== 'string' || !HEX64.test(request.requestDigest)) {
    throw new Error('execution requestDigest is invalid');
  }
  if (typeof request.promptDigest !== 'string' || !FURY_PROMPT_DIGEST.test(request.promptDigest)) {
    throw new Error('execution promptDigest is invalid');
  }
  if (
    typeof request.promptSourceDigest !== 'string'
    || !FURY_SOURCE_DIGEST.test(request.promptSourceDigest)
  ) throw new Error('execution promptSourceDigest is invalid');

  const outcome = plainRecord(record.outcome, 'execution outcome');
  if (outcome.kind !== 'success' && outcome.kind !== 'error') {
    throw new Error('execution outcome kind is invalid');
  }

  const verification = plainRecord(record.verification, 'execution verification');
  const providerResult = verification.providerResult;
  if (
    verification.structuralConsistency !== 'verified'
    || verification.requestProvenance !== 'process-local-verified'
    || verification.permitProvenance !== 'process-local-verified'
    || verification.outcomeProvenance !== 'not-verified'
    || (
      providerResult !== 'transport-reported'
      && providerResult !== 'partially-transport-reported'
      && providerResult !== 'not-reported'
      && providerResult !== 'not-executed'
    )
  ) {
    throw new Error('execution verification semantics are invalid');
  }

  return Object.freeze({
    scope: Object.freeze([providerId, model, workloadId] as const),
    request: Object.freeze({
      requestDigest: request.requestDigest,
      promptDigest: request.promptDigest,
      sourceDigest: request.promptSourceDigest,
      bytes: nonNegativeSafeInteger(request.promptBytes, 'execution promptBytes'),
    }),
    protocol: record.protocol,
    outcome: outcome.kind,
    providerResult,
    digest: verifyReceiptDigest(record, 'execution'),
    provenance: receipt.verification,
  });
}

function sameScope(
  left: readonly [string, string, string],
  right: readonly [string, string, string],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function assertProfileContinuity(
  planning: ReturnType<typeof validatePlanningReceipt>['profile'],
  context: ReturnType<typeof validateContextReceipt>['profile'],
): void {
  if (planning.state !== context.state) {
    throw new Error('context profile state changed between planning and context runtime receipts');
  }

  if (planning.state === 'QUALIFIED') {
    if (
      planning.profileId === undefined
      || planning.profileDigest === undefined
      || context.profileId !== planning.profileId
      || context.profileDigest !== planning.profileDigest
    ) {
      throw new Error('qualified context profile identity changed between receipts');
    }
    return;
  }

  if (
    planning.profileId !== undefined
    || planning.profileDigest !== undefined
    || context.profileId !== undefined
    || context.profileDigest !== undefined
  ) {
    throw new Error('non-qualified context profile receipts must not expose applied profile identity');
  }
}

function auditCore(input: FuryProviderExecutionAuditChainInput): Omit<FuryProviderExecutionAuditChain, 'chainDigest'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('provider execution audit chain input is required');
  }

  const planning = validatePlanningReceipt(input.planning);
  const context = validateContextReceipt(input.context);
  const execution = validateExecutionReceipt(input.execution);

  if (!sameScope(planning.scope, context.scope) || !sameScope(context.scope, execution.scope)) {
    throw new Error('provider/model/workload scope continuity failed across receipts');
  }

  assertProfileContinuity(planning.profile, context.profile);

  let planningToContextPrompt: FuryProviderExecutionAuditChain['continuity']['planningToContextPrompt'];
  if (context.injected) {
    planningToContextPrompt = 'context-transformed-not-verifiable-from-receipts';
  } else {
    if (
      planning.prompt.promptDigest !== context.prompt.promptDigest
      || planning.prompt.sourceDigest !== context.prompt.sourceDigest
      || planning.prompt.bytes !== context.prompt.bytes
      || planning.prompt.level !== context.prompt.level
    ) {
      throw new Error('planning and context prompt identities diverged without context injection');
    }
    planningToContextPrompt = 'verified-identical';
  }

  if (
    context.prompt.promptDigest !== execution.request.promptDigest
    || context.prompt.sourceDigest !== execution.request.sourceDigest
    || context.prompt.bytes !== execution.request.bytes
  ) {
    throw new Error('final context prompt identity does not match execution request identity');
  }

  return Object.freeze({
    format: 'furypipe-provider-execution-audit-chain/v1',
    providerId: planning.scope[0],
    model: planning.scope[1],
    workloadId: planning.scope[2],
    receipts: Object.freeze({
      planning: planning.digest,
      context: context.digest,
      execution: execution.digest,
    }),
    continuity: Object.freeze({
      exactScope: 'verified',
      contextProfile: 'verified',
      planningToContextPrompt,
      planningToContextCompileInput: 'not-comparable-across-receipt-v1-formats',
      contextToExecutionPrompt: 'verified',
    }),
    execution: Object.freeze({
      protocol: execution.protocol,
      requestDigest: execution.request.requestDigest,
      outcome: execution.outcome,
      providerResult: execution.providerResult,
    }),
    provenance: Object.freeze({
      planningReceipt: planning.plannerProvenance,
      contextRuntimeReceipt: context.runtimeProvenance,
      executionRequestReceipt: execution.provenance.requestProvenance,
      executionPermitReceipt: execution.provenance.permitProvenance,
      executionOutcomeReceipt: execution.provenance.outcomeProvenance,
      chainProvenance: 'not-verified',
    }),
    verification: Object.freeze({
      receiptDigestIntegrity: 'verified',
      structuralContinuity: 'verified',
      sourceObjectProvenance: 'not-verified',
    }),
  });
}

export function createProviderExecutionAuditChain(
  input: FuryProviderExecutionAuditChainInput,
): FuryProviderExecutionAuditChain {
  const core = auditCore(input);
  return Object.freeze({
    ...core,
    chainDigest: sha256(canonicalJson(core)),
  });
}

export function verifyProviderExecutionAuditChain(
  chain: FuryProviderExecutionAuditChain,
  input: FuryProviderExecutionAuditChainInput,
): boolean {
  try {
    if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return false;
    if (!HEX64.test(chain.chainDigest)) return false;

    const suppliedCore: Record<string, unknown> = {};
    for (const key of Object.keys(chain)) {
      if (key === 'chainDigest') continue;
      const descriptor = Object.getOwnPropertyDescriptor(chain, key);
      if (!descriptor || !('value' in descriptor)) return false;
      suppliedCore[key] = descriptor.value;
    }

    const expected = createProviderExecutionAuditChain(input);
    return sha256(canonicalJson(suppliedCore)) === chain.chainDigest
      && chain.chainDigest === expected.chainDigest;
  } catch {
    return false;
  }
}
