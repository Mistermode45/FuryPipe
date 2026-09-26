import type { AgentFabricPermission, AgentFabricStageId } from './agent-fabric.js';
import type {
  AgentMcpPlannedCall,
  AgentMcpServerDefinition,
  AgentSkillDefinition,
} from './agent-runtime.js';
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
  FURY_INSTRUCTION_PROFILE_IDS,
  type FuryInstructionProfileId,
} from './instruction-profiles.js';
import type {
  FuryPromptCompileInput,
  FuryPromptSection,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';
import {
  resolveInstructionPlan,
  type FuryInstructionFacetId,
  type FuryInstructionPlan,
} from './instruction-fabric.js';

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
  'minecraft-plugin',
  'minecraft-mod',
  'fivem-resource',
  'game-server-extension',
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
  readonly selectionTrace: readonly FuryExplainableCapabilitySelection[];
}

export interface FuryExplainableCapabilitySelection {
  readonly kind: 'skill' | 'plugin' | 'mcp-server' | 'mcp-tool' | 'model';
  readonly id: string;
  readonly score: number;
  readonly reason: 'explicit-request' | 'family-match' | 'task-relevance';
  readonly requiredPermissions: readonly string[];
  /** Routing metadata never grants runtime authority. */
  readonly executionAuthorized: false;
}

export interface FuryUniversalCapabilityAnalysis {
  /** Stable short identifier chosen by the analyzer, e.g. "legal-research" or "video-production". */
  readonly domainId: string;
  readonly requiredSkillCategories: readonly SkillCategory[];
  readonly optionalSkillCategories?: readonly SkillCategory[];
  /** Explicit specialized skills selected from the registered inventory. */
  readonly preferredSkillIds?: readonly string[];
  readonly instructionProfiles?: readonly FuryInstructionProfileId[];
  readonly pluginBundleIds?: readonly string[];
  readonly qualityGates?: readonly string[];
  readonly autoMcpCallsByStage?: Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>>;
  readonly promptAdditions?: Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;
  /** Explainable metadata shortlist emitted by a governed analyzer. */
  readonly selectionTrace?: readonly FuryExplainableCapabilitySelection[];
}

export interface FuryUniversalCapabilitySkillInventoryItem {
  readonly id: string;
  readonly category: SkillCategory;
  readonly priority: number;
  readonly stages: readonly AgentFabricStageId[];
  readonly permission: AgentFabricPermission;
  readonly network: 'disabled' | 'required';
  readonly description?: string;
}

export interface FuryUniversalCapabilityMcpInventoryItem {
  readonly id: string;
  readonly transport: 'remote-http' | 'stdio';
  readonly readOnlyPreferred: boolean;
  readonly projectScoped: boolean;
  readonly permissions: readonly FuryPluginPermission[];
}

export interface FuryUniversalCapabilityPluginInventoryItem {
  readonly id: string;
  readonly name: string;
  readonly skills: readonly string[];
  readonly permissions: readonly FuryPluginPermission[];
  readonly mcpProfiles: readonly FuryUniversalCapabilityMcpInventoryItem[];
  readonly cliProfileIds: readonly string[];
  readonly providerProfileIds: readonly string[];
}

export interface FuryUniversalCapabilityAnalyzerInput {
  readonly objective: string;
  readonly knownPackIds: readonly FuryCapabilityPackId[];
  readonly availableInstructionProfileIds: readonly FuryInstructionProfileId[];
  readonly availableSkillCategories: readonly SkillCategory[];
  readonly availableSkills: readonly FuryUniversalCapabilitySkillInventoryItem[];
  readonly availablePluginIds: readonly string[];
  readonly availablePlugins: readonly FuryUniversalCapabilityPluginInventoryItem[];
  readonly availableRuntimeMcpServers: readonly {
    readonly id: string;
    readonly allowedMethods: readonly string[];
    readonly network: 'disabled' | 'required';
  }[];
}

