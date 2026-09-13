import type { CapabilityCandidate, ProvenanceClassification } from './ecosystem/types.js';
import {
  isGeneratedFuryTrustReport,
  type FuryTrustReport,
  type FuryTrustVerdict,
  type TrustConfidence,
} from './fury-trust.js';

export const FURY_SCORE_FORMAT = 'furypipe-capability-score/v1' as const;
export const FURY_SCORE_POLICY_VERSION = 'furyscore-v1' as const;

export type FuryScoreRoutingState =
  | 'RANKED'
  | 'REVIEW_REQUIRED'
  | 'REFERENCE_ONLY'
  | 'BLOCKED';

export type FuryScoreConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FuryCapabilityPerformanceEvidenceInput {
  readonly candidateId: string;
  readonly benchmarkId: string;
  readonly benchmarkSha256: string;
  readonly provider: string;
  readonly model: string;
  readonly workloadId: string;
  readonly sampleSize: number;
  /** Candidate quality minus baseline quality, expressed on a -1..1 scale. */
  readonly qualityDelta: number;
  /** Fractional delta vs baseline. Negative means fewer tokens. */
  readonly tokenDeltaRatio: number;
  /** Fractional delta vs baseline. Negative means lower latency. */
  readonly latencyDeltaRatio: number;
  /** Fractional delta vs baseline. Negative means lower cost. */
  readonly costDeltaRatio?: number;
  readonly exactnessPassed: boolean;
  readonly errors: number;
}

export interface QualifiedFuryCapabilityPerformanceEvidence
  extends FuryCapabilityPerformanceEvidenceInput {
  readonly format: 'furypipe-capability-performance/v1';
}

export interface FuryScoreComponents {
  readonly relevance: number;
  readonly trust: number;
  readonly provenance: number;
  readonly health: number;
  readonly maintenance: number;
  readonly performance: number;
  readonly riskPenalty: number;
}

export interface FuryCapabilityScore {
  readonly format: typeof FURY_SCORE_FORMAT;
  readonly policyVersion: typeof FURY_SCORE_POLICY_VERSION;
  readonly candidateId: string;
  readonly name: string;
  readonly routingState: FuryScoreRoutingState;
  readonly score: number;
  readonly confidence: FuryScoreConfidence;
  readonly components: FuryScoreComponents;
  readonly riskScore: number;
  readonly trustVerdict: FuryTrustVerdict;
  readonly performanceEvidence: 'QUALIFIED' | 'NONE';
  readonly executionAuthorized: false;
  readonly reasons: readonly string[];
}

export interface FuryScoreInput {
  readonly candidate: CapabilityCandidate;
  readonly trustReport: FuryTrustReport;
  readonly relevance: number;
  readonly provider?: string;
  readonly model?: string;
  readonly workloadId?: string;
  readonly performance?: QualifiedFuryCapabilityPerformanceEvidence;
}

const QUALIFIED_PERFORMANCE = new WeakSet<object>();
const HEX64 = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function boundedText(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }
  return trimmed;
}

function finiteRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function performanceFingerprint(input: FuryCapabilityPerformanceEvidenceInput): string {
  return JSON.stringify({
    candidateId: input.candidateId,
    benchmarkId: input.benchmarkId,
    benchmarkSha256: input.benchmarkSha256,
    provider: input.provider,
    model: input.model,
    workloadId: input.workloadId,
    sampleSize: input.sampleSize,
    qualityDelta: input.qualityDelta,
    tokenDeltaRatio: input.tokenDeltaRatio,
    latencyDeltaRatio: input.latencyDeltaRatio,
    costDeltaRatio: input.costDeltaRatio ?? null,
    exactnessPassed: input.exactnessPassed,
    errors: input.errors,
  });
}

