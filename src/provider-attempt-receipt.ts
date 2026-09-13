import { createHash } from 'node:crypto';

import {
  compileFuryPrompt,
  FURY_PROMPT_SECTION_ORDER,
  type FuryPromptCompileInput,
} from './fury-prompt.js';
import type { FuryModelAdapterBlock } from './model-adapter-registry.js';
import type {
  FuryContextOptimizerProfileBlock,
} from './context-optimizer-profile.js';
import type { FuryProviderAttemptPlan } from './provider-attempt-planner.js';

export interface FuryProviderAttemptPlanReceipt {
  readonly format: 'furypipe-provider-attempt-plan-receipt/v1';
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
  readonly adapter: {
    readonly state: FuryProviderAttemptPlan['adapter']['adapterState'];
    readonly evidence: FuryProviderAttemptPlan['adapter']['evidence'];
    readonly adapterId?: string;
    readonly adapterDigest?: string;
    readonly blocked: readonly FuryModelAdapterBlock[];
  };
  readonly contextProfile: {
    readonly state: FuryProviderAttemptPlan['contextProfileState'];
    readonly evidence: FuryProviderAttemptPlan['contextProfile']['evidence'];
    readonly profileId?: string;
    readonly profileDigest?: string;
    readonly blocked: readonly FuryContextOptimizerProfileBlock[];
  };
  readonly authority: {
    readonly networkCallExecuted: false;
    readonly providerRequestExecuted: false;
    readonly optimizerExecuted: false;
    readonly executionAuthorized: false;
  };
  readonly verification: {
    readonly structuralConsistency: 'verified';
    readonly plannerProvenance: 'not-verified';
    readonly providerResult: 'not-executed';
    readonly currentContextResult: 'not-verified';
  };
  readonly receiptDigest: string;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;
const MAX_BLOCKED = 256;

const ADAPTER_BLOCK_REASONS = new Set([
  'missing-qualification',
  'invalid-qualification',
  'scope-mismatch',
  'digest-mismatch',
  'insufficient-repetitions',
  'quality-regression',
  'exactness-incomplete',
  'benchmark-errors',
]);

const PROFILE_BLOCK_REASONS = new Set([
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

function exactScope(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_SCOPE_CHARS
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be an exact bounded printable identifier`);
  }
  return value;
}

function exactId(value: unknown, label: string): string {
  return exactScope(value, label);
}

function digest64(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function copyAdapterBlocks(value: readonly FuryModelAdapterBlock[]): readonly FuryModelAdapterBlock[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKED) {
    throw new Error(`adapter blocked entries must contain at most ${MAX_BLOCKED} entries`);
  }
  return Object.freeze(value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`adapter blocked entry ${index} must be an object`);
    }
    const id = exactId(entry.id, `adapter blocked entry ${index} id`);
    if (!ADAPTER_BLOCK_REASONS.has(entry.reason)) {
      throw new Error(`adapter blocked entry ${index} reason is invalid`);
    }
    return Object.freeze({ id, reason: entry.reason });
  }));
}

function copyProfileBlocks(
  value: readonly FuryContextOptimizerProfileBlock[],
): readonly FuryContextOptimizerProfileBlock[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKED) {
    throw new Error(`context profile blocked entries must contain at most ${MAX_BLOCKED} entries`);
  }
  return Object.freeze(value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`context profile blocked entry ${index} must be an object`);
    }
    const id = exactId(entry.id, `context profile blocked entry ${index} id`);
    if (!PROFILE_BLOCK_REASONS.has(entry.reason)) {
      throw new Error(`context profile blocked entry ${index} reason is invalid`);
    }
    return Object.freeze({ id, reason: entry.reason });
  }));
}

function assertPlanAuthority(plan: FuryProviderAttemptPlan): void {
  if (
    plan.networkCallExecuted !== false
    || plan.providerRequestExecuted !== false
    || plan.optimizerExecuted !== false
    || plan.executionAuthorized !== false
  ) {
    throw new Error('provider attempt receipt accepts planning-only, non-authorized plans');
  }

  if (
    plan.adapter.networkCallExecuted !== false
    || plan.adapter.providerRequestExecuted !== false
  ) {
    throw new Error('provider attempt adapter plan must be non-executing');
  }

  if (
    plan.contextProfile.optimizerExecuted !== false
    || plan.contextProfile.providerCallExecuted !== false
    || plan.contextProfile.executionAuthorized !== false
  ) {
    throw new Error('context profile plan must be non-executing and non-authorized');
  }
}

function assertScopeConsistency(plan: FuryProviderAttemptPlan): void {
  const providerId = exactScope(plan.providerId, 'providerId');
  const model = exactScope(plan.model, 'model');
  const workloadId = exactScope(plan.workloadId, 'workloadId');

  if (
    plan.adapter.providerId !== providerId
    || plan.adapter.model !== model
    || plan.adapter.workloadId !== workloadId
  ) {
    throw new Error('adapter plan scope must exactly match provider attempt scope');
  }

  if (
    plan.contextProfile.provider !== providerId
    || plan.contextProfile.model !== model
    || plan.contextProfile.workloadId !== workloadId
  ) {
    throw new Error('context profile scope must exactly match provider attempt scope');
  }
}

function assertAdapterState(plan: FuryProviderAttemptPlan): void {
  const adapter = plan.adapter;
  if (adapter.adapterState === 'APPLIED') {
    if (adapter.adapterId === undefined || adapter.adapterDigest === undefined || adapter.evidence !== 'verified') {
      throw new Error('APPLIED adapter state requires id, digest, and verified evidence');
    }
    exactId(adapter.adapterId, 'adapterId');
    digest64(adapter.adapterDigest, 'adapterDigest');
    return;
  }

  if (adapter.adapterId !== undefined || adapter.adapterDigest !== undefined || adapter.evidence !== 'none') {
    throw new Error(`${adapter.adapterState} adapter state must not expose applied adapter evidence`);
  }

  const hasSubstantiveBlocker = adapter.blocked.some((entry) => entry.reason !== 'missing-qualification');
  if (adapter.adapterState === 'IDENTITY' && hasSubstantiveBlocker) {
    throw new Error('IDENTITY adapter state cannot contain substantive blockers');
  }
  if (adapter.adapterState === 'BLOCKED' && !hasSubstantiveBlocker) {
    throw new Error('BLOCKED adapter state requires a substantive blocker');
  }
}

function assertContextProfileState(plan: FuryProviderAttemptPlan): void {
  const profile = plan.contextProfile;

  if (plan.contextProfileState === 'QUALIFIED') {
    if (
      profile.profileId === undefined
      || profile.profileDigest === undefined
      || profile.options === undefined
      || profile.evidence !== 'verified'
    ) {
      throw new Error('QUALIFIED context profile requires id, digest, options, and verified evidence');
    }
    exactId(profile.profileId, 'profileId');
    digest64(profile.profileDigest, 'profileDigest');
    return;
  }

  if (
    profile.profileId !== undefined
    || profile.profileDigest !== undefined
    || profile.options !== undefined
    || profile.evidence !== 'none'
  ) {
    throw new Error(`${plan.contextProfileState} context profile must not expose applied profile evidence`);
  }

  const hasSubstantiveBlocker = profile.blocked.some((entry) => entry.reason !== 'missing-qualification');
  if (plan.contextProfileState === 'IDENTITY' && hasSubstantiveBlocker) {
    throw new Error('IDENTITY context profile state cannot contain substantive blockers');
  }
  if (plan.contextProfileState === 'BLOCKED' && !hasSubstantiveBlocker) {
    throw new Error('BLOCKED context profile state requires a substantive blocker');
  }
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
  const canonical = JSON.stringify({
    sections,
    level: input.level ?? null,
    securityCritical: input.securityCritical ?? null,
    exactGuardMode: input.exactGuardMode ?? null,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('receipt canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw new Error('receipt canonical JSON contains an unsupported value');
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('receipt canonical JSON requires plain objects');
  }

  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('receipt canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function receiptDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function receiptCore(plan: FuryProviderAttemptPlan): Omit<FuryProviderAttemptPlanReceipt, 'receiptDigest'> {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('provider attempt plan is required');
  }
  if (plan.format !== 'furypipe-provider-attempt-plan/v1') {
    throw new Error('provider attempt plan format is invalid');
  }

  assertPlanAuthority(plan);
  assertScopeConsistency(plan);

  const adapterBlocked = copyAdapterBlocks(plan.adapter.blocked);
  const profileBlocked = copyProfileBlocks(plan.contextProfile.blocked);
  assertAdapterState(plan);
  assertContextProfileState(plan);

  const promptCompilation = compileFuryPrompt(plan.prompt);
  const adapterPromptCompilation = compileFuryPrompt(plan.adapter.prompt);
  const compileInputDigest = promptCompileInputDigest(plan.prompt);
  const adapterCompileInputDigest = promptCompileInputDigest(plan.adapter.prompt);
  if (
    promptCompilation.promptDigest !== adapterPromptCompilation.promptDigest
    || promptCompilation.source.contentDigest !== adapterPromptCompilation.source.contentDigest
    || compileInputDigest !== adapterCompileInputDigest
  ) {
    throw new Error('provider attempt prompt must exactly match adapter plan prompt');
  }

  const adapter = Object.freeze({
    state: plan.adapter.adapterState,
    evidence: plan.adapter.evidence,
    ...(plan.adapter.adapterId === undefined ? {} : { adapterId: plan.adapter.adapterId }),
    ...(plan.adapter.adapterDigest === undefined ? {} : { adapterDigest: plan.adapter.adapterDigest }),
    blocked: adapterBlocked,
  });

  const contextProfile = Object.freeze({
    state: plan.contextProfileState,
    evidence: plan.contextProfile.evidence,
    ...(plan.contextProfile.profileId === undefined ? {} : { profileId: plan.contextProfile.profileId }),
    ...(plan.contextProfile.profileDigest === undefined ? {} : { profileDigest: plan.contextProfile.profileDigest }),
    blocked: profileBlocked,
  });

  return Object.freeze({
    format: 'furypipe-provider-attempt-plan-receipt/v1',
    providerId: exactScope(plan.providerId, 'providerId'),
    model: exactScope(plan.model, 'model'),
    workloadId: exactScope(plan.workloadId, 'workloadId'),
    prompt: Object.freeze({
      promptDigest: promptCompilation.promptDigest,
      sourceDigest: promptCompilation.source.contentDigest,
      compileInputDigest,
      bytes: promptCompilation.promptBytes,
      level: promptCompilation.level,
    }),
    adapter,
    contextProfile,
    authority: Object.freeze({
      networkCallExecuted: false,
      providerRequestExecuted: false,
      optimizerExecuted: false,
      executionAuthorized: false,
    }),
    verification: Object.freeze({
      structuralConsistency: 'verified',
      plannerProvenance: 'not-verified',
      providerResult: 'not-executed',
      currentContextResult: 'not-verified',
    }),
  });
}

export function createProviderAttemptPlanReceipt(
  plan: FuryProviderAttemptPlan,
): FuryProviderAttemptPlanReceipt {
  const core = receiptCore(plan);
  return Object.freeze({
    ...core,
    receiptDigest: receiptDigest(core),
  });
}

export function verifyProviderAttemptPlanReceipt(
  receipt: FuryProviderAttemptPlanReceipt,
  plan: FuryProviderAttemptPlan,
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

    const expected = createProviderAttemptPlanReceipt(plan);
    const suppliedDigest = receiptDigest(suppliedCore);
    return receipt.format === expected.format
      && suppliedDigest === receipt.receiptDigest
      && receipt.receiptDigest === expected.receiptDigest;
  } catch {
    return false;
  }
}
