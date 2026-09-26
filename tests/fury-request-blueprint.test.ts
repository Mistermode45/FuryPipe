import { describe, expect, it } from 'vitest';

import { selectFuryCapabilitiesForTask } from '../src/capability-autopilot.js';
import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
} from '../src/capability-index.js';
import {
  createFuryRequestBlueprint,
  FURY_REQUEST_BLUEPRINT_FORMAT,
} from '../src/fury-request-blueprint.js';

describe('Fury Request Blueprint', () => {
  it('separates selected capabilities, advisory MCP and unresolved decisions without granting authority', () => {
    const index = createFuryCapabilityIndex();
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'repository-review',
      name: 'Repository review',
      description: 'Review repository code and tests.',
      families: ['repository'],
      tags: ['review'],
      keywords: ['repository', 'review', 'tests'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'none',
      requiredPermissions: [],
      compatibility: [],
      source: { system: 'skill-registry', sourceId: 'repository-review' },
    });
    const selection = selectFuryCapabilitiesForTask({
      objective: 'Review repository code and tests.',
      index,
    });
    const blueprint = createFuryRequestBlueprint({
      objective: 'Review repository code and tests.',
      profile: { id: 'coding', label: 'Engineering' },
      effort: {
        requested: 'auto',
        recommended: 'medium',
        effective: 'medium',
        reason: 'test',
      },
      communicationStyle: 'CAVEMAN',
      contextMode: 'TEXT_FIRST',
      capabilitySelection: selection,
      instructionFacetIds: ['production-engineering'],
      instructionProfileIds: ['karpathy-coding-discipline'],
      qualityGates: ['tests'],
      mcpSuggestions: [{
        sourceId: 'github',
        source: 'github',
        tool: 'pull_request.read',
        score: 5,
        policy: 'ASK',
        trusted: false,
        needsApproval: true,
        reason: 'advisory only',
      }],
      budgets: {
        skillInstructionBytes: 12 * 1024,
        systemPromptBytes: 28 * 1024,
      },
    });

    expect(blueprint.format).toBe(FURY_REQUEST_BLUEPRINT_FORMAT);
    expect(blueprint.capabilities.selected).toHaveLength(1);
    expect(blueprint.capabilities.selected[0]).toMatchObject({
      kind: 'skill',
      id: 'repository-review',
    });
    expect(blueprint.mcp.advisory[0]).toMatchObject({
      sourceId: 'github',
      needsApproval: true,
    });
    expect(blueprint.unresolved).toEqual(['model', 'agent', 'tool']);
    expect(blueprint.capabilities.executionAuthority).toBe(false);
    expect(blueprint.mcp.executionAuthority).toBe(false);
    expect(blueprint.executionAuthorized).toBe(false);
    expect(JSON.stringify(blueprint)).not.toContain('Review repository code and tests.');
  });

  it('resolves agent and native tool families when the capability plan selects them', () => {
    const index = createFuryCapabilityIndex();
    for (const capability of [
      {
        kind: 'agent' as const,
        id: 'review-agent',
        name: 'Review agent',
        description: 'Review repository changes.',
        families: ['review'],
        tags: ['agent'],
        keywords: ['review', 'repository'],
      },
      {
        kind: 'tool' as const,
        id: 'native/repo-read',
        name: 'Repository read tool',
        description: 'Read repository files.',
        families: ['repository'],
        tags: ['read'],
        keywords: ['repository', 'read'],
      },
      {
        kind: 'model' as const,
        id: 'model/review',
        name: 'Review model',
        description: 'Model for repository review.',
        families: ['review'],
        tags: ['model'],
        keywords: ['review', 'repository'],
      },
    ]) {
      index.upsert({
        format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
        ...capability,
        trust: 'verified',
        license: 'not-applicable',
        health: 'ready',
        riskClass: capability.kind === 'tool' ? 'read' : 'none',
        requiredPermissions: [],
        compatibility: [],
        source: { system: capability.kind === 'model' ? 'model-fabric' : capability.kind === 'tool' ? 'native-tool' : 'host', sourceId: capability.id },
      });
    }

    const selection = selectFuryCapabilitiesForTask({
      objective: 'Review repository files with the review agent and model.',
      index,
      options: {
        minScore: 0,
        maxSelected: 3,
        maxSelectedByKind: { agent: 1, tool: 1, model: 1 },
      },
    });

    const blueprint = createFuryRequestBlueprint({
      objective: 'Review repository files with the review agent and model.',
      profile: { id: 'coding', label: 'Engineering' },
      effort: { requested: 'auto', recommended: 'medium', effective: 'medium', reason: 'test' },
      communicationStyle: 'STANDARD',
      contextMode: 'TEXT_FIRST',
      capabilitySelection: selection,
      instructionFacetIds: [],
      instructionProfileIds: [],
      qualityGates: [],
      mcpSuggestions: [],
      budgets: { skillInstructionBytes: 0, systemPromptBytes: 0 },
    });

    expect(blueprint.capabilities.selected.map((item) => item.kind)).toEqual(expect.arrayContaining(['agent','tool','model']));
    expect(blueprint.unresolved).toEqual([]);
    expect(blueprint.executionAuthorized).toBe(false);
  });

  it('rejects forged selection data', () => {
    expect(() => createFuryRequestBlueprint({
      objective: 'x',
      profile: { id: 'general', label: 'General' },
      effort: {
        requested: 'low',
        recommended: 'low',
        effective: 'low',
        reason: 'test',
      },
      communicationStyle: 'STANDARD',
      contextMode: 'TEXT_FIRST',
      capabilitySelection: {
        format: 'furypipe-capability-selection/v1',
        executionAuthority: false,
      } as never,
      instructionFacetIds: [],
      instructionProfileIds: [],
      qualityGates: [],
      mcpSuggestions: [],
      budgets: { skillInstructionBytes: 0, systemPromptBytes: 0 },
    })).toThrow(/process-local/u);
  });
});