export function qualifyFuryCapabilityPerformance(
  input: FuryCapabilityPerformanceEvidenceInput,
): QualifiedFuryCapabilityPerformanceEvidence {
  if (!input || typeof input !== 'object') {
    throw new TypeError('capability performance evidence is required');
  }

  const normalized: QualifiedFuryCapabilityPerformanceEvidence = Object.freeze({
    format: 'furypipe-capability-performance/v1',
    candidateId: boundedText(input.candidateId, 'candidateId', 160),
    benchmarkId: boundedText(input.benchmarkId, 'benchmarkId', 160),
    benchmarkSha256: boundedText(input.benchmarkSha256, 'benchmarkSha256', 64),
    provider: boundedText(input.provider, 'provider', 160),
    model: boundedText(input.model, 'model', 256),
    workloadId: boundedText(input.workloadId, 'workloadId', 256),
    sampleSize: nonNegativeInteger(input.sampleSize, 'sampleSize'),
    qualityDelta: round(finiteRange(input.qualityDelta, 'qualityDelta', -1, 1), 6),
    tokenDeltaRatio: round(finiteRange(input.tokenDeltaRatio, 'tokenDeltaRatio', -1, 10), 6),
    latencyDeltaRatio: round(finiteRange(input.latencyDeltaRatio, 'latencyDeltaRatio', -1, 10), 6),
    ...(input.costDeltaRatio === undefined
      ? {}
      : { costDeltaRatio: round(finiteRange(input.costDeltaRatio, 'costDeltaRatio', -1, 10), 6) }),
    exactnessPassed: input.exactnessPassed === true,
    errors: nonNegativeInteger(input.errors, 'errors'),
  });

  if (!HEX64.test(normalized.benchmarkSha256)) {
    throw new Error('benchmarkSha256 must be lowercase SHA-256');
  }
  if (normalized.sampleSize < 5) {
    throw new Error('capability performance evidence requires at least 5 samples');
  }
  if (!normalized.exactnessPassed) {
    throw new Error('capability performance evidence requires passing exactness');
  }
  if (normalized.errors !== 0) {
    throw new Error('capability performance evidence requires zero benchmark errors');
  }
  if (normalized.qualityDelta < 0) {
    throw new Error('capability performance evidence cannot qualify with a quality regression');
  }

  // Force deterministic serialization through validation before the object is
  // marked as qualified. The digest itself remains an external benchmark
  // artifact identity and is not synthesized here.
  encoder.encode(performanceFingerprint(normalized));
  QUALIFIED_PERFORMANCE.add(normalized);
  return normalized;
}

export function isQualifiedFuryCapabilityPerformance(
  value: unknown,
): value is QualifiedFuryCapabilityPerformanceEvidence {
  return value !== null
    && typeof value === 'object'
    && QUALIFIED_PERFORMANCE.has(value as object);
}

function trustComponent(verdict: FuryTrustVerdict): number {
  switch (verdict) {
    case 'TRUSTED': return 20;
    case 'AUDITED': return 16;
    case 'RESTRICTED': return 8;
    case 'QUARANTINED':
    case 'BLOCKED':
    case 'UNKNOWN':
      return 0;
  }
}

function provenanceBase(classification: ProvenanceClassification): number {
  switch (classification) {
    case 'FIRST_PARTY': return 10;
    case 'OFFICIAL': return 9;
    case 'VERIFIED_COMMUNITY': return 8;
    case 'COMMUNITY': return 5;
    case 'FORK': return 4;
    case 'MIRROR': return 3;
    case 'UNKNOWN': return 0;
  }
}

function provenanceComponent(candidate: CapabilityCandidate): number {
  const base = provenanceBase(candidate.provenance.classification);
  return candidate.provenance.reviewStatus === 'REVIEWED' ? base : Math.min(base, 2);
}

function healthComponent(candidate: CapabilityCandidate): number {
  switch (candidate.health.status) {
    case 'HEALTHY': return 8;
    case 'DEGRADED': return 4;
    case 'UNHEALTHY': return 0;
    case 'UNKNOWN': return 2;
  }
}

function maintenanceComponent(candidate: CapabilityCandidate): number {
  switch (candidate.maintenance.status) {
    case 'ACTIVE': return 7;
    case 'MAINTENANCE': return 4;
    case 'ARCHIVED': return 0;
    case 'UNKNOWN': return 2;
  }
}

function performanceComponent(
  performance: QualifiedFuryCapabilityPerformanceEvidence | undefined,
): number {
  if (performance === undefined) return 0;

  let score = 5;
  score += clamp(performance.qualityDelta / 0.2, 0, 1) * 4;

  if (performance.tokenDeltaRatio < 0) {
    score += clamp((-performance.tokenDeltaRatio) / 0.5, 0, 1) * 3;
  } else {
    score -= clamp(performance.tokenDeltaRatio / 0.5, 0, 1) * 3;
  }

  if (performance.latencyDeltaRatio < 0) {
    score += clamp((-performance.latencyDeltaRatio) / 0.5, 0, 1) * 2;
  } else {
    score -= clamp(performance.latencyDeltaRatio / 0.5, 0, 1) * 2;
  }

  if (performance.costDeltaRatio !== undefined) {
    if (performance.costDeltaRatio < 0) {
      score += clamp((-performance.costDeltaRatio) / 0.5, 0, 1);
    } else {
      score -= clamp(performance.costDeltaRatio / 0.5, 0, 1);
    }
  }

  return round(clamp(score, 0, 15));
}

function routingState(
  candidate: CapabilityCandidate,
  report: FuryTrustReport,
): FuryScoreRoutingState {
  if (candidate.decision === 'REJECT') return 'BLOCKED';
  if (report.verdict === 'BLOCKED' || report.verdict === 'QUARANTINED' || report.verdict === 'UNKNOWN') {
    return 'BLOCKED';
  }
  if (candidate.decision === 'REFERENCE_ONLY') return 'REFERENCE_ONLY';
  if (report.verdict === 'RESTRICTED') return 'REVIEW_REQUIRED';
  return 'RANKED';
}

