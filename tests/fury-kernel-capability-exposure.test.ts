import { describe, expect, it, vi } from 'vitest';

import {
  selectFuryCapabilitiesForTask,
} from '../src/capability-autopilot.js';
import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  type FuryCapabilityIndexEntryInput,
} from '../src/capability-index.js';
import {
  createFuryCapabilitySignalRegistry,
  FURY_CAPABILITY_SIGNAL_FORMAT,
} from '../src/capability-signals.js';
import {
  createFuryKernelCapabilityExposurePlan,
  FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT,
  isGeneratedFuryKernelCapabilityExposurePlan,
} from '../src/fury-kernel-capability-exposure.js';

function entry(
  id: string,
  overrides: Partial<FuryCapabilityIndexEntryInput> = {},
): FuryCapabilityIndexEntryInput {
  return {
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'skill',
    id,
    name: id.replaceAll('-', ' '),
    description: 'Repository review capability metadata.',
    families: ['repository'],
    tags: ['review'],
    keywords: ['repository', 'review'],
    trust: 'verified',
    license: 'not-applicable',
    health: 'ready',
    riskClass: 'read',
    requiredPermissions: [],
    compatibility: [],
    source: {
      system: 'skill-registry',
      sourceId: id,
      sourceRevision: '1.0.0',
    },
    ...overrides,
  };
}

