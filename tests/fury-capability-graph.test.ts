import { describe, expect, it } from 'vitest';

import { createFuryCapabilityIndex, FURY_CAPABILITY_INDEX_ENTRY_FORMAT } from '../src/capability-index.js';
import { selectFuryCapabilitiesForTask } from '../src/capability-autopilot.js';
import { buildFuryCapabilityGraph } from '../src/fury-capability-graph.js';
import { createFuryRequestBlueprint } from '../src/fury-request-blueprint.js';

function blueprintFixture() {
  const index = createFuryCapabilityIndex();
  index.upsert({
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'skill',
    id: 'security-review',
    name: 'Security review',
    description: 'Review repository security and authentication.',
    families: ['security'],
    tags: ['review'],
    keywords: ['security', 'authentication', 'repository'],
    trust: 'verified',
    license: 'verified',
    health: 'ready',
    riskClass: 'read',
    requiredPermissions: ['read'],
    compatibility: [],
    source: { system: 'skill-registry', sourceId: 'security-review' },
  });
  index.upsert({
    format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
    kind: 'mcp-server',
    id: 'github',
    name: 'GitHub',
    description: 'GitHub repository MCP source.',
    families: ['repository'],
    tags: ['github'],
    keywords: ['github', 'repository'],
    trust: 'unverified',
    license: 'not-applicable',
    health: 'ready',
    riskClass: 'process',
    requiredPermissions: ['network'],
    compatibility: [],
    source: { system: 'mcp-host', sourceId: 'github' },
  });
  const selection = selectFuryCapabilitiesForTask({
    objective: 'Review repository security with GitHub context',
    index,
    availablePermissions: ['read'],
    options: { minScore: 0, maxSelectedByKind: { skill: 1, 'mcp-server': 1 } },
  });
  return createFuryRequestBlueprint({
    objective: 'Review repository security with GitHub context',
    profile: { id: 'security', label: 'Security' },
    effort: {
      requested: 'auto',
      recommended: 'high',
      effective: 'high',
      reason: 'Security review.',
    },
    communicationStyle: 'STANDARD',
    contextMode: 'TEXT_FIRST',
    capabilitySelection: selection,
    instructionFacetIds: ['security-boundaries'],
    instructionProfileIds: ['strict-security'],
    qualityGates: ['security-review'],
    mcpSuggestions: [{
      sourceId: 'github',
      source: 'github',
      score: 5,
      policy: 'ASK',
      trusted: false,
      needsApproval: true,
      reason: 'Advisory repository source.',
    }],
    budgets: {
      skillInstructionBytes: 12 * 1024,
      systemPromptBytes: 28 * 1024,
    },
  });
}

describe('Fury Capability Graph', () => {
  it('projects request decisions, selected capabilities and blocked candidates without authority', () => {
    const blueprint = blueprintFixture();
    const graph = buildFuryCapabilityGraph(blueprint);

    expect(graph).toMatchObject({
      format: 'furypipe-capability-graph/v1',
      requestDigestSha256: blueprint.objectiveDigestSha256,
      selectionDigestSha256: blueprint.capabilities.selectionDigestSha256,
      authority: 'visualization-only',
      executionAuthorized: false,
    });
    expect(graph.nodes).toContainEqual(expect.objectContaining({
      kind: 'decision',
      family: 'skills',
      executionAuthority: false,
    }));
    expect(graph.nodes).toContainEqual(expect.objectContaining({
      kind: 'capability',
      capabilityId: 'security-review',
      family: 'skills',
      executionAuthority: false,
    }));
    expect(graph.nodes).toContainEqual(expect.objectContaining({
      kind: 'blocked',
      capabilityId: 'github',
      reason: 'trust-unverified',
      executionAuthority: false,
    }));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      kind: 'blocks',
      executionAuthority: false,
    }));
    expect(graph.nodes.every((node) => node.executionAuthority === false)).toBe(true);
    expect(graph.edges.every((edge) => edge.executionAuthority === false)).toBe(true);
  });

  it('is deterministic for the same process-local blueprint', () => {
    const blueprint = blueprintFixture();
    expect(buildFuryCapabilityGraph(blueprint)).toEqual(buildFuryCapabilityGraph(blueprint));
  });

  it('rejects serialized or forged blueprints', () => {
    const serialized = JSON.parse(JSON.stringify(blueprintFixture()));
    expect(() => buildFuryCapabilityGraph(serialized)).toThrow(/process-local/u);
  });
});
