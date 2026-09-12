import { createHash } from 'node:crypto';

import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';

export const FURY_MODEL_ADAPTER_SAFE_SECTIONS = Object.freeze([
  'role',
  'constraints',
  'plan',
  'outputContract',
  'acceptanceCriteria',
  'verification',
] as const satisfies readonly FuryPromptSection[]);

export type FuryModelAdapterSafeSection = typeof FURY_MODEL_ADAPTER_SAFE_SECTIONS[number];

export interface FuryModelAdapterDefinition {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly priority?: number;
  readonly additions: Readonly<Partial<Record<FuryModelAdapterSafeSection, readonly string[]>>>;
}

export interface FuryModelAdapterQualification {
  readonly format: 'furypipe-model-adapter-qualification/v1';
  readonly adapterId: string;
  readonly adapterDigest: string;
  readonly benchmarkSuiteSha256: string;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly comparability: 'VERIFIED';
  readonly claimStatus: 'CLAIM_ELIGIBLE';
  readonly repetitions: number;
  readonly baselineQualityMedian: number;
  readonly candidateQualityMedian: number;
  readonly exactnessCheckedRuns: number;
  readonly exactnessPassingRuns: number;
  readonly exactnessMismatches: number;
  readonly errors: number;
}

export interface FuryModelAdapterResolveInput {
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly prompt: FuryPromptCompileInput;
  readonly qualifications?: readonly FuryModelAdapterQualification[];
}

export interface FuryModelAdapterBlock {
  readonly id: string;
  readonly reason:
    | 'missing-qualification'
    | 'invalid-qualification'
    | 'scope-mismatch'
    | 'digest-mismatch'
    | 'insufficient-repetitions'
    | 'quality-regression'
    | 'exactness-incomplete'
    | 'benchmark-errors';
}

export interface FuryModelAdapterPlan {
  readonly format: 'furypipe-model-adapter-plan/v1';
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly adapterId?: string;
  readonly adapterDigest?: string;
  readonly prompt: FuryPromptCompileInput;
  readonly blocked: readonly FuryModelAdapterBlock[];
  readonly evidence: 'verified' | 'none';
}

export interface FuryModelAdapterRegistry {
  register(definition: FuryModelAdapterDefinition): void;
  inspect(): readonly FuryModelAdapterDefinition[];
  resolve(input: FuryModelAdapterResolveInput): FuryModelAdapterPlan;
}

const MAX_ID_CHARS = 128;
const MAX_SCOPE_CHARS = 256;
const MAX_ADDITIONS_PER_SECTION = 16;
const MAX_ADDITION_CHARS = 4096;
const MAX_TOTAL_ADDITION_BYTES = 24 * 1024;
const MIN_REPETITIONS = 5;
const HEX64 = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

interface NormalizedAdapter extends FuryModelAdapterDefinition {
  readonly priority: number;
  readonly digest: string;
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(label + ' must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || trimmed.includes('\0')) {
    throw new Error(label + ' must be a bounded non-empty string');
  }
  return trimmed;
}

function boundedUnit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(label + ' must be a finite number between 0 and 1');
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function boundedNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(label + ' must be a non-negative safe integer');
  }
  return value as number;
}

function normalizeAdditions(
  value: FuryModelAdapterDefinition['additions'],
): Readonly<Partial<Record<FuryModelAdapterSafeSection, readonly string[]>>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model adapter additions must be an object');
  }
  const out: Partial<Record<FuryModelAdapterSafeSection, readonly string[]>> = {};
  let totalBytes = 0;

  for (const [rawSection, rawValues] of Object.entries(value)) {
    if (!FURY_MODEL_ADAPTER_SAFE_SECTIONS.includes(rawSection as FuryModelAdapterSafeSection)) {
      throw new Error('model adapter section is not allowed: ' + rawSection);
    }
    if (!Array.isArray(rawValues) || rawValues.length < 1 || rawValues.length > MAX_ADDITIONS_PER_SECTION) {
      throw new Error('model adapter section must contain 1 to ' + MAX_ADDITIONS_PER_SECTION + ' additions');
    }
    const section = rawSection as FuryModelAdapterSafeSection;
    const values: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawValues as readonly unknown[]) {
      const item = boundedText(raw, 'model adapter addition', MAX_ADDITION_CHARS);
      if (seen.has(item)) throw new Error('model adapter contains duplicate additions');
      seen.add(item);
      totalBytes += encoder.encode(item).byteLength;
      if (totalBytes > MAX_TOTAL_ADDITION_BYTES) {
        throw new Error('model adapter additions exceed 24 KiB');
      }
      values.push(item);
    }
    out[section] = Object.freeze(values);
  }

  if (Object.keys(out).length === 0) throw new Error('model adapter must add at least one instruction');
  return Object.freeze(out);
}

