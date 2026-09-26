// FuryExtensionCatalog — curated metadata for optional FuryPipe capabilities.
//
// This catalog never installs or activates remote code by itself. It is a
// decision surface: operators can inspect what an extension is, where it comes
// from, and which trust boundary applies before importing anything.
export const FURY_EXTENSION_KINDS = Object.freeze([
  'SKILL_PACK',
  'PROMPT_PACK',
  'MODEL_RUNTIME',
  'AI_WORKBENCH',
  'REGISTRY',
  'MCP_APP',
] as const);
export type FuryExtensionKind = typeof FURY_EXTENSION_KINDS[number];

export const FURY_EXTENSION_TRUST = Object.freeze([
  'OFFICIAL_VENDOR',
  'CURATED_COMMUNITY',
  'COMMUNITY',
  'RESTRICTED',
] as const);
export type FuryExtensionTrust = typeof FURY_EXTENSION_TRUST[number];

export type FuryExtensionRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'RESTRICTED';
export type FuryExtensionAutoActivation = 'ELIGIBLE_AFTER_IMPORT' | 'MANUAL_ONLY' | 'DENIED';

export interface FuryExtensionCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly creator: string;
  readonly sourceUrl: string;
  readonly kind: FuryExtensionKind;
  readonly trust: FuryExtensionTrust;
  readonly risk: FuryExtensionRisk;
  readonly autoActivation: FuryExtensionAutoActivation;
  readonly description: string;
  readonly tags: readonly string[];
  readonly integration: string;
  readonly safety: string;
}

