import { describe, expect, it } from 'vitest';
import {
  COST_UNKNOWN,
  DEFAULT_PROVIDER_REGISTRY,
  createProviderRuntimeState,
  resolveProviderFabric,
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
});
