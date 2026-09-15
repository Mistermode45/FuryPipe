import { compileFuryPrompt, FURY_PROMPT_SECTION_ORDER } from './fury-prompt.js';
import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSections,
  FuryPromptSectionValue,
} from './fury-prompt.js';
import {
  createModelAdapterRegistry,
  type FuryModelAdapterBlock,
  type FuryModelAdapterPlan,
  type FuryModelAdapterQualification,
  type FuryModelAdapterRegistry,
} from './model-adapter-registry.js';

declare const attemptPromptBrand: unique symbol;

/** A task-level prompt that has not been adapted for a provider attempt. */
export type FuryProviderAttemptBasePrompt = FuryPromptCompileInput & {
  readonly [attemptPromptBrand]?: never;
};

/** An attempt-scoped prompt; it cannot be passed back as another planner's base. */
export type FuryProviderAttemptPrompt = FuryPromptCompileInput & {
  readonly [attemptPromptBrand]: true;
};

export interface FuryProviderAttemptIdentity {
  /** Exact provider selected by the caller; this planner does not infer it. */
  readonly providerId: string;
  /** Exact provider model selected by the caller; this planner does not rewrite it. */
  readonly model: string;
  readonly workloadId: string;
}

export interface FuryProviderAttemptAdapterPlannerInput {
  readonly basePrompt: FuryProviderAttemptBasePrompt;
  readonly registry: FuryModelAdapterRegistry;
  readonly qualifications?: readonly FuryModelAdapterQualification[];
}

export interface FuryProviderAttemptAdapterPlan {
  readonly format: 'furypipe-provider-attempt-adapter-plan/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly adapterState: 'IDENTITY' | 'APPLIED' | 'BLOCKED';
  readonly adapterId?: string;
  readonly adapterDigest?: string;
  readonly prompt: FuryProviderAttemptPrompt;
  readonly blocked: readonly FuryModelAdapterBlock[];
  readonly evidence: 'none' | 'verified';
  readonly networkCallExecuted: false;
  readonly providerRequestExecuted: false;
}

export interface FuryProviderAttemptAdapterPlanner {
  /** Resolve each provider attempt independently from the captured base prompt. */
  plan(attempt: FuryProviderAttemptIdentity): FuryProviderAttemptAdapterPlan;
}

const MAX_SCOPE_CHARS = 256;
const MAX_REGISTRY_ADAPTERS = 256;
const MAX_QUALIFICATIONS = 256;
const MAX_SECTION_VALUES = 256;
const MAX_VALUE_CHARS = 1_000_000;
const MAX_TOTAL_PROMPT_BYTES = 8 * 1024 * 1024;
const PROMPT_KEYS = Object.freeze(['sections', 'level', 'securityCritical', 'exactGuardMode']);
const QUALIFICATION_KEYS = Object.freeze([
  'format',
  'adapterId',
  'adapterDigest',
  'benchmarkSuiteSha256',
  'provider',
  'model',
  'workloadId',
  'comparability',
  'claimStatus',
  'repetitions',
  'baselineQualityMedian',
  'candidateQualityMedian',
  'exactnessCheckedRuns',
  'exactnessPassingRuns',
  'exactnessMismatches',
  'errors',
]);
const encoder = new TextEncoder();

function ownDataRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${label} must not contain symbol keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property`);
    }
    Object.defineProperty(record, key, {
      value: descriptor.value,
      enumerable: true,
    });
  }
  return record;
}

function assertKnownKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains an unsupported field: ${key}`);
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
    throw new Error(`${label} must be an exact 1-${MAX_SCOPE_CHARS} character identifier without whitespace padding or controls`);
  }
  return value;
}

function cloneBasePrompt(value: FuryProviderAttemptBasePrompt): FuryPromptCompileInput {
  const input = ownDataRecord(value, 'base FuryPrompt');
  assertKnownKeys(input, PROMPT_KEYS, 'base FuryPrompt');
  const sourceSections = ownDataRecord(input.sections, 'base FuryPrompt sections');
  const sections: Record<string, FuryPromptSectionValue> = Object.create(null) as Record<string, FuryPromptSectionValue>;
  let totalBytes = 0;

  for (const key of Object.keys(sourceSections)) {
    if (!(FURY_PROMPT_SECTION_ORDER as readonly string[]).includes(key)) {
      throw new Error(`base FuryPrompt contains an unsupported section: ${key}`);
    }
  }

  const addValue = (raw: unknown, section: FuryPromptSection): string => {
    if (typeof raw !== 'string') throw new TypeError(`base FuryPrompt section ${section} values must be strings`);
    if (raw.length > MAX_VALUE_CHARS) throw new RangeError(`base FuryPrompt section ${section} value is too large`);
    totalBytes += encoder.encode(raw).byteLength;
    if (totalBytes > MAX_TOTAL_PROMPT_BYTES) throw new RangeError('base FuryPrompt exceeds the 8 MiB limit');
    return raw;
  };

  for (const section of FURY_PROMPT_SECTION_ORDER) {
    const raw = sourceSections[section];
    if (raw === undefined) continue;
    if (typeof raw === 'string') {
      sections[section] = addValue(raw, section);
      continue;
    }
    if (!Array.isArray(raw)) throw new TypeError(`base FuryPrompt section ${section} must be a string or string array`);
    if (raw.length > MAX_SECTION_VALUES) throw new RangeError(`base FuryPrompt section ${section} has too many values`);

    const values: string[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      if (!Object.hasOwn(raw, index)) throw new TypeError(`base FuryPrompt section ${section} must not contain sparse values`);
      values.push(addValue(raw[index], section));
    }
    sections[section] = Object.freeze(values);
  }

  if (input.securityCritical !== undefined && typeof input.securityCritical !== 'boolean') {
    throw new TypeError('base FuryPrompt securityCritical must be a boolean');
  }

  const snapshot: FuryPromptCompileInput = Object.freeze({
    sections: Object.freeze(sections) as FuryPromptSections,
    ...(input.level === undefined ? {} : { level: input.level as FuryPromptCompileInput['level'] }),
    ...(input.securityCritical === undefined ? {} : { securityCritical: input.securityCritical }),
    ...(input.exactGuardMode === undefined ? {} : { exactGuardMode: input.exactGuardMode as FuryPromptCompileInput['exactGuardMode'] }),
  });

  // Reuse FuryPrompt's canonical validation for enum values and semantic constraints.
  compileFuryPrompt(snapshot);
  return snapshot;
}

