import { describe, expect, it } from 'vitest';

import { createFuryCapabilityIndex, FURY_CAPABILITY_INDEX_ENTRY_FORMAT } from '../src/capability-index.js';
import { projectSkillsIntoCapabilityIndex } from '../src/capability-index-adapters.js';
import { createFuryCapabilityRouterAutopilot } from '../src/capability-router-autopilot.js';
import { resolveFuryCapabilities } from '../src/capability-router.js';
import { createAgentSkillRegistry } from '../src/skill-registry.js';

function registerSecuritySkill(
  registry: ReturnType<typeof createAgentSkillRegistry>,
  id: string,
  priority: number,
): void {
  registry.register({
    id,
    category: 'security',
    priority,
    provenance: {
      sourceKind: 'local',
      licenseStatus: 'NOT_APPLICABLE',
      decision: 'ADOPT',
    },
    healthPolicy: 'required',
  }, {
    id,
    version: '1.0.0',
    stages: ['review'],
    health: async () => ({ status: 'healthy' }),
    execute: async () => ({ evidence: [id + '-evidence'], consumedTokens: 1 }),
  });
}

describe('Capability Router + Capability Autopilot V2 convergence', () => {
  it('feeds a minimal indexed shortlist into the existing source-of-truth router without granting authority', async () => {
    const skills = createAgentSkillRegistry();
    registerSecuritySkill(skills, 'generic-security-review', 300);
    registerSecuritySkill(skills, 'oauth-token-review', 50);

    const index = createFuryCapabilityIndex();
    projectSkillsIntoCapabilityIndex(index, skills);

    const analyzer = createFuryCapabilityRouterAutopilot({
      index,
      selectionOptions: {
        maxSelected: 1,
        maxSelectedByKind: { skill: 1 },
      },
    });

    const plan = await resolveFuryCapabilities({
      objective: 'Review OAuth token security and authentication boundaries.',
      skillRegistry: skills,
      universalAnalyzer: analyzer,
    });

    expect(plan.dynamicDomainIds).toEqual(['capability-index-autopilot']);
    expect(plan.selectedSkillIds).toContain('oauth-token-review');
    expect(plan.autoInvokeSkillsByStage.review).toContain('oauth-token-review');
  });

  it('fails closed when the indexed shortlist is stale relative to the current router inventory', async () => {
    const index = createFuryCapabilityIndex();
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'stale-security-skill',
      name: 'Stale security skill',
      description: 'Review token security and authentication.',
      families: ['security'],
      tags: ['oauth'],
      keywords: ['token', 'authentication'],
      trust: 'verified',
      license: 'verified',
      health: 'ready',
      riskClass: 'none',
      requiredPermissions: [],
      compatibility: [],
      source: { system: 'skill-registry', sourceId: 'stale-security-skill' },
    });

    const skills = createAgentSkillRegistry();
    const analyzer = createFuryCapabilityRouterAutopilot({
      index,
      selectionOptions: { minScore: 0 },
    });

    await expect(resolveFuryCapabilities({
      objective: 'Review OAuth token security.',
      skillRegistry: skills,
      universalAnalyzer: analyzer,
    })).rejects.toThrow(/stale skill/u);
  });

  it('never turns an indexed MCP selection into an automatic MCP call', async () => {
    const index = createFuryCapabilityIndex();
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'mcp-tool',
      id: 'github/pull_request.read',
      name: 'GitHub pull request read',
      description: 'Read GitHub pull request metadata.',
      families: ['repository'],
      tags: ['github'],
      keywords: ['pull request', 'github'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: ['network'],
      compatibility: [],
      source: { system: 'mcp-host', sourceId: 'github/pull_request.read' },
    });

    const skills = createAgentSkillRegistry();
    const analyzer = createFuryCapabilityRouterAutopilot({
      index,
      availablePermissions: ['network'],
      selectionOptions: { minScore: 0 },
    });

    const plan = await resolveFuryCapabilities({
      objective: 'Read the GitHub pull request metadata.',
      skillRegistry: skills,
      runtimeMcpServers: [{
        id: 'github',
        allowedMethods: ['pull_request.read'],
        execute: async () => ({ ok: true }),
      }],
      universalAnalyzer: analyzer,
    });

    expect(plan.dynamicDomainIds).toEqual(['capability-index-autopilot']);
    expect(plan.autoInvokeMcpByStage).toEqual({});
  });

  it('rejects forged indexes instead of accepting serialized authority-like data', () => {
    expect(() => createFuryCapabilityRouterAutopilot({
      index: {
        snapshot: () => ({ records: [] }),
      } as never,
    })).toThrow(/process-local/u);
  });
});