const CATALOG: readonly FuryExtensionCatalogEntry[] = Object.freeze([
  Object.freeze({
    id: 'superpowers',
    name: 'Superpowers',
    creator: 'obra / Prime Radiant',
    sourceUrl: 'https://github.com/obra/superpowers',
    kind: 'SKILL_PACK',
    trust: 'CURATED_COMMUNITY',
    risk: 'MEDIUM',
    autoActivation: 'ELIGIBLE_AFTER_IMPORT',
    description: 'Structured software-engineering workflows: planning, TDD, debugging, review, worktrees and verification.',
    tags: Object.freeze(['coding', 'planning', 'testing', 'review', 'debugging', 'worktrees']),
    integration: 'Import selected Agent Skills through Fury Skill Hub, checksum them, pin approved versions, then let Fury Auto select relevant skills.',
    safety: 'Instructions are data, not authority. Imported skills never gain tool, network or script permissions from installation alone.',
  }),
  Object.freeze({
    id: 'ecc',
    name: 'ECC',
    creator: 'affaan-m',
    sourceUrl: 'https://github.com/affaan-m/ECC',
    kind: 'SKILL_PACK',
    trust: 'CURATED_COMMUNITY',
    risk: 'MEDIUM',
    autoActivation: 'ELIGIBLE_AFTER_IMPORT',
    description: 'Multi-harness agents, skills, hooks, rules, memory and verification workflows for coding agents.',
    tags: Object.freeze(['coding', 'agents', 'skills', 'memory', 'security', 'verification', 'codex', 'opencode']),
    integration: 'Import selected skills and instruction assets individually; do not copy hooks or executables without an explicit review.',
    safety: 'Executable hooks and shell helpers require a separate code review and explicit capability approval.',
  }),
  Object.freeze({
    id: 'karpathy-workflows',
    name: 'Karpathy-inspired workflows',
    creator: 'community',
    sourceUrl: 'https://github.com/yshms/karpathy-claude-skills',
    kind: 'PROMPT_PACK',
    trust: 'COMMUNITY',
    risk: 'MEDIUM',
    autoActivation: 'ELIGIBLE_AFTER_IMPORT',
    description: 'Third-party skills inspired by public Andrej Karpathy workflows for coding loops, verification, routing and context engineering.',
    tags: Object.freeze(['coding', 'verification', 'routing', 'context', 'prompting']),
    integration: 'Treat as third-party instructions. Import only the skills that pass Fury Skill Hub validation and pin their content checksum.',
    safety: 'This pack is community-authored and must not be represented as an official Karpathy skill distribution.',
  }),
  Object.freeze({
    id: 'microsoft-skills',
    name: 'Microsoft Agent Skills',
    creator: 'Microsoft',
    sourceUrl: 'https://github.com/microsoft/skills',
    kind: 'SKILL_PACK',
    trust: 'OFFICIAL_VENDOR',
    risk: 'MEDIUM',
    autoActivation: 'ELIGIBLE_AFTER_IMPORT',
    description: 'Official Microsoft skills, agents and MCP configurations for Microsoft and Azure development workflows.',
    tags: Object.freeze(['microsoft', 'azure', 'sdk', 'mcp', 'coding']),
    integration: 'Import individual SKILL.md packages through the same checksum, compatibility and governance path as every other skill.',
    safety: 'Vendor provenance does not bypass local capability policy; MCP configs and executable helpers remain separately governed.',
  }),
  Object.freeze({
    id: 'open-generative-ai',
    name: 'Open Generative AI',
    creator: 'anil-matcha',
    sourceUrl: 'https://github.com/anil-matcha/open-generative-ai',
    kind: 'AI_WORKBENCH',
    trust: 'COMMUNITY',
    risk: 'HIGH',
    autoActivation: 'MANUAL_ONLY',
    description: 'Generative media workbench covering image, video, audio, design and related creative workflows.',
    tags: Object.freeze(['image', 'video', 'audio', 'design', 'creative', 'media']),
    integration: 'Use as a reference or isolated provider/workbench adapter. Do not vendor the application wholesale into Studio.',
    safety: 'A third-party application has a much larger dependency and browser attack surface than a SKILL.md package; require dependency, license and security review before adapter enablement.',
  }),
  Object.freeze({
    id: 'helios',
    name: 'Helios',
    creator: 'PKU-YuanGroup',
    sourceUrl: 'https://github.com/PKU-YuanGroup/Helios',
    kind: 'MODEL_RUNTIME',
    trust: 'CURATED_COMMUNITY',
    risk: 'HIGH',
    autoActivation: 'MANUAL_ONLY',
    description: 'Long-video generation model/runtime for text-to-video, image-to-video and related video generation workloads.',
    tags: Object.freeze(['video', 'generation', 'multimodal', 'gpu', 'model']),
    integration: 'Expose as an optional model runtime/provider adapter with hardware-fit checks and explicit model download consent.',
    safety: 'Large model downloads and GPU execution are never background-installed by Fury Auto.',
  }),
  Object.freeze({
    id: 'claude-red',
    name: 'Claude-Red',
    creator: 'SnailSploit',
    sourceUrl: 'https://github.com/SnailSploit/claude-red',
    kind: 'SKILL_PACK',
    trust: 'RESTRICTED',
    risk: 'RESTRICTED',
    autoActivation: 'DENIED',
    description: 'Offensive-security skill collection spanning reconnaissance, exploitation and post-exploitation topics.',
    tags: Object.freeze(['security', 'red-team', 'pentest', 'offensive']),
    integration: 'Catalog-only by default. Individual defensive or authorized-testing skills may be reviewed and imported manually into a restricted profile.',
    safety: 'Never auto-activate. Execution-capable offensive content requires explicit authorization, sandboxing and tool policy gates.',
  }),
  Object.freeze({
    id: 'mcp-registry',
    name: 'MCP Registry',
    creator: 'Model Context Protocol',
    sourceUrl: 'https://registry.modelcontextprotocol.io/',
    kind: 'REGISTRY',
    trust: 'OFFICIAL_VENDOR',
    risk: 'MEDIUM',
    autoActivation: 'MANUAL_ONLY',
    description: 'Registry discovery surface for MCP servers and ecosystem integrations.',
    tags: Object.freeze(['mcp', 'registry', 'tools', 'integrations']),
    integration: 'Discover candidates, then add an MCP source to the local project config as disabled and untrusted until reviewed.',
    safety: 'Registry presence is not a trust grant. Every server keeps its own source, transport, tool and approval policy.',
  }),
]);

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

export interface FuryExtensionCatalogQuery {
  readonly query?: string;
  readonly kind?: FuryExtensionKind;
  readonly includeRestricted?: boolean;
}

export function listFuryExtensions(query: FuryExtensionCatalogQuery = {}): readonly FuryExtensionCatalogEntry[] {
  const q = normalize(query.query?.trim() ?? '');
  return Object.freeze(CATALOG.filter((entry) => {
    if (query.kind && entry.kind !== query.kind) return false;
    if (!query.includeRestricted && entry.risk === 'RESTRICTED') return false;
    if (!q) return true;
    const haystack = normalize([entry.id, entry.name, entry.creator, entry.description, ...entry.tags].join(' '));
    return q.split(/\s+/u).every((part) => haystack.includes(part));
  }));
}

export function getFuryExtension(id: string): FuryExtensionCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

export const FURY_EXTENSION_CATALOG = CATALOG;
