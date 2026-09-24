import { describe, expect, it } from 'vitest';

import { collectFuryBetaReadiness } from '../src/beta-readiness-runtime.js';
import {
  collectFuryBetaOnboarding,
  createFuryBetaOnboardingSnapshot,
  isGeneratedFuryBetaOnboardingSnapshot,
} from '../src/beta-onboarding.js';

describe('Phase 10 beta capability onboarding', () => {
  it('keeps configured, available, authenticated, authorized, selected and executed distinct', () => {
    const readiness = collectFuryBetaReadiness({
      configFile: 'missing-config.json',
      observedAt: 2_000,
      nodeVersion: '26.8.2',
      gatewayRunning: true,
      env: { ANTHROPIC_API_KEY: 'secret-provider-key', FURYPIPE_MODELS: 'model-a' },
    });
    const snapshot = collectFuryBetaOnboarding({
      observedAt: 2_000,
      env: { ANTHROPIC_API_KEY: 'secret-provider-key', FURYPIPE_MODELS: 'model-a' },
      readiness: readiness.snapshot,
      modelScopeMode: 'explicit',
      inventoryCounts: { models: 1, skills: 0 },
      selectedDomains: ['models'],
      executedDomains: [],
    });

    const models = snapshot.items.find((item) => item.domain === 'models');
    expect(models).toMatchObject({
      configured: 'yes',
      available: 'yes',
      authenticated: 'not-applicable',
      authorized: 'unknown',
      selected: 'yes',
      executed: 'unknown',
    });
    const providers = snapshot.items.find((item) => item.domain === 'providers');
    expect(providers).toMatchObject({ configured: 'yes', authenticated: 'unknown' });
    expect(providers?.available).not.toBe('yes');
    expect(snapshot.authority).toBe('readiness-observation-only');
    expect(snapshot.installationAuthority).toBe(false);
    expect(snapshot.grantAuthority).toBe(false);
    expect(snapshot.credentialValuesIncluded).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('secret-provider-key');
  });

  it('reports tool availability only from an explicit doctor observation', () => {
    const snapshot = collectFuryBetaOnboarding({
      observedAt: 2_000,
      env: { FURYPIPE_AGENT_SKILLS: 'off' },
      tools: {
        browser: { status: 'available', value: 'chromium' },
        claude: { status: 'unavailable' },
        codex: { status: 'unavailable' },
      },
      modelScopeMode: 'off',
    });
    expect(snapshot.items.find((item) => item.domain === 'browser')).toMatchObject({
      configured: 'not-applicable', available: 'yes', authenticated: 'not-applicable',
    });
    expect(snapshot.items.find((item) => item.domain === 'coding')?.available).toBe('no');
    expect(snapshot.items.find((item) => item.domain === 'skills')?.configured).toBe('no');
    expect(snapshot.items.find((item) => item.domain === 'models')?.configured).toBe('no');
  });

  it('rejects forged or structurally unsafe onboarding evidence', () => {
    const readiness = collectFuryBetaReadiness({
      configFile: 'forged-readiness.json',
      observedAt: 1,
      nodeVersion: '26.8.2',
      gatewayRunning: false,
      env: {},
    }).snapshot;
    expect(() => collectFuryBetaOnboarding({
      observedAt: 1,
      readiness: { ...readiness },
    })).toThrow(/generated readiness/u);
    expect(() => collectFuryBetaOnboarding({
      observedAt: 1,
      selectedDomains: ['not-a-domain' as never],
    })).toThrow(/invalid domain/u);

    const valid = createFuryBetaOnboardingSnapshot({
      observedAt: 1,
      items: [{
        domain: 'models',
        source: 'test',
        configured: 'yes',
        available: 'unknown',
        authenticated: 'unknown',
        authorized: 'unknown',
        selected: 'unknown',
        executed: 'unknown',
        reasonCodes: ['test-observation'],
      }],
    });
    expect(isGeneratedFuryBetaOnboardingSnapshot(valid)).toBe(true);
    expect(isGeneratedFuryBetaOnboardingSnapshot({ ...valid })).toBe(false);
    expect(() => createFuryBetaOnboardingSnapshot({
      observedAt: 1,
      items: [{
        domain: 'models',
        source: 'test',
        configured: 'yes',
        available: 'unknown',
        authenticated: 'unknown',
        authorized: 'unknown',
        selected: 'unknown',
        executed: 'unknown',
        reasonCodes: ['bad reason'],
      }],
    })).toThrow(/invalid reason/u);
    expect(() => createFuryBetaOnboardingSnapshot({
      observedAt: 1,
      items: [{
        domain: 'models',
        source: 'test',
        configured: 'yes',
        available: 'unknown',
        authenticated: 'unknown',
        authorized: 'unknown',
        selected: 'unknown',
        executed: 'unknown',
        reasonCodes: [],
        extra: true,
      } as never],
    })).toThrow(/unsupported/u);
    expect(() => createFuryBetaOnboardingSnapshot({
      observedAt: 1,
      items: [{
        domain: 'models',
        source: 'credential value',
        configured: 'yes',
        available: 'unknown',
        authenticated: 'unknown',
        authorized: 'unknown',
        selected: 'unknown',
        executed: 'unknown',
        reasonCodes: [],
      }],
    })).toThrow(/source is invalid/u);
  });
});
