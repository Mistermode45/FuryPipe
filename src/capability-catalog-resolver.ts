import type {
  CapabilityRegistry,
  CapabilityRegistryQuery,
} from './ecosystem/registry.js';
import {
  rankFuryCapabilities,
  type FuryCapabilityScore,
  type FuryScoreInput,
  type QualifiedFuryCapabilityPerformanceEvidence,
} from './fury-score.js';

export interface FuryCatalogRelevance {
  readonly candidateId: string;
  readonly relevance: number;
}

export interface FuryCatalogResolverInput {
  readonly registry: CapabilityRegistry;
  readonly query?: CapabilityRegistryQuery;
  readonly relevance: readonly FuryCatalogRelevance[];
  readonly provider?: string;
  readonly model?: string;
  readonly workloadId?: string;
  readonly performance?: readonly QualifiedFuryCapabilityPerformanceEvidence[];
  readonly maxResults?: number;
}

export interface FuryCatalogSkippedCandidate {
  readonly candidateId: string;
  readonly reason: 'missing-relevance' | 'missing-trust-report';
}

export interface FuryCatalogResolution {
  readonly format: 'furypipe-catalog-resolution/v1';
  readonly recommendations: readonly FuryCapabilityScore[];
  readonly blocked: readonly FuryCapabilityScore[];
  readonly skipped: readonly FuryCatalogSkippedCandidate[];
  readonly candidatesConsidered: number;
  readonly candidatesScored: number;
  readonly executionAuthorized: false;
}

const MAX_RELEVANCE_ITEMS = 5_000;
const MAX_PERFORMANCE_ITEMS = 5_000;
const MAX_RESULTS = 100;

function relevanceMap(
  items: readonly FuryCatalogRelevance[],
): ReadonlyMap<string, number> {
  if (!Array.isArray(items) || items.length > MAX_RELEVANCE_ITEMS) {
    throw new Error(`catalog resolver accepts at most ${MAX_RELEVANCE_ITEMS} relevance entries`);
  }

  const out = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`catalog relevance entry ${index} is invalid`);
    }
    const candidateId = typeof item.candidateId === 'string' ? item.candidateId.trim() : '';
    if (!candidateId || candidateId.length > 160 || /[\u0000-\u001f\u007f]/u.test(candidateId)) {
      throw new Error(`catalog relevance entry ${index} has an invalid candidateId`);
    }
    if (
      typeof item.relevance !== 'number'
      || !Number.isFinite(item.relevance)
      || item.relevance < 0
      || item.relevance > 1
    ) {
      throw new Error(`catalog relevance entry ${index} must be between 0 and 1`);
    }
    if (out.has(candidateId)) {
      throw new Error(`catalog relevance contains duplicate candidateId: ${candidateId}`);
    }
    out.set(candidateId, item.relevance);
  }
  return out;
}

function performanceMap(
  items: readonly QualifiedFuryCapabilityPerformanceEvidence[] | undefined,
): ReadonlyMap<string, QualifiedFuryCapabilityPerformanceEvidence> {
  if (items === undefined) return new Map();
  if (!Array.isArray(items) || items.length > MAX_PERFORMANCE_ITEMS) {
    throw new Error(`catalog resolver accepts at most ${MAX_PERFORMANCE_ITEMS} performance entries`);
  }

  const out = new Map<string, QualifiedFuryCapabilityPerformanceEvidence>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`catalog performance entry ${index} is invalid`);
    }
    if (typeof item.candidateId !== 'string' || !item.candidateId) {
      throw new Error(`catalog performance entry ${index} has an invalid candidateId`);
    }
    if (out.has(item.candidateId)) {
      throw new Error(`catalog performance contains duplicate candidateId: ${item.candidateId}`);
    }
    out.set(item.candidateId, item);
  }
  return out;
}

function boundedMaxResults(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`catalog maxResults must be an integer from 1 to ${MAX_RESULTS}`);
  }
  return value;
}

export function resolveFuryCatalog(
  input: FuryCatalogResolverInput,
): FuryCatalogResolution {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('catalog resolver input is required');
  }
  if (!input.registry || typeof input.registry !== 'object') {
    throw new TypeError('catalog resolver requires a capability registry');
  }

  const relevance = relevanceMap(input.relevance);
  const performance = performanceMap(input.performance);
  const maxResults = boundedMaxResults(input.maxResults);
  const candidates = input.registry.list(input.query);

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  for (const candidateId of relevance.keys()) {
    if (!candidateIds.has(candidateId)) {
      throw new Error(`catalog relevance references a candidate outside the resolved query: ${candidateId}`);
    }
  }
  for (const candidateId of performance.keys()) {
    if (!candidateIds.has(candidateId)) {
      throw new Error(`catalog performance references a candidate outside the resolved query: ${candidateId}`);
    }
  }

  const skipped: FuryCatalogSkippedCandidate[] = [];
  const scoreInputs: FuryScoreInput[] = [];

  for (const candidate of candidates) {
    const candidateRelevance = relevance.get(candidate.id);
    if (candidateRelevance === undefined) {
      skipped.push(Object.freeze({
        candidateId: candidate.id,
        reason: 'missing-relevance' as const,
      }));
      continue;
    }

    const trustReport = input.registry.getTrustReport(candidate.id);
    if (trustReport === undefined) {
      skipped.push(Object.freeze({
        candidateId: candidate.id,
        reason: 'missing-trust-report' as const,
      }));
      continue;
    }

    const candidatePerformance = performance.get(candidate.id);
    scoreInputs.push({
      candidate,
      trustReport,
      relevance: candidateRelevance,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.workloadId === undefined ? {} : { workloadId: input.workloadId }),
      ...(candidatePerformance === undefined ? {} : { performance: candidatePerformance }),
    });
  }

  const ranked = rankFuryCapabilities(scoreInputs);
  const blocked = ranked.filter((entry) => entry.routingState === 'BLOCKED');
  const recommendations = ranked
    .filter((entry) => entry.routingState !== 'BLOCKED')
    .slice(0, maxResults);

  return Object.freeze({
    format: 'furypipe-catalog-resolution/v1',
    recommendations: Object.freeze(recommendations),
    blocked: Object.freeze(blocked),
    skipped: Object.freeze(skipped),
    candidatesConsidered: candidates.length,
    candidatesScored: ranked.length,
    executionAuthorized: false,
  });
}
