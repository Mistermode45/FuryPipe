import { describe, expect, it } from 'vitest';

import {
  createFuryCapabilitySignalRegistry,
  FURY_CAPABILITY_SIGNAL_FORMAT,
  FURY_CAPABILITY_SIGNAL_SNAPSHOT_FORMAT,
  isGeneratedFuryCapabilitySignalRegistry,
  type FuryCapabilitySignalObservationInput,
} from '../src/capability-signals.js';

function observation(
  overrides: Partial<FuryCapabilitySignalObservationInput> = {},
): FuryCapabilitySignalObservationInput {
  return {
    format: FURY_CAPABILITY_SIGNAL_FORMAT,
    kind: 'model',
    id: 'openai/gpt-5.6-sol',
    observedAt: 1_000,
    expiresAt: 2_000,
    source: 'provider-runtime-live-probe',
    evidenceKind: 'live-probe',
    health: 'ready',
    latencyMs: 180,
    ...overrides,
  };
}

describe('Capability Autopilot measured signal registry', () => {
  it('keeps one bounded process-local observation and makes freshness explicit', () => {
    let now = 1_500;
    const registry = createFuryCapabilitySignalRegistry({
      now: () => now,
    });
    const stored = registry.observe(observation());

    expect(stored).toMatchObject({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'model',
      id: 'openai/gpt-5.6-sol',
      health: 'ready',
      latencyMs: 180,
      authority: 'measured-evidence-only',
      executionAuthority: false,
    });
    expect(stored.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(isGeneratedFuryCapabilitySignalRegistry(registry)).toBe(true);
    expect(isGeneratedFuryCapabilitySignalRegistry({
      ...registry,
    })).toBe(false);

    const fresh = registry.get('model', 'openai/gpt-5.6-sol');
    expect(fresh).toMatchObject({
      status: 'fresh',
      executionAuthority: false,
    });

    const snapshot = registry.snapshot();
    expect(snapshot).toMatchObject({
      format: FURY_CAPABILITY_SIGNAL_SNAPSHOT_FORMAT,
      count: 1,
      fresh: 1,
      stale: 0,
      authority: 'measured-evidence-only',
      executionAuthority: false,
    });
    expect(snapshot.records[0]).toMatchObject({
      status: 'fresh',
      fingerprintSha256: stored.fingerprintSha256,
      observation: stored,
    });
    const freshDigest = snapshot.digestSha256;

    now = 2_000;
    const stale = registry.get('model', 'openai/gpt-5.6-sol');
    expect(stale.status).toBe('stale');
    const staleSnapshot = registry.snapshot();
    expect(staleSnapshot).toMatchObject({
      fresh: 0,
      stale: 1,
    });
    expect(staleSnapshot.digestSha256).not.toBe(freshDigest);
  });

  it('represents absent evidence as unknown instead of synthesizing zero/ready values', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    expect(registry.get('skill', 'repo-review')).toEqual({
      kind: 'skill',
      id: 'repo-review',
      status: 'unknown',
      authority: 'measured-evidence-only',
      executionAuthority: false,
    });
  });

  it('requires cost and comparable cost basis together', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });

    expect(() => registry.observe(observation({
      observedCostUsd: 0.0042,
    }))).toThrow(/observedCostUsd and costBasis/u);

    expect(() => registry.observe(observation({
      costBasis: 'same-request-fixture-v1',
    }))).toThrow(/observedCostUsd and costBasis/u);

    expect(registry.observe(observation({
      observedCostUsd: 0.0042,
      costBasis: 'same-request-fixture-v1',
    }))).toMatchObject({
      observedCostUsd: 0.0042,
      costBasis: 'same-request-fixture-v1',
    });
  });

  it('requires at least one measured health, latency or cost signal', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    expect(() => registry.observe(observation({
      health: undefined,
      latencyMs: undefined,
    }))).toThrow(/at least one measured/u);
  });

  it('rejects older evidence and conflicting evidence at the same timestamp', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    const first = registry.observe(observation());

    expect(registry.observe(observation())).toBe(first);

    expect(() => registry.observe(observation({
      observedAt: 999,
      expiresAt: 2_500,
    }))).toThrow(/older than current evidence/u);

    expect(() => registry.observe(observation({
      latencyMs: 181,
    }))).toThrow(/conflicts at the same timestamp/u);

    const newer = registry.observe(observation({
      observedAt: 1_100,
      expiresAt: 2_100,
      latencyMs: 170,
    }));
    expect(newer.latencyMs).toBe(170);
    expect(registry.size()).toBe(1);
  });

  it('enforces capacity and reclaims it after removal', () => {
    const registry = createFuryCapabilitySignalRegistry({
      maxRecords: 1,
      now: () => 1_500,
    });
    registry.observe(observation());

    expect(() => registry.observe(observation({
      kind: 'skill',
      id: 'repo-review',
    }))).toThrow(/capacity exceeded/u);

    expect(registry.remove('model', 'openai/gpt-5.6-sol')).toBe(true);
    expect(registry.remove('model', 'openai/gpt-5.6-sol')).toBe(false);
    expect(registry.size()).toBe(0);

    expect(() => registry.observe(observation({
      kind: 'skill',
      id: 'repo-review',
    }))).not.toThrow();
  });

  it('rejects credential-like provenance without storing it', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    const bearer = 'Bear' + 'er ' + 'abcdefghijklmnopqrstuvwxyz012345';

    expect(() => registry.observe(observation({
      source: bearer,
    }))).toThrow(/credential-like material/u);
    expect(registry.size()).toBe(0);
  });

  it('rejects unknown fields, accessors, symbols and unsafe registry options', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });

    expect(() => registry.observe({
      ...observation(),
      hiddenPermit: true,
    } as never)).toThrow(/unsupported or unsafe fields/u);

    const accessor = observation() as Record<string, unknown>;
    Object.defineProperty(accessor, 'source', {
      enumerable: true,
      get() {
        throw new Error('SIGNAL_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => registry.observe(accessor as never))
      .toThrow(/unsupported or unsafe fields/u);

    const symbol = observation() as Record<PropertyKey, unknown>;
    symbol[Symbol('hidden')] = 'value';
    expect(() => registry.observe(symbol as never))
      .toThrow(/plain data object/u);

    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, 'maxRecords', {
      enumerable: true,
      get() {
        throw new Error('OPTIONS_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => createFuryCapabilitySignalRegistry(options as never))
      .toThrow(/unsupported or unsafe fields/u);
  });

  it('validates timestamps and bounded measured values', () => {
    const registry = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });

    expect(() => registry.observe(observation({
      expiresAt: 1_000,
    }))).toThrow(/later than observedAt/u);

    expect(() => registry.observe(observation({
      latencyMs: -1,
    }))).toThrow(/latencyMs/u);

    expect(() => registry.observe(observation({
      observedCostUsd: Number.POSITIVE_INFINITY,
      costBasis: 'fixture',
    }))).toThrow(/observedCostUsd/u);
  });
});
