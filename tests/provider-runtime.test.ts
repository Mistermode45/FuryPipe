import { describe, expect, it } from 'vitest';
import {
  COST_UNKNOWN,
  DEFAULT_PROVIDER_REGISTRY,
  createProviderRuntimeState,
  resolveProviderFabric,
  transformRequest,
} from '../src/core/index.js';

describe('provider runtime evidence and cost oracle', () => {
  it('keeps availability unknown until a fresh explicit observation exists', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    expect(runtime.health('anthropic', 1000)).toEqual({
      providerId: 'anthropic',
      availability: 'unknown',
      fresh: false,
    });

    runtime.observeHealth({
      providerId: 'anthropic',
      availability: 'available',
      observedAt: 1000,
      expiresAt: 2000,
      latencyMs: 42,
      source: 'operator-health-probe-v1',
      evidenceKind: 'live-probe',
    });

    expect(runtime.health('anthropic', 1500)).toMatchObject({
      availability: 'available',
      fresh: true,
      latencyMs: 42,
    });
    expect(runtime.health('anthropic', 2001)).toMatchObject({
      availability: 'unknown',
      fresh: false,
    });
  });

  it('overlays only fresh health evidence into the provider registry', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'unavailable',
      observedAt: 10,
      expiresAt: 20,
      source: 'gateway-healthcheck',
      evidenceKind: 'operator-config',
    });

    const fresh = resolveProviderFabric({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      registry: runtime.registry(15),
    });
    expect(fresh.provider.availability).toBe('unavailable');
    expect(fresh.provider.evidence.at(-1)).toEqual({ kind: 'operator-config', source: 'gateway-healthcheck' });

    const stale = resolveProviderFabric({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      registry: runtime.registry(21),
    });
    expect(stale.provider.availability).toBe('unknown');
  });

  it('calculates cost only from an exact explicit provider/model price', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.registerPrice({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      inputUsdPerMillionTokens: 10,
      outputUsdPerMillionTokens: 20,
      cacheWriteUsdPerMillionTokens: 12,
      cacheReadUsdPerMillionTokens: 1,
      observedAt: 1000,
      source: 'approved-pricing-catalog-2026-09',
    });

    const known = runtime.estimateCost('anthropic', 'claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheWriteTokens: 100_000,
      cacheReadTokens: 200_000,
    });
    expect(known.status).toBe('known');
    if (known.status === 'known') expect(known.totalUsd).toBeCloseTo(21.4);

    const unknown = runtime.estimateCost('anthropic', 'claude-opus-5-latest', {
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(unknown.status).toBe(COST_UNKNOWN);
  });

  it('fails closed when cache usage has no registered cache rate', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.registerPrice({
      providerId: 'google',
      model: 'gemini-3.8-flash',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      observedAt: 1000,
      source: 'operator-approved-price',
    });

    expect(runtime.estimateCost('google', 'gemini-3.8-flash', {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 1,
    })).toMatchObject({
      status: COST_UNKNOWN,
      reason: expect.stringContaining('cache read price'),
    });
  });

  it('rejects stale/malformed evidence metadata and never guesses unknown providers', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    expect(() => runtime.observeHealth({
      providerId: 'not-registered',
      availability: 'available',
      observedAt: 1,
      expiresAt: 2,
      source: 'probe',
      evidenceKind: 'live-probe',
    })).toThrow(/unregistered provider/);
    expect(() => runtime.observeHealth({
      providerId: 'anthropic',
      availability: 'available',
      observedAt: 2,
      expiresAt: 1,
      source: 'probe',
      evidenceKind: 'live-probe',
    })).toThrow(/later than observedAt/);
    expect(() => runtime.registerPrice({
      providerId: 'anthropic',
      model: ' claude-opus-5 ',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
      observedAt: 1,
      source: 'catalog',
    })).toThrow(/exact 1-256 character identifier/);
  });

  it('inspection is metadata-only and excludes price amounts', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.registerPrice({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      inputUsdPerMillionTokens: 10,
      outputUsdPerMillionTokens: 20,
      observedAt: 1000,
      source: 'catalog-v1',
    });
    const inspection = runtime.inspect(1000);
    expect(inspection.pricedModels).toEqual([{
      providerId: 'anthropic',
      model: 'claude-opus-5',
      observedAt: 1000,
      source: 'catalog-v1',
    }]);
    expect(JSON.stringify(inspection)).not.toContain('inputUsdPerMillionTokens');
  });
  it('wires fresh provider health into the real transform Context Fabric analysis', async () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'anthropic',
      availability: 'unavailable',
      observedAt: 100,
      expiresAt: 200,
      source: 'runtime-health-gate',
      evidenceKind: 'live-probe',
    });

    const body = new TextEncoder().encode(JSON.stringify({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'short request' }],
    }));
    const result = await transformRequest(body, {
      safetyMode: false,
      providerRegistry: runtime.registry(150),
    });

    expect(result.info.contextFabric?.providerFabric.provider.availability).toBe('unavailable');
    expect(result.info.contextFabric?.policyFabric.providerState.status).toBe('unavailable');
    expect(result.info.contextFabric?.policy.hardConstraints).toContain('provider unavailable');
    expect(JSON.stringify(result.info.contextFabric)).not.toContain('short request');
  });


  it('selects the first explicitly ordered fresh healthy compatible fallback without a network call', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'anthropic',
      availability: 'unavailable',
      observedAt: 100,
      expiresAt: 200,
      source: 'primary-health',
      evidenceKind: 'live-probe',
    });
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 100,
      expiresAt: 200,
      source: 'fallback-health',
      evidenceKind: 'live-probe',
    });

    const decision = runtime.selectFallback([
      { providerId: 'anthropic', model: 'claude-opus-5' },
      { providerId: 'openai', model: 'gpt-5.6-sol' },
    ], 150);

    expect(decision.selected).toEqual({ providerId: 'openai', model: 'gpt-5.6-sol' });
    expect(decision.assessments).toMatchObject([
      { providerId: 'anthropic', eligible: false, reason: 'provider_unavailable' },
      { providerId: 'openai', eligible: true, reason: 'eligible' },
    ]);
    expect(decision.networkCallExecuted).toBe(false);
  });

  it('refuses stale health and unknown providers instead of guessing a route', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'anthropic',
      availability: 'available',
      observedAt: 10,
      expiresAt: 20,
      source: 'old-health',
      evidenceKind: 'operator-config',
    });

    const decision = runtime.selectFallback([
      { providerId: 'anthropic', model: 'claude-opus-5' },
      { providerId: 'unregistered', model: 'custom-model' },
    ], 21);

    expect(decision.selected).toBeUndefined();
    expect(decision.assessments).toMatchObject([
      { providerId: 'anthropic', availability: 'unknown', reason: 'health_not_fresh' },
      { providerId: 'unregistered', availability: 'unknown', reason: 'unknown_provider' },
    ]);
  });

  it('rejects family-mismatched and unsupported models even when provider health is green', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 1,
      expiresAt: 100,
      source: 'green',
      evidenceKind: 'live-probe',
    });

    const decision = runtime.selectFallback([
      { providerId: 'openai', model: 'claude-opus-5' },
      { providerId: 'openai', model: 'totally-unknown-model' },
    ], 50);

    expect(decision.selected).toBeUndefined();
    expect(decision.assessments[0]).toMatchObject({
      eligible: false,
      reason: 'model_family_mismatch',
    });
    expect(decision.assessments[1]).toMatchObject({
      eligible: false,
      reason: 'model_not_supported',
    });
  });

  it('keeps fallback order deterministic and rejects duplicate candidate identities', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    for (const providerId of ['anthropic', 'openai'] as const) {
      runtime.observeHealth({
        providerId,
        availability: 'available',
        observedAt: 1,
        expiresAt: 100,
        source: `health-${providerId}`,
        evidenceKind: 'operator-config',
      });
    }

    const first = runtime.selectFallback([
      { providerId: 'openai', model: 'gpt-5.6-sol' },
      { providerId: 'anthropic', model: 'claude-opus-5' },
    ], 50);
    expect(first.selected?.providerId).toBe('openai');

    expect(() => runtime.selectFallback([
      { providerId: 'anthropic', model: 'claude-opus-5' },
      { providerId: 'claude', model: 'claude-opus-5' },
    ], 50)).toThrow(/unique/);
  });

});
