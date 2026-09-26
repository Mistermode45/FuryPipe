import { describe, expect, it, vi } from 'vitest';

import {
  selectFuryCapabilitiesForTask,
} from '../src/capability-autopilot.js';
import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexEntryInput,
  type FuryCapabilityIndexKind,
} from '../src/capability-index.js';
import {
  createFuryCapabilitySignalRegistry,
  FURY_CAPABILITY_SIGNAL_FORMAT,
} from '../src/capability-signals.js';

function capability(
  id: string,
  overrides: Partial<FuryCapabilityIndexEntryInput> = {},
): FuryCapabilityIndexEntryInput {
  return {
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'skill',
    id,
    name: id.replaceAll('-', ' '),
    description: 'General capability metadata for deterministic routing.',
    families: ['general'],
    tags: [],
    keywords: [],
    trust: 'verified',
    license: 'verified',
    health: 'ready',
    riskClass: 'none',
    requiredPermissions: [],
    compatibility: [],
    estimatedContextTokens: 128,
    source: {
      system: 'skill-registry',
      sourceId: id,
    },
    ...overrides,
  };
}

function indexOf(...entries: FuryCapabilityIndexEntryInput[]): FuryCapabilityIndex {
  const index = createFuryCapabilityIndex();
  for (const entry of entries) index.upsert(entry);
  return index;
}

