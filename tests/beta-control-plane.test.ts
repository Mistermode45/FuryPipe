import { describe, expect, it } from 'vitest';

import { inspectBetaConfigValue } from '../src/beta-config.js';
import { createFuryBetaControlPlaneSnapshot } from '../src/beta-control-plane.js';
import { collectFuryBetaOnboarding } from '../src/beta-onboarding.js';
import { collectFuryBetaReadiness } from '../src/beta-readiness-runtime.js';

function evidence() {
  const readiness = collectFuryBetaReadiness({
    configText: JSON.stringify({ models: ['keep'] }),
    configFile: 'beta-control-plane.json',
    observedAt: 2_000,
    nodeVersion: '26.8.2',
    gatewayRunning: true,
    env: { FURYPIPE_MODELS: 'model-a' },
  }).snapshot;
  const onboarding = collectFuryBetaOnboarding({
    observedAt: 2_000,
    env: { FURYPIPE_MODELS: 'model-a' },
    readiness,
    inventoryCounts: { models: 1 },
  });
  return { readiness, onboarding };
}

describe('Phase 10 beta control-plane projection', () => {
  it('composes task-first, readiness and onboarding without adding authority', () => {
    const { readiness, onboarding } = evidence();
    const snapshot = createFuryBetaControlPlaneSnapshot({
      generatedAt: 2_000,
      config: inspectBetaConfigValue({ models: ['keep'] }, 'beta-control-plane.json'),
      readiness,
      onboarding,
      operations: { policy: 'observed', recovery: 'unknown', reasonCodes: ['local-observation'] },
    });

    expect(snapshot.format).toBe('furypipe-beta-control-plane/v1');
    expect(snapshot.entry.entryPath).toBe('legacy-expert');
    expect(snapshot.entry.authority).toBe('entry-routing-observation-only');
    expect(snapshot.onboarding.availableCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.operations).toMatchObject({
      policy: 'observed',
      recovery: 'unknown',
      approvals: 'not-observed',
      unknownOutcomes: 'not-observed',
    });
    expect(snapshot.operations.reasonCodes).toEqual(expect.arrayContaining([
      'dashboard-cannot-authorize',
      'execution-receipts-not-injected',
      'local-observation',
    ]));
    expect(snapshot.authority).toBe('dashboard-observation-only');
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.mutationAuthority).toBe(false);
  });

  it('rejects forged readiness or onboarding evidence', () => {
    const { readiness, onboarding } = evidence();
    const config = inspectBetaConfigValue({}, 'beta-control-plane.json');
    expect(() => createFuryBetaControlPlaneSnapshot({
      generatedAt: 2_000,
      config: { ...config },
      readiness,
      onboarding,
    })).toThrow(/generated configuration observation/u);
    expect(() => createFuryBetaControlPlaneSnapshot({
      generatedAt: 2_000,
      config,
      readiness: { ...readiness },
      onboarding,
    })).toThrow(/observation-only readiness/u);
    expect(() => createFuryBetaControlPlaneSnapshot({
      generatedAt: 2_000,
      config,
      readiness,
      onboarding: { ...onboarding },
    })).toThrow(/generated onboarding evidence/u);
  });

  it('fails closed on malformed operational evidence', () => {
    const { readiness } = evidence();
    expect(() => createFuryBetaControlPlaneSnapshot({
      generatedAt: 2_000,
      config: inspectBetaConfigValue({}, 'beta-control-plane.json'),
      readiness,
      operations: { reasonCodes: ['not a token'] },
    })).toThrow(/operation reason/u);
  });
});