export interface FuryUniversalCapabilityAnalyzer {
  analyze(input: FuryUniversalCapabilityAnalyzerInput): Promise<FuryUniversalCapabilityAnalysis>;
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
  readonly dynamicDomainIds: readonly string[];
  readonly matchedScores: Readonly<Record<string, number>>;
  readonly requiredSkillCategories: readonly SkillCategory[];
  readonly optionalSkillCategories: readonly SkillCategory[];
  readonly selectedSkillIds: readonly string[];
  readonly skills: readonly AgentSkillDefinition[];
  readonly autoInvokeSkillsByStage: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  readonly autoInvokeMcpByStage: Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>>;
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
  /** Runtime MCP servers that are actually mounted for this run. */
  readonly runtimeMcpServers?: readonly AgentMcpServerDefinition[];
  readonly explicitPackIds?: readonly FuryCapabilityPackId[];
  /**
   * Optional host-owned semantic analyzer for domains not fully represented by
   * the built-in packs. It selects from the real registered inventory; FuryPipe
   * still validates and gates every returned capability.
   */
  readonly universalAnalyzer?: FuryUniversalCapabilityAnalyzer;
  /** Maximum eligible skills selected per category and stage. Default 2. */
  readonly maxSkillsPerCategoryPerStage?: number;
}

export interface FuryCapabilityRunOptions {
  readonly explicitInstructionFacetIds?: readonly FuryInstructionFacetId[];
  readonly maxInstructionFacets?: number;
  readonly maxInstructionBytes?: number;
}

export interface PreparedCapabilityRun {
  readonly furyPrompt: FuryPromptCompileInput;
  readonly instructionPlan: FuryInstructionPlan;
  readonly skills: readonly AgentSkillDefinition[];
  readonly autoInvokeSkillsByStage: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  readonly autoInvokeMcpByStage: Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>>;
  readonly pluginActivations: readonly CapabilityPluginActivation[];
  readonly qualityGates: readonly string[];
  readonly recommendedSecurityCritical: boolean;
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

  'minecraft-plugin': pack({
    id: 'minecraft-plugin',
    name: 'Minecraft Plugin Engineering',
    triggers: [
      'minecraft plugin', 'plugin minecraft', 'paper plugin', 'papermc plugin',
      'velocity plugin', 'spigot plugin', 'bukkit plugin', 'purpur plugin',
      'paper 1.21', 'velocity proxy plugin',
    ],
    bonusTriggers: [
      'paper', 'papermc', 'velocity', 'spigot', 'bukkit', 'purpur',
      'plugin.yml', 'paper-plugin.yml', 'placeholderapi', 'worldguard',
      'nexo', 'luckperms', 'vault', 'gradle',
    ],
    requiredSkillCategories: [
      'minecraft', 'game-server', 'architecture', 'testing', 'security', 'performance',
    ],
    optionalSkillCategories: [
      'repository', 'debugging', 'documentation', 'context', 'research',
      'data', 'automation',
    ],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp', 'exa'],
    qualityGates: [
      'minecraft-target-platform-and-version',
      'api-and-dependency-compatibility',
      'command-permission-validation',
      'event-lifecycle-review',
      'scheduler-thread-safety',
      'no-blocking-io-on-server-thread',
      'configuration-schema-and-migration',
      'persistent-data-integrity',
      'plugin-messaging-trust-boundary',
      'paper-folia-declaration-consistency',
      'server-boot-smoke',
      'reload-restart-safety',
      'performance-under-player-load',
      'security-review',
    ],
    promptAdditions: {
      role: [
        'Operate as a senior Minecraft server plugin engineer familiar with modern Paper, Velocity and Bukkit-compatible plugin architecture.',
      ],
      plan: [
        'Detect the actual target platform, Minecraft version, Java version, build system, installed plugin APIs, proxy topology, persistence layer and threading model before changing code.',
        'Map commands, permissions, listeners, schedulers, services, storage, configuration, hooks and cross-server messaging before implementation.',
      ],
      constraints: [
        'Use the target server API instead of reflection or NMS unless the requested feature genuinely requires internals and the compatibility cost is documented.',
        'Never block the primary server thread with database, HTTP, filesystem or long-running computation.',
        'Treat player-controlled chat, commands, plugin messages, NBT/PDC-like data and proxy messages as untrusted input.',
        'Do not claim Paper/Folia support unless scheduler and entity/region access patterns actually satisfy that runtime.',
        'Preserve project-specific build constraints and supported server versions already declared by the repository.',
      ],
      acceptanceCriteria: [
        'The plugin must boot on the declared server target, register commands/listeners/services cleanly, enforce permissions, survive restart, and preserve persisted player/project data according to its schema.',
      ],
      verification: [
        'Compile against the declared API, run unit/integration tests, perform a server boot smoke test, inspect startup/shutdown logs, and verify no synchronous blocking path is introduced in hot events or commands.',
      ],
    },
  }),