describe('Capability Autopilot V2 deterministic shortlist', () => {
  it('selects a small relevant set and never returns execution authority', () => {
    const objective = 'Review this TypeScript repository architecture and security.';
    const index = indexOf(
      capability('repo-review', {
        name: 'Repository security review',
        description: 'Review TypeScript repository architecture, tests and security.',
        families: ['coding', 'repository'],
        tags: ['security', 'review'],
        keywords: ['typescript', 'architecture review'],
        estimatedContextTokens: 320,
      }),
      capability('marketing-copy', {
        name: 'Marketing copy',
        description: 'Write launch copy and social posts.',
        families: ['marketing'],
        keywords: ['campaign', 'copywriting'],
      }),
      capability('security-audit', {
        name: 'Security audit',
        description: 'Analyze application security and trust boundaries.',
        families: ['security'],
        keywords: ['security', 'threat model'],
        estimatedContextTokens: 220,
      }),
    );

    const plan = selectFuryCapabilitiesForTask({
      objective,
      index,
      requiredFamilies: ['repository'],
    });

    expect(plan.format).toBe('furypipe-capability-selection/v1');
    expect(plan.executionAuthority).toBe(false);
    expect(plan.authority).toBe('selection-only');
    expect(plan.objectiveDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.indexDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.selectionDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.selected[0]).toMatchObject({
      kind: 'skill',
      id: 'repo-review',
      reason: 'family-match',
      requestedExplicitly: false,
    });
    expect(plan.selected.some((item) => item.id === 'marketing-copy')).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(objective);
    expect(JSON.stringify(plan)).not.toContain('executionAuthority":true');
  });

  it('makes identical selections regardless of index insertion order', () => {
    const entries = [
      capability('a', {
        description: 'TypeScript repository architecture.',
        families: ['coding'],
      }),
      capability('b', {
        description: 'TypeScript repository testing.',
        families: ['coding'],
      }),
      capability('c', {
        description: 'TypeScript repository documentation.',
        families: ['coding'],
      }),
    ];

    const forward = indexOf(...entries);
    const reverse = indexOf(...[...entries].reverse());

    const a = selectFuryCapabilitiesForTask({
      objective: 'TypeScript repository',
      index: forward,
      options: { maxSelected: 2 },
    });
    const b = selectFuryCapabilitiesForTask({
      objective: 'TypeScript repository',
      index: reverse,
      options: { maxSelected: 2 },
    });

    expect(a.selected.map((item) => item.id)).toEqual(
      b.selected.map((item) => item.id),
    );
    expect(a.selectionDigestSha256).toBe(b.selectionDigestSha256);
  });

  it('boosts explicit requests but never lets them bypass trust, license, health or permissions', () => {
    const index = indexOf(
      capability('trusted-skill', {
        description: 'Unrelated but explicitly requested.',
      }),
      capability('unverified-skill', {
        trust: 'unverified',
      }),
      capability('unknown-license', {
        license: 'unknown',
      }),
      capability('blocked-health', {
        health: 'blocked',
      }),
      capability('network-skill', {
        requiredPermissions: ['network'],
      }),
    );

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Do the task.',
      index,
      explicitRequests: [
        { kind: 'skill', id: 'trusted-skill' },
        { kind: 'skill', id: 'unverified-skill' },
        { kind: 'skill', id: 'unknown-license' },
        { kind: 'skill', id: 'blocked-health' },
        { kind: 'skill', id: 'network-skill' },
      ],
      availablePermissions: [],
      options: { maxSelected: 8, maxSelectedByKind: { skill: 8 } },
    });

    expect(plan.selected).toEqual([
      expect.objectContaining({
        id: 'trusted-skill',
        reason: 'explicit-request',
        requestedExplicitly: true,
      }),
    ]);
    expect(plan.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unverified-skill', reason: 'trust-unverified', requestedExplicitly: true }),
      expect.objectContaining({ id: 'unknown-license', reason: 'license-unknown', requestedExplicitly: true }),
      expect.objectContaining({ id: 'blocked-health', reason: 'health-blocked', requestedExplicitly: true }),
      expect.objectContaining({ id: 'network-skill', reason: 'missing-permission', requestedExplicitly: true }),
    ]));
  });

  it('fails compatibility closed when requirements are unknown or incomplete', () => {
    const index = indexOf(capability('node-typescript', {
      description: 'Node TypeScript implementation.',
      compatibility: ['node', 'typescript'],
    }));

    const unknown = selectFuryCapabilitiesForTask({
      objective: 'Node TypeScript implementation',
      index,
    });
    expect(unknown.selected).toHaveLength(0);
    expect(unknown.blockedCounts).toMatchObject({
      'compatibility-unproven': 1,
    });

    const incomplete = selectFuryCapabilitiesForTask({
      objective: 'Node TypeScript implementation',
      index,
      hostCompatibility: ['node'],
    });
    expect(incomplete.selected).toHaveLength(0);
    expect(incomplete.blockedCounts).toMatchObject({
      'compatibility-mismatch': 1,
    });

    const compatible = selectFuryCapabilitiesForTask({
      objective: 'Node TypeScript implementation',
      index,
      hostCompatibility: ['node', 'typescript'],
    });
    expect(compatible.selected.map((item) => item.id)).toContain('node-typescript');
  });

  it('requires all indexed permissions to already exist in the planning context', () => {
    const index = indexOf(capability('repo-network-tool', {
      kind: 'mcp-tool',
      description: 'Read repository metadata over a network integration.',
      requiredPermissions: ['network', 'repository-read'],
      source: {
        system: 'mcp-host',
        sourceId: 'repo-network-tool',
      },
    }));

    const blocked = selectFuryCapabilitiesForTask({
      objective: 'Read repository metadata',
      index,
      availablePermissions: ['repository-read'],
    });
    expect(blocked.selected).toHaveLength(0);
    expect(blocked.blockedCounts).toMatchObject({
      'missing-permission': 1,
    });

    const eligible = selectFuryCapabilitiesForTask({
      objective: 'Read repository metadata',
      index,
      availablePermissions: ['network', 'repository-read'],
    });
    expect(eligible.selected[0]).toMatchObject({
      kind: 'mcp-tool',
      id: 'repo-network-tool',
    });
    expect('executionAuthority' in (eligible.selected[0] ?? {})).toBe(false);
    expect(eligible.executionAuthority).toBe(false);
  });

  it('uses context and risk only as bounded penalties, never as authority', () => {
    const index = indexOf(
      capability('cheap-read', {
        description: 'Repository inspect.',
        riskClass: 'read',
        estimatedContextTokens: 100,
      }),
      capability('expensive-admin', {
        description: 'Repository inspect.',
        riskClass: 'admin',
        estimatedContextTokens: 8_000,
      }),
    );

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository inspect',
      index,
      explicitRequests: [
        { kind: 'skill', id: 'cheap-read' },
        { kind: 'skill', id: 'expensive-admin' },
      ],
      options: { maxSelected: 2, maxSelectedByKind: { skill: 2 } },
    });

    expect(plan.selected.map((item) => item.id)).toEqual([
      'cheap-read',
      'expensive-admin',
    ]);
    expect(plan.selected[0]!.penalty).toBeLessThan(plan.selected[1]!.penalty);
    expect(plan.estimatedContextTokensKnown).toBe(8_100);
  });

  it('enforces global and per-kind caps deterministically', () => {
    const index = indexOf(
      capability('skill-a', { description: 'Repository testing security.' }),
      capability('skill-b', { description: 'Repository testing security.' }),
      capability('plugin-a', {
        kind: 'plugin',
        description: 'Repository testing security.',
        source: { system: 'plugin-registry', sourceId: 'plugin-a' },
      }),
      capability('plugin-b', {
        kind: 'plugin',
        description: 'Repository testing security.',
        source: { system: 'plugin-registry', sourceId: 'plugin-b' },
      }),
      capability('model-a', {
        kind: 'model',
        description: 'Repository testing security.',
        source: { system: 'model-fabric', sourceId: 'model-a' },
      }),
    );

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository testing security',
      index,
      options: {
        maxSelected: 3,
        maxSelectedByKind: {
          skill: 1,
          plugin: 1,
          model: 1,
        },
      },
    });

    expect(plan.selected).toHaveLength(3);
    expect(plan.selected.filter((item) => item.kind === 'skill')).toHaveLength(1);
    expect(plan.selected.filter((item) => item.kind === 'plugin')).toHaveLength(1);
    expect(plan.selected.filter((item) => item.kind === 'model')).toHaveLength(1);
    expect((plan.blockedCounts['kind-cap'] ?? 0) + (plan.blockedCounts['global-cap'] ?? 0))
      .toBeGreaterThan(0);
  });

  it('keeps newly represented universal capability kinds fail-closed until a caller opts them into routing', () => {
    const index = indexOf(capability('review-agent', {
      kind: 'agent',
      description: 'Repository review agent.',
      source: { system: 'host', sourceId: 'review-agent' },
    }));

    const closed = selectFuryCapabilitiesForTask({
      objective: 'Use a repository review agent.',
      index,
    });
    expect(closed.selected).toHaveLength(0);
    expect(closed.blockedCounts).toMatchObject({ 'kind-cap': 1 });

    const enabled = selectFuryCapabilitiesForTask({
      objective: 'Use a repository review agent.',
      index,
      options: { maxSelectedByKind: { agent: 1 } },
    });
    expect(enabled.selected).toEqual([
      expect.objectContaining({
        kind: 'agent',
        id: 'review-agent',
      }),
    ]);
    expect(enabled.executionAuthority).toBe(false);
  });

  it('reports missing explicit requests without fabricating capabilities', () => {
    const index = indexOf(capability('known'));

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Use a requested integration.',
      index,
      explicitRequests: [
        { kind: 'plugin', id: 'does-not-exist' },
      ],
    });

    expect(plan.selected).toHaveLength(0);
    expect(plan.missingExplicitRequests).toEqual([
      { kind: 'plugin', id: 'does-not-exist' },
    ]);
  });

  it('bounds blocked details while preserving aggregate counts', () => {
    const index = createFuryCapabilityIndex();
    for (let i = 0; i < 20; i += 1) {
      index.upsert(capability(`blocked-${i}`, {
        trust: 'unverified',
      }));
    }

    const plan = selectFuryCapabilitiesForTask({
      objective: 'blocked',
      index,
      options: {
        maxBlockedDetails: 3,
      },
    });

    expect(plan.blocked).toHaveLength(3);
    expect(plan.blockedCounts).toMatchObject({
      'trust-unverified': 20,
    });
  });

  it('rejects unsafe selector inputs and duplicate explicit requests', () => {
    const index = indexOf(capability('known'));

    expect(() => selectFuryCapabilitiesForTask({
      objective: '',
      index,
    })).toThrow(/bounded non-empty/u);

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'task',
      index,
      hostCompatibility: ['node', 'node'],
    })).toThrow(/duplicate facts/u);

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'task',
      index,
      explicitRequests: [
        { kind: 'skill', id: 'known' },
        { kind: 'skill', id: 'known' },
      ],
    })).toThrow(/must be unique/u);

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'task',
      index,
      explicitRequests: [{
        kind: 'side-effect' as FuryCapabilityIndexKind,
        id: 'unknown',
      }],
    })).toThrow(/kind is unsupported/u);
  });

  it('requires a process-local FuryPipe index instead of calling methods on a forged object', () => {
    const snapshot = vi.fn(() => {
      throw new Error('FORGED_INDEX_CALLBACK_MUST_NOT_RUN');
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

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index: forged as never,
    })).toThrow(/process-local FuryPipe index/u);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('rejects accessors and unknown fields at the selector boundary before routing', () => {
    const index = indexOf(capability('known'));
    const input = {
      objective: 'Repository review',
      index,
    } as Record<string, unknown>;
    Object.defineProperty(input, 'objective', {
      enumerable: true,
      get() {
        throw new Error('OBJECTIVE_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => selectFuryCapabilitiesForTask(input as never))
      .toThrow(/unsupported or unsafe fields/u);

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      unexpected: true,
    } as never)).toThrow(/unsupported or unsafe fields/u);

    const permissions = ['repository-read'] as string[];
    Object.defineProperty(permissions, '0', {
      enumerable: true,
      get() {
        throw new Error('PERMISSION_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      availablePermissions: permissions,
    })).toThrow(/accessor entries/u);
  });

  it('rejects indexes larger than the caller selection bound', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(capability('one'));
    index.upsert(capability('two'));

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'general',
      index,
      options: { maxCandidates: 1 },
    })).toThrow(/candidate bound exceeded/u);
  });

  it('does not select a plugin, MCP tool or model merely because it exists', () => {
    const index = indexOf(
      capability('plugin-unrelated', {
        kind: 'plugin',
        description: 'Design asset integration.',
        families: ['design'],
        source: { system: 'plugin-registry', sourceId: 'plugin-unrelated' },
      }),
      capability('tool-unrelated', {
        kind: 'mcp-tool',
        description: 'Calendar scheduling integration.',
        families: ['calendar'],
        source: { system: 'mcp-host', sourceId: 'tool-unrelated' },
      }),
      capability('model-unrelated', {
        kind: 'model',
        description: 'Image generation model.',
        families: ['image'],
        source: { system: 'model-fabric', sourceId: 'model-unrelated' },
      }),
    );

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Review a TypeScript repository.',
      index,
    });

    expect(plan.selected).toHaveLength(0);
    expect(plan.executionAuthority).toBe(false);
  });

  it('allows fresh measured health to resolve indexed unknown health without granting authority', () => {
    const index = indexOf(capability('measured-model', {
      kind: 'model',
      health: 'unknown',
      description: 'Reasoning model for repository review.',
      source: { system: 'model-fabric', sourceId: 'measured-model' },
    }));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'model',
      id: 'measured-model',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'provider-live-probe-v1',
      evidenceKind: 'live-probe',
      health: 'ready',
      latencyMs: 140,
    });

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository review reasoning model',
      index,
      signals,
    });

    expect(plan.selected).toHaveLength(1);
    expect(plan.signalSnapshotDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan).toMatchObject({
      signalRecordsConsidered: 1,
      signalFreshRecords: 1,
      signalStaleRecords: 0,
      executionAuthority: false,
    });
    expect(plan.selected[0]).toMatchObject({
      id: 'measured-model',
      measuredSignal: {
        status: 'fresh',
        health: 'ready',
        latencyMs: 140,
        observedAt: 1_000,
        expiresAt: 2_000,
        source: 'provider-live-probe-v1',
        evidenceKind: 'live-probe',
      },
    });
    expect('executionAuthority' in (plan.selected[0]?.measuredSignal ?? {})).toBe(false);
  });

  it('does not let stale measured health resolve indexed unknown health', () => {
    const index = indexOf(capability('stale-model', {
      kind: 'model',
      health: 'unknown',
      description: 'Reasoning model for repository review.',
      source: { system: 'model-fabric', sourceId: 'stale-model' },
    }));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 3_000,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'model',
      id: 'stale-model',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'provider-live-probe-v1',
      evidenceKind: 'live-probe',
      health: 'ready',
    });

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository review reasoning model',
      index,
      signals,
      explicitRequests: [{ kind: 'model', id: 'stale-model' }],
    });

    expect(plan.selected).toHaveLength(0);
    expect(plan.blockedCounts).toMatchObject({
      'health-unknown': 1,
    });
    expect(plan).toMatchObject({
      signalFreshRecords: 0,
      signalStaleRecords: 1,
    });
  });

  it('lets fresh measured unavailable health block an otherwise ready capability', () => {
    const index = indexOf(capability('runtime-down', {
      health: 'ready',
      description: 'Repository review.',
    }));
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    signals.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'runtime-down',
      observedAt: 1_000,
      expiresAt: 2_000,
      source: 'runtime-observation-v1',
      evidenceKind: 'runtime-observation',
      health: 'unavailable',
    });

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals,
      explicitRequests: [{ kind: 'skill', id: 'runtime-down' }],
    });

    expect(plan.selected).toHaveLength(0);
    expect(plan.blockedCounts).toMatchObject({
      'health-unavailable': 1,
    });
  });

  it('uses measured cost only when candidates share the exact same cost basis', () => {
    const index = indexOf(
      capability('alpha', {
        description: 'Repository review equal task.',
      }),
      capability('beta', {
        description: 'Repository review equal task.',
      }),
    );
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    for (const [id, cost] of [['alpha', 0.02], ['beta', 0.01]] as const) {
      signals.observe({
        format: FURY_CAPABILITY_SIGNAL_FORMAT,
        kind: 'skill',
        id,
        observedAt: 1_000,
        expiresAt: 2_000,
        source: 'completed-operation-fixture',
        evidenceKind: 'completed-operation',
        observedCostUsd: cost,
        costBasis: 'same-workload-fixture-v1',
      });
    }

    const comparable = selectFuryCapabilitiesForTask({
      objective: 'Repository review equal task',
      index,
      signals,
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });
    expect(comparable.selected.map((item) => item.id)).toEqual([
      'beta',
      'alpha',
    ]);

    let now = 1_500;
    const differentBasis = createFuryCapabilitySignalRegistry({
      now: () => now,
    });
    differentBasis.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'alpha',
      observedAt: 1_100,
      expiresAt: 2_100,
      source: 'completed-operation-fixture',
      evidenceKind: 'completed-operation',
      observedCostUsd: 100,
      costBasis: 'workload-a',
    });
    differentBasis.observe({
      format: FURY_CAPABILITY_SIGNAL_FORMAT,
      kind: 'skill',
      id: 'beta',
      observedAt: 1_100,
      expiresAt: 2_100,
      source: 'completed-operation-fixture',
      evidenceKind: 'completed-operation',
      observedCostUsd: 0.000001,
      costBasis: 'workload-b',
    });
    const notComparable = selectFuryCapabilitiesForTask({
      objective: 'Repository review equal task',
      index,
      signals: differentBasis,
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });
    expect(notComparable.selected.map((item) => item.id)).toEqual([
      'alpha',
      'beta',
    ]);
    now = 3_000;
    expect(differentBasis.snapshot().stale).toBe(2);
  });

  it('uses measured latency only as a deterministic tie-break after relevance and policy', () => {
    const index = indexOf(
      capability('slow', { description: 'Repository review equal task.' }),
      capability('fast', { description: 'Repository review equal task.' }),
    );
    const signals = createFuryCapabilitySignalRegistry({
      now: () => 1_500,
    });
    for (const [id, latencyMs] of [['slow', 900], ['fast', 120]] as const) {
      signals.observe({
        format: FURY_CAPABILITY_SIGNAL_FORMAT,
        kind: 'skill',
        id,
        observedAt: 1_000,
        expiresAt: 2_000,
        source: 'runtime-observation-v1',
        evidenceKind: 'runtime-observation',
        latencyMs,
      });
    }

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository review equal task',
      index,
      signals,
      options: {
        maxSelected: 2,
        maxSelectedByKind: { skill: 2 },
      },
    });

    expect(plan.selected.map((item) => item.id)).toEqual(['fast', 'slow']);
  });

  it('rejects a forged measured signal registry before invoking snapshot', () => {
    const index = indexOf(capability('known'));
    const snapshot = vi.fn(() => {
      throw new Error('FORGED_SIGNAL_SNAPSHOT_MUST_NOT_RUN');
    });
    const forged = {
      snapshot,
      observe: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      size: vi.fn(),
    };

    expect(() => selectFuryCapabilitiesForTask({
      objective: 'Repository review',
      index,
      signals: forged as never,
    })).toThrow(/process-local signal registry/u);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
