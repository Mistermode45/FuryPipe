import { describe, expect, it } from 'vitest';

import {
  applyCapabilityPlanToPrompt,
  FURY_CAPABILITY_PACK_IDS,
  prepareCapabilityRun,
  resolveFuryCapabilities,
} from '../src/capability-router.js';
import { createAgentSkillRegistry, type SkillCategory } from '../src/skill-registry.js';
import {
  BUILTIN_FURY_PLUGIN_BUNDLES,
  createFuryPluginBundleRegistry,
} from '../src/plugin-bundles.js';

function registerSkill(
  registry: ReturnType<typeof createAgentSkillRegistry>,
  id: string,
  category: SkillCategory,
  stage: 'research' | 'plan' | 'implement' | 'review' | 'verify',
  priority = 100,
) {
  registry.register({
    id,
    category,
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
    stages: [stage],
    health: async () => ({ status: 'healthy' }),
    execute: async () => ({ evidence: [id + '-evidence'], consumedTokens: 1 }),
  });
}

describe('FuryPipe capability router', () => {
  it('defines bounded first-class capability packs for engineering, web, research, learning and business', () => {
    expect(FURY_CAPABILITY_PACK_IDS).toEqual([
      'software-engineering',
      'marketing-website',
      'web-application',
      'research-intelligence',
      'learning-coach',
      'business-launch',
      'business-operations',
      'automation',
      'data-analytics',
    ]);
    expect(new Set(FURY_CAPABILITY_PACK_IDS).size).toBe(FURY_CAPABILITY_PACK_IDS.length);
  });

  it('routes a marketing website request to the complete production-quality stack', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'frontend-production', 'frontend', 'implement', 200);
    registerSkill(skills, 'design-system', 'design', 'plan', 180);
    registerSkill(skills, 'conversion-copy', 'content', 'plan', 170);
    registerSkill(skills, 'marketing-strategy', 'marketing', 'research', 160);
    registerSkill(skills, 'technical-seo', 'seo', 'review', 150);
    registerSkill(skills, 'a11y-review', 'accessibility', 'review', 140);
    registerSkill(skills, 'web-performance', 'performance', 'verify', 130);
    registerSkill(skills, 'security-review', 'security', 'review', 120);
    registerSkill(skills, 'web-tests', 'testing', 'verify', 110);
    registerSkill(skills, 'repo-context', 'repository', 'research', 100);
    registerSkill(skills, 'web-architecture', 'architecture', 'plan', 100);

    const plugins = createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES);
    const plan = await resolveFuryCapabilities({
      objective: 'Crée un site web de marketing professionnel avec SEO, conversion, responsive et Figma.',
      skillRegistry: skills,
      pluginRegistry: plugins,
      enabledPluginIds: ['figma', 'playwright-cli'],
      pluginStates: { exa: 'ready', vercel: 'available' },
    });

    expect(plan.packIds).toContain('marketing-website');
    expect(plan.packIds).toContain('software-engineering');
    expect(plan.requiredSkillCategories).toEqual(expect.arrayContaining([
      'frontend',
      'design',
      'content',
      'marketing',
      'seo',
      'accessibility',
      'performance',
      'security',
      'testing',
      'repository',
      'architecture',
    ]));
    expect(plan.selectedSkillIds).toEqual(expect.arrayContaining([
      'frontend-production',
      'design-system',
      'conversion-copy',
      'marketing-strategy',
      'technical-seo',
      'a11y-review',
      'web-performance',
      'security-review',
      'web-tests',
    ]));
    expect(plan.autoInvokeSkillsByStage).toMatchObject({
      research: expect.arrayContaining(['marketing-strategy']),
      plan: expect.arrayContaining(['design-system', 'conversion-copy']),
      implement: expect.arrayContaining(['frontend-production']),
      review: expect.arrayContaining(['technical-seo', 'a11y-review', 'security-review']),
      verify: expect.arrayContaining(['web-performance', 'web-tests']),
    });
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'conversion-copy-review',
      'wcag-accessibility',
      'technical-seo',
      'core-web-vitals-budget',
      'browser-qa',
    ]));

    const states = Object.fromEntries(plan.pluginActivations.map((plugin) => [plugin.id, plugin.state]));
    expect(states).toMatchObject({
      exa: 'ready',
      context7: 'approval_required',
      figma: 'ready',
      'playwright-cli': 'ready',
      vercel: 'available',
      cloudflare: 'approval_required',
    });
  });

  it('progressively discloses only the best eligible skills and reports missing required categories', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'research-high', 'research', 'research', 200);
    registerSkill(skills, 'research-low', 'research', 'research', 100);
    registerSkill(skills, 'research-third', 'research', 'research', 50);

    skills.register({
      id: 'network-research',
      category: 'research',
      priority: 300,
      provenance: { sourceKind: 'local', licenseStatus: 'NOT_APPLICABLE', decision: 'ADOPT' },
    }, {
      id: 'network-research',
      version: '1.0.0',
      stages: ['research'],
      network: 'required',
      execute: async () => ({ evidence: ['network'], consumedTokens: 1 }),
    });

    const plan = await resolveFuryCapabilities({
      objective: 'Fais une recherche complète avec sources et comparaison.',
      skillRegistry: skills,
      explicitPackIds: ['research-intelligence'],
      maxSkillsPerCategoryPerStage: 2,
    });

    expect(plan.packIds).toEqual(['research-intelligence']);
    expect(plan.autoInvokeSkillsByStage.research).toEqual(['research-high', 'research-low']);
    expect(plan.selectedSkillIds).not.toContain('research-third');
    expect(plan.blockedSkills).toContainEqual({
      id: 'network-research',
      category: 'research',
      reason: 'network_required',
    });
    expect(plan.missingRequiredSkillCategories).toEqual(['context']);
  });

  it('routes business automation to operations plus automation without granting external writes', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'ops-map', 'operations', 'plan');
    registerSkill(skills, 'business-kpis', 'business', 'research');
    registerSkill(skills, 'workflow-safety', 'automation', 'plan');
    registerSkill(skills, 'analytics-review', 'analytics', 'review');
    registerSkill(skills, 'security-review', 'security', 'review');

    const plan = await resolveFuryCapabilities({
      objective: 'Je veux gérer automatiquement mon business, le CRM, la facturation, les KPI et les workflows.',
      skillRegistry: skills,
      pluginRegistry: createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES),
    });

    expect(plan.packIds).toContain('business-operations');
    expect(plan.packIds).toContain('automation');
    expect(plan.requiredSkillCategories).toEqual(expect.arrayContaining([
      'operations', 'business', 'automation', 'analytics', 'architecture', 'testing', 'security',
    ]));
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'approval-for-financial-or-external-write',
      'idempotency',
      'audit-log',
      'retry-policy',
      'rollback-or-compensation',
    ]));
    expect(plan.pluginActivations.every((plugin) => plugin.state !== 'ready')).toBe(true);
  });

  it('injects selected instructions, capability gaps, plugin truth and quality gates into FuryPrompt', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'frontend', 'frontend', 'implement');
    registerSkill(skills, 'testing', 'testing', 'verify');
    registerSkill(skills, 'security', 'security', 'review');

    const plan = await resolveFuryCapabilities({
      objective: 'Build a marketing landing page.',
      skillRegistry: skills,
      pluginRegistry: createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES),
      enabledPluginIds: ['playwright-cli'],
    });

    const prepared = prepareCapabilityRun({
      level: 'ENGINEERING',
      sections: {
        objective: 'Build a marketing landing page.',
      },
    }, plan);

    const compiledInput = applyCapabilityPlanToPrompt({
      level: 'ENGINEERING',
      sections: { objective: 'Build a marketing landing page.' },
    }, plan);

    const encoded = JSON.stringify(compiledInput);
    expect(encoded).toContain('Karpathy');
    expect(encoded).toContain('Pass FuryPipe quality gate: technical-seo');
    expect(encoded).toContain('playwright-cli=ready');
    expect(encoded).toContain('Capability gap:');
    expect(prepared.skills.map((skill) => skill.id)).toEqual(expect.arrayContaining(['frontend', 'testing', 'security']));
    expect(prepared.autoInvokeSkillsByStage).toEqual(plan.autoInvokeSkillsByStage);
  });

  it('rejects unknown explicit packs and impossible skill fan-out', async () => {
    const skills = createAgentSkillRegistry();

    await expect(resolveFuryCapabilities({
      objective: 'anything',
      skillRegistry: skills,
      explicitPackIds: ['not-real' as 'software-engineering'],
    })).rejects.toThrow(/unknown FuryPipe capability pack/);

    await expect(resolveFuryCapabilities({
      objective: 'code',
      skillRegistry: skills,
      maxSkillsPerCategoryPerStage: 99,
    })).rejects.toThrow(/between 1 and 8/);
  });
});