function canonicalAdapterValue(definition: Omit<NormalizedAdapter, 'digest'>): string {
  const additions = Object.fromEntries(
    FURY_MODEL_ADAPTER_SAFE_SECTIONS
      .filter((section) => definition.additions[section] !== undefined)
      .map((section) => [section, definition.additions[section]]),
  );
  return JSON.stringify({
    id: definition.id,
    provider: definition.provider,
    model: definition.model,
    workloadId: definition.workloadId,
    priority: definition.priority,
    additions,
  });
}

function adapterDigest(definition: Omit<NormalizedAdapter, 'digest'>): string {
  return createHash('sha256').update(canonicalAdapterValue(definition), 'utf8').digest('hex');
}

function normalizeDefinition(definition: FuryModelAdapterDefinition): NormalizedAdapter {
  if (!definition || typeof definition !== 'object') throw new TypeError('model adapter definition is required');
  const priority = definition.priority ?? 100;
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 10_000) {
    throw new Error('model adapter priority must be an integer from 0 to 10000');
  }
  const normalized = Object.freeze({
    id: boundedText(definition.id, 'model adapter id', MAX_ID_CHARS),
    provider: boundedText(definition.provider, 'model adapter provider', MAX_SCOPE_CHARS),
    model: boundedText(definition.model, 'model adapter model', MAX_SCOPE_CHARS),
    workloadId: boundedText(definition.workloadId, 'model adapter workload', MAX_SCOPE_CHARS),
    priority,
    additions: normalizeAdditions(definition.additions),
  });
  return Object.freeze({
    ...normalized,
    digest: adapterDigest(normalized),
  });
}

function validateQualification(
  qualification: FuryModelAdapterQualification,
): string | undefined {
  if (!qualification || typeof qualification !== 'object') return 'qualification must be an object';
  if (qualification.format !== 'furypipe-model-adapter-qualification/v1') return 'qualification format is invalid';
  try {
    boundedText(qualification.adapterId, 'qualification adapterId', MAX_ID_CHARS);
    boundedText(qualification.provider, 'qualification provider', MAX_SCOPE_CHARS);
    boundedText(qualification.model, 'qualification model', MAX_SCOPE_CHARS);
    boundedText(qualification.workloadId, 'qualification workloadId', MAX_SCOPE_CHARS);
    if (!HEX64.test(qualification.adapterDigest)) return 'qualification adapterDigest must be lowercase SHA-256';
    if (!HEX64.test(qualification.benchmarkSuiteSha256)) return 'qualification benchmarkSuiteSha256 must be lowercase SHA-256';
    if (qualification.comparability !== 'VERIFIED') return 'qualification comparability must be VERIFIED';
    if (qualification.claimStatus !== 'CLAIM_ELIGIBLE') return 'qualification claimStatus must be CLAIM_ELIGIBLE';
    boundedNonNegativeInteger(qualification.repetitions, 'qualification repetitions');
    boundedUnit(qualification.baselineQualityMedian, 'qualification baselineQualityMedian');
    boundedUnit(qualification.candidateQualityMedian, 'qualification candidateQualityMedian');
    boundedNonNegativeInteger(qualification.exactnessCheckedRuns, 'qualification exactnessCheckedRuns');
    boundedNonNegativeInteger(qualification.exactnessPassingRuns, 'qualification exactnessPassingRuns');
    boundedNonNegativeInteger(qualification.exactnessMismatches, 'qualification exactnessMismatches');
    boundedNonNegativeInteger(qualification.errors, 'qualification errors');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

function blockReason(
  adapter: NormalizedAdapter,
  qualification: FuryModelAdapterQualification | undefined,
): FuryModelAdapterBlock['reason'] | undefined {
  if (qualification === undefined) return 'missing-qualification';
  if (validateQualification(qualification) !== undefined) return 'invalid-qualification';
  if (
    qualification.adapterId !== adapter.id
    || qualification.provider !== adapter.provider
    || qualification.model !== adapter.model
    || qualification.workloadId !== adapter.workloadId
  ) {
    return 'scope-mismatch';
  }
  if (qualification.adapterDigest !== adapter.digest) return 'digest-mismatch';
  if (qualification.repetitions < MIN_REPETITIONS) return 'insufficient-repetitions';
  if (qualification.candidateQualityMedian < qualification.baselineQualityMedian) return 'quality-regression';
  if (
    qualification.exactnessMismatches !== 0
    || qualification.exactnessCheckedRuns < qualification.repetitions
    || qualification.exactnessPassingRuns !== qualification.exactnessCheckedRuns
  ) {
    return 'exactness-incomplete';
  }
  if (qualification.errors !== 0) return 'benchmark-errors';
  return undefined;
}

function normalizeSectionValue(value: FuryPromptSectionValue | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

function applyAdditions(
  prompt: FuryPromptCompileInput,
  additions: FuryModelAdapterDefinition['additions'],
): FuryPromptCompileInput {
  const next: Record<string, FuryPromptSectionValue | undefined> = { ...prompt.sections };
  for (const section of FURY_MODEL_ADAPTER_SAFE_SECTIONS) {
    const values = additions[section];
    if (values === undefined) continue;
    const existing = normalizeSectionValue(next[section]);
    const seen = new Set(existing);
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value);
        existing.push(value);
      }
    }
    next[section] = Object.freeze(existing);
  }
  return Object.freeze({
    ...prompt,
    sections: Object.freeze(next) as FuryPromptSections,
  });
}