  'minecraft-mod': pack({
    id: 'minecraft-mod',
    name: 'Minecraft Mod Engineering',
    triggers: [
      'minecraft mod', 'mod minecraft', 'fabric mod', 'fabricmc', 'quilt mod',
      'minecraft fabric', 'mod loader',
    ],
    bonusTriggers: [
      'fabric', 'fabric api', 'mixin', 'datagen', 'networking', 'client mod',
      'server mod', 'resource pack',
    ],
    requiredSkillCategories: [
      'minecraft', 'modding', 'architecture', 'testing', 'security', 'performance',
    ],
    optionalSkillCategories: [
      'repository', 'debugging', 'documentation', 'design', 'research', 'context',
    ],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp', 'exa'],
    qualityGates: [
      'minecraft-loader-and-version-lock',
      'mapping-and-api-compatibility',
      'client-server-side-separation',
      'network-packet-validation',
      'mixin-scope-review',
      'data-generation-reproducibility',
      'resource-registration',
      'performance-review',
      'game-launch-smoke',
      'security-review',
    ],
    promptAdditions: {
      role: [
        'Operate as a senior Minecraft mod engineer with modern Fabric-style loader, networking, rendering and data-generation discipline.',
      ],
      plan: [
        'Identify loader, game version, mappings, Java version, client/server boundaries, networking, registries, mixins and generated data before implementation.',
      ],
      constraints: [
        'Keep client-only code out of dedicated-server execution paths and validate all network payloads crossing the client/server boundary.',
        'Prefer stable loader/API extension points over broad mixins; every mixin must have a narrow documented reason.',
      ],
      verification: [
        'Run compile/tests plus client and dedicated-server launch smoke tests when the changed surface can affect either side.',
      ],
    },
  }),

  'fivem-resource': pack({
    id: 'fivem-resource',
    name: 'FiveM Resource Engineering',
    triggers: [
      'fivem', 'five m', 'cfx.re', 'cfx resource', 'fivem resource',
      'fivem script', 'script fivem', 'fxmanifest', 'txadmin',
    ],
    bonusTriggers: [
      'lua', 'nui', 'onesync', 'server event', 'client event', 'qbcore',
      'esx', 'ox_lib', 'oxmysql',
    ],
    requiredSkillCategories: [
      'game-server', 'modding', 'architecture', 'testing', 'security', 'performance',
    ],
    optionalSkillCategories: [
      'frontend', 'data', 'repository', 'debugging', 'documentation',
      'research', 'context',
    ],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp', 'exa', 'playwright-cli'],
    qualityGates: [
      'fxmanifest-validity',
      'client-server-boundary',
      'network-event-validation',
      'server-authoritative-state',
      'permission-and-identity-checks',
      'database-query-safety',
      'nui-message-validation',
      'resource-start-stop-restart',
      'onesync-compatibility-if-declared',
      'performance-under-player-load',
      'security-review',
    ],
    promptAdditions: {
      role: [
        'Operate as a senior FiveM/Cfx.re resource engineer across server scripts, client scripts, NUI, persistence and multiplayer security.',
      ],
      plan: [
        'Map fxmanifest, client/server/shared scripts, exported APIs, network events, framework dependencies, database access, NUI messages and server authority before implementation.',
      ],
      constraints: [
        'Assume a malicious client can trigger exposed network events; validate authorization, state, values and ownership on the server.',
        'Use local event handlers for same-context events and networked events only when cross-context communication is required.',
        'Do not trust client-provided money, inventory, permissions, positions, entity ownership or business state without server-side validation.',
      ],
      verification: [
        'Validate fxmanifest, start/stop/restart the resource, exercise authorized and unauthorized event paths, inspect server/client logs, and test NUI/browser behavior when present.',
      ],
    },
  }),

