import { describe, expect, it } from 'vitest';

import {
  projectProviderRuntimeModelSignals,
} from '../src/capability-signal-adapters.js';
import {
  createFuryCapabilitySignalRegistry,
} from '../src/capability-signals.js';
import {
  DEFAULT_PROVIDER_REGISTRY,
} from '../src/core/provider-fabric.js';
import {
  createProviderRuntimeState,
} from '../src/core/provider-runtime.js';
import {
  createModelFabricRegistry,
  normalizeOpenAIModelsPayload,
} from '../src/core/model-fabric.js';

function modelRegistry(id = 'gpt-5.6-sol') {
  const models = createModelFabricRegistry();
  models.upsertMany(normalizeOpenAIModelsPayload({
    data: [{
      id,
      owned_by: 'openai',
    }],
  }, '2026-09-20T10:00:00.000Z'));
  return models;
}

describe('Capability Autopilot measured signal adapters', () => {
  it('projects fresh live-probe provider health into model signals', () => {
    const now = 1_500;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 1_000,
      expiresAt: 2_000,
      latencyMs: 125,
      source: 'provider-live-probe-v1',
      evidenceKind: 'live-probe',
    });
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    const report = projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry(),
      { now },
    );

    expect(report).toEqual({
      format: 'furypipe-capability-signal-projection/v1',
      source: 'provider-runtime',
      observed: 1,
      skippedUnmeasured: 0,
      skippedUnregisteredProvider: 0,
      skippedInvalidIdentity: 0,
      authority: 'projection-only',
      executionAuthority: false,
    });
    expect(signals.get('model', 'openai/gpt-5.6-sol')).toMatchObject({
      status: 'fresh',
      observation: {
        health: 'ready',
        latencyMs: 125,
        observedAt: 1_000,
        expiresAt: 2_000,
        source: 'provider-live-probe-v1',
        evidenceKind: 'live-probe',
        executionAuthority: false,
      },
    });
  });

  it('projects transport-result unavailable evidence without converting it to ready', () => {
    const now = 1_500;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'unavailable',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'provider-transport-result-v1',
      evidenceKind: 'transport-result',
    });
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry(),
      { now },
    );

    expect(signals.get('model', 'openai/gpt-5.6-sol')).toMatchObject({
      status: 'fresh',
      observation: {
        health: 'unavailable',
        evidenceKind: 'transport-result',
      },
    });
  });

  it('does not treat operator-config health as measured evidence', () => {
    const now = 1_500;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'local-webchat-operator-config',
      evidenceKind: 'operator-config',
    });
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    const report = projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry(),
      { now },
    );

    expect(report).toMatchObject({
      observed: 0,
      skippedUnmeasured: 1,
    });
    expect(signals.get('model', 'openai/gpt-5.6-sol').status).toBe('unknown');
  });

  it('does not revive stale provider evidence', () => {
    const now = 3_000;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'provider-live-probe-v1',
      evidenceKind: 'live-probe',
    });
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    const report = projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry(),
      { now },
    );

    expect(report).toMatchObject({
      observed: 0,
      skippedUnmeasured: 1,
    });
    expect(signals.size()).toBe(0);
  });

  it('skips Model Fabric providers that Provider Runtime does not register', () => {
    const now = 1_500;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const models = createModelFabricRegistry();
    models.observe('router-model', 'openrouter');
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    const report = projectProviderRuntimeModelSignals(
      signals,
      runtime,
      models,
      { now },
    );

    expect(report).toMatchObject({
      observed: 0,
      skippedUnregisteredProvider: 1,
      skippedInvalidIdentity: 0,
      executionAuthority: false,
    });
    expect(signals.size()).toBe(0);
  });

  it('skips a valid Model Fabric identity outside the stricter signal identity bound', () => {
    const now = 1_500;
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai',
      availability: 'available',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'provider-live-probe-v1',
      evidenceKind: 'live-probe',
    });
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });

    const report = projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry('m'.repeat(300)),
      { now },
    );

    expect(report).toMatchObject({
      observed: 0,
      skippedInvalidIdentity: 1,
    });
    expect(signals.size()).toBe(0);
  });

  it('rejects a forged signal registry before calling Provider Runtime', () => {
    const health = () => {
      throw new Error('FORGED_SIGNAL_REGISTRY_MUST_NOT_REACH_RUNTIME');
    };
    const runtime = {
      health,
    };

    expect(() => projectProviderRuntimeModelSignals(
      {
        observe() {
          throw new Error('forged');
        },
        get() {
          throw new Error('forged');
        },
        snapshot() {
          throw new Error('forged');
        },
        remove() {
          return false;
        },
        size() {
          return 0;
        },
      } as never,
      runtime as never,
      modelRegistry(),
      { now: 1_500 },
    )).toThrow(/process-local signal registry/u);
  });

  it('rejects accessor-backed options before reading now', () => {
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, 'now', {
      enumerable: true,
      get() {
        throw new Error('SIGNAL_ADAPTER_OPTIONS_GETTER_MUST_NOT_RUN');
      },
    });

    expect(() => projectProviderRuntimeModelSignals(
      signals,
      runtime,
      modelRegistry(),
      options as never,
    )).toThrow(/unsupported or unsafe fields/u);
  });
});
