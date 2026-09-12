import type { AgentFabricStageId } from './agent-fabric.js';
import type { AgentSkillDefinition } from './agent-runtime.js';
import type {
  AgentSkillRegistry,
  SkillCategory,
  SkillResolution,
} from './skill-registry.js';
import type {
  FuryPluginBundleRegistry,
  FuryPluginPermission,
} from './plugin-bundles.js';
import {
  applyInstructionProfiles,
  type FuryInstructionProfileId,
} from './instruction-profiles.js';
import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';

export const FURY_CAPABILITY_PACK_IDS = Object.freeze([
  'software-engineering',
  'marketing-website',
  'web-application',
  'research-intelligence',
  'learning-coach',
  'business-launch',
  'business-operations',
  'automation',
  'data-analytics',
] as const);

export type FuryCapabilityPackId = typeof FURY_CAPABILITY_PACK_IDS[number];

export interface FuryCapabilityPack {
  readonly id: FuryCapabilityPackId;
  readonly name: string;
  readonly triggers: readonly string[];
  readonly bonusTriggers?: readonly string[];
  readonly requiredSkillCategories: readonly SkillCategory[];
  readonly optionalSkillCategories: readonly SkillCategory[];
  readonly instructionProfiles: readonly FuryInstructionProfileId[];
  readonly pluginBundleIds: readonly string[];
  readonly qualityGates: readonly string[];
  readonly promptAdditions: Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;
}

export type CapabilityPluginState =
  | 'ready'
  | 'available'
  | 'approval_required'
  | 'blocked'
  | 'unavailable';

export interface CapabilityPluginActivation {
  readonly id: string;
  readonly state: CapabilityPluginState;
  readonly permissions: readonly FuryPluginPermission[];
  readonly reason:
    | 'enabled_by_host'
    | 'registered_but_not_enabled'
    | 'host_reported_available'
    | 'host_reported_blocked'
    | 'not_registered';
}

export interface FuryCapabilityPlan {
  readonly format: 'furypipe-capability-plan/v1';
  readonly objective: string;
  readonly packIds: readonly FuryCapabilityPackId[];
  readonly matchedScores: Readonly<Record<string, number>>;
  readonly requiredSkillCategories: readonly SkillCategory[];
  readonly optionalSkillCategories: readonly SkillCategory[];
  readonly selectedSkillIds: readonly string[];
  readonly skills: readonly AgentSkillDefinition[];
  readonly autoInvokeSkillsByStage: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  readonly blockedSkills: readonly {
    readonly id: string;
    readonly category: SkillCategory;
    readonly reason: SkillResolution['reason'];
  }[];
  readonly missingRequiredSkillCategories: readonly SkillCategory[];
  readonly instructionProfileIds: readonly FuryInstructionProfileId[];
  readonly pluginActivations: readonly CapabilityPluginActivation[];
  readonly qualityGates: readonly string[];
  readonly promptAdditions: Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;
}

export interface FuryCapabilityResolveInput {
  readonly objective: string;
  readonly skillRegistry: AgentSkillRegistry;
  readonly pluginRegistry?: FuryPluginBundleRegistry;
  /** Plugins already connected/enabled in the current host. */
  readonly enabledPluginIds?: readonly string[];
  /** Optional host health/availability override. */
  readonly pluginStates?: Readonly<Record<string, 'ready' | 'available' | 'blocked'>>;
  readonly explicitPackIds?: readonly FuryCapabilityPackId[];
  /** Maximum eligible skills selected per category and stage. Default 2. */
  readonly maxSkillsPerCategoryPerStage?: number;
}

export interface PreparedCapabilityRun {
  readonly furyPrompt: FuryPromptCompileInput;
  readonly skills: readonly AgentSkillDefinition[];
  readonly autoInvokeSkillsByStage: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  readonly pluginActivations: readonly CapabilityPluginActivation[];
  readonly qualityGates: readonly string[];
}

const STAGES = ['research', 'plan', 'implement', 'review', 'verify'] as const satisfies readonly AgentFabricStageId[];
const MAX_OBJECTIVE_CHARS = 64_000;