describe('Fury Kernel Capability Autopilot exposure', () => {
  it('exposes only revalidated bounded descriptors with zero execution authority', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review', {
      estimatedContextTokens: 512,
    }));

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Review this repository.',
      index,
    });
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    });

    expect(exposure).toMatchObject({
      format: FURY_KERNEL_CAPABILITY_EXPOSURE_FORMAT,
      status: 'ready',
      selectedCount: 1,
      exposedCount: 1,
      estimatedContextTokensKnown: 512,
      estimatedContextTokensUnknown: 0,
      contextEstimateComplete: true,
      authority: 'exposure-metadata-only',
      executionAuthority: false,
    });
    expect(exposure.status).toBe('ready');
    if (exposure.status !== 'ready') throw new Error('expected ready exposure');

    expect(exposure.exposureDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(exposure.metadataBytes).toBeGreaterThan(0);
    expect(exposure.descriptors).toEqual([
      expect.objectContaining({
        kind: 'skill',
        id: 'repo-review',
        fullBodyLoaded: false,
        activationAuthorized: false,
        connectionAuthorized: false,
        executionAuthorized: false,
        authority: 'routing-metadata-only',
      }),
    ]);
    expect(Object.isFrozen(exposure)).toBe(true);
    expect(Object.isFrozen(exposure.descriptors)).toBe(true);
    expect(Object.isFrozen(exposure.descriptors[0])).toBe(true);

    const serialized = JSON.stringify(exposure);
    expect(serialized).not.toContain('"keywords"');
    expect(serialized).not.toContain('"compatibility"');
    expect(serialized).not.toContain('"execute"');
    expect(serialized).not.toContain('"executionAuthority":true');
  });

  it('keeps unknown context estimates explicit instead of treating them as zero evidence', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('unknown-cost'));

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
    });
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    });

    expect(exposure).toMatchObject({
      status: 'ready',
      estimatedContextTokensKnown: 0,
      estimatedContextTokensUnknown: 1,
      contextEstimateComplete: false,
    });
  });

  it('blocks exposure when the index changes after selection', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
    });

    index.upsert(entry('repo-review', {
      description: 'Changed source-of-truth metadata.',
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        sourceRevision: '2.0.0',
      },
    }));

    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    });
    expect(exposure).toEqual(expect.objectContaining({
      status: 'blocked',
      reason: 'reselection-required',
      descriptors: [],
      exposedCount: 0,
      executionAuthority: false,
    }));
  });

  it('requires an authentic process-local selection and never evaluates a forged plan', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const genuine = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
    });

    const forged = {
      ...genuine,
      selected: genuine.selected,
    };

    expect(() => createFuryKernelCapabilityExposurePlan({
      selection: forged,
      index,
    } as never)).toThrow(/process-local Autopilot selection/u);
  });

  it('requires a process-local index before reading any forged methods', () => {
    const realIndex = createFuryCapabilityIndex();
    realIndex.upsert(entry('repo-review'));
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index: realIndex,
    });

    const snapshot = vi.fn(() => {
      throw new Error('FORGED_INDEX_MUST_NOT_RUN');
    });
    const forged = {
      snapshot,
      get: vi.fn(),
      list: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      size: vi.fn(),
      metadataBytes: vi.fn(),
    };

    expect(() => createFuryKernelCapabilityExposurePlan({
      selection,
      index: forged,
    } as never)).toThrow(/process-local capability index/u);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('fails closed when selected count exceeds the exposure cap', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('one'));
    index.upsert(entry('two'));

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      explicitRequests: [
        { kind: 'skill', id: 'one' },
        { kind: 'skill', id: 'two' },
      ],
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });

    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      maxCapabilities: 1,
    });
    expect(exposure).toMatchObject({
      status: 'blocked',
      reason: 'selection-count-exceeds-limit',
      selectedCount: 2,
      exposedCount: 0,
      metadataBytes: 0,
    });
  });

  it('fails closed on per-descriptor and total metadata byte budgets without truncation', () => {
    const one = createFuryCapabilityIndex();
    one.upsert(entry('large', {
      description: 'x'.repeat(1_200),
    }));
    const oneSelection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index: one,
      explicitRequests: [{ kind: 'skill', id: 'large' }],
    });
    expect(createFuryKernelCapabilityExposurePlan({
      selection: oneSelection,
      index: one,
      maxDescriptorBytes: 256,
      maxTotalBytes: 1_024,
    })).toMatchObject({
      status: 'blocked',
      reason: 'descriptor-byte-limit',
    });

    const two = createFuryCapabilityIndex();
    two.upsert(entry('first', {
      description: 'a'.repeat(1_000),
    }));
    two.upsert(entry('second', {
      description: 'b'.repeat(1_000),
    }));
    const twoSelection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index: two,
      explicitRequests: [
        { kind: 'skill', id: 'first' },
        { kind: 'skill', id: 'second' },
      ],
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });

    expect(createFuryKernelCapabilityExposurePlan({
      selection: twoSelection,
      index: two,
      maxDescriptorBytes: 2_048,
      maxTotalBytes: 2_048,
    })).toMatchObject({
      status: 'blocked',
      reason: 'total-byte-limit',
      descriptors: [],
    });
  });

  it('fails closed when known selected context cost exceeds its configured budget', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('expensive', {
      estimatedContextTokens: 5_000,
    }));
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      explicitRequests: [{ kind: 'skill', id: 'expensive' }],
    });

    expect(createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      maxKnownContextTokens: 1_000,
    })).toMatchObject({
      status: 'blocked',
      reason: 'known-context-budget-exceeded',
      descriptors: [],
      executionAuthority: false,
    });
  });

  it('does not enable an explicitly selected plugin', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('github-mcp', {
      kind: 'plugin',
      name: 'GitHub MCP',
      description: 'Registered external opt-in repository integration.',
      families: ['plugin', 'repository'],
      tags: ['external-opt-in'],
      requiredPermissions: ['network', 'repository-read'],
      riskClass: 'process',
      source: {
        system: 'plugin-registry',
        sourceId: 'github-mcp',
        sourceRevision: '1.0.0',
      },
    }));

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Use GitHub MCP.',
      index,
      explicitRequests: [{ kind: 'plugin', id: 'github-mcp' }],
      availablePermissions: ['network', 'repository-read'],
    });
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    });

    expect(exposure.status).toBe('ready');
    if (exposure.status !== 'ready') throw new Error('expected ready exposure');
    expect(exposure.descriptors[0]).toMatchObject({
      kind: 'plugin',
      id: 'github-mcp',
      activationAuthorized: false,
      connectionAuthorized: false,
      executionAuthorized: false,
    });
  });

  it('marks only genuine exposure plans as process-local evidence', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
    });
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    });

    expect(isGeneratedFuryKernelCapabilityExposurePlan(exposure)).toBe(true);
    expect(isGeneratedFuryKernelCapabilityExposurePlan({
      ...exposure,
    })).toBe(false);
  });

  it('rejects accessor-backed exposure options before revalidation', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
    });

    const input = {
      selection,
      index,
    } as Record<string, unknown>;
    Object.defineProperty(input, 'maxCapabilities', {
      enumerable: true,
      get() {
        throw new Error('EXPOSURE_OPTION_GETTER_MUST_NOT_RUN');
      },
    });

    expect(() => createFuryKernelCapabilityExposurePlan(input as never))
      .toThrow(/unsupported or unsafe fields/u);
  });

  it('carries only revalidated measured signal metadata into Kernel exposure', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      health: 'ready',
      latencyMs: 95,
      observedCostUsd: 0.002,
      costBasis: 'same-workload-fixture-v1',
    });

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals,
    });
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      signals,
    });

    expect(exposure.status).toBe('ready');
    if (exposure.status !== 'ready') throw new Error('expected ready exposure');
    expect(exposure.signalSnapshotDigestSha256)
      .toBe(selection.signalSnapshotDigestSha256);
    expect(exposure.descriptors[0]).toMatchObject({
      id: 'repo-review',
      measuredSignal: {
        status: 'fresh',
        health: 'ready',
        latencyMs: 95,
        observedCostUsd: 0.002,
        costBasis: 'same-workload-fixture-v1',
        observedAt: 1_000,
        expiresAt: 2_000,
        source: 'runtime-observation-v1',
        evidenceKind: 'runtime-observation',
      },
      activationAuthorized: false,
      connectionAuthorized: false,
      executionAuthorized: false,
    });
    expect(JSON.stringify(exposure)).not.toContain('"executionAuthority":true');
  });

  it('blocks a signal-backed selection when the signal registry is missing at exposure time', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      latencyMs: 100,
    });
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals,
    });

    expect(createFuryKernelCapabilityExposurePlan({
      selection,
      index,
    })).toMatchObject({
      status: 'blocked',
      reason: 'signal-reselection-required',
      descriptors: [],
      executionAuthority: false,
    });
  });

  it('blocks exposure when measured evidence expires after selection', () => {
    let now = 1_500;
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => now,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      latencyMs: 100,
    });
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals,
    });

    now = 2_000;
    const exposure = createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      signals,
    });
    expect(exposure).toMatchObject({
      status: 'blocked',
      reason: 'signal-reselection-required',
      descriptors: [],
    });
    expect(exposure.signalSnapshotDigestSha256)
      .not.toBe(selection.signalSnapshotDigestSha256);
  });

  it('blocks exposure when measured evidence is replaced after selection', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      latencyMs: 100,
    });
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals,
    });

    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_100,
      expiresAt: 2_100,
      source: 'runtime-observation-v2',
      evidenceKind: 'runtime-observation',
      latencyMs: 80,
    });

    expect(createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      signals,
    })).toMatchObject({
      status: 'blocked',
      reason: 'signal-reselection-required',
    });
  });

  it('rejects a forged measured signal registry before snapshot evaluation', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry('repo-review'));
    const genuineSignals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    genuineSignals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      latencyMs: 100,
    });
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals: genuineSignals,
    });

    const snapshot = vi.fn(() => {
      throw new Error('FORGED_SIGNAL_REGISTRY_MUST_NOT_RUN');
    });
    const forged = {
      snapshot,
      observe: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      size: vi.fn(),
    };

    expect(() => createFuryKernelCapabilityExposurePlan({
      selection,
      index,
      signals: forged as never,
    })).toThrow(/process-local signal registry/u);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
