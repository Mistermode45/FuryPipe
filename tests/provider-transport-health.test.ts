import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_REGISTRY } from '../src/core/provider-fabric.js';
import { createProviderRuntimeState } from '../src/core/provider-runtime.js';
import {
  createGovernedProviderExecutor,
  isGeneratedGovernedProviderExecutionResult,
} from '../src/governed-provider-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import {
  applyProviderTransportHealthAssessment,
  assessProviderTransportHealth,
  MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS,
  type ProviderTransportHealthAssessment,
} from '../src/provider-transport-health.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;

async function execution(overrides: Record<string, unknown> = {}) {
  const request = makeRequest();
  const runtime = makeRuntime();
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  const transports = createProviderTransportRegistry([{
    providerId: request.providerId,
    protocol: request.protocol,
    execute: async () => ({
      providerId: request.providerId,
      model: request.model,
      networkStatus: 'executed',
      providerRequestStatus: 'accepted',
      httpStatus: 200,
      ...overrides,
    }),
  }]);
  return createGovernedProviderExecutor({
    transports,
    providerRuntime: runtime,
    now: () => at,
  }).execute(request, permit);
}

describe('provider transport health observation', () => {
  it('requires a process-local governed execution result', async () => {
    const result = await execution();
    expect(isGeneratedGovernedProviderExecutionResult(result)).toBe(true);
    expect(isGeneratedGovernedProviderExecutionResult({ ...result })).toBe(false);

    expect(() => assessProviderTransportHealth(
      { ...result },
      { availableTtlMs: 30_000 },
      { startedAt: 1_000, finishedAt: 1_125 },
    )).toThrow(/process-local provenance/);
  });

  it('derives short-lived available evidence from a transport-reported accepted 2xx', async () => {
    const result = await execution();
    const assessment = assessProviderTransportHealth(
      result,
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
      sourceProvenance: 'process-local',
    });
  });

  it('does not infer availability when an accepted result has no HTTP status', async () => {
    const result = await execution({ httpStatus: undefined });
    const assessment = assessProviderTransportHealth(
      result,
      { availableTtlMs: 30_000 },
      { startedAt: 10, finishedAt: 20 },
    );
    expect(assessment.availability).toBe('unknown');
    expect(assessment.reason).toBe('http-status-missing');
  });

  it('requires an explicit host allowlist before a rejected HTTP result becomes unavailable', async () => {
    const result = await execution({
      providerRequestStatus: 'rejected',
      httpStatus: 503,
      retryAfterMs: 2_000,
    });

    const conservative = assessProviderTransportHealth(
      result,
      { availableTtlMs: 30_000 },
      { startedAt: 100, finishedAt: 150 },
    );
    expect(conservative.availability).toBe('unknown');
    expect(conservative.reason).toBe('rejection-not-classified');

    const explicit = assessProviderTransportHealth(
      result,
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

  it('applies explicitly classified negative evidence and makes runtime availability fail closed', async () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const result = await execution({
      providerRequestStatus: 'rejected',
      httpStatus: 503,
    });
    const assessment = assessProviderTransportHealth(
      result,
      {
        availableTtlMs: 30_000,
        unavailableHttpStatuses: [503],
        unavailableTtlMs: 2_000,
      },
      { startedAt: 100, finishedAt: 200 },
    );

    expect(applyProviderTransportHealthAssessment(runtime, assessment)).toBe(true);
    expect(runtime.health('openai', 500)).toMatchObject({
      availability: 'unavailable',
      fresh: true,
      evidenceKind: 'transport-result',
    });
    expect(runtime.selectFallback([
      { providerId: 'openai', model: 'gpt-5.6-sol' },
    ], 500).assessments[0]).toMatchObject({
      eligible: false,
      reason: 'provider_unavailable',
    });
  });

  it('does not turn not-reported transport state into health evidence', async () => {
    const result = await execution({ networkStatus: undefined });
    const assessment = assessProviderTransportHealth(
      result,
      { availableTtlMs: 30_000 },
      { startedAt: 100, finishedAt: 150 },
    );
    expect(assessment.availability).toBe('unknown');
    expect(assessment.reason).toBe('transport-evidence-insufficient');
  });

  it('applies only known process-local assessments and preserves the transport-result evidence kind', async () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const assessment = assessProviderTransportHealth(
      await execution(),
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

  it('leaves ProviderRuntime unchanged for unknown assessments', async () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const assessment = assessProviderTransportHealth(
      await execution({ providerRequestStatus: 'rejected', httpStatus: 401 }),
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
      sourceProvenance: 'process-local',
    }) as ProviderTransportHealthAssessment;
    expect(() => applyProviderTransportHealthAssessment(runtime, forged)).toThrow(/process-local provenance/);
  });

  it('bounds timing, TTLs, and negative-status policy', async () => {
    const result = await execution();

    expect(() => assessProviderTransportHealth(
      result,
      { availableTtlMs: 0 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/availableTtlMs/);

    expect(() => assessProviderTransportHealth(
      result,
      { availableTtlMs: MAX_PROVIDER_TRANSPORT_HEALTH_TTL_MS + 1 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/availableTtlMs/);

    expect(() => assessProviderTransportHealth(
      result,
      { availableTtlMs: 1_000, unavailableHttpStatuses: [503] },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/unavailableTtlMs/);

    expect(() => assessProviderTransportHealth(
      result,
      { availableTtlMs: 1_000, unavailableHttpStatuses: [200], unavailableTtlMs: 1_000 },
      { startedAt: 1, finishedAt: 2 },
    )).toThrow(/rejection statuses/);

    expect(() => assessProviderTransportHealth(
      result,
      { availableTtlMs: 1_000 },
      { startedAt: 3, finishedAt: 2 },
    )).toThrow(/ordered safe timestamps/);
  });
});