function pack(definition: FuryCapabilityPack): FuryCapabilityPack {
  return Object.freeze({
    ...definition,
    triggers: Object.freeze([...definition.triggers]),
    bonusTriggers: Object.freeze([...(definition.bonusTriggers ?? [])]),
    requiredSkillCategories: Object.freeze([...definition.requiredSkillCategories]),
    optionalSkillCategories: Object.freeze([...definition.optionalSkillCategories]),
    instructionProfiles: Object.freeze([...definition.instructionProfiles]),
    pluginBundleIds: Object.freeze([...definition.pluginBundleIds]),
    qualityGates: Object.freeze([...definition.qualityGates]),
    promptAdditions: Object.freeze(Object.fromEntries(
      Object.entries(definition.promptAdditions).map(([key, values]) => [key, Object.freeze([...(values ?? [])])]),
    )) as FuryCapabilityPack['promptAdditions'],
  });
}

export const FURY_CAPABILITY_PACKS: Readonly<Record<FuryCapabilityPackId, FuryCapabilityPack>> = Object.freeze({
  'software-engineering': pack({
    id: 'software-engineering',
    name: 'Software Engineering',
    triggers: [
      'code', 'coding', 'coder', 'develop', 'developer', 'developper', 'développer',
      'bug', 'debug', 'refactor', 'architecture', 'api', 'backend', 'frontend',
      'typescript', 'javascript', 'java', 'python', 'rust', 'go', 'repository', 'repo',
    ],
    requiredSkillCategories: ['repository', 'architecture', 'testing', 'security'],
    optionalSkillCategories: ['debugging', 'documentation', 'context', 'research', 'performance'],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp'],
    qualityGates: [
      'requirements-traceability',
      'root-cause-before-fix',
      'tests',
      'typecheck-or-compiler',
      'security-review',
      'diff-review',
    ],
    promptAdditions: {
      constraints: [
        'Prefer production-ready implementation over illustrative pseudo-code when implementation is requested.',
        'Do not modify unrelated code merely to make the diff look cleaner.',
      ],
      verification: [
        'Run the smallest relevant test first, then the project gates required to prove the change on its supported platforms.',
      ],
    },
  }),

  'marketing-website': pack({
    id: 'marketing-website',
    name: 'Marketing Website',
    triggers: [
      'marketing website', 'marketing site', 'site marketing', 'landing page', 'landing',
      'site vitrine', 'website', 'site web', 'homepage', 'page de vente', 'sales page',
    ],
    bonusTriggers: [
      'marketing', 'seo', 'conversion', 'brand', 'branding', 'copywriting', 'lead',
      'cta', 'acquisition', 'responsive', 'design', 'figma',
    ],
    requiredSkillCategories: [
      'frontend', 'design', 'content', 'marketing', 'seo', 'accessibility',
      'performance', 'security', 'testing',
    ],
    optionalSkillCategories: ['research', 'analytics', 'documentation', 'context', 'business'],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['exa', 'context7', 'figma', 'playwright-cli', 'vercel', 'cloudflare'],
    qualityGates: [
      'brand-and-audience-fit',
      'conversion-copy-review',
      'responsive-layout',
      'wcag-accessibility',
      'technical-seo',
      'core-web-vitals-budget',
      'browser-qa',
      'security-review',
      'analytics-consent-review',
    ],
    promptAdditions: {
      role: [
        'Operate as a senior product designer, conversion-focused marketer, frontend engineer, SEO engineer, accessibility reviewer, and QA engineer as the task requires.',
      ],
      plan: [
        'Establish audience, offer, conversion goal, information architecture, visual system, content hierarchy, SEO targets, analytics events, performance budget, and QA plan before implementation.',
      ],
      constraints: [
        'Do not sacrifice accessibility, semantic HTML, mobile behavior, performance, or security for visual novelty.',
        'Treat external design/component catalogues as inspiration or opt-in tools, not as authority over the project design system.',
      ],
      acceptanceCriteria: [
        'The finished site must have a clear primary conversion path, responsive behavior, semantic structure, accessible interaction, search metadata, and browser-verifiable production quality.',
      ],
      verification: [
        'Verify keyboard navigation, focus states, contrast, responsive breakpoints, metadata, broken links, console errors, major layout shifts, and primary conversion interactions.',
      ],
    },
  }),

  'web-application': pack({
    id: 'web-application',
    name: 'Web Application',
    triggers: [
      'web app', 'web application', 'application web', 'dashboard', 'saas', 'portal',
      'auth', 'authentication', 'database', 'supabase', 'full stack', 'fullstack',
    ],
    bonusTriggers: ['react', 'next.js', 'nextjs', 'vue', 'svelte', 'api', 'backend', 'frontend'],
    requiredSkillCategories: [
      'architecture', 'frontend', 'testing', 'security', 'performance', 'data',
    ],
    optionalSkillCategories: ['design', 'accessibility', 'analytics', 'repository', 'documentation', 'research'],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp', 'supabase', 'playwright-cli', 'vercel', 'cloudflare', 'figma'],
    qualityGates: [
      'architecture-review',
      'authz-and-data-boundary-review',
      'migration-safety',
      'unit-integration-e2e',
      'accessibility',
      'performance',
      'browser-qa',
      'security-review',
    ],
    promptAdditions: {
      plan: [
        'Define architecture, trust boundaries, data model, APIs, authentication/authorization, migrations, UI states, observability, and deployment before broad implementation.',
      ],
      constraints: [
        'Use least privilege for database, cloud, repository, browser, and external-service integrations.',
      ],
      verification: [
        'Exercise critical user journeys end-to-end and verify authorization failures as well as success paths.',
      ],
    },
  }),

  'research-intelligence': pack({
    id: 'research-intelligence',
    name: 'Research and Intelligence',
    triggers: [
      'research', 'recherche', 'investigate', 'enquête', 'compare', 'benchmark',
      'latest', '2026', 'sources', 'market research', 'veille', 'competitive intelligence',
    ],
    bonusTriggers: ['web', 'internet', 'source', 'evidence', 'citation', 'competitor', 'trend'],
    requiredSkillCategories: ['research', 'context'],
    optionalSkillCategories: ['data', 'analytics', 'business', 'documentation', 'security'],
    instructionProfiles: ['spec-driven-development'],
    pluginBundleIds: ['exa', 'context7', 'github-mcp'],
    qualityGates: [
      'source-quality',
      'freshness-check',
      'cross-source-verification',
      'fact-inference-separation',
      'citation-traceability',
    ],
    promptAdditions: {
      constraints: [
        'Separate observed facts, source claims, calculations, and inference. Do not turn absence of evidence into evidence of absence.',
      ],
      verification: [
        'For time-sensitive claims, verify publication date and event date and prefer current primary sources.',
      ],
    },
  }),

  'learning-coach': pack({
    id: 'learning-coach',
    name: 'Learning and Mastery',
    triggers: [
      'learn', 'learning', 'apprendre', 'teach', 'explain', 'expliquer', 'course',
      'cours', 'study', 'réviser', 'revision', 'practice', 'quiz', 'master',
    ],
    bonusTriggers: ['beginner', 'advanced', 'exercise', 'exercice', 'lesson', 'leçon'],
    requiredSkillCategories: ['learning', 'context'],
    optionalSkillCategories: ['research', 'documentation'],
    instructionProfiles: [],
    pluginBundleIds: ['context7', 'exa'],
    qualityGates: [
      'learner-level-fit',
      'progressive-explanation',
      'active-recall',
      'practice-and-feedback',
      'misconception-correction',
    ],
    promptAdditions: {
      plan: [
        'Assess the learner level and goal, teach in progressive chunks, then use retrieval practice and feedback instead of passive repetition.',
      ],
      verification: [
        'Check understanding with a task or question that requires recall or transfer, not recognition alone.',
      ],
    },
  }),

  'business-launch': pack({
    id: 'business-launch',
    name: 'Business Launch',
    triggers: [
      'create business', 'start business', 'launch business', 'créer une entreprise',
      'creer une entreprise', 'lancer un business', 'business plan', 'startup', 'go to market',
      'go-to-market', 'offer', 'offre', 'pricing', 'market positioning',
    ],
    bonusTriggers: ['market', 'marché', 'customer', 'client', 'competitor', 'revenue', 'brand'],
    requiredSkillCategories: ['business', 'research', 'marketing', 'finance', 'operations'],
    optionalSkillCategories: ['sales', 'analytics', 'automation', 'content', 'seo', 'security'],
    instructionProfiles: ['spec-driven-development'],
    pluginBundleIds: ['exa', 'context7'],
    qualityGates: [
      'problem-customer-evidence',
      'competitive-positioning',
      'offer-and-pricing',
      'unit-economics',
      'go-to-market',
      'legal-and-financial-human-approval',
      'metric-plan',
    ],
    promptAdditions: {
      role: [
        'Operate as a business strategist, market researcher, growth operator, financial planner, and operations designer while separating advice from regulated professional decisions.',
      ],
      constraints: [
        'Do not spend money, create legal commitments, move funds, publish externally, or modify production business systems without explicit authorization.',
      ],
      verification: [
        'Tie recommendations to measurable assumptions, risks, owner decisions, and next validation experiments.',
      ],
    },
  }),

  'business-operations': pack({
    id: 'business-operations',
    name: 'Business Operations',
    triggers: [
      'manage business', 'run business', 'gérer entreprise', 'gerer entreprise',
      'operations', 'crm', 'pipeline', 'sales ops', 'business automation', 'customer support',
      'invoicing', 'invoice', 'facturation', 'kpi', 'reporting',
    ],
    bonusTriggers: ['automatic', 'automatiquement', 'workflow', 'lead', 'revenue', 'support', 'finance'],
    requiredSkillCategories: ['operations', 'business', 'automation', 'analytics'],
    optionalSkillCategories: ['sales', 'finance', 'marketing', 'data', 'security', 'research'],
    instructionProfiles: ['spec-driven-development'],
    pluginBundleIds: ['exa', 'context7'],
    qualityGates: [
      'system-of-record-boundary',
      'idempotency',
      'audit-log',
      'approval-for-financial-or-external-write',
      'kpi-health',
      'failure-recovery',
    ],
    promptAdditions: {
      plan: [
        'Map the business process, system of record, triggers, approvals, failure paths, KPIs, and owner escalation rules before automating it.',
      ],
      constraints: [
        'Business automation must be idempotent where possible and must not send, publish, charge, refund, delete, or mutate critical records without the authorization level required by the host.',
      ],
    },
  }),

  automation: pack({
    id: 'automation',
    name: 'Automation and Workflows',
    triggers: [
      'automation', 'automate', 'automatiser', 'workflow', 'scheduled', 'schedule',
      'cron', 'pipeline', 'orchestration', 'orchestrate', 'agent workflow',
    ],
    bonusTriggers: ['automatic', 'automatically', 'automatique', 'trigger', 'webhook', 'integration'],
    requiredSkillCategories: ['automation', 'architecture', 'testing', 'security'],
    optionalSkillCategories: ['operations', 'data', 'context', 'documentation'],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp'],
    qualityGates: [
      'idempotency',
      'retry-policy',
      'timeout-policy',
      'rollback-or-compensation',
      'audit-log',
      'least-privilege',
      'failure-injection',
    ],
    promptAdditions: {
      constraints: [
        'Automations must expose retries, timeouts, duplicate-event behavior, cancellation, and recovery semantics.',
      ],
    },
  }),

  'data-analytics': pack({
    id: 'data-analytics',
    name: 'Data and Analytics',
    triggers: [
      'analytics', 'analyse data', 'data analysis', 'metrics', 'métriques', 'dashboard data',
      'sql', 'dataset', 'reporting', 'statistics', 'statistiques', 'kpi',
    ],
    bonusTriggers: ['database', 'query', 'conversion rate', 'cohort', 'funnel'],
    requiredSkillCategories: ['data', 'analytics', 'research'],
    optionalSkillCategories: ['business', 'automation', 'security', 'documentation'],
    instructionProfiles: ['spec-driven-development'],
    pluginBundleIds: ['supabase', 'exa', 'context7'],
    qualityGates: [
      'data-lineage',
      'query-correctness',
      'metric-definition',
      'null-and-outlier-review',
      'privacy-review',
      'reproducibility',
    ],
    promptAdditions: {
      constraints: [
        'Define every metric before interpreting it and preserve the distinction between source data, transformation, and conclusion.',
      ],
    },
  }),
});

