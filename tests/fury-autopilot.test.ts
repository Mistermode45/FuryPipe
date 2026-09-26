import { describe, expect, it } from 'vitest';

import { planFuryAutopilot } from '../src/fury-autopilot.js';
import { getFuryExtension, listFuryExtensions } from '../src/fury-extension-catalog.js';

describe('Fury Autopilot', () => {
  it('routes coding work to engineering instructions, skills, visual context and matching MCP without authorizing execution', () => {
    const plan = planFuryAutopilot({
      objective: 'Review this repository code, fix the GitHub CI bug, update tests and verify the diff.',
      selectedSkills: [
        { name: 'systematic-debugging', score: 9.2, reason: 'description_relevance' },
        { name: 'verification-before-completion', score: 7.1, reason: 'description_relevance' },
      ],
      mcpSources: [{
        sourceId: 'project-mcp.github',
        name: 'github',
        enabled: true,
        trusted: true,
        defaultPolicy: 'READ_ONLY',
        health: { ok: true, tools: [{ name: 'pull_request.read', readOnly: true }, { name: 'pull_request.merge', readOnly: false }] },
      }],
    });

    expect(plan.profile.id).toBe('coding');
    expect(plan.contextMode).toBe('VISUAL_COMPRESS_AUTO');
    expect(plan.skills.map((skill) => skill.name)).toContain('systematic-debugging');
    expect(plan.mcp[0]).toMatchObject({ source: 'github', policy: 'READ_ONLY', trusted: true });
    expect(plan.effort.effective).toMatch(/medium|high/u);
    expect(plan.executionAuthorized).toBe(false);
  });

  it('uses Caveman for operational troubleshooting and respects effort overrides', () => {
    const plan = planFuryAutopilot({
      objective: 'PowerShell error while installing the runtime, tell me what command fixes it',
      effort: 'xhigh',
    });
    expect(plan.profile.id).toBe('operations');
    expect(plan.communicationStyle).toBe('CAVEMAN');
    expect(plan.effort).toMatchObject({ requested: 'xhigh', effective: 'xhigh' });
  });

  it('does not select disabled, denied or unrelated MCP sources', () => {
    const plan = planFuryAutopilot({
      objective: 'Search the web for current AI research',
      mcpSources: [
        { sourceId: 'a', name: 'github', enabled: false, trusted: true, defaultPolicy: 'ALLOW' },
        { sourceId: 'b', name: 'web-search', enabled: true, trusted: true, defaultPolicy: 'DENY' },
        { sourceId: 'c', name: 'payments', enabled: true, trusted: true, defaultPolicy: 'ALLOW' },
      ],
    });
    expect(plan.mcp).toEqual([]);
  });

  it('rejects invalid objectives and efforts', () => {
    expect(() => planFuryAutopilot({ objective: '' })).toThrow(/objective/u);
    expect(() => planFuryAutopilot({ objective: 'x', effort: 'turbo' as never })).toThrow(/effort/u);
  });
});

describe('Fury extension catalog', () => {
  it('contains requested 2026 extension families and hides restricted packs by default', () => {
    expect(getFuryExtension('open-generative-ai')?.kind).toBe('AI_WORKBENCH');
    expect(getFuryExtension('helios')?.kind).toBe('MODEL_RUNTIME');
    expect(getFuryExtension('ecc')?.kind).toBe('SKILL_PACK');
    expect(getFuryExtension('superpowers')?.kind).toBe('SKILL_PACK');
    expect(getFuryExtension('karpathy-workflows')?.kind).toBe('PROMPT_PACK');
    expect(listFuryExtensions().some((entry) => entry.id === 'claude-red')).toBe(false);
    expect(listFuryExtensions({ includeRestricted: true }).find((entry) => entry.id === 'claude-red')).toMatchObject({
      trust: 'RESTRICTED',
      autoActivation: 'DENIED',
    });
  });

  it('filters by query and kind', () => {
    expect(listFuryExtensions({ query: 'azure', kind: 'SKILL_PACK' }).map((entry) => entry.id)).toEqual(['microsoft-skills']);
    expect(listFuryExtensions({ query: 'video', includeRestricted: true }).map((entry) => entry.id)).toContain('helios');
  });
});