function validateResolveInput(input: FuryModelAdapterResolveInput): {
  provider: string;
  model: string;
  workloadId: string;
  qualifications: readonly FuryModelAdapterQualification[];
} {
  if (!input || typeof input !== 'object' || !input.prompt || typeof input.prompt !== 'object') {
    throw new TypeError('model adapter resolution input is required');
  }
  if (!input.prompt.sections || typeof input.prompt.sections !== 'object') {
    throw new Error('model adapter resolution requires FuryPrompt sections');
  }
  const qualifications = input.qualifications ?? [];
  if (!Array.isArray(qualifications) || qualifications.length > 256) {
    throw new Error('model adapter qualifications must be a bounded array');
  }
  return {
    provider: boundedText(input.provider, 'model adapter resolution provider', MAX_SCOPE_CHARS),
    model: boundedText(input.model, 'model adapter resolution model', MAX_SCOPE_CHARS),
    workloadId: boundedText(input.workloadId, 'model adapter resolution workload', MAX_SCOPE_CHARS),
    qualifications,
  };
}

export function createModelAdapterRegistry(
  initial: readonly FuryModelAdapterDefinition[] = [],
): FuryModelAdapterRegistry {
  if (!Array.isArray(initial)) throw new TypeError('initial model adapters must be an array');
  const definitions = new Map<string, NormalizedAdapter>();

  const register = (definition: FuryModelAdapterDefinition): void => {
    const normalized = normalizeDefinition(definition);
    if (definitions.has(normalized.id)) throw new Error('duplicate model adapter id: ' + normalized.id);
    definitions.set(normalized.id, normalized);
  };

  for (const definition of initial) register(definition);

  return Object.freeze({
    register,
    inspect() {
      return Object.freeze(
        [...definitions.values()]
          .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
          .map(({ digest: _digest, ...definition }) => Object.freeze(definition)),
      );
    },
    resolve(input) {
      const normalizedInput = validateResolveInput(input);
      const candidates = [...definitions.values()]
        .filter((definition) =>
          definition.provider === normalizedInput.provider
          && definition.model === normalizedInput.model
          && definition.workloadId === normalizedInput.workloadId,
        )
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

      const qualificationsById = new Map<string, FuryModelAdapterQualification>();
      for (const qualification of normalizedInput.qualifications) {
        if (!qualification || typeof qualification !== 'object') continue;
        if (typeof qualification.adapterId !== 'string' || qualificationsById.has(qualification.adapterId)) continue;
        qualificationsById.set(qualification.adapterId, qualification);
      }

      const blocked: FuryModelAdapterBlock[] = [];
      let selected: NormalizedAdapter | undefined;
      for (const adapter of candidates) {
        const qualification = qualificationsById.get(adapter.id);
        const reason = blockReason(adapter, qualification);
        if (reason !== undefined) {
          blocked.push(Object.freeze({ id: adapter.id, reason }));
          continue;
        }
        selected = adapter;
        break;
      }

      if (selected === undefined) {
        return Object.freeze({
          format: 'furypipe-model-adapter-plan/v1',
          provider: normalizedInput.provider,
          model: normalizedInput.model,
          workloadId: normalizedInput.workloadId,
          prompt: input.prompt,
          blocked: Object.freeze(blocked),
          evidence: 'none',
        });
      }

      return Object.freeze({
        format: 'furypipe-model-adapter-plan/v1',
        provider: normalizedInput.provider,
        model: normalizedInput.model,
        workloadId: normalizedInput.workloadId,
        adapterId: selected.id,
        adapterDigest: selected.digest,
        prompt: applyAdditions(input.prompt, selected.additions),
        blocked: Object.freeze(blocked),
        evidence: 'verified',
      });
    },
  });
}

export function digestModelAdapter(definition: FuryModelAdapterDefinition): string {
  return normalizeDefinition(definition).digest;
}
