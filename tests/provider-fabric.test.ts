import { describe, expect, it } from 'vitest';
import {
  COST_UNKNOWN,
  DEFAULT_PROVIDER_REGISTRY,
  inspectProviderRegistry,
  resolveProviderFabric,
} from '../src/core/index.js';

describe('provider/model fabric', () => {
  it('resolves an explicit Anthropic route and keeps live availability unknown', () => {
    const result = resolveProviderFabric({
      providerId: 'anthropic',
      model: 'anthropic/claude-opus-5',
      protocol: 'anthropic',
    });

    expect(result.routing.reason).toBe('explicit_provider_route');
    expect(result.provider.id).toBe('anthropic');
    expect(result.model.family).toBe('anthropic');
    expect(result.model.status).toBe('supported');
    expect(result.provider.availability).toBe('unknown');
    expect(result.cache).toMatchObject({ status: 'known', minTokens: 1024, granularity: 'prefix' });
    expect(result.model.cost.status).toBe(COST_UNKNOWN);
    expect(result.fallback.eligible).toBe(false);
  });

  it('infers model families only when the provider route is absent', () => {
    expect(resolveProviderFabric({ model: 'gemini-3.8-flash' }).provider.id).toBe('google');
    expect(resolveProviderFabric({ model: 'gpt-5.6-sol' }).provider.id).toBe('openai');
    expect(resolveProviderFabric({ model: 'gpt-5.6-sol' }).routing.reason).toBe('model_family_inference');
  });

  it('uses a native safe fallback for unknown models and never invents cost', () => {
    const result = resolveProviderFabric({ providerId: 'anthropic', model: 'vendor/model-without-profile' });

    expect(result.model.status).toBe('unknown');
    expect(result.model.transform).toBe('unknown');
    expect(result.model.safeFallback).toBe('native');
    expect(result.model.cost).toEqual({
      status: COST_UNKNOWN,
      reason: 'model capability is unknown; no price may be inferred',
    });
    expect(result.model.aliases).toEqual(['vendor/model-without-profile', 'model-without-profile']);
  });

  it('normalizes hostile bracket input in one linear pass', () => {
    const result = resolveProviderFabric({ model: `${'['.repeat(10_000)}]vendor/model-without-profile` });
    expect(result.model.aliases).toEqual(['vendor/model-without-profile', 'model-without-profile']);
  });

  it('does not redirect an unknown explicit route through a model string', () => {
    const result = resolveProviderFabric({
      providerId: 'unregistered-gateway',
      model: 'gemini-3.8-flash',
      protocol: 'anthropic',
    });

    expect(result.routing.reason).toBe('unknown_provider_fallback');
    expect(result.provider.id).toBe('anthropic');
    expect(result.routing.providerMatchesModelFamily).toBe(false);
    expect(result.model.transform).toBe('unknown');
  });

  it('exposes a metadata-only registry with no availability claim', () => {
    const providers = inspectProviderRegistry(DEFAULT_PROVIDER_REGISTRY);

    expect(providers.map((provider) => provider.id)).toEqual(['anthropic', 'openai', 'google']);
    expect(providers.every((provider) => provider.status === 'registered')).toBe(true);
    expect(providers.every((provider) => provider.availability === 'unknown')).toBe(true);
    expect(providers.every((provider) => provider.cache.cost.status === COST_UNKNOWN)).toBe(true);
  });
});