function normalizeObjective(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_OBJECTIVE_CHARS || value.includes('\0')) {
    throw new Error('capability objective must be bounded non-empty text');
  }
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function phraseScore(objective: string, phrases: readonly string[], weight: number): number {
  let score = 0;
  for (const phrase of phrases) {
    const needle = phrase.normalize('NFKC').toLocaleLowerCase('en-US');
    if (objective.includes(needle)) {
      const specificity = Math.min(3, Math.max(1, needle.split(/\s+/u).length));
      score += weight * specificity;
    }
  }
  return score;
}

function scorePack(objective: string, definition: FuryCapabilityPack): number {
  return phraseScore(objective, definition.triggers, 3)
    + phraseScore(objective, definition.bonusTriggers ?? [], 1);
}

function uniqueOrdered<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function mergePromptAdditions(
  packs: readonly FuryCapabilityPack[],
): Readonly<Partial<Record<FuryPromptSection, readonly string[]>>> {
  const merged = new Map<FuryPromptSection, string[]>();
  for (const definition of packs) {
    for (const [rawSection, additions] of Object.entries(definition.promptAdditions)) {
      if (!additions) continue;
      const section = rawSection as FuryPromptSection;
      const existing = merged.get(section) ?? [];
      for (const addition of additions) {
        if (!existing.includes(addition)) existing.push(addition);
      }
      merged.set(section, existing);
    }
  }
  return Object.freeze(Object.fromEntries(
    [...merged.entries()].map(([section, additions]) => [section, Object.freeze(additions)]),
  )) as Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;
}