function freshAttemptPrompt(basePrompt: FuryPromptCompileInput): FuryProviderAttemptPrompt {
  const sections: Record<string, FuryPromptSectionValue> = Object.create(null) as Record<string, FuryPromptSectionValue>;
  for (const section of FURY_PROMPT_SECTION_ORDER) {
    const value = basePrompt.sections[section];
    if (value === undefined) continue;
    sections[section] = typeof value === 'string' ? value : Object.freeze([...value]);
  }
  return Object.freeze({
    ...basePrompt,
    sections: Object.freeze(sections) as FuryPromptSections,
  }) as FuryProviderAttemptPrompt;
}

function snapshotQualifications(
  qualifications: readonly FuryModelAdapterQualification[] | undefined,
): readonly FuryModelAdapterQualification[] {
  const source = qualifications ?? [];
  if (!Array.isArray(source) || source.length > MAX_QUALIFICATIONS) {
    throw new Error(`provider attempt qualifications must be an array of at most ${MAX_QUALIFICATIONS} entries`);
  }

  const snapshots = source.map((qualification, index) => {
    const record = ownDataRecord(qualification, `qualification ${index}`);
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of QUALIFICATION_KEYS) {
      if (Object.hasOwn(record, key)) {
        Object.defineProperty(copy, key, { value: record[key], enumerable: true });
      }
    }
    return Object.freeze(copy) as unknown as FuryModelAdapterQualification;
  });
  return Object.freeze(snapshots);
}

function snapshotRegistry(registry: FuryModelAdapterRegistry): FuryModelAdapterRegistry {
  if (!registry || typeof registry !== 'object' || typeof registry.inspect !== 'function') {
    throw new TypeError('provider attempt planner requires a model adapter registry');
  }
  const definitions = registry.inspect();
  if (!Array.isArray(definitions) || definitions.length > MAX_REGISTRY_ADAPTERS) {
    throw new Error(`provider attempt model adapter registry must contain at most ${MAX_REGISTRY_ADAPTERS} definitions`);
  }
  return createModelAdapterRegistry(definitions);
}

function adapterState(plan: FuryModelAdapterPlan): FuryProviderAttemptAdapterPlan['adapterState'] {
  if (plan.adapterId !== undefined) return 'APPLIED';
  if (plan.blocked.some((entry) => entry.reason !== 'missing-qualification')) return 'BLOCKED';
  return 'IDENTITY';
}

/**
 * Capture one immutable, model-neutral base prompt and resolve every provider
 * attempt independently through the existing FuryBench-gated registry.
 *
 * Calling `plan()` repeatedly never accepts a previous attempt prompt as input.
 */
export function createProviderAttemptAdapterPlanner(
  input: FuryProviderAttemptAdapterPlannerInput,
): FuryProviderAttemptAdapterPlanner {
  const plannerInput = ownDataRecord(input, 'provider attempt planner input');
  assertKnownKeys(plannerInput, ['basePrompt', 'registry', 'qualifications'], 'provider attempt planner input');
  const basePrompt = cloneBasePrompt(plannerInput.basePrompt as FuryProviderAttemptBasePrompt);
  const registry = snapshotRegistry(plannerInput.registry as FuryModelAdapterRegistry);
  const qualifications = snapshotQualifications(
    plannerInput.qualifications as readonly FuryModelAdapterQualification[] | undefined,
  );

  return Object.freeze({
    plan(attempt: FuryProviderAttemptIdentity): FuryProviderAttemptAdapterPlan {
      const identity = ownDataRecord(attempt, 'provider attempt identity');
      assertKnownKeys(identity, ['providerId', 'model', 'workloadId'], 'provider attempt identity');
      const providerId = exactScope(identity.providerId, 'providerId');
      const model = exactScope(identity.model, 'model');
      const workloadId = exactScope(identity.workloadId, 'workloadId');
      const attemptPrompt = freshAttemptPrompt(basePrompt);
      const resolved = registry.resolve({
        provider: providerId,
        model,
        workloadId,
        prompt: attemptPrompt,
        qualifications,
      });
      const blocked = Object.freeze(resolved.blocked.map((entry) => Object.freeze({ ...entry })));

      return Object.freeze({
        format: 'furypipe-provider-attempt-adapter-plan/v1',
        providerId,
        model,
        workloadId,
        adapterState: adapterState(resolved),
        ...(resolved.adapterId === undefined ? {} : { adapterId: resolved.adapterId }),
        ...(resolved.adapterDigest === undefined ? {} : { adapterDigest: resolved.adapterDigest }),
        prompt: resolved.prompt as FuryProviderAttemptPrompt,
        blocked,
        evidence: resolved.evidence,
        networkCallExecuted: false,
        providerRequestExecuted: false,
      });
    },
  });
}
