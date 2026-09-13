import { describe, expect, it } from 'vitest';
import { COST_UNKNOWN, DEFAULT_PROVIDER_REGISTRY } from '../src/core/provider-fabric.js';
import { createProviderRuntimeState } from '../src/core/provider-runtime.js';
import {
  applyProviderTransportHealthAssessment,
  assessProviderTransportHealth,
  MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS,
  type ProviderTransportHealthAssessment,
} from '../src/provider-transport-health.js';

function execution(overrides: Record<string, unknown> = {}) {
  return {
    format: 'furypipe-governed-provider-execution-result/v1',
    state: 'TRANSPORT_RESULT',
    transportInvoked: true,
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'health-test',
    requestDigest: 'a'.repeat(64),
    network: { status: 'executed', evidence: 'transport-reported' },
    providerRequest: { status: 'accepted', evidence: 'transport-reported' },
    httpStatus: 200,
    cost: {
      status: COST_UNKNOWN,
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      reason: 'test fixture',
    },
    ...overrides,
  };
}

describe('provider transport health observation', () => {
  it('derives short-lived available evidence from a transport-reported accepted 2xx', () => {
    const assessment = assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 30_000 },
      { startedAt: 1_000, finishedAt: 1_125 },
    );

    expect(assessment).toMatchObject({
      availability: 'available',
      reason: 'accepted-http-response',
      observedAt: 1_125,
      expiresAt: 31_125,
      latencyMs: 125,
      evidenceKind: 'transport-result',
      assessmentProvenance: 'process-local',
      sourceProvenance: 'not-verified',
    });
  });

  it('does not infer availability when an accepted result has no HTTP status', () => {
    const value = execution();
    delete value.httpStatus;
    const assessment = assessProviderTransportHealth(
      value,
      { availableTtlMs: 30_000 },
      { startedAt: 10, finishedAt: 20 },
    );
    expect(assessment.availability).toBe('unknown');
    expect(assessment.reason).toBe('http-status-missing');
  });

  it('requires an explicit host allowlist before a rejected HTTP result becomes unavailable', () => {
    const rejected = execution({
      providerRequest: { status: 'rejected', evidence: 'transport-reported' },
      httpStatus: 503,
      retryAfterMs: 2_000,
    });

    const conservative = assessProviderTransportHealth(
      rejected,
      { availableTtlMs: 30_000 },
      { startedAt: 100, finishedAt: 150 },
    );
    expect(conservative.availability).toBe('unknown');
    expect(conservative.reason).toBe('rejection-not-classified');

    const explicit = assessProviderTransportHealth(
      rejected,
      {
        availableTtlMs: 30_000,
        unavailableHttpStatuses: [503],
        unavailableTtlMs: 5_000,
      },
      { startedAt: 100, finishedAt: 150 },
    );
    expect(explicit).toMatchObject({
      availability: 'unavailable',
      reason: 'explicit-negative-http-status',
      expiresAt: 5_150,
      retryAfterMs: 2_000,
    });
  });

  it('does not turn not-reported transport state into health evidence', () => {
    const assessment = assessProviderTransportHealth(
      execution({ network: { status: 'executed', evidence: 'not-reported' } }),
      { availableTtlMs: 30_000 },
      { startedAt: 100, finishedAt: 150 },
    );
    expect(assessment.availability).toBe('unknown');
    expect(assessment.reason).toBe('transport-evidence-insufficient');
  });

  it('applies only known process-local assessments and preserves the transport-result evidence kind', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const assessment = assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 1_000 },
      { startedAt: 100, finishedAt: 200 },
    );

    expect(applyProviderTransportHealthAssessment(runtime, assessment)).toBe(true);
    expect(runtime.health('openai', 500)).toMatchObject({
      availability: 'available',
      fresh: true,
      observedAt: 200,
      expiresAt: 1_200,
      latencyMs: 100,
      source: 'governed-provider-transport-result',
      evidenceKind: 'transport-result',
    });
    expect(runtime.health('openai', 1_201)).toMatchObject({
      availability: 'unknown',
      fresh: false,
      observedAt: 200,
      expiresAt: 1_200,
    });
  });

  it('leaves ProviderRuntime unchanged for unknown assessments', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const assessment = assessProviderTransportHealth(
      execution({
        providerRequest: { status: 'rejected', evidence: 'transport-reported' },
        httpStatus: 401,
      }),
      { availableTtlMs: 1_000 },
      { startedAt: 100, finishedAt: 200 },
    );
    expect(applyProviderTransportHealthAssessment(runtime, assessment)).toBe(false);
    expect(runtime.health('openai', 200)).toMatchObject({ availability: 'unknown', fresh: false });
  });

  it('rejects forged assessment promotion', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const forged = Object.freeze({
      format: 'furypipe-provider-transport-health-assessment/v1',
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'health-test',
      requestDigest: 'a'.repeat(64),
      observedAt: 1,
      latencyMs: 1,
      availability: 'available',
      reason: 'accepted-http-response',
      expiresAt: 1_001,
      evidenceKind: 'transport-result',
      assessmentProvenance: 'process-local',
      sourceProvenance: 'not-verified',
    }) as ProviderTransportHealthAssessment;
    expect(() => applyProviderTransportHealthAssessment(runtime, forged)).toThrow(/process-local provenance/);
  });

  it('bounds timing, TTLs, and negative-status policy', () => {
    expect(() => assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 0 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/availableTtlMs/);

    expect(() => assessProviderTransportHealth(
      execution(),
      { availableTtlMs: MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS + 1 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/availableTtlMs/);

    expect(() => assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 1_000, unavailableHttpStatuses: [503] },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/unavailableTtlMs/);

    expect(() => assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 1_000, unavailableHttpStatuses: [200], unavailableTtlMs: 1_000 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/rejection statuses/);

    expect(() => assessProviderTransportHealth(
      execution(),
      { availableTtlMs: 1_000 },
      { startedAt: 3, finishedAt: 2 },
    )).toThrow(/ordered safe timestamps/);
  });
});
