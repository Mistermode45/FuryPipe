import { describe, expect, it } from 'vitest';

import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  FURY_CAPABILITY_INDEX_KINDS,
  FURY_CAPABILITY_INDEX_SNAPSHOT_FORMAT,
  type FuryCapabilityIndexEntryInput,
  type FuryCapabilityIndexKind,
} from '../src/capability-index.js';

function entry(
  overrides: Partial<FuryCapabilityIndexEntryInput> = {},
): FuryCapabilityIndexEntryInput {
  return {
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'skill',
    id: 'repo-review',
    name: 'Repository Review',
    description: 'Review repository architecture, tests and security constraints.',
    families: ['coding', 'repository'],
    tags: ['review', 'security'],
    keywords: ['architecture review', 'repository'],
    trust: 'verified',
    license: 'verified',
    health: 'ready',
    riskClass: 'read',
    requiredPermissions: ['repository-read'],
    compatibility: ['typescript', 'node'],
    estimatedContextTokens: 420,
    source: {
      system: 'skill-registry',
      sourceId: 'repo-review',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      observedAt: '2026-09-20T12:00:00Z',
    },
    ...overrides,
  };
}

describe('Capability Autopilot V2 local index', () => {
  it('represents the universal 2026 capability taxonomy without granting routing by presence alone', () => {
    expect(FURY_CAPABILITY_INDEX_KINDS).toEqual(expect.arrayContaining([
      'model','provider','skill','skill-pack','instruction','plugin','mcp','connector','tool','agent',
      'workflow','automation','memory-provider','search-provider','browser-provider','image-provider',
      'video-provider','audio-provider','voice-provider','embedding-provider','reranker','code-runtime','sandbox',
    ]));
    expect(new Set(FURY_CAPABILITY_INDEX_KINDS).size).toBe(FURY_CAPABILITY_INDEX_KINDS.length);
  });

  it('stores immutable routing metadata only and emits no execution authority', () => {
    const index = createFuryCapabilityIndex();
    const record = index.upsert(entry());

    expect(record).toMatchObject({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      authority: 'routing-metadata-only',
      executionAuthority: false,
    });
    expect(record.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.families)).toBe(true);
    expect(Object.isFrozen(record.source)).toBe(true);

    const snapshot = index.snapshot();
    expect(snapshot).toMatchObject({
      format: FURY_CAPABILITY_INDEX_SNAPSHOT_FORMAT,
      count: 1,
      authority: 'routing-metadata-only',
      executionAuthority: false,
    });
    expect(snapshot.digestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.metadataBytes).toBeGreaterThan(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('executionAuthority":true');
  });

  it('canonicalizes set-like metadata and keeps deterministic fingerprints', () => {
    const first = createFuryCapabilityIndex();
    const second = createFuryCapabilityIndex();

    const a = first.upsert(entry({
      families: ['repository', 'coding'],
      tags: ['security', 'review'],
      keywords: ['Repository', 'Architecture Review'],
      requiredPermissions: ['repository-read', 'evidence-read'],
      compatibility: ['node', 'typescript'],
    }));
    const b = second.upsert(entry({
      families: ['coding', 'repository'],
      tags: ['review', 'security'],
      keywords: ['architecture review', 'repository'],
      requiredPermissions: ['evidence-read', 'repository-read'],
      compatibility: ['typescript', 'node'],
    }));

    expect(a.families).toEqual(['coding', 'repository']);
    expect(a.tags).toEqual(['review', 'security']);
    expect(a.keywords).toEqual(['architecture review', 'repository']);
    expect(a.requiredPermissions).toEqual(['evidence-read', 'repository-read']);
    expect(a.compatibility).toEqual(['node', 'typescript']);
    expect(a.fingerprintSha256).toBe(b.fingerprintSha256);
    expect(first.snapshot().digestSha256).toBe(second.snapshot().digestSha256);
  });

  it('sorts snapshots canonically regardless of insertion order', () => {
    const one = createFuryCapabilityIndex();
    const two = createFuryCapabilityIndex();

    const records = [
      entry({ kind: 'model', id: 'gpt-5.6-sol', source: { system: 'model-fabric', sourceId: 'openai/gpt-5.6-sol' } }),
      entry({ kind: 'plugin', id: 'github-mcp', source: { system: 'plugin-registry', sourceId: 'github-mcp' } }),
      entry({ kind: 'mcp-tool', id: 'github/get-file', source: { system: 'mcp-host', sourceId: 'github/get-file' } }),
      entry({ kind: 'skill', id: 'repo-review' }),
    ] as const;

    for (const value of records) one.upsert(value);
    for (const value of [...records].reverse()) two.upsert(value);

    expect(one.snapshot().records.map((value) => `${value.kind}:${value.id}`))
      .toEqual([
        'mcp-tool:github/get-file',
        'model:gpt-5.6-sol',
        'plugin:github-mcp',
        'skill:repo-review',
      ]);
    expect(one.snapshot().digestSha256).toBe(two.snapshot().digestSha256);
  });

  it('uses (kind,id) identity so equal IDs in different capability families cannot collide', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry({ kind: 'skill', id: 'shared-id' }));
    index.upsert(entry({
      kind: 'plugin',
      id: 'shared-id',
      source: { system: 'plugin-registry', sourceId: 'shared-id' },
    }));

    expect(index.size()).toBe(2);
    expect(index.get('skill', 'shared-id')?.kind).toBe('skill');
    expect(index.get('plugin', 'shared-id')?.kind).toBe('plugin');
  });

  it('replaces one identity atomically without consuming another record slot', () => {
    const index = createFuryCapabilityIndex({ maxRecords: 1 });
    const first = index.upsert(entry());
    const firstBytes = index.metadataBytes();

    const replacement = index.upsert(entry({
      description: 'A newer bounded repository review description.',
      estimatedContextTokens: 256,
    }));

    expect(index.size()).toBe(1);
    expect(replacement.fingerprintSha256).not.toBe(first.fingerprintSha256);
    expect(index.get('skill', 'repo-review')?.description)
      .toBe('A newer bounded repository review description.');
    expect(index.metadataBytes()).not.toBe(firstBytes);

    expect(() => index.upsert(entry({
      id: 'second-record',
      source: { system: 'skill-registry', sourceId: 'second-record' },
    }))).toThrow(/record capacity exceeded/u);
  });

  it('reclaims record and byte capacity after removal', () => {
    const index = createFuryCapabilityIndex({ maxRecords: 1 });
    index.upsert(entry());
    const bytes = index.metadataBytes();
    expect(bytes).toBeGreaterThan(0);

    expect(index.remove('skill', 'repo-review')).toBe(true);
    expect(index.remove('skill', 'repo-review')).toBe(false);
    expect(index.size()).toBe(0);
    expect(index.metadataBytes()).toBe(0);

    expect(() => index.upsert(entry({
      id: 'replacement',
      source: { system: 'skill-registry', sourceId: 'replacement' },
    }))).not.toThrow();
  });

  it('enforces per-record and total metadata byte quotas', () => {
    const perRecord = createFuryCapabilityIndex({
      maxRecordBytes: 512,
      maxTotalBytes: 2_048,
    });
    expect(() => perRecord.upsert(entry({
      description: 'x'.repeat(1_200),
    }))).toThrow(/record exceeds maxRecordBytes/u);

    const total = createFuryCapabilityIndex({
      maxRecordBytes: 2_048,
      maxTotalBytes: 2_500,
    });
    total.upsert(entry({
      id: 'one',
      description: 'a'.repeat(700),
      source: { system: 'skill-registry', sourceId: 'one' },
    }));
    expect(() => total.upsert(entry({
      id: 'two',
      description: 'b'.repeat(1_000),
      source: { system: 'skill-registry', sourceId: 'two' },
    }))).toThrow(/metadata byte capacity exceeded/u);
  });

  it('rejects callbacks, unknown fields, accessors, symbols and custom prototypes', () => {
    const index = createFuryCapabilityIndex();

    expect(() => index.upsert({
      ...entry(),
      execute: () => undefined,
    } as never)).toThrow(/unsupported or unsafe fields/u);

    const accessor = entry() as Record<string, unknown>;
    Object.defineProperty(accessor, 'name', {
      enumerable: true,
      get() {
        return 'malicious getter';
      },
    });
    expect(() => index.upsert(accessor as never)).toThrow(/unsupported or unsafe fields/u);

    const symbol = entry() as Record<PropertyKey, unknown>;
    symbol[Symbol('hidden')] = 'value';
    expect(() => index.upsert(symbol as never)).toThrow(/plain data object/u);

    const custom = Object.assign(Object.create({ inherited: true }), entry());
    expect(() => index.upsert(custom)).toThrow(/plain data object/u);
  });

  it('rejects accessor, sparse and symbol-bearing nested metadata arrays', () => {
    const index = createFuryCapabilityIndex();

    const accessor = ['coding'] as string[];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        throw new Error('NESTED_ARRAY_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => index.upsert(entry({
      families: accessor,
    }))).toThrow(/accessor entries/u);

    const sparse = new Array<string>(1);
    expect(() => index.upsert(entry({
      tags: sparse,
    }))).toThrow(/sparse/u);

    const symbol = ['repository'] as Array<string> & Record<symbol, string>;
    symbol[Symbol('hidden')] = 'hidden';
    expect(() => index.upsert(entry({
      keywords: symbol,
    }))).toThrow(/symbol properties/u);
  });

  it('rejects credential-like material from index metadata', () => {
    const index = createFuryCapabilityIndex();

    for (const secret of [
      'Bearer abcdefghijklmnopqrstuvwxyz012345',
      'sk-abcdefghijklmnopqrstuvwxyz012345',
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
      'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
      'https://user:password@example.com/private',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expect(() => index.upsert(entry({
        id: `secret-${secret.length}`,
        description: `Capability accidentally contains ${secret}`,
        source: { system: 'host', sourceId: 'redaction-test' },
      }))).toThrow(/credential-like material/u);
    }
  });

  it('rejects malformed enums, duplicate metadata and invalid source timestamps', () => {
    const index = createFuryCapabilityIndex();

    expect(() => index.upsert(entry({ kind: 'agent' as FuryCapabilityIndexKind })))
      .toThrow(/kind is unsupported/u);
    expect(() => index.upsert(entry({ trust: 'super-trusted' as never })))
      .toThrow(/trust is unsupported/u);
    expect(() => index.upsert(entry({ families: ['coding', 'coding'] })))
      .toThrow(/must not contain duplicates/u);
    expect(() => index.upsert(entry({
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        observedAt: 'yesterday',
      },
    }))).toThrow(/ISO UTC timestamp/u);
  });

  it('validates estimated context cost without inventing unknown values', () => {
    const index = createFuryCapabilityIndex();
    const withoutEstimate = index.upsert(entry({
      estimatedContextTokens: undefined,
    }));
    expect(withoutEstimate.estimatedContextTokens).toBeUndefined();

    for (const invalid of [-1, 1.5, 10_000_001]) {
      expect(() => index.upsert(entry({
        id: `estimate-${String(invalid).replace('.', '-')}`,
        estimatedContextTokens: invalid,
        source: { system: 'skill-registry', sourceId: 'estimate-test' },
      }))).toThrow(/estimatedContextTokens/u);
    }
  });

  it('returns a kind-filtered immutable view without changing the global snapshot', () => {
    const index = createFuryCapabilityIndex();
    index.upsert(entry());
    index.upsert(entry({
      kind: 'model',
      id: 'gpt-5.6-sol',
      source: { system: 'model-fabric', sourceId: 'openai/gpt-5.6-sol' },
    }));

    const models = index.list('model');
    expect(models).toHaveLength(1);
    expect(models[0]?.kind).toBe('model');
    expect(Object.isFrozen(models)).toBe(true);
    expect(index.snapshot().count).toBe(2);
  });
});
