import { describe, expect, it } from 'vitest';

import { collectFuryBetaReadiness } from '../src/beta-readiness-runtime.js';

describe('Phase 10 beta readiness runtime projection', () => {
  it('keeps default local startup task-ready while exposing unprobed dependencies as degraded', () => {
    const result = collectFuryBetaReadiness({
      configFile: 'C:\\missing\\furypipe-config.json',
      observedAt: 2_000,
      nodeVersion: '26.8.2',
      gatewayRunning: false,
      env: {},
    });

    expect(result.snapshot).toMatchObject({
      overallStatus: 'degraded',
      taskReady: true,
      blockers: [],
      executionAuthority: false,
      repairAuthority: false,
      selectionAuthority: false,
    });
    expect(result.snapshot.subsystems.map((item) => item.id)).toEqual([
      'configuration',
      'gateway',
      'provider',
      'runtime',
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain('secret-value');
  });

  it('blocks task readiness for an invalid required configuration', () => {
    const result = collectFuryBetaReadiness({
      configFile: 'C:\\invalid\\furypipe-config.json',
      configText: '[]',
      observedAt: 2_000,
      nodeVersion: '26.8.2',
      env: {},
    });

    expect(result.snapshot.overallStatus).toBe('blocked');
    expect(result.snapshot.taskReady).toBe(false);
    expect(result.snapshot.blockers).toEqual([
      expect.objectContaining({ subsystemId: 'configuration', status: 'blocked' }),
    ]);
  });

  it('blocks unsupported runtimes without granting provider authority', () => {
    const result = collectFuryBetaReadiness({
      configFile: 'C:\\missing\\furypipe-config.json',
      observedAt: 2_000,
      nodeVersion: '20.0.0',
      env: {},
    });

    expect(result.snapshot.overallStatus).toBe('blocked');
    expect(result.snapshot.blockers).toEqual([
      expect.objectContaining({ subsystemId: 'runtime', status: 'unsupported' }),
    ]);
    expect(result.snapshot.executionAuthority).toBe(false);
  });

  it('does not persist or expose provider credentials while classifying an invalid endpoint', () => {
    const result = collectFuryBetaReadiness({
      configFile: 'C:\\missing\\furypipe-config.json',
      observedAt: 2_000,
      nodeVersion: '26.8.2',
      env: {
        ANTHROPIC_UPSTREAM: 'not a URL',
        ANTHROPIC_API_KEY: 'secret-value',
      },
    });

    expect(result.snapshot.overallStatus).toBe('degraded');
    expect(result.snapshot.taskReady).toBe(true);
    expect(result.snapshot.subsystems.find((item) => item.id === 'provider')).toMatchObject({
      status: 'blocked',
      requirement: 'optional',
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('is deterministic for equivalent observations and reflects gateway liveness separately', () => {
    const input = {
      configFile: 'C:\\missing\\furypipe-config.json',
      observedAt: 2_000,
      nodeVersion: '26.8.2',
      env: {},
    } as const;
    const before = collectFuryBetaReadiness({ ...input, gatewayRunning: false });
    const after = collectFuryBetaReadiness({ ...input, gatewayRunning: true });
    const repeat = collectFuryBetaReadiness({ ...input, gatewayRunning: false });

    expect(before.snapshot.digestSha256).toBe(repeat.snapshot.digestSha256);
    expect(before.snapshot.subsystems.find((item) => item.id === 'gateway')?.status).toBe('degraded');
    expect(after.snapshot.subsystems.find((item) => item.id === 'gateway')).toMatchObject({
      status: 'ready',
      stale: false,
    });
  });
});
