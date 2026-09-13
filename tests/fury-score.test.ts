import { describe, expect, it } from 'vitest';

import { normalizeCapabilityCandidate } from '../src/ecosystem/normalize.js';
import { evaluateFuryTrust } from '../src/fury-trust.js';
import {
  qualifyFuryCapabilityPerformance,
  rankFuryCapabilities,
  scoreFuryCapability,
} from '../src/fury-score.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

function candidate(
  suffix: string,
  overrides: Parameters<typeof makeCapabilityCandidate>[0] = {},
) {
  return normalizeCapabilityCandidate(makeCapabilityCandidate({
    source: {
      kind: 'git',
      url: `https://github.com/fury-example/capability-${suffix}`,
      repositoryUrl: `https://github.com/fury-example/capability-${suffix}`,
      version: '1.0.0',
      commitSha: suffix.padEnd(40, 'a').slice(0, 40).replace(/[^0-9a-f]/gu, 'a'),
    },
    decision: 'ADOPT',
    ...overrides,
  }));
}

function audited(candidateValue: ReturnType<typeof candidate>) {
  return evaluateFuryTrust(
    candidateValue,
    [{ path: 'src/index.ts', content: 'export const capability = "safe fixture";' }],
    {
      decision: 'APPROVE',
      reviewerId: 'fixture-reviewer',
      reviewedAt: '2026-09-13T00:00:00Z',
      evidenceReference: 'review:fixture',
    },
  );
}

