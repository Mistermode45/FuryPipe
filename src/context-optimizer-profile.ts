import { createHash } from 'node:crypto';

import {
  evaluateBenchmarkClaim,
  type FuryBenchmarkBaseline,
  type FuryBenchmarkClaimDecision,
} from './benchmark-claim-gate.js';
import type {
  FuryContextKind,
  FuryContextOptimizerInput,
} from './context-optimizer.js';

export type FuryContextOptimizerProfileOptions = Pick<
  FuryContextOptimizerInput,
  'maxBytes' | 'maxItems' | 'discoveryMinRelevance' | 'strictOrdering' | 'maxBytesByKind'
>;

export interface FuryContextOptimizerProfileDefinition {
  readonly id: string;
  readonly priority?: number;
  readonly options: FuryContextOptimizerProfileOptions;
}

export interface FuryContextOptimizerProfileRecord {
  readonly id: string;
  readonly priority: number;
  readonly options: FuryContextOptimizerProfileOptions;
  readonly digest: string;
}

export interface FuryContextOptimizerQualificationInput {
  readonly profile: FuryContextOptimizerProfileDefinition;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly benchmarkSuite: unknown;
  readonly benchmarkSuiteSha256: string;
  readonly baseline?: FuryBenchmarkBaseline;
  readonly minimumAbsoluteTokenImprovement?: number;
  readonly minimumRelativeTokenImprovementRatio?: number;
}

export interface FuryContextOptimizerProfileQualification {
  readonly format: 'furypipe-context-optimizer-profile-qualification/v1';
  readonly profileId: string;
  readonly profileDigest: string;
  readonly benchmarkSuiteSha256: string;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly baseline: FuryBenchmarkBaseline;
  readonly comparability: 'VERIFIED';
  readonly claimStatus: 'CLAIM_ELIGIBLE';
  readonly repetitions: number;
  readonly baselineTokenMedian: number;
  readonly candidateTokenMedian: number;
  readonly measuredTokenImprovement: number;
  readonly measuredTokenImprovementRatio: number | null;
  readonly rawQualityMedian: number;
  readonly pxpipeQualityMedian: number;
  readonly candidateQualityMedian: number;
  readonly exactnessMismatches: 0;
  readonly benchmarkErrors: 0;
}

export interface FuryContextOptimizerQualificationDecision {
  readonly format: 'furypipe-context-optimizer-profile-qualification-decision/v1';
  readonly status: 'QUALIFIED' | 'BLOCKED';
  readonly profileId: string;
  readonly profileDigest: string;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly claim: FuryBenchmarkClaimDecision;
  readonly qualification?: FuryContextOptimizerProfileQualification;
  readonly blockers: readonly string[];
  readonly optimizerExecuted: false;
  readonly providerCallExecuted: false;
  readonly executionAuthorized: false;
}

export interface FuryContextOptimizerProfileResolveInput {
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly qualifications?: readonly FuryContextOptimizerProfileQualification[];
}

export type FuryContextOptimizerProfileBlockReason =
  | 'missing-qualification'
  | 'invalid-qualification'
  | 'scope-mismatch'
  | 'digest-mismatch'
  | 'insufficient-repetitions'
  | 'quality-regression'
  | 'exactness-incomplete'
  | 'benchmark-errors'
  | 'no-token-improvement';

export interface FuryContextOptimizerProfileBlock {
  readonly id: string;
  readonly reason: FuryContextOptimizerProfileBlockReason;
}

export interface FuryContextOptimizerProfilePlan {
  readonly format: 'furypipe-context-optimizer-profile-plan/v1';
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly profileId?: string;
  readonly profileDigest?: string;
  readonly options?: FuryContextOptimizerProfileOptions;
  readonly evidence: 'verified' | 'none';
  readonly blocked: readonly FuryContextOptimizerProfileBlock[];
  readonly optimizerExecuted: false;
  readonly providerCallExecuted: false;
  readonly executionAuthorized: false;
}

export interface FuryContextOptimizerProfileRegistry {
  register(definition: FuryContextOptimizerProfileDefinition): FuryContextOptimizerProfileRecord;
  inspect(): readonly FuryContextOptimizerProfileRecord[];
  resolve(input: FuryContextOptimizerProfileResolveInput): FuryContextOptimizerProfilePlan;
}

