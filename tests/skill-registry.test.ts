import { describe, expect, it } from 'vitest';
import { createAgentSkillRegistry, SKILL_CATEGORIES } from '../src/skill-registry.js';

const localSkill = (id: string, priority = 10) => ({
  metadata: {
    id,
    category: 'debugging' as const,
    priority,
    provenance: {
      sourceKind: 'local' as const,
      licenseStatus: 'NOT_APPLICABLE' as const,
      decision: 'ADOPT' as const,
    },
    healthPolicy: 'required' as const,
  },
  definition: {
    id,
    version: '1.0.0',
    stages: ['research'] as const,
    health: async () => ({ status: 'healthy' as const }),
    execute: async () => ({ evidence: [`${id}-evidence`], consumedTokens: 1 }),
  },
});

describe('Agent skill registry', () => {
  it('defines the bounded FuryPipe skill categories across engineering, growth, data and business', () => {
    expect(SKILL_CATEGORIES).toEqual([
      'repository',
      'debugging',
      'security',
      'architecture',
      'testing',
      'documentation',
      'frontend',
      'design',
      'content',
      'marketing',
      'seo',
      'accessibility',
      'performance',
      'analytics',
      'data',
      'automation',
      'business',
      'sales',
      'operations',
      'finance',
      'research',
      'context',
      'learning',
    ]);
    expect(new Set(SKILL_CATEGORIES).size).toBe(23);
  });

  it('resolves executable local skills by priority with health evidence', async () => {
    const registry = createAgentSkillRegistry();
    const low = localSkill('debug-low', 10);
    const high = localSkill('debug-high', 100);
    registry.register(low.metadata, low.definition);
    registry.register(high.metadata, high.definition);

    const resolved = await registry.resolveForStage('research');
    expect(resolved.map((item) => item.metadata.id)).toEqual(['debug-high', 'debug-low']);
    expect(resolved.every((item) => item.eligible && item.health === 'healthy')).toBe(true);
    expect((await registry.definitionsForStage('research')).map((item) => item.id)).toEqual([
      'debug-high',
      'debug-low',
    ]);
  });

  it('keeps external reference-only skills non-executable even with pinned provenance', async () => {
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'reference-skill',
      category: 'research',
      priority: 50,
      provenance: {
        sourceKind: 'external-reference',
        repository: 'https://github.com/example/reference-skill',
        commitSha: 'a'.repeat(40),
        licenseStatus: 'VERIFIED',
        licenseSpdx: 'MIT',
        decision: 'REFERENCE_ONLY',
      },
    }, {
      id: 'reference-skill',
      version: '1.2.3',
      stages: ['research'],
      execute: async () => ({ evidence: ['never'], consumedTokens: 1 }),
    });

    expect(await registry.resolveForStage('research')).toMatchObject([{
      eligible: false,
      reason: 'reference_only',
      health: 'unknown',
    }]);
    expect(await registry.definitionsForStage('research')).toEqual([]);
  });

  it('requires pinned and license-reviewed provenance before external code can execute', () => {
    const registry = createAgentSkillRegistry();
    expect(() => registry.register({
      id: 'external-skill',
      category: 'security',
      priority: 10,
      provenance: {
        sourceKind: 'vendored',
        repository: 'https://github.com/example/external-skill',
        licenseStatus: 'VERIFIED',
        decision: 'ADAPT',
      },
    }, {
      id: 'external-skill',
      version: '2.0.0',
      stages: ['review'],
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    })).toThrow(/pinned commitSha/);

    expect(() => registry.register({
      id: 'external-skill-2',
      category: 'security',
      priority: 10,
      provenance: {
        sourceKind: 'vendored',
        repository: 'https://github.com/example/external-skill',
        commitSha: 'b'.repeat(40),
        licenseStatus: 'UNKNOWN',
        decision: 'ADAPT',
      },
    }, {
      id: 'external-skill-2',
      version: '2.0.0',
      stages: ['review'],
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    })).not.toThrow();

    expect(registry.inspect().find((item) => item.id === 'external-skill-2')?.executableByProvenance).toBe(false);
  });

  it('blocks required unknown health, unhealthy skills and ambient-network skills', async () => {
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'unknown-health',
      category: 'testing',
      priority: 30,
      healthPolicy: 'required',
      provenance: { sourceKind: 'local', licenseStatus: 'NOT_APPLICABLE', decision: 'ADOPT' },
    }, {
      id: 'unknown-health',
      version: '1.0.0',
      stages: ['verify'],
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    });
    registry.register({
      id: 'unhealthy',
      category: 'testing',
      priority: 20,
      provenance: { sourceKind: 'local', licenseStatus: 'NOT_APPLICABLE', decision: 'ADOPT' },
    }, {
      id: 'unhealthy',
      version: '1.0.0',
      stages: ['verify'],
      health: async () => ({ status: 'unhealthy' }),
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    });
    registry.register({
      id: 'network-required',
      category: 'research',
      priority: 10,
      provenance: { sourceKind: 'local', licenseStatus: 'NOT_APPLICABLE', decision: 'ADOPT' },
    }, {
      id: 'network-required',
      version: '1.0.0',
      stages: ['verify'],
      network: 'required',
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    });

    const resolved = await registry.resolveForStage('verify');
    expect(resolved.map((item) => [item.metadata.id, item.reason])).toEqual([
      ['unknown-health', 'health_required_but_unknown'],
      ['unhealthy', 'unhealthy'],
      ['network-required', 'network_required'],
    ]);
    expect(await registry.definitionsForStage('verify')).toEqual([]);
  });

  it('keeps inspection metadata-only and never serializes executor functions', () => {
    const registry = createAgentSkillRegistry();
    const skill = localSkill('metadata-only');
    registry.register(skill.metadata, skill.definition);
    const encoded = JSON.stringify(registry.inspect());
    expect(encoded).toContain('metadata-only');
    expect(encoded).not.toContain('execute');
    expect(encoded).not.toContain('evidence');
  });

  it('rejects duplicate IDs, unpinned versions and credential-bearing repository URLs', () => {
    const registry = createAgentSkillRegistry();
    const skill = localSkill('duplicate');
    registry.register(skill.metadata, skill.definition);
    expect(() => registry.register(skill.metadata, skill.definition)).toThrow(/already registered/);

    expect(() => registry.register({
      id: 'latest-version',
      category: 'repository',
      priority: 1,
      provenance: { sourceKind: 'local', licenseStatus: 'NOT_APPLICABLE', decision: 'ADOPT' },
    }, {
      id: 'latest-version',
      version: 'latest',
      stages: ['research'],
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    })).toThrow(/pinned semver/);

    expect(() => registry.register({
      id: 'bad-url',
      category: 'research',
      priority: 1,
      provenance: {
        sourceKind: 'external-reference',
        repository: 'https://token@example.com/repo',
        commitSha: 'c'.repeat(40),
        licenseStatus: 'VERIFIED',
        decision: 'REFERENCE_ONLY',
      },
    }, {
      id: 'bad-url',
      version: '1.0.0',
      stages: ['research'],
      execute: async () => ({ evidence: ['x'], consumedTokens: 1 }),
    })).toThrow(/credential-free HTTPS/);
  });
});
