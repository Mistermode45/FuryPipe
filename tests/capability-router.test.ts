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
      'minecraft-plugin',
      'minecraft-mod',
      'fivem-resource',
      'game-server-extension',
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

  it('routes Minecraft Paper/Velocity plugin work through specialized server engineering capabilities', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'minecraft-api', 'minecraft', 'research', 220);
    registerSkill(skills, 'server-lifecycle', 'game-server', 'plan', 210);
    registerSkill(skills, 'plugin-architecture', 'architecture', 'plan', 200);
    registerSkill(skills, 'plugin-security', 'security', 'review', 190);
    registerSkill(skills, 'plugin-performance', 'performance', 'verify', 180);
    registerSkill(skills, 'plugin-tests', 'testing', 'verify', 170);
    registerSkill(skills, 'repository-analysis', 'repository', 'research', 160);

    const plan = await resolveFuryCapabilities({
      objective: 'Crée un plugin Minecraft Paper 1.21.8 compatible Velocity avec commandes, permissions, config et stockage.',
      skillRegistry: skills,
      pluginRegistry: createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES),
      enabledPluginIds: ['context7', 'github-mcp'],
    });

    expect(plan.packIds).toContain('minecraft-plugin');
    expect(plan.packIds).toContain('software-engineering');
    expect(plan.requiredSkillCategories).toEqual(expect.arrayContaining([
      'minecraft',
      'game-server',
      'architecture',
      'testing',
      'security',
      'performance',
      'repository',
    ]));
    expect(plan.selectedSkillIds).toEqual(expect.arrayContaining([
      'minecraft-api',
      'server-lifecycle',
      'plugin-architecture',
      'plugin-security',
      'plugin-performance',
      'plugin-tests',
    ]));
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'minecraft-target-platform-and-version',
      'scheduler-thread-safety',
      'no-blocking-io-on-server-thread',
      'paper-folia-declaration-consistency',
      'server-boot-smoke',
    ]));
    const states = Object.fromEntries(plan.pluginActivations.map((plugin) => [plugin.id, plugin.state]));
    expect(states).toMatchObject({
      context7: 'ready',
      'github-mcp': 'ready',
      exa: 'approval_required',
    });
  });

  it('routes Fabric mod work through Minecraft modding and client/server boundary checks', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'minecraft-loader', 'minecraft', 'research');
    registerSkill(skills, 'modding-runtime', 'modding', 'implement');
    registerSkill(skills, 'mod-security', 'security', 'review');
    registerSkill(skills, 'mod-performance', 'performance', 'verify');
    registerSkill(skills, 'mod-tests', 'testing', 'verify');
    registerSkill(skills, 'mod-architecture', 'architecture', 'plan');

    const plan = await resolveFuryCapabilities({
      objective: 'Développe un mod Minecraft Fabric avec networking, datagen et code client/serveur.',
      skillRegistry: skills,
    });

    expect(plan.packIds).toContain('minecraft-mod');
    expect(plan.packIds).toContain('software-engineering');
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'minecraft-loader-and-version-lock',
      'client-server-side-separation',
      'network-packet-validation',
      'mixin-scope-review',
      'game-launch-smoke',
    ]));
  });

  it('routes FiveM resource work through server-authoritative event and NUI security checks', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'game-server-runtime', 'game-server', 'research');
    registerSkill(skills, 'resource-modding', 'modding', 'implement');
    registerSkill(skills, 'resource-security', 'security', 'review');
    registerSkill(skills, 'resource-performance', 'performance', 'verify');
    registerSkill(skills, 'resource-tests', 'testing', 'verify');
    registerSkill(skills, 'resource-architecture', 'architecture', 'plan');

    const plan = await resolveFuryCapabilities({
      objective: 'Crée une resource FiveM avec fxmanifest.lua, événements client/serveur, base de données et NUI.',
      skillRegistry: skills,
      pluginRegistry: createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES),
    });

    expect(plan.packIds).toContain('fivem-resource');
    expect(plan.packIds).toContain('software-engineering');
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'fxmanifest-validity',
      'network-event-validation',
      'server-authoritative-state',
      'database-query-safety',
      'nui-message-validation',
      'resource-start-stop-restart',
    ]));
    expect(plan.requiredSkillCategories).toEqual(expect.arrayContaining([
      'game-server',
      'modding',
      'architecture',
      'testing',
      'security',
      'performance',
    ]));
  });

  it('uses the universal analyzer for a domain with no built-in pack and selects the registered specialist', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'legal-source-research', 'research', 'research', 300);
    registerSkill(skills, 'general-research', 'research', 'research', 100);

    const plan = await resolveFuryCapabilities({
      objective: 'Analyse un contrat commercial français et vérifie les clauses à risque.',
      skillRegistry: skills,
      pluginRegistry: createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES),
      universalAnalyzer: {
        async analyze(input) {
          expect(input.availableSkillCategories).toContain('research');
          return {
            domainId: 'legal-contract-review',
            requiredSkillCategories: ['research'],
            optionalSkillCategories: ['documentation'],
            preferredSkillIds: ['legal-source-research'],
            pluginBundleIds: ['exa', 'legal-mcp-not-installed'],
            qualityGates: [
              'primary-law-source-check',
              'jurisdiction-and-date-check',
              'fact-advice-separation',
              'human-legal-review',
            ],
            promptAdditions: {
              role: ['Operate as a legal research analyst, not as a substitute for licensed counsel.'],
              constraints: ['Separate source-backed legal facts from interpretation and recommendations.'],
            },
          };
        },
      },
    });

    expect(plan.packIds).toEqual([]);
    expect(plan.dynamicDomainIds).toEqual(['legal-contract-review']);
    expect(plan.selectedSkillIds).toContain('legal-source-research');
    expect(plan.autoInvokeSkillsByStage.research).toContain('legal-source-research');
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'primary-law-source-check',
      'jurisdiction-and-date-check',
      'human-legal-review',
    ]));
    const plugins = Object.fromEntries(plan.pluginActivations.map((plugin) => [plugin.id, plugin.state]));
    expect(plugins).toMatchObject({
      exa: 'approval_required',
      'legal-mcp-not-installed': 'unavailable',
    });
  });

  it('rejects a universal analyzer that selects unregistered skills or unsupported prompt sections', async () => {
    const skills = createAgentSkillRegistry();
    registerSkill(skills, 'known-research', 'research', 'research');

    await expect(resolveFuryCapabilities({
      objective: 'Unknown specialist domain.',
      skillRegistry: skills,
      universalAnalyzer: {
        async analyze() {
          return {
            domainId: 'unknown-domain',
            requiredSkillCategories: ['research'],
            preferredSkillIds: ['missing-specialist'],
          };
        },
      },
    })).rejects.toThrow(/unregistered skill/);

    await expect(resolveFuryCapabilities({
      objective: 'Another unknown domain.',
      skillRegistry: skills,
      universalAnalyzer: {
        async analyze() {
          return {
            domainId: 'unknown-domain',
            requiredSkillCategories: ['research'],
            promptAdditions: {
              deployment: ['not a FuryPrompt section'],
            } as never,
          };
        },
      },
    })).rejects.toThrow(/promptAdditions/);
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
    expect(encoded).toContain('Prefer the smallest implementation that satisfies the requested behavior');
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