describe('FuryScore', () => {
  it('produces an explainable ranked score without authorizing execution', () => {
    const c = candidate('1');
    const trust = audited(c);
    const performance = qualifyFuryCapabilityPerformance({
      candidateId: c.id,
      benchmarkId: 'bench-website-001',
      benchmarkSha256: 'b'.repeat(64),
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
      sampleSize: 10,
      qualityDelta: 0.05,
      tokenDeltaRatio: -0.25,
      latencyDeltaRatio: -0.10,
      costDeltaRatio: -0.20,
      exactnessPassed: true,
      errors: 0,
    });

    const score = scoreFuryCapability({
      candidate: c,
      trustReport: trust,
      relevance: 0.95,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'marketing-website',
      performance,
    });

    expect(score.routingState).toBe('RANKED');
    expect(score.score).toBeGreaterThan(60);
    expect(score.performanceEvidence).toBe('QUALIFIED');
    expect(score.components.relevance).toBe(38);
    expect(score.components.performance).toBeGreaterThan(5);
    expect(score.executionAuthorized).toBe(false);
    expect(score.reasons).toContain('runtime-not-verified');
  });

  it('does not use stars or download counts as a scoring signal', () => {
    const lowPopularity = candidate('2', {
      activity: { stars: 1, downloads: 1, observedAt: '2026-09-12T12:00:00Z' },
    });
    const highPopularity = candidate('3', {
      activity: { stars: 10_000_000, downloads: 1_000_000_000, observedAt: '2026-09-12T12:00:00Z' },
    });

    const a = scoreFuryCapability({
      candidate: lowPopularity,
      trustReport: audited(lowPopularity),
      relevance: 0.8,
    });
    const b = scoreFuryCapability({
      candidate: highPopularity,
      trustReport: audited(highPopularity),
      relevance: 0.8,
    });

    expect(a.components).toEqual(b.components);
    expect(a.score).toBe(b.score);
  });

  it('never promotes QUARANTINED or UNKNOWN trust into routing eligibility', () => {
    const dangerous = candidate('4', {
      permissions: {
        network: 'arbitrary',
        filesystem: 'read',
        subprocess: 'none',
        credentials: 'manage',
        externalWrites: [],
        database: 'none',
        browser: 'none',
        provider: 'none',
        cloud: 'none',
      },
    });
    const dangerousTrust = evaluateFuryTrust(
      dangerous,
      [{ path: 'src/index.ts', content: 'export const x = 1;' }],
    );
    expect(['QUARANTINED', 'BLOCKED']).toContain(dangerousTrust.verdict);

    const blocked = scoreFuryCapability({
      candidate: dangerous,
      trustReport: dangerousTrust,
      relevance: 1,
    });
    expect(blocked.routingState).toBe('BLOCKED');
    expect(blocked.executionAuthorized).toBe(false);

    const unknown = candidate('5', {
      provenance: {
        classification: 'UNKNOWN',
        reviewStatus: 'UNREVIEWED',
        evidence: [],
      },
      license: {
        status: 'UNKNOWN',
        source: 'unknown',
        evidence: [],
        conflict: false,
      },
    });
    const unknownScore = scoreFuryCapability({
      candidate: unknown,
      trustReport: evaluateFuryTrust(unknown),
      relevance: 1,
    });
    expect(unknownScore.routingState).toBe('BLOCKED');
  });

  it('keeps REFERENCE_ONLY and RESTRICTED separate from ordinary ranked candidates', () => {
    const reference = candidate('6', { decision: 'REFERENCE_ONLY' });
    const referenceScore = scoreFuryCapability({
      candidate: reference,
      trustReport: audited(reference),
      relevance: 0.9,
    });
    expect(referenceScore.routingState).toBe('REFERENCE_ONLY');

    const restricted = candidate('7', {
      permissions: {
        network: 'restricted',
        filesystem: 'write',
        subprocess: 'none',
        credentials: 'none',
        externalWrites: [],
        database: 'none',
        browser: 'none',
        provider: 'none',
        cloud: 'none',
      },
    });
    const restrictedTrust = evaluateFuryTrust(
      restricted,
      [{ path: 'src/index.ts', content: 'export const x = 1;' }],
    );
    expect(restrictedTrust.verdict).toBe('RESTRICTED');
    const restrictedScore = scoreFuryCapability({
      candidate: restricted,
      trustReport: restrictedTrust,
      relevance: 0.9,
    });
    expect(restrictedScore.routingState).toBe('REVIEW_REQUIRED');
  });

  it('rejects forged trust reports instead of accepting structurally similar data', () => {
    const c = candidate('8');
    const real = audited(c);
    const forged = { ...real };

    expect(() => scoreFuryCapability({
      candidate: c,
      trustReport: forged,
      relevance: 1,
    })).toThrow(/in-process generated FuryTrust report/);
  });

  it('requires benchmark evidence to pass sample, quality, exactness and error gates', () => {
    const c = candidate('9');
    const base = {
      candidateId: c.id,
      benchmarkId: 'bench',
      benchmarkSha256: 'c'.repeat(64),
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      sampleSize: 5,
      qualityDelta: 0,
      tokenDeltaRatio: -0.1,
      latencyDeltaRatio: 0,
      exactnessPassed: true,
      errors: 0,
    };

    expect(() => qualifyFuryCapabilityPerformance({ ...base, sampleSize: 4 }))
      .toThrow(/at least 5 samples/);
    expect(() => qualifyFuryCapabilityPerformance({ ...base, qualityDelta: -0.01 }))
      .toThrow(/quality regression/);
    expect(() => qualifyFuryCapabilityPerformance({ ...base, exactnessPassed: false }))
      .toThrow(/passing exactness/);
    expect(() => qualifyFuryCapabilityPerformance({ ...base, errors: 1 }))
      .toThrow(/zero benchmark errors/);
  });

  it('binds qualified performance evidence to candidate, model and workload', () => {
    const c = candidate('a');
    const performance = qualifyFuryCapabilityPerformance({
      candidateId: c.id,
      benchmarkId: 'bench-a',
      benchmarkSha256: 'd'.repeat(64),
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'website',
      sampleSize: 5,
      qualityDelta: 0.01,
      tokenDeltaRatio: -0.1,
      latencyDeltaRatio: -0.1,
      exactnessPassed: true,
      errors: 0,
    });

    expect(() => scoreFuryCapability({
      candidate: c,
      trustReport: audited(c),
      relevance: 1,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      workloadId: 'website',
      performance,
    })).toThrow(/scope does not match/);

    expect(() => scoreFuryCapability({
      candidate: c,
      trustReport: audited(c),
      relevance: 1,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'minecraft-plugin',
      performance,
    })).toThrow(/scope does not match/);
  });

  it('sorts routing-safe candidates before review/reference/blocked states deterministically', () => {
    const ranked = candidate('b');
    const reference = candidate('c', { decision: 'REFERENCE_ONLY' });
    const rejected = candidate('d', { decision: 'REJECT' });

    const scores = rankFuryCapabilities([
      { candidate: rejected, trustReport: audited(rejected), relevance: 1 },
      { candidate: reference, trustReport: audited(reference), relevance: 1 },
      { candidate: ranked, trustReport: audited(ranked), relevance: 0.5 },
    ]);

    expect(scores.map((entry) => entry.routingState)).toEqual([
      'RANKED',
      'REFERENCE_ONLY',
      'BLOCKED',
    ]);
    expect(scores[0]?.candidateId).toBe(ranked.id);
  });

  it('rejects duplicate candidate identities in one ranking request', () => {
    const c = candidate('e');
    const trust = audited(c);
    expect(() => rankFuryCapabilities([
      { candidate: c, trustReport: trust, relevance: 0.8 },
      { candidate: c, trustReport: trust, relevance: 0.9 },
    ])).toThrow(/duplicate FuryScore candidate/);
  });
});
