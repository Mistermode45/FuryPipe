import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_BETA_READINESS_SUBSYSTEM_FORMAT,
  createFuryBetaReadinessSnapshot,
  isGeneratedFuryBetaReadinessSnapshot,
  type FuryBetaReadinessDimensions,
  type FuryBetaReadinessSubsystemInput,
} from '../src/beta-readiness.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function dimensions(
  overrides: Partial<FuryBetaReadinessDimensions> = {},
): FuryBetaReadinessDimensions {
  return {
    discovery: 'ready',
    compatibility: 'ready',
    health: 'ready',
    policy: 'ready',
    authentication: 'ready',
    connection: 'ready',
    executionAuthority: 'not-applicable',
    ...overrides,
  };
}

function subsystem(
  overrides: Partial<FuryBetaReadinessSubsystemInput> = {},
): FuryBetaReadinessSubsystemInput {
  return {
    format: FURY_BETA_READINESS_SUBSYSTEM_FORMAT,
    id: 'gateway',
    requirement: 'required',
    evidenceDigestSha256: digest('gateway'),
    observedAt: 1_000,
    dimensions: dimensions(),
    ...overrides,
  };
}

describe('FuryPipe Phase 10 beta readiness model', () => {
  it('reports ready when required and optional subsystems are ready', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [
        subsystem(),
        subsystem({
          id: 'devices',
          requirement: 'optional',
          evidenceDigestSha256: digest('devices'),
        }),
      ],
    });
    expect(snapshot).toMatchObject({
      overallStatus: 'ready',
      taskReady: true,
      subsystemCount: 2,
      requiredSubsystems: 1,
      optionalSubsystems: 1,
      blockers: [],
      degradations: [],
      authority: 'readiness-observation-only',
      executionAuthority: false,
      repairAuthority: false,
      selectionAuthority: false,
    });
  });

  it('degrades but stays task-ready when an optional subsystem is unavailable', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [
        subsystem(),
        subsystem({
          id: 'voice',
          requirement: 'optional',
          evidenceDigestSha256: digest('voice'),
          dimensions: dimensions({ health: 'unavailable' }),
        }),
      ],
    });
    expect(snapshot).toMatchObject({ overallStatus: 'degraded', taskReady: true });
    expect(snapshot.blockers).toHaveLength(0);
    expect(snapshot.degradations[0]).toMatchObject({
      subsystemId: 'voice',
      requirement: 'optional',
      status: 'unavailable',
    });
  });

  it.each(['unconfigured', 'unavailable', 'blocked', 'unsupported'] as const)(
    'blocks when a required subsystem is %s',
    (state) => {
      const snapshot = createFuryBetaReadinessSnapshot({
        observedAt: 2_000,
        subsystems: [subsystem({ dimensions: dimensions({ health: state }) })],
      });
      expect(snapshot).toMatchObject({ overallStatus: 'blocked', taskReady: false });
      expect(snapshot.blockers[0]).toMatchObject({
        subsystemId: 'gateway',
        requirement: 'required',
        status: state,
      });
    },
  );

  it('keeps a required degraded subsystem task-ready but visible', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ dimensions: dimensions({ compatibility: 'degraded' }) })],
    });
    expect(snapshot).toMatchObject({ overallStatus: 'degraded', taskReady: true });
    expect(snapshot.degradations[0]?.reasonCodes).toContain('dimension-compatibility-degraded');
  });

  it('treats unknown evidence as degraded instead of claiming readiness', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ dimensions: dimensions({ health: 'unknown' }) })],
    });
    expect(snapshot.subsystems[0]).toMatchObject({ status: 'degraded', stale: false });
    expect(snapshot.subsystems[0]?.reasonCodes).toContain('dimension-health-unknown');
  });

  it('gives blocked precedence over weaker degraded states', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({
        dimensions: dimensions({ policy: 'blocked', health: 'degraded' }),
      })],
    });
    expect(snapshot.subsystems[0]?.status).toBe('blocked');
    expect(snapshot.overallStatus).toBe('blocked');
  });

  it('makes expired required evidence unavailable and blocking', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ expiresAt: 1_500 })],
    });
    expect(snapshot.subsystems[0]).toMatchObject({ status: 'unavailable', stale: true });
    expect(snapshot.subsystems[0]?.reasonCodes).toContain('stale-evidence');
    expect(snapshot.taskReady).toBe(false);
  });

  it('makes expired optional evidence degraded but non-blocking', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [
        subsystem(),
        subsystem({
          id: 'acp',
          requirement: 'optional',
          evidenceDigestSha256: digest('acp'),
          expiresAt: 1_500,
        }),
      ],
    });
    expect(snapshot).toMatchObject({ overallStatus: 'degraded', taskReady: true });
    expect(snapshot.blockers).toHaveLength(0);
  });

  it('rejects future evidence and impossible expiry ordering', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ observedAt: 2_001 })],
    })).toThrow(/future/u);
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ observedAt: 1_500, expiresAt: 1_499 })],
    })).toThrow(/precede observedAt/u);
  });

  it('rejects duplicate subsystem identifiers', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [
        subsystem(),
        subsystem({ evidenceDigestSha256: digest('duplicate') }),
      ],
    })).toThrow(/duplicate/u);
  });

  it('enforces the configured subsystem bound', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      maxSubsystems: 1,
      subsystems: [
        subsystem(),
        subsystem({ id: 'doctor', evidenceDigestSha256: digest('doctor') }),
      ],
    })).toThrow(/at most 1/u);
  });

  it('rejects an empty readiness model instead of claiming readiness', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [],
    })).toThrow(/at least one subsystem/u);
  });

  it('rejects schema drift on subsystem input', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [{ ...subsystem(), repair: true } as FuryBetaReadinessSubsystemInput],
    })).toThrow(/unsupported or unsafe fields/u);
  });

  it('rejects accessor-backed subsystem fields', () => {
    const value = subsystem() as unknown as Record<string, unknown>;
    Object.defineProperty(value, 'id', { enumerable: true, get: () => 'gateway' });
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [value as unknown as FuryBetaReadinessSubsystemInput],
    })).toThrow(/unsupported or unsafe fields/u);
  });

  it('rejects unsafe or incomplete dimension objects', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({
        dimensions: { ...dimensions(), trusted: 'ready' } as FuryBetaReadinessDimensions,
      })],
    })).toThrow(/unsupported or unsafe fields/u);

    const incomplete = { ...dimensions() } as Record<string, unknown>;
    delete incomplete.connection;
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({
        dimensions: incomplete as unknown as FuryBetaReadinessDimensions,
      })],
    })).toThrow(/missing required field/u);
  });

  it('rejects malformed evidence digests', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ evidenceDigestSha256: 'not-a-digest' })],
    })).toThrow(/evidence digest/u);
  });

  it('rejects duplicate and unsafe reason codes', () => {
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ reasonCodes: ['missing-provider', 'missing-provider'] })],
    })).toThrow(/duplicates/u);
    expect(() => createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({ reasonCodes: ['SECRET TOKEN'] })],
    })).toThrow(/bounded lowercase token/u);
  });

  it('canonicalizes subsystem order and produces a deterministic digest', () => {
    const a = subsystem({ id: 'a', evidenceDigestSha256: digest('a') });
    const b = subsystem({
      id: 'b',
      evidenceDigestSha256: digest('b'),
      requirement: 'optional',
    });
    const first = createFuryBetaReadinessSnapshot({ observedAt: 2_000, subsystems: [b, a] });
    const second = createFuryBetaReadinessSnapshot({ observedAt: 2_000, subsystems: [a, b] });
    expect(first.subsystems.map((item) => item.id)).toEqual(['a', 'b']);
    expect(first.digestSha256).toBe(second.digestSha256);
  });

  it('makes snapshot authenticity process-local', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem()],
    });
    expect(isGeneratedFuryBetaReadinessSnapshot(snapshot)).toBe(true);
    expect(isGeneratedFuryBetaReadinessSnapshot({ ...snapshot })).toBe(false);
  });

  it('never turns execution-authority readiness evidence into actual authority', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [subsystem({
        dimensions: dimensions({ executionAuthority: 'ready' }),
      })],
    });
    expect(snapshot.subsystems[0]?.dimensions.executionAuthority).toBe('ready');
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.repairAuthority).toBe(false);
    expect(snapshot.selectionAuthority).toBe(false);
    expect('repair' in snapshot).toBe(false);
    expect('execute' in snapshot).toBe(false);
  });

  it('tracks status counts independently from blocking semantics', () => {
    const snapshot = createFuryBetaReadinessSnapshot({
      observedAt: 2_000,
      subsystems: [
        subsystem({ id: 'ready', evidenceDigestSha256: digest('ready') }),
        subsystem({
          id: 'degraded',
          evidenceDigestSha256: digest('degraded'),
          requirement: 'optional',
          dimensions: dimensions({ health: 'degraded' }),
        }),
        subsystem({
          id: 'blocked',
          evidenceDigestSha256: digest('blocked'),
          requirement: 'optional',
          dimensions: dimensions({ policy: 'blocked' }),
        }),
      ],
    });
    expect(snapshot.statusCounts).toMatchObject({ ready: 1, degraded: 1, blocked: 1 });
    expect(snapshot.overallStatus).toBe('degraded');
    expect(snapshot.taskReady).toBe(true);
  });
});