  'game-server-extension': pack({
    id: 'game-server-extension',
    name: 'Game Server Extension Engineering',
    triggers: [
      'game server plugin', 'server plugin', 'game plugin', 'server extension',
      'mod server', 'server mod', 'dedicated server plugin',
    ],
    bonusTriggers: [
      'multiplayer', 'plugin', 'mod', 'resource', 'server api', 'game server',
    ],
    requiredSkillCategories: [
      'game-server', 'architecture', 'testing', 'security', 'performance',
    ],
    optionalSkillCategories: [
      'modding', 'repository', 'debugging', 'documentation', 'research', 'context',
    ],
    instructionProfiles: ['karpathy-coding-discipline', 'spec-driven-development'],
    pluginBundleIds: ['context7', 'github-mcp', 'exa'],
    qualityGates: [
      'platform-and-version-detection',
      'server-authoritative-state',
      'lifecycle-start-stop-restart',
      'permission-model',
      'untrusted-client-input',
      'hot-path-performance',
      'persistence-integrity',
      'security-review',
    ],
    promptAdditions: {
      plan: [
        'Identify the game server, extension API, supported versions, lifecycle, networking model, persistence, permissions and hot paths before implementation.',
      ],
      constraints: [
        'Treat all remote/client-controlled input as untrusted and preserve server authority for security-sensitive state.',
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

function chosenPacks(
  objective: string,
  explicit: readonly FuryCapabilityPackId[] | undefined,
  allowDynamicOnly = false,
): {
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
    return allowDynamicOnly
      ? Object.freeze({ packs: Object.freeze([]), scores: Object.freeze({}) })
      : Object.freeze({
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
  if ((selectedIds.has('marketing-website')
      || selectedIds.has('web-application')
      || selectedIds.has('minecraft-plugin')
      || selectedIds.has('minecraft-mod')
      || selectedIds.has('fivem-resource')
      || selectedIds.has('game-server-extension'))
    && !selectedIds.has('software-engineering')) {
    selected.push({ id: 'software-engineering', score: 1 });
    selectedIds.add('software-engineering');
  }
  if (selectedIds.has('business-operations') && !selectedIds.has('automation')) {
    selected.push({ id: 'automation', score: 1 });
    selectedIds.add('automation');
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



function validateAutoMcpPlan(
  value: FuryUniversalCapabilityAnalysis['autoMcpCallsByStage'],
  input: FuryCapabilityResolveInput,
): Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('universal autoMcpCallsByStage must be a stage map');
  }
  const servers = new Map((input.runtimeMcpServers ?? []).map((server) => [server.id, server] as const));
  const output: Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>> = {};
  for (const [rawStage, rawCalls] of Object.entries(value)) {
    if (!STAGES.includes(rawStage as AgentFabricStageId)
      || !Array.isArray(rawCalls)
      || rawCalls.length > 32) {
      throw new Error('universal autoMcpCallsByStage contains an invalid stage or call list');
    }
    const stage = rawStage as AgentFabricStageId;
    const normalized: AgentMcpPlannedCall[] = [];
    const seen = new Set<string>();
    for (const rawCall of rawCalls) {
      if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) {
        throw new Error('universal MCP call is invalid');
      }
      const call = rawCall as AgentMcpPlannedCall;
      if (typeof call.serverId !== 'string' || call.serverId.length < 1 || call.serverId.length > 256
        || typeof call.method !== 'string' || call.method.length < 1 || call.method.length > 256) {
        throw new Error('universal MCP call serverId/method is invalid');
      }
      const server = servers.get(call.serverId);
      if (!server) throw new Error('universal analyzer selected unavailable MCP server: ' + call.serverId);
      if (!server.allowedMethods.includes(call.method)) {
        throw new Error('universal analyzer selected disallowed MCP method: ' + call.serverId + '/' + call.method);
      }
      if (server.network === 'required') {
        throw new Error('universal analyzer selected MCP server requiring disabled network access: ' + call.serverId);
      }
      let paramsJson: string;
      try {
        paramsJson = JSON.stringify(call.params ?? null);
      } catch {
        throw new Error('universal MCP call params must be JSON serializable');
      }
      if (Buffer.byteLength(paramsJson, 'utf8') > 65_536) {
        throw new Error('universal MCP call params exceed 64 KiB');
      }
      const key = call.serverId + '\0' + call.method + '\0' + paramsJson;
      if (seen.has(key)) throw new Error('universal autoMcpCallsByStage contains duplicate calls');
      seen.add(key);
      normalized.push(Object.freeze({
        serverId: call.serverId,
        method: call.method,
        ...(call.params === undefined ? {} : { params: call.params }),
      }));
    }
    output[stage] = Object.freeze(normalized);
  }
  return Object.freeze(output);
}

function validateDynamicAnalysis(
  analysis: FuryUniversalCapabilityAnalysis,
  input: FuryCapabilityResolveInput,
): FuryUniversalCapabilityAnalysis {
  if (!analysis || typeof analysis !== 'object') throw new Error('universal capability analyzer returned invalid output');
  if (typeof analysis.domainId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(analysis.domainId)) {
    throw new Error('universal capability domainId is invalid');
  }
  const skillCategories = new Set<SkillCategory>(input.skillRegistry.inspect().map((item) => item.category));
  const validateCategories = (values: readonly SkillCategory[] | undefined, label: string): readonly SkillCategory[] => {
    if (values === undefined) return Object.freeze([]);
    if (!Array.isArray(values) || values.length > 32 || new Set(values).size !== values.length) {
      throw new Error(label + ' must be a unique bounded category list');
    }
    for (const value of values) {
      if (!skillCategories.has(value) && !SKILL_CATEGORY_SET.has(value)) {
        throw new Error(label + ' contains unknown category: ' + String(value));
      }
    }
    return Object.freeze([...values]);
  };
  const required = validateCategories(analysis.requiredSkillCategories, 'universal requiredSkillCategories');
  const optional = validateCategories(analysis.optionalSkillCategories, 'universal optionalSkillCategories')
    .filter((category) => !required.includes(category));
  const availableSkillIds = new Set(input.skillRegistry.inspect().map((item) => item.id));
  const preferredSkillIds = analysis.preferredSkillIds ?? [];
  if (!Array.isArray(preferredSkillIds)
    || preferredSkillIds.length > 64
    || new Set(preferredSkillIds).size !== preferredSkillIds.length
    || preferredSkillIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 128 || id.includes('\0'))) {
    throw new Error('universal preferredSkillIds must be a unique bounded list');
  }
  for (const id of preferredSkillIds) {
    if (!availableSkillIds.has(id)) {
      throw new Error('universal analyzer selected an unregistered skill: ' + id);
    }
  }
  const knownPlugins = new Set(input.pluginRegistry?.list().map((bundle) => bundle.id) ?? []);
  const pluginIds = analysis.pluginBundleIds ?? [];
  if (!Array.isArray(pluginIds) || pluginIds.length > 32 || new Set(pluginIds).size !== pluginIds.length) {
    throw new Error('universal pluginBundleIds must be a unique bounded list');
  }
  for (const id of pluginIds) {
    if (typeof id !== 'string' || id.length < 1 || id.length > 128 || id.includes('\0')) {
      throw new Error('universal pluginBundleIds contains an invalid id');
    }
    // Unknown IDs are retained as unavailable so the plan truthfully reports
    // the capability gap instead of pretending the integration exists.
    void knownPlugins;
  }
  const profiles = analysis.instructionProfiles ?? [];
  if (!Array.isArray(profiles) || profiles.length > 16 || new Set(profiles).size !== profiles.length) {
    throw new Error('universal instructionProfiles must be a unique bounded list');
  }
  for (const id of profiles) {
    if (!FURY_INSTRUCTION_PROFILE_IDS.includes(id)) {
      throw new Error('universal analyzer returned unknown instruction profile: ' + String(id));
    }
  }
  const quality = analysis.qualityGates ?? [];
  if (!Array.isArray(quality) || quality.length > 64 || new Set(quality).size !== quality.length
    || quality.some((gate) => typeof gate !== 'string' || gate.length < 1 || gate.length > 256 || gate.includes('\0'))) {
    throw new Error('universal qualityGates must be bounded unique text');
  }
  const autoMcpCallsByStage = validateAutoMcpPlan(analysis.autoMcpCallsByStage, input);
  const selectionTrace = analysis.selectionTrace ?? [];
  if (!Array.isArray(selectionTrace) || selectionTrace.length > 64) {
    throw new Error('universal selectionTrace must be a bounded list');
  }
  const seenTrace = new Set<string>();
  const validatedSelectionTrace: FuryExplainableCapabilitySelection[] = [];
  for (const entry of selectionTrace) {
    if (!entry || typeof entry !== 'object') throw new Error('universal selectionTrace entry is invalid');
    if (!['skill','plugin','mcp-server','mcp-tool','model'].includes(entry.kind)
      || typeof entry.id !== 'string'
      || entry.id.length < 1
      || entry.id.length > 256
      || entry.id.includes('\0')
      || typeof entry.score !== 'number'
      || !Number.isFinite(entry.score)
      || entry.score < 0
      || !['explicit-request','family-match','task-relevance'].includes(entry.reason)
      || !Array.isArray(entry.requiredPermissions)
      || entry.requiredPermissions.length > 32
      || entry.requiredPermissions.some((permission) => typeof permission !== 'string' || permission.length < 1 || permission.length > 128 || permission.includes('\0'))
      || entry.executionAuthorized !== false) {
      throw new Error('universal selectionTrace entry is invalid');
    }
    const key = entry.kind + '\u0000' + entry.id;
    if (seenTrace.has(key)) throw new Error('universal selectionTrace contains duplicate capability identities');
    seenTrace.add(key);
    validatedSelectionTrace.push(Object.freeze({
      kind: entry.kind,
      id: entry.id,
      score: entry.score,
      reason: entry.reason,
      requiredPermissions: Object.freeze([...new Set(entry.requiredPermissions)]),
      executionAuthorized: false,
    }));
  }
  const additions = analysis.promptAdditions ?? {};
  for (const [section, values] of Object.entries(additions)) {
    if (!['intent','role','objective','context','inputs','constraints','task','plan','tools','skills','mcp','subagents','outputContract','acceptanceCriteria','verification'].includes(section)
      || !Array.isArray(values)
      || values.length > 32
      || values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 2048 || value.includes('\0'))) {
      throw new Error('universal promptAdditions is invalid');
    }
  }
  return Object.freeze({
    domainId: analysis.domainId,
    requiredSkillCategories: required,
    optionalSkillCategories: Object.freeze(optional),
    preferredSkillIds: Object.freeze([...preferredSkillIds]),
    instructionProfiles: Object.freeze([...profiles]),
    pluginBundleIds: Object.freeze([...pluginIds]),
    qualityGates: Object.freeze([...quality]),
    autoMcpCallsByStage,
    selectionTrace: Object.freeze(validatedSelectionTrace),
    promptAdditions: Object.freeze(Object.fromEntries(
      Object.entries(additions).map(([section, values]) => [section, Object.freeze([...(values ?? [])])]),
    )) as Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>,
  });
}

const SKILL_CATEGORY_SET = new Set<SkillCategory>([
  'repository','debugging','security','architecture','testing','documentation',
  'frontend','design','content','marketing','seo','accessibility','performance',
  'analytics','data','automation','business','sales','operations','finance',
  'minecraft','modding','game-server','research','context','learning',
]);

export async function resolveFuryCapabilities(input: FuryCapabilityResolveInput): Promise<FuryCapabilityPlan> {
  if (!input || typeof input !== 'object' || !input.skillRegistry) {
    throw new Error('capability resolution requires a skill registry');
  }
  const objective = normalizeObjective(input.objective);
  const selected = chosenPacks(objective, input.explicitPackIds, input.universalAnalyzer !== undefined);
  const dynamicAnalysis = input.universalAnalyzer === undefined
    ? undefined
    : validateDynamicAnalysis(await input.universalAnalyzer.analyze({
      objective: input.objective.trim(),
      knownPackIds: FURY_CAPABILITY_PACK_IDS,
      availableInstructionProfileIds: FURY_INSTRUCTION_PROFILE_IDS,
      availableSkillCategories: uniqueOrdered(input.skillRegistry.inspect().map((item) => item.category)),
      availableSkills: Object.freeze(input.skillRegistry.inspect().map((item) => Object.freeze({
        id: item.id,
        category: item.category,
        priority: item.priority,
        stages: item.stages,
        permission: item.permission,
        network: item.network,
      }))),
      availablePluginIds: Object.freeze(input.pluginRegistry?.list().map((bundle) => bundle.id) ?? []),
      availablePlugins: Object.freeze((input.pluginRegistry?.inspect() ?? []).map((plugin) => Object.freeze({
        id: plugin.id,
        name: plugin.name,
        skills: plugin.skills,
        permissions: plugin.permissions,
        mcpProfiles: Object.freeze(plugin.mcpProfiles.map((profile) => Object.freeze({
          id: profile.id,
          transport: profile.transport,
          readOnlyPreferred: profile.readOnlyPreferred,
          projectScoped: profile.projectScoped,
          permissions: profile.permissions,
        }))),
        cliProfileIds: Object.freeze(plugin.cliProfiles.map((profile) => profile.id)),
        providerProfileIds: Object.freeze(plugin.providerProfiles.map((profile) => profile.id)),
      }))),
      availableRuntimeMcpServers: Object.freeze((input.runtimeMcpServers ?? []).map((server) => Object.freeze({
        id: server.id,
        allowedMethods: Object.freeze([...server.allowedMethods]),
        network: server.network ?? 'disabled',
      }))),
    }), input);
  const required = uniqueOrdered([
    ...selected.packs.flatMap((definition) => definition.requiredSkillCategories),
    ...(dynamicAnalysis?.requiredSkillCategories ?? []),
  ]);
  const optional = uniqueOrdered([
    ...selected.packs.flatMap((definition) => definition.optionalSkillCategories),
    ...(dynamicAnalysis?.optionalSkillCategories ?? []),
  ].filter((category) => !required.includes(category)));
  const wanted = new Set<SkillCategory>([...required, ...optional]);
  const maxSkills = input.maxSkillsPerCategoryPerStage ?? 2;
  if (!Number.isSafeInteger(maxSkills) || maxSkills < 1 || maxSkills > 8) {
    throw new RangeError('maxSkillsPerCategoryPerStage must be between 1 and 8');
  }

  const selectedDefinitions = new Map<string, AgentSkillDefinition>();
  const preferredSkillIds = new Set(dynamicAnalysis?.preferredSkillIds ?? []);
  const autoByStage: Partial<Record<AgentFabricStageId, readonly string[]>> = {};
  const blocked = new Map<string, { id: string; category: SkillCategory; reason: SkillResolution['reason'] }>();
  const coveredRequired = new Set<SkillCategory>();

  for (const stage of STAGES) {
    const resolutions = await input.skillRegistry.resolveForStage(stage);
    const perCategory = new Map<SkillCategory, number>();
    const stageIds: string[] = [];

    for (const resolution of resolutions) {
      if (!preferredSkillIds.has(resolution.metadata.id)) continue;
      if (!resolution.eligible || !resolution.definition) {
        if (!blocked.has(resolution.metadata.id)) {
          blocked.set(resolution.metadata.id, Object.freeze({
            id: resolution.metadata.id,
            category: resolution.metadata.category,
            reason: resolution.reason,
          }));
        }
        continue;
      }
      stageIds.push(resolution.definition.id);
      selectedDefinitions.set(resolution.definition.id, resolution.definition);
      if (required.includes(resolution.metadata.category)) coveredRequired.add(resolution.metadata.category);
    }

    for (const resolution of resolutions) {
      const category = resolution.metadata.category;
      if (!wanted.has(category) || preferredSkillIds.has(resolution.metadata.id)) continue;
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

    if (stageIds.length > 32) throw new Error('universal analyzer selected more than 32 skills for one stage');
    if (stageIds.length > 0) autoByStage[stage] = Object.freeze(stageIds);
  }

  const pluginIds = uniqueOrdered([
    ...selected.packs.flatMap((definition) => definition.pluginBundleIds),
    ...(dynamicAnalysis?.pluginBundleIds ?? []),
  ]);
  const pluginActivations = Object.freeze(pluginIds.map((id) => pluginState(id, input)));
  const instructionProfileIds = uniqueOrdered([
    ...selected.packs.flatMap((definition) => definition.instructionProfiles),
    ...(dynamicAnalysis?.instructionProfiles ?? []),
  ]);
  const qualityGates = uniqueOrdered([
    ...selected.packs.flatMap((definition) => definition.qualityGates),
    ...(dynamicAnalysis?.qualityGates ?? []),
  ]);
  const basePromptAdditions = mergePromptAdditions(selected.packs);
  const promptAdditions = dynamicAnalysis?.promptAdditions === undefined
    ? basePromptAdditions
    : Object.freeze(Object.fromEntries(
      [...new Set([
        ...Object.keys(basePromptAdditions),
        ...Object.keys(dynamicAnalysis.promptAdditions),
      ])].map((rawSection) => {
        const section = rawSection as FuryPromptSection;
        return [section, uniqueOrdered([
          ...(basePromptAdditions[section] ?? []),
          ...(dynamicAnalysis.promptAdditions?.[section] ?? []),
        ])];
      }),
    )) as Readonly<Partial<Record<FuryPromptSection, readonly string[]>>>;

  return Object.freeze({
    format: 'furypipe-capability-plan/v1',
    objective: input.objective.trim(),
    packIds: Object.freeze(selected.packs.map((definition) => definition.id)),
    dynamicDomainIds: Object.freeze(dynamicAnalysis ? [dynamicAnalysis.domainId] : []),
    matchedScores: selected.scores,
    requiredSkillCategories: required,
    optionalSkillCategories: optional,
    selectedSkillIds: Object.freeze([...selectedDefinitions.keys()]),
    skills: Object.freeze([...selectedDefinitions.values()]),
    autoInvokeSkillsByStage: Object.freeze(autoByStage),
    autoInvokeMcpByStage: dynamicAnalysis?.autoMcpCallsByStage ?? Object.freeze({}),
    blockedSkills: Object.freeze([...blocked.values()].sort((a, b) => a.id.localeCompare(b.id))),
    missingRequiredSkillCategories: Object.freeze(required.filter((category) => !coveredRequired.has(category))),
    instructionProfileIds,
    pluginActivations,
    qualityGates,
    promptAdditions,
    selectionTrace: dynamicAnalysis?.selectionTrace ?? Object.freeze([]),
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
  options: FuryCapabilityRunOptions = {},
): PreparedCapabilityRun {
  const capabilityPrompt = applyCapabilityPlanToPrompt(furyPrompt, plan);
  const instructionPlan = resolveInstructionPlan({
    objective: plan.objective,
    prompt: capabilityPrompt,
    capabilityPackIds: plan.packIds,
    ...(options.explicitInstructionFacetIds === undefined
      ? {}
      : { explicitFacetIds: options.explicitInstructionFacetIds }),
    ...(options.maxInstructionFacets === undefined
      ? {}
      : { maxFacets: options.maxInstructionFacets }),
    ...(options.maxInstructionBytes === undefined
      ? {}
      : { maxAddedBytes: options.maxInstructionBytes }),
  });
  const qualityGates = uniqueOrdered([
    ...plan.qualityGates,
    ...instructionPlan.qualityGates,
  ]);

  return Object.freeze({
    furyPrompt: instructionPlan.input,
    instructionPlan,
    skills: plan.skills,
    autoInvokeSkillsByStage: plan.autoInvokeSkillsByStage,
    autoInvokeMcpByStage: plan.autoInvokeMcpByStage,
    pluginActivations: plan.pluginActivations,
    qualityGates,
    recommendedSecurityCritical: instructionPlan.recommendedSecurityCritical,
  });
}