function chosenPacks(objective: string, explicit: readonly FuryCapabilityPackId[] | undefined): {
  readonly packs: readonly FuryCapabilityPack[];
  readonly scores: Readonly<Record<string, number>>;
} {
  if (explicit !== undefined) {
    const explicitIds = [...explicit];
    if (explicitIds.length < 1 || explicitIds.length > 5 || new Set(explicitIds).size !== explicitIds.length) {
      throw new Error('explicit capability packs must contain 1 to 5 unique pack IDs');
    }
    for (const id of explicitIds as readonly unknown[]) {
      if (typeof id !== 'string' || !FURY_CAPABILITY_PACK_IDS.includes(id as FuryCapabilityPackId)) {
        throw new Error('unknown FuryPipe capability pack: ' + String(id));
      }
    }
    const validatedIds = explicitIds as FuryCapabilityPackId[];
    return Object.freeze({
      packs: Object.freeze(validatedIds.map((id) => FURY_CAPABILITY_PACKS[id])),
      scores: Object.freeze(Object.fromEntries(validatedIds.map((id) => [id, 1_000_000]))),
    });
  }

  const scored = FURY_CAPABILITY_PACK_IDS
    .map((id) => ({ id, score: scorePack(objective, FURY_CAPABILITY_PACKS[id]) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (scored.length === 0) {
    return Object.freeze({
      packs: Object.freeze([FURY_CAPABILITY_PACKS['software-engineering']]),
      scores: Object.freeze({ 'software-engineering': 0 }),
    });
  }

  const top = scored[0]!.score;
  const selected = scored
    .filter((item, index) => index === 0 || (item.score >= Math.max(3, Math.ceil(top * 0.55))))
    .slice(0, 3);

  // A coding-heavy site/app task benefits from engineering discipline even if
  // the generic pack did not independently score high enough.
  const selectedIds = new Set(selected.map((item) => item.id));
  if ((selectedIds.has('marketing-website') || selectedIds.has('web-application'))
    && !selectedIds.has('software-engineering')) {
    selected.push({ id: 'software-engineering', score: 1 });
  }

  return Object.freeze({
    packs: Object.freeze(selected.map((item) => FURY_CAPABILITY_PACKS[item.id])),
    scores: Object.freeze(Object.fromEntries(scored.map((item) => [item.id, item.score]))),
  });
}

function appendSection(
  sections: FuryPromptSections,
  section: FuryPromptSection,
  values: readonly string[],
): FuryPromptSections {
  if (values.length === 0) return sections;
  const source = sections as Readonly<Record<string, FuryPromptSectionValue | undefined>>;
  const existingRaw = source[section];
  const existing = existingRaw === undefined
    ? []
    : typeof existingRaw === 'string'
      ? [existingRaw]
      : [...existingRaw];
  const merged = [...existing];
  for (const value of values) if (!merged.includes(value)) merged.push(value);
  return Object.freeze({ ...sections, [section]: Object.freeze(merged) }) as FuryPromptSections;
}

function pluginState(
  id: string,
  input: FuryCapabilityResolveInput,
): CapabilityPluginActivation {
  const bundle = input.pluginRegistry?.get(id);
  if (!bundle) {
    return Object.freeze({
      id,
      state: 'unavailable',
      permissions: Object.freeze([]),
      reason: 'not_registered',
    });
  }

  const override = input.pluginStates?.[id];
  if (override === 'blocked') {
    return Object.freeze({
      id,
      state: 'blocked',
      permissions: bundle.permissions,
      reason: 'host_reported_blocked',
    });
  }
  if (override === 'ready' || input.enabledPluginIds?.includes(id)) {
    return Object.freeze({
      id,
      state: 'ready',
      permissions: bundle.permissions,
      reason: 'enabled_by_host',
    });
  }
  if (override === 'available') {
    return Object.freeze({
      id,
      state: 'available',
      permissions: bundle.permissions,
      reason: 'host_reported_available',
    });
  }
  return Object.freeze({
    id,
    state: 'approval_required',
    permissions: bundle.permissions,
    reason: 'registered_but_not_enabled',
  });
}

export async function resolveFuryCapabilities(input: FuryCapabilityResolveInput): Promise<FuryCapabilityPlan> {
  if (!input || typeof input !== 'object' || !input.skillRegistry) {
    throw new Error('capability resolution requires a skill registry');
  }
  const objective = normalizeObjective(input.objective);
  const selected = chosenPacks(objective, input.explicitPackIds);
  const required = uniqueOrdered(selected.packs.flatMap((definition) => definition.requiredSkillCategories));
  const optional = uniqueOrdered(selected.packs.flatMap((definition) => definition.optionalSkillCategories)
    .filter((category) => !required.includes(category)));
  const wanted = new Set<SkillCategory>([...required, ...optional]);
  const maxSkills = input.maxSkillsPerCategoryPerStage ?? 2;
  if (!Number.isSafeInteger(maxSkills) || maxSkills < 1 || maxSkills > 8) {
    throw new RangeError('maxSkillsPerCategoryPerStage must be between 1 and 8');
  }

  const selectedDefinitions = new Map<string, AgentSkillDefinition>();
  const autoByStage: Partial<Record<AgentFabricStageId, readonly string[]>> = {};
  const blocked = new Map<string, { id: string; category: SkillCategory; reason: SkillResolution['reason'] }>();
  const coveredRequired = new Set<SkillCategory>();

  for (const stage of STAGES) {
    const resolutions = await input.skillRegistry.resolveForStage(stage);
    const perCategory = new Map<SkillCategory, number>();
    const stageIds: string[] = [];

    for (const resolution of resolutions) {
      const category = resolution.metadata.category;
      if (!wanted.has(category)) continue;
      if (!resolution.eligible || !resolution.definition) {
        if (!blocked.has(resolution.metadata.id)) {
          blocked.set(resolution.metadata.id, Object.freeze({
            id: resolution.metadata.id,
            category,
            reason: resolution.reason,
          }));
        }
        continue;
      }
      const count = perCategory.get(category) ?? 0;
      if (count >= maxSkills) continue;
      perCategory.set(category, count + 1);
      stageIds.push(resolution.definition.id);
      selectedDefinitions.set(resolution.definition.id, resolution.definition);
      if (required.includes(category)) coveredRequired.add(category);
    }

    if (stageIds.length > 0) autoByStage[stage] = Object.freeze(stageIds);
  }

  const pluginIds = uniqueOrdered(selected.packs.flatMap((definition) => definition.pluginBundleIds));
  const pluginActivations = Object.freeze(pluginIds.map((id) => pluginState(id, input)));
  const instructionProfileIds = uniqueOrdered(selected.packs.flatMap((definition) => definition.instructionProfiles));
  const qualityGates = uniqueOrdered(selected.packs.flatMap((definition) => definition.qualityGates));
  const promptAdditions = mergePromptAdditions(selected.packs);

  return Object.freeze({
    format: 'furypipe-capability-plan/v1',
    objective: input.objective.trim(),
    packIds: Object.freeze(selected.packs.map((definition) => definition.id)),
    matchedScores: selected.scores,
    requiredSkillCategories: required,
    optionalSkillCategories: optional,
    selectedSkillIds: Object.freeze([...selectedDefinitions.keys()]),
    skills: Object.freeze([...selectedDefinitions.values()]),
    autoInvokeSkillsByStage: Object.freeze(autoByStage),
    blockedSkills: Object.freeze([...blocked.values()].sort((a, b) => a.id.localeCompare(b.id))),
    missingRequiredSkillCategories: Object.freeze(required.filter((category) => !coveredRequired.has(category))),
    instructionProfileIds,
    pluginActivations,
    qualityGates,
    promptAdditions,
  });
}

export function applyCapabilityPlanToPrompt(
  input: FuryPromptCompileInput,
  plan: FuryCapabilityPlan,
): FuryPromptCompileInput {
  const profiled = applyInstructionProfiles(input, plan.instructionProfileIds).input;
  let sections = profiled.sections;
  for (const [rawSection, additions] of Object.entries(plan.promptAdditions)) {
    if (!additions) continue;
    sections = appendSection(sections, rawSection as FuryPromptSection, additions);
  }

  sections = appendSection(sections, 'skills', [
    'FuryPipe selected capability packs: ' + plan.packIds.join(', '),
    'Automatically scheduled skills: ' + (plan.selectedSkillIds.join(', ') || 'none available'),
  ]);
  sections = appendSection(sections, 'mcp', [
    'External plugin/MCP activations: ' + plan.pluginActivations
      .map((plugin) => plugin.id + '=' + plugin.state)
      .join(', '),
    'Never claim an external plugin or MCP ran unless the host reports it ready and an execution receipt exists.',
  ]);
  sections = appendSection(sections, 'acceptanceCriteria', [
    ...plan.qualityGates.map((gate) => 'Pass FuryPipe quality gate: ' + gate),
  ]);

  if (plan.missingRequiredSkillCategories.length > 0) {
    sections = appendSection(sections, 'constraints', [
      'Capability gap: no eligible registered skill is available for required categories: '
        + plan.missingRequiredSkillCategories.join(', ')
        + '. Continue with native reasoning where safe, but report the gap instead of claiming the missing skill executed.',
    ]);
  }

  return Object.freeze({ ...profiled, sections });
}

export function prepareCapabilityRun(
  furyPrompt: FuryPromptCompileInput,
  plan: FuryCapabilityPlan,
): PreparedCapabilityRun {
  return Object.freeze({
    furyPrompt: applyCapabilityPlanToPrompt(furyPrompt, plan),
    skills: plan.skills,
    autoInvokeSkillsByStage: plan.autoInvokeSkillsByStage,
    pluginActivations: plan.pluginActivations,
    qualityGates: plan.qualityGates,
  });
}
