import { createHash } from 'node:crypto';

import {
  isGeneratedFuryBetaConfigObservation,
  type FuryBetaConfigMode,
  type FuryBetaConfigObservation,
} from './beta-config.js';

export const FURY_BETA_EXPERIENCE_FORMAT = 'furypipe-beta-experience/v1' as const;

export type FuryBetaRequestedEntry = 'default' | 'task-first' | 'legacy' | 'expert';
export type FuryBetaResolvedMode = 'recommended' | 'legacy' | 'opted-out' | 'blocked';
export type FuryBetaEntryPath = 'task-first' | 'legacy-expert' | 'blocked';

export interface FuryBetaEntrySnapshot {
  readonly format: typeof FURY_BETA_EXPERIENCE_FORMAT;
  readonly mode: FuryBetaResolvedMode;
  readonly entryPath: FuryBetaEntryPath;
  readonly requestedEntry: FuryBetaRequestedEntry;
  readonly configuredMode: FuryBetaConfigMode | null;
  readonly configStatus: FuryBetaConfigObservation['status'];
  readonly optOutAvailable: true;
  readonly legacyExpertPathAvailable: true;
  readonly reversible: true;
  readonly authority: 'entry-routing-observation-only';
  readonly selectionAuthority: 'selection-only';
  readonly executionAuthority: false;
  readonly grantAuthority: false;
  readonly installationAuthority: false;
  readonly reasonCodes: readonly string[];
  readonly digestSha256: string;
}

export interface FuryBetaTaskPlan {
  readonly format: 'furypipe-beta-task-plan/v1';
  readonly objectiveDigestSha256: string;
  readonly objectiveLength: number;
  readonly entry: FuryBetaEntrySnapshot;
  readonly selection: 'not-run';
  readonly selectedCapabilities: readonly [];
  readonly execution: 'not-authorized';
  readonly authority: 'planning-only';
  readonly executionAuthority: false;
  readonly reasonCodes: readonly string[];
}

const OBJECTIVE_MAX_CHARS = 64_000;
const REASONS = Object.freeze([
  'config-invalid',
  'config-missing',
  'config-legacy',
  'config-opted-out',
  'config-recommended',
  'explicit-task-first',
  'explicit-legacy',
  'explicit-expert',
  'default-task-first',
  'default-legacy',
  'legacy-compatible-path',
  'task-first-planning-only',
] as const);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedReasons(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((a, b) => a.localeCompare(b)));
}

function requestedEntry(value: FuryBetaRequestedEntry | undefined): FuryBetaRequestedEntry {
  if (value === undefined) return 'default';
  if (!['default', 'task-first', 'legacy', 'expert'].includes(value)) {
    throw new RangeError(`unsupported beta entry: ${value}`);
  }
  return value;
}

/**
 * Resolve the recommended entry without writing configuration or granting any
 * runtime authority. A missing config is the fresh-install recommendation;
 * an existing legacy config stays on the legacy/expert-compatible path until
 * the operator explicitly opts in.
 */
export function resolveFuryBetaEntry(
  config: FuryBetaConfigObservation,
  requested: FuryBetaRequestedEntry = 'default',
): FuryBetaEntrySnapshot {
  if (!isGeneratedFuryBetaConfigObservation(config)) {
    throw new TypeError('beta entry requires a generated configuration observation');
  }
  const requestedEntryValue = requestedEntry(requested);
  const reasons: string[] = [];
  let mode: FuryBetaResolvedMode;
  let entryPath: FuryBetaEntryPath;

  if (config.status === 'invalid' || config.status === 'unsupported') {
    mode = 'blocked';
    entryPath = 'blocked';
    reasons.push('config-invalid');
  } else if (requestedEntryValue === 'task-first') {
    mode = 'recommended';
    entryPath = 'task-first';
    reasons.push('explicit-task-first');
  } else if (requestedEntryValue === 'legacy' || requestedEntryValue === 'expert') {
    mode = config.mode === 'opted-out' ? 'opted-out' : 'legacy';
    entryPath = 'legacy-expert';
    reasons.push(requestedEntryValue === 'expert' ? 'explicit-expert' : 'explicit-legacy');
  } else if (config.status === 'missing') {
    mode = 'recommended';
    entryPath = 'task-first';
    reasons.push('config-missing', 'default-task-first');
  } else if (config.status === 'legacy' || config.mode === 'legacy') {
    mode = 'legacy';
    entryPath = 'legacy-expert';
    reasons.push(config.status === 'legacy' ? 'config-legacy' : 'default-legacy');
  } else if (config.mode === 'opted-out') {
    mode = 'opted-out';
    entryPath = 'legacy-expert';
    reasons.push('config-opted-out', 'legacy-compatible-path');
  } else {
    mode = 'recommended';
    entryPath = 'task-first';
    reasons.push('config-recommended');
  }

  const canonical = {
    format: FURY_BETA_EXPERIENCE_FORMAT,
    mode,
    entryPath,
    requestedEntry: requestedEntryValue,
    configuredMode: config.mode,
    configStatus: config.status,
    reasonCodes: normalizedReasons(reasons),
  };
  return Object.freeze({
    ...canonical,
    optOutAvailable: true,
    legacyExpertPathAvailable: true,
    reversible: true,
    authority: 'entry-routing-observation-only',
    selectionAuthority: 'selection-only',
    executionAuthority: false,
    grantAuthority: false,
    installationAuthority: false,
    reasonCodes: normalizedReasons(reasons),
    digestSha256: sha256(JSON.stringify(canonical)),
  });
}

/**
 * Build the safe task-first CLI/Web handoff. It deliberately stops before
 * capability selection and execution: the real host must inject its actual
 * runtime inventory and pass the normal governed task orchestrator later.
 */
export function createFuryBetaTaskPlan(
  objective: string,
  config: FuryBetaConfigObservation,
  requested: FuryBetaRequestedEntry = 'default',
): FuryBetaTaskPlan {
  if (typeof objective !== 'string') throw new TypeError('task objective must be text');
  const normalized = objective.normalize('NFKC').trim();
  if (!normalized || normalized.length > OBJECTIVE_MAX_CHARS || normalized.includes('\0')) {
    throw new Error('task objective must be a bounded non-empty string');
  }
  const entry = resolveFuryBetaEntry(config, requested);
  const reasonCodes = entry.mode === 'blocked'
    ? Object.freeze(['config-invalid'] as const)
    : Object.freeze(['task-first-planning-only'] as const);
  return Object.freeze({
    format: 'furypipe-beta-task-plan/v1',
    objectiveDigestSha256: sha256(normalized),
    objectiveLength: normalized.length,
    entry,
    selection: 'not-run',
    selectedCapabilities: Object.freeze([]) as readonly [],
    execution: 'not-authorized',
    authority: 'planning-only',
    executionAuthority: false,
    reasonCodes,
  });
}

export function isFuryBetaReasonCode(value: string): boolean {
  return (REASONS as readonly string[]).includes(value);
}
