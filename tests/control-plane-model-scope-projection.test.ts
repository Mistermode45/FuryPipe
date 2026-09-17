import { describe, expect, it } from 'vitest';
import { createControlPlaneSnapshot } from '../src/control-plane.js';

const baseRuntime = {
  port: 48721,
  uptimeSec: 1,
  requests: 0,
  compressedRequests: 0,
  passthroughRequests: 0,
  savedInputTokens: 0,
  savedUsd: 0,
  compressionEnabled: true,
  activeModels: ['claude-fable-5', 'gemini'],
} as const;

describe('Control Plane model-scope projection', () => {
  it('does not expose the compatibility seed as active models in automatic mode', () => {
    const snapshot = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: { ...baseRuntime, modelScopeMode: 'automatic' },
      controlRoom: null,
    });

    expect(snapshot.runtime.modelScopeMode).toBe('automatic');
    expect(snapshot.runtime.activeModels).toEqual([]);
  });

  it('preserves the operator list in explicit mode', () => {
    const snapshot = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: {
        ...baseRuntime,
        activeModels: ['claude-opus-5'],
        modelScopeMode: 'explicit',
      },
      controlRoom: null,
    });

    expect(snapshot.runtime.modelScopeMode).toBe('explicit');
    expect(snapshot.runtime.activeModels).toEqual(['claude-opus-5']);
  });

  it('projects no active static models when scope is off', () => {
    const snapshot = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: { ...baseRuntime, modelScopeMode: 'off' },
      controlRoom: null,
    });

    expect(snapshot.runtime.modelScopeMode).toBe('off');
    expect(snapshot.runtime.activeModels).toEqual([]);
  });

  it('still validates bounded model input before discarding it in automatic mode', () => {
    expect(() => createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: {
        ...baseRuntime,
        activeModels: Array.from({ length: 65 }, () => 'model'),
        modelScopeMode: 'automatic',
      },
      controlRoom: null,
    })).toThrow('activeModels exceeds 64');
  });
});