function confidence(
  trustConfidence: TrustConfidence,
  hasPerformance: boolean,
): FuryScoreConfidence {
  if (trustConfidence === 'HIGH' && hasPerformance) return 'HIGH';
  if (trustConfidence === 'LOW') return 'LOW';
  return 'MEDIUM';
}

function validateScope(
  input: FuryScoreInput,
): QualifiedFuryCapabilityPerformanceEvidence | undefined {
  const performance = input.performance;
  if (performance === undefined) return undefined;
  if (!isQualifiedFuryCapabilityPerformance(performance)) {
    throw new Error('performance evidence must be produced by qualifyFuryCapabilityPerformance');
  }
  if (performance.candidateId !== input.candidate.id) {
    throw new Error('performance evidence candidateId does not match the candidate');
  }
  if (input.provider === undefined || input.model === undefined || input.workloadId === undefined) {
    throw new Error('provider, model and workloadId are required when performance evidence is supplied');
  }
  if (
    performance.provider !== input.provider
    || performance.model !== input.model
    || performance.workloadId !== input.workloadId
  ) {
    throw new Error('performance evidence scope does not match provider/model/workload');
  }
  return performance;
}

export function scoreFuryCapability(input: FuryScoreInput): FuryCapabilityScore {
  if (!input || typeof input !== 'object') throw new TypeError('FuryScore input is required');
  if (!isGeneratedFuryTrustReport(input.trustReport)) {
    throw new Error('FuryScore requires an in-process generated FuryTrust report');
  }
  if (input.trustReport.candidateId !== input.candidate.id) {
    throw new Error('FuryTrust report candidateId does not match the candidate');
  }
  const relevance = finiteRange(input.relevance, 'relevance', 0, 1);
  const performance = validateScope(input);
  const state = routingState(input.candidate, input.trustReport);

  const components: FuryScoreComponents = Object.freeze({
    relevance: round(relevance * 40),
    trust: trustComponent(input.trustReport.verdict),
    provenance: provenanceComponent(input.candidate),
    health: healthComponent(input.candidate),
    maintenance: maintenanceComponent(input.candidate),
    performance: performanceComponent(performance),
    riskPenalty: round(clamp(input.trustReport.riskScore / 5, 0, 20)),
  });

  const rawScore = components.relevance
    + components.trust
    + components.provenance
    + components.health
    + components.maintenance
    + components.performance
    - components.riskPenalty;

  const reasons: string[] = [];
  if (state === 'BLOCKED') reasons.push('not-routing-eligible');
  if (state === 'REVIEW_REQUIRED') reasons.push('trust-review-required');
  if (state === 'REFERENCE_ONLY') reasons.push('reference-only');
  if (performance === undefined) reasons.push('no-qualified-performance-evidence');
  else reasons.push('qualified-performance-evidence');
  if (input.candidate.provenance.reviewStatus !== 'REVIEWED') reasons.push('provenance-not-reviewed');
  if (input.candidate.health.status === 'UNKNOWN') reasons.push('health-unknown');
  if (!input.trustReport.runtimeVerified) reasons.push('runtime-not-verified');

  return Object.freeze({
    format: FURY_SCORE_FORMAT,
    policyVersion: FURY_SCORE_POLICY_VERSION,
    candidateId: input.candidate.id,
    name: input.candidate.name,
    routingState: state,
    score: round(clamp(rawScore, 0, 100)),
    confidence: confidence(input.trustReport.confidence, performance !== undefined),
    components,
    riskScore: input.trustReport.riskScore,
    trustVerdict: input.trustReport.verdict,
    performanceEvidence: performance === undefined ? 'NONE' : 'QUALIFIED',
    executionAuthorized: false,
    reasons: Object.freeze(reasons),
  });
}

const STATE_RANK: Readonly<Record<FuryScoreRoutingState, number>> = Object.freeze({
  RANKED: 0,
  REVIEW_REQUIRED: 1,
  REFERENCE_ONLY: 2,
  BLOCKED: 3,
});

export function rankFuryCapabilities(
  inputs: readonly FuryScoreInput[],
): readonly FuryCapabilityScore[] {
  if (!Array.isArray(inputs) || inputs.length > 10_000) {
    throw new Error('FuryScore accepts at most 10000 candidates');
  }

  const ids = new Set<string>();
  const scores = inputs.map((input) => {
    if (ids.has(input.candidate.id)) {
      throw new Error(`duplicate FuryScore candidate: ${input.candidate.id}`);
    }
    ids.add(input.candidate.id);
    return scoreFuryCapability(input);
  });

  scores.sort((a, b) => {
    const state = STATE_RANK[a.routingState] - STATE_RANK[b.routingState];
    if (state !== 0) return state;
    if (a.score !== b.score) return b.score - a.score;
    if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
    return a.candidateId.localeCompare(b.candidateId);
  });

  return Object.freeze(scores);
}