const MAX_ID_CHARS = 128;
const MAX_SCOPE_CHARS = 256;
const MAX_PROFILES = 256;
const MAX_PRIORITY = 10_000;
const MIN_REPETITIONS = 5;
const HEX64 = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTION_KEYS = new Set([
  'maxBytes',
  'maxItems',
  'discoveryMinRelevance',
  'strictOrdering',
  'maxBytesByKind',
]);
const CONTEXT_KINDS = new Set<FuryContextKind>([
  'instruction',
  'skill',
  'tool',
  'mcp',
  'memory',
  'knowledge',
  'evidence',
  'tool-output',
  'task-state',
  'transcript',
  'other',
]);
const GENERATED_QUALIFICATIONS = new WeakSet<object>();

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || trimmed.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return trimmed;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function boundedUnit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number between 0 and 1`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function normalizeKindBudgets(value: unknown): Readonly<Partial<Record<FuryContextKind, number>>> | undefined {
  if (value === undefined) return undefined;
  const record = plainRecord(value, 'context optimizer profile maxBytesByKind');
  const out: Partial<Record<FuryContextKind, number>> = {};
  for (const [rawKind, rawLimit] of Object.entries(record)) {
    if (!CONTEXT_KINDS.has(rawKind as FuryContextKind)) {
      throw new Error(`context optimizer profile kind is invalid: ${rawKind}`);
    }
    out[rawKind as FuryContextKind] = boundedInteger(
      rawLimit,
      `context optimizer profile maxBytesByKind.${rawKind}`,
      1,
      4 * 1024 * 1024,
    );
  }
  return Object.freeze(out);
}

function normalizeOptions(value: unknown): FuryContextOptimizerProfileOptions {
  const record = plainRecord(value, 'context optimizer profile options');
  for (const key of Object.keys(record)) {
    if (!ALLOWED_OPTION_KEYS.has(key)) {
      throw new Error(`context optimizer profile option is not allowed: ${key}`);
    }
  }

  const maxBytes = record.maxBytes === undefined
    ? undefined
    : boundedInteger(record.maxBytes, 'context optimizer profile maxBytes', 1, 4 * 1024 * 1024);
  const maxItems = record.maxItems === undefined
    ? undefined
    : boundedInteger(record.maxItems, 'context optimizer profile maxItems', 1, 1024);
  const discoveryMinRelevance = record.discoveryMinRelevance === undefined
    ? undefined
    : boundedUnit(record.discoveryMinRelevance, 'context optimizer profile discoveryMinRelevance');
  const strictOrdering = record.strictOrdering;
  if (strictOrdering !== undefined && typeof strictOrdering !== 'boolean') {
    throw new Error('context optimizer profile strictOrdering must be boolean');
  }
  const maxBytesByKind = normalizeKindBudgets(record.maxBytesByKind);

  if (
    maxBytes === undefined
    && maxItems === undefined
    && discoveryMinRelevance === undefined
    && strictOrdering === undefined
    && maxBytesByKind === undefined
  ) {
    throw new Error('context optimizer profile must configure at least one optimization option');
  }

  if (maxBytes !== undefined && maxBytesByKind !== undefined) {
    for (const [kind, limit] of Object.entries(maxBytesByKind)) {
      if (limit !== undefined && limit > maxBytes) {
        throw new Error(`context optimizer profile maxBytesByKind.${kind} exceeds maxBytes`);
      }
    }
  }

  return Object.freeze({
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(maxItems === undefined ? {} : { maxItems }),
    ...(discoveryMinRelevance === undefined ? {} : { discoveryMinRelevance }),
    ...(strictOrdering === undefined ? {} : { strictOrdering }),
    ...(maxBytesByKind === undefined ? {} : { maxBytesByKind }),
  });
}

function canonicalOptions(options: FuryContextOptimizerProfileOptions): Record<string, unknown> {
  const byKind = options.maxBytesByKind === undefined
    ? undefined
    : Object.fromEntries(
      Object.entries(options.maxBytesByKind).sort(([a], [b]) => a.localeCompare(b)),
    );
  return {
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
    ...(options.discoveryMinRelevance === undefined ? {} : { discoveryMinRelevance: options.discoveryMinRelevance }),
    ...(options.strictOrdering === undefined ? {} : { strictOrdering: options.strictOrdering }),
    ...(byKind === undefined ? {} : { maxBytesByKind: byKind }),
  };
}

function normalizeDefinition(
  definition: FuryContextOptimizerProfileDefinition,
): FuryContextOptimizerProfileRecord {
  const record = plainRecord(definition, 'context optimizer profile definition');
  for (const key of Object.keys(record)) {
    if (key !== 'id' && key !== 'priority' && key !== 'options') {
      throw new Error(`context optimizer profile field is not allowed: ${key}`);
    }
  }
  const id = boundedText(record.id, 'context optimizer profile id', MAX_ID_CHARS);
  const priority = record.priority === undefined
    ? 100
    : boundedInteger(record.priority, 'context optimizer profile priority', 0, MAX_PRIORITY);
  const options = normalizeOptions(record.options);
  const canonical = JSON.stringify({
    id,
    priority,
    options: canonicalOptions(options),
  });
  return Object.freeze({
    id,
    priority,
    options,
    digest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  });
}

export function digestContextOptimizerProfile(
  definition: FuryContextOptimizerProfileDefinition,
): string {
  return normalizeDefinition(definition).digest;
}

function validateSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function qualificationValidationError(
  qualification: FuryContextOptimizerProfileQualification,
): string | undefined {
  if (!qualification || typeof qualification !== 'object' || Array.isArray(qualification)) {
    return 'qualification must be an object';
  }
  if (!GENERATED_QUALIFICATIONS.has(qualification)) {
    return 'qualification must be generated by FuryPipe in the current process';
  }
  try {
    if (qualification.format !== 'furypipe-context-optimizer-profile-qualification/v1') {
      return 'qualification format is invalid';
    }
    boundedText(qualification.profileId, 'qualification profileId', MAX_ID_CHARS);
    validateSha256(qualification.profileDigest, 'qualification profileDigest');
    validateSha256(qualification.benchmarkSuiteSha256, 'qualification benchmarkSuiteSha256');
    boundedText(qualification.provider, 'qualification provider', MAX_SCOPE_CHARS);
    boundedText(qualification.model, 'qualification model', MAX_SCOPE_CHARS);
    boundedText(qualification.workloadId, 'qualification workloadId', MAX_SCOPE_CHARS);
    if (qualification.baseline !== 'raw' && qualification.baseline !== 'pxpipe') {
      return 'qualification baseline is invalid';
    }
    if (qualification.comparability !== 'VERIFIED') return 'qualification comparability must be VERIFIED';
    if (qualification.claimStatus !== 'CLAIM_ELIGIBLE') return 'qualification claimStatus must be CLAIM_ELIGIBLE';
    boundedInteger(qualification.repetitions, 'qualification repetitions', 0, Number.MAX_SAFE_INTEGER);
    for (const [label, value] of [
      ['qualification baselineTokenMedian', qualification.baselineTokenMedian],
      ['qualification candidateTokenMedian', qualification.candidateTokenMedian],
      ['qualification measuredTokenImprovement', qualification.measuredTokenImprovement],
    ] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return `${label} must be finite and non-negative`;
      }
    }
    if (
      qualification.measuredTokenImprovementRatio !== null
      && (
        typeof qualification.measuredTokenImprovementRatio !== 'number'
        || !Number.isFinite(qualification.measuredTokenImprovementRatio)
        || qualification.measuredTokenImprovementRatio < 0
      )
    ) {
      return 'qualification measuredTokenImprovementRatio must be finite and non-negative or null';
    }
    boundedUnit(qualification.rawQualityMedian, 'qualification rawQualityMedian');
    boundedUnit(qualification.pxpipeQualityMedian, 'qualification pxpipeQualityMedian');
    boundedUnit(qualification.candidateQualityMedian, 'qualification candidateQualityMedian');
    if (qualification.exactnessMismatches !== 0) return 'qualification exactnessMismatches must be zero';
    if (qualification.benchmarkErrors !== 0) return 'qualification benchmarkErrors must be zero';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

export function isGeneratedContextOptimizerProfileQualification(
  value: unknown,
): value is FuryContextOptimizerProfileQualification {
  return value !== null && typeof value === 'object' && GENERATED_QUALIFICATIONS.has(value as object);
}

function qualificationBlockReason(
  profile: FuryContextOptimizerProfileRecord,
  qualification: FuryContextOptimizerProfileQualification | undefined,
  provider: string,
  model: string,
  workloadId: string,
): FuryContextOptimizerProfileBlockReason | undefined {
  if (qualification === undefined) return 'missing-qualification';
  if (qualificationValidationError(qualification) !== undefined) return 'invalid-qualification';
  if (
    qualification.profileId !== profile.id
    || qualification.provider !== provider
    || qualification.model !== model
    || qualification.workloadId !== workloadId
  ) {
    return 'scope-mismatch';
  }
  if (qualification.profileDigest !== profile.digest) return 'digest-mismatch';
  if (qualification.repetitions < MIN_REPETITIONS) return 'insufficient-repetitions';
  if (
    qualification.candidateQualityMedian < qualification.rawQualityMedian
    || qualification.candidateQualityMedian < qualification.pxpipeQualityMedian
  ) {
    return 'quality-regression';
  }
  if (qualification.exactnessMismatches !== 0) return 'exactness-incomplete';
  if (qualification.benchmarkErrors !== 0) return 'benchmark-errors';
  if (qualification.measuredTokenImprovement <= 0) return 'no-token-improvement';
  return undefined;
}

export function qualifyContextOptimizerProfile(
  input: FuryContextOptimizerQualificationInput,
): FuryContextOptimizerQualificationDecision {
  const record = plainRecord(input, 'context optimizer qualification input');
  const profile = normalizeDefinition(record.profile as FuryContextOptimizerProfileDefinition);
  const provider = boundedText(record.provider, 'context optimizer qualification provider', MAX_SCOPE_CHARS);
  const model = boundedText(record.model, 'context optimizer qualification model', MAX_SCOPE_CHARS);
  const workloadId = boundedText(record.workloadId, 'context optimizer qualification workloadId', MAX_SCOPE_CHARS);
  const benchmarkSuiteSha256 = validateSha256(
    record.benchmarkSuiteSha256,
    'context optimizer qualification benchmarkSuiteSha256',
  );
  const baseline = record.baseline === undefined ? 'raw' : record.baseline;
  if (baseline !== 'raw' && baseline !== 'pxpipe') {
    throw new Error('context optimizer qualification baseline must be raw or pxpipe');
  }

  const claim = evaluateBenchmarkClaim({
    suite: record.benchmarkSuite,
    baseline,
    metric: 'input_tokens',
    direction: 'LOWER_IS_BETTER',
    ...(record.minimumAbsoluteTokenImprovement === undefined
      ? {}
      : { minimumAbsoluteImprovement: record.minimumAbsoluteTokenImprovement as number }),
    ...(record.minimumRelativeTokenImprovementRatio === undefined
      ? {}
      : { minimumRelativeImprovementRatio: record.minimumRelativeTokenImprovementRatio as number }),
  });

  const blockers = [...claim.blockers.map((entry) => `${entry.code}: ${entry.detail}`)];
  if (claim.scope.provider !== provider || claim.scope.model !== model) {
    blockers.push('scope-mismatch: benchmark suite provider/model does not match qualification scope');
  }

  const decisionBase = {
    format: 'furypipe-context-optimizer-profile-qualification-decision/v1' as const,
    profileId: profile.id,
    profileDigest: profile.digest,
    provider,
    model,
    workloadId,
    claim,
    optimizerExecuted: false as const,
    providerCallExecuted: false as const,
    executionAuthorized: false as const,
  };

  if (
    blockers.length > 0
    || claim.status !== 'CLAIM_ELIGIBLE'
    || claim.baselineMedian === null
    || claim.candidateMedian === null
    || claim.measuredImprovement === null
    || claim.measuredImprovement <= 0
  ) {
    return Object.freeze({
      ...decisionBase,
      status: 'BLOCKED' as const,
      blockers: Object.freeze(blockers.length > 0 ? blockers : ['benchmark claim is not eligible']),
    });
  }

  const rawQualityMedian = claim.antiRegression.qualityMedian.raw;
  const pxpipeQualityMedian = claim.antiRegression.qualityMedian.pxpipe;
  const candidateQualityMedian = claim.antiRegression.qualityMedian.furypipe;
  if (rawQualityMedian === null || pxpipeQualityMedian === null || candidateQualityMedian === null) {
    return Object.freeze({
      ...decisionBase,
      status: 'BLOCKED' as const,
      blockers: Object.freeze(['quality evidence is incomplete']),
    });
  }

  const qualification = Object.freeze({
    format: 'furypipe-context-optimizer-profile-qualification/v1' as const,
    profileId: profile.id,
    profileDigest: profile.digest,
    benchmarkSuiteSha256,
    provider,
    model,
    workloadId,
    baseline,
    comparability: 'VERIFIED' as const,
    claimStatus: 'CLAIM_ELIGIBLE' as const,
    repetitions: claim.scope.repetitionsPerVariant,
    baselineTokenMedian: claim.baselineMedian,
    candidateTokenMedian: claim.candidateMedian,
    measuredTokenImprovement: claim.measuredImprovement,
    measuredTokenImprovementRatio: claim.measuredImprovementRatio,
    rawQualityMedian,
    pxpipeQualityMedian,
    candidateQualityMedian,
    exactnessMismatches: 0 as const,
    benchmarkErrors: 0 as const,
  });
  GENERATED_QUALIFICATIONS.add(qualification);

  return Object.freeze({
    ...decisionBase,
    status: 'QUALIFIED' as const,
    qualification,
    blockers: Object.freeze([]),
  });
}

export function createContextOptimizerProfileRegistry(
  initial: readonly FuryContextOptimizerProfileDefinition[] = [],
): FuryContextOptimizerProfileRegistry {
  if (!Array.isArray(initial) || initial.length > MAX_PROFILES) {
    throw new Error(`context optimizer profile registry supports at most ${MAX_PROFILES} profiles`);
  }
  const profiles = new Map<string, FuryContextOptimizerProfileRecord>();

  const register = (
    definition: FuryContextOptimizerProfileDefinition,
  ): FuryContextOptimizerProfileRecord => {
    const profile = normalizeDefinition(definition);
    const existing = profiles.get(profile.id);
    if (existing !== undefined) {
      if (existing.digest !== profile.digest) {
        throw new Error(`context optimizer profile id conflict: ${profile.id}`);
      }
      return existing;
    }
    if (profiles.size >= MAX_PROFILES) {
      throw new Error('context optimizer profile registry size limit reached');
    }
    profiles.set(profile.id, profile);
    return profile;
  };

  for (const definition of initial) register(definition);

  return Object.freeze({
    register,
    inspect() {
      return Object.freeze(
        [...profiles.values()]
          .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
      );
    },
    resolve(input: FuryContextOptimizerProfileResolveInput) {
      const record = plainRecord(input, 'context optimizer profile resolve input');
      const provider = boundedText(record.provider, 'context optimizer profile provider', MAX_SCOPE_CHARS);
      const model = boundedText(record.model, 'context optimizer profile model', MAX_SCOPE_CHARS);
      const workloadId = boundedText(record.workloadId, 'context optimizer profile workloadId', MAX_SCOPE_CHARS);
      const rawQualifications = record.qualifications;
      if (rawQualifications !== undefined && !Array.isArray(rawQualifications)) {
        throw new Error('context optimizer profile qualifications must be an array');
      }
      const qualifications = (rawQualifications ?? []) as readonly FuryContextOptimizerProfileQualification[];
      if (qualifications.length > MAX_PROFILES * 4) {
        throw new Error('context optimizer profile qualifications exceed the configured limit');
      }

      const blocked: FuryContextOptimizerProfileBlock[] = [];
      for (const profile of [...profiles.values()].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
      )) {
        const qualification = qualifications.find((entry) =>
          entry?.profileId === profile.id
          && entry?.provider === provider
          && entry?.model === model
          && entry?.workloadId === workloadId,
        ) ?? qualifications.find((entry) => entry?.profileId === profile.id);

        const reason = qualificationBlockReason(
          profile,
          qualification,
          provider,
          model,
          workloadId,
        );
        if (reason !== undefined) {
          blocked.push(Object.freeze({ id: profile.id, reason }));
          continue;
        }

        return Object.freeze({
          format: 'furypipe-context-optimizer-profile-plan/v1' as const,
          provider,
          model,
          workloadId,
          profileId: profile.id,
          profileDigest: profile.digest,
          options: profile.options,
          evidence: 'verified' as const,
          blocked: Object.freeze(blocked),
          optimizerExecuted: false as const,
          providerCallExecuted: false as const,
          executionAuthorized: false as const,
        });
      }

      return Object.freeze({
        format: 'furypipe-context-optimizer-profile-plan/v1' as const,
        provider,
        model,
        workloadId,
        evidence: 'none' as const,
        blocked: Object.freeze(blocked),
        optimizerExecuted: false as const,
        providerCallExecuted: false as const,
        executionAuthorized: false as const,
      });
    },
  });
}
