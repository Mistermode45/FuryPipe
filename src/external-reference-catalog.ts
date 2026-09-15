export type ExternalReferenceKind = 'github' | 'official-docs' | 'service';
export type ExternalReferenceMode = 'REFERENCE_ONLY' | 'ADAPTER_CANDIDATE' | 'EXTERNAL_OPT_IN';
export type ExternalReferenceLicenseStatus =
  | 'VERIFIED'
  | 'REPORTED'
  | 'COMMERCIAL'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN';

export type ExternalReferenceCapability =
  | 'session-observability'
  | 'code-simplification'
  | 'agent-skills'
  | 'codebase-context'
  | 'video-production'
  | 'codebase-memory'
  | 'agent-personas'
  | 'web-research'
  | 'agent-framework'
  | 'multi-agent-orchestration'
  | 'browser-automation'
  | 'security-testing'
  | 'app-backend'
  | 'ui-design'
  | 'documentation-retrieval'
  | 'provider-gateway'
  | 'skill-standard'
  | 'spec-driven-development'
  | 'memory-backend'
  | 'temporal-knowledge'
  | 'skill-registry'
  | 'api-discovery'
  | 'context-efficiency'
  | 'code-review'
  | 'marketing';

export interface ExternalReferenceEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly kind: ExternalReferenceKind;
  readonly mode: ExternalReferenceMode;
  readonly capabilities: readonly ExternalReferenceCapability[];
  readonly commitSha?: string;
  readonly licenseStatus: ExternalReferenceLicenseStatus;
  readonly licenseSpdx?: string;
  readonly notes: string;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u;

function validateEntry(entry: ExternalReferenceEntry): ExternalReferenceEntry {
  if (!ID.test(entry.id)) throw new Error(`external reference id is invalid: ${entry.id}`);
  if (!entry.name.trim() || entry.name.length > 160 || entry.name.includes('\0')) {
    throw new Error(`external reference name is invalid: ${entry.id}`);
  }
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    throw new Error(`external reference URL is invalid: ${entry.id}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`external reference URL must be credential-free HTTPS: ${entry.id}`);
  }
  if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0
    || new Set(entry.capabilities).size !== entry.capabilities.length) {
    throw new Error(`external reference capabilities are invalid: ${entry.id}`);
  }
  if (!entry.notes.trim() || entry.notes.length > 1024 || entry.notes.includes('\0')) {
    throw new Error(`external reference notes are invalid: ${entry.id}`);
  }
  if (entry.kind === 'github') {
    if (!entry.commitSha || !SHA40.test(entry.commitSha)) {
      throw new Error(`GitHub reference must pin a lowercase 40-character commit SHA: ${entry.id}`);
    }
  } else if (entry.commitSha !== undefined) {
    throw new Error(`non-GitHub reference must not claim a git commit: ${entry.id}`);
  }
  if (entry.licenseSpdx !== undefined && !SPDX.test(entry.licenseSpdx)) {
    throw new Error(`external reference SPDX value is invalid: ${entry.id}`);
  }
  if (entry.licenseStatus === 'VERIFIED' && !entry.licenseSpdx) {
    throw new Error(`verified external reference must declare SPDX: ${entry.id}`);
  }
  if (entry.licenseStatus === 'COMMERCIAL' && entry.mode !== 'REFERENCE_ONLY') {
    throw new Error(`commercial source must remain reference-only: ${entry.id}`);
  }
  return Object.freeze({
    ...entry,
    capabilities: Object.freeze([...entry.capabilities]),
  });
}

function ref(entry: ExternalReferenceEntry): ExternalReferenceEntry {
  return validateEntry(entry);
}

export const EXTERNAL_REFERENCE_CATALOG: readonly ExternalReferenceEntry[] = Object.freeze([
  ref({
    id: 'zoetrope',
    name: 'Zoetrope',
    url: 'https://github.com/furkankly/zoetrope',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['session-observability', 'multi-agent-orchestration'],
    commitSha: 'b1f31dd26bd4e9e513885e39edb78d0850a5d1fe',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Read-only Claude Code/Codex transcript visualization. Candidate for metadata-only session observability ideas, not transcript copying into Control Room.',
  }),
  ref({
    id: 'ponytail',
    name: 'Ponytail',
    url: 'https://github.com/dietrichgebert/ponytail',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['code-simplification', 'agent-skills'],
    commitSha: '356918eba965ee1eac64bd3a7f0dd02108350de5',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Reference for minimal-code/YAGNI discipline and benchmark methodology. FuryPipe keeps its own policy semantics.',
  }),
  ref({
    id: 'addy-agent-skills',
    name: 'Addy Osmani Agent Skills',
    url: 'https://github.com/addyosmani/agent-skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'ui-design', 'browser-automation'],
    commitSha: 'be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Production engineering skill workflows covering spec/plan/build/test/review/ship. Reference only until individual skills are separately reviewed.',
  }),
  ref({
    id: 'graft',
    name: 'Graft',
    url: 'https://github.com/trailhq/Graft',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['codebase-context', 'codebase-memory'],
    commitSha: 'f9e65396e638e517aecae0d731017f53084d70ed',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Context graph and MCP-oriented codebase mapping. Candidate for external context adapter comparisons; no bundled telemetry or hooks.',
  }),
  ref({
    id: 'openmontage',
    name: 'OpenMontage',
    url: 'https://github.com/calesthio/OpenMontage',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['video-production', 'agent-skills'],
    commitSha: '08e2151fa02de28a5d6a312b3d575692bf147ad7',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'AGPL-3.0',
    notes: 'Agentic video-production reference. AGPL source remains reference-only; FuryPipe does not copy or vendor its implementation.',
  }),
  ref({
    id: 'codebase-memory-mcp',
    name: 'Codebase Memory MCP',
    url: 'https://github.com/DeusData/codebase-memory-mcp',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['codebase-memory', 'codebase-context'],
    commitSha: 'b790be3d15d44f0d4629a2c97ddf76c104d80d22',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Local code graph/MCP engine reference. Candidate as an explicit external MCP integration, never silently installed.',
  }),
  ref({
    id: 'agency-agents',
    name: 'Agency Agents',
    url: 'https://github.com/msitarzewski/agency-agents',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-personas', 'multi-agent-orchestration', 'agent-skills'],
    commitSha: '6d29a9b08785a0e49ffc9818bbdd381164c2df5f',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Large specialist-agent catalogue. Reference for role decomposition; FuryPipe does not auto-import agent prompts.',
  }),
  ref({
    id: 'scrapegraph-ai',
    name: 'ScrapeGraphAI',
    url: 'https://github.com/ScrapeGraphAI/Scrapegraph-ai',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['web-research'],
    commitSha: 'c75c8084fae2d4f5ba01a8c218bc1168b67e3569',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Web/data extraction reference. Any future adapter must be explicit, sandboxed and policy-aware; no ambient scraping is enabled.',
  }),
  ref({
    id: 'voltagent',
    name: 'VoltAgent',
    url: 'https://github.com/voltagent/voltagent',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-framework', 'multi-agent-orchestration', 'codebase-memory'],
    commitSha: '44b4c8e4998ce56095b2f0e4eaf1a988f5e6d0de',
    licenseStatus: 'REPORTED',
    notes: 'Repository README reports MIT, but the audit did not resolve a root license file. Reference-only until license provenance is file-verified.',
  }),
  ref({
    id: 'onewave-claude-skills',
    name: 'OneWave Claude Skills',
    url: 'https://github.com/OneWave-AI/claude-skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'multi-agent-orchestration', 'ui-design'],
    commitSha: '82859c0ebaff803889be6ca2efa0834ba8787773',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Large Agent Skills-compatible library. Reference only pending per-skill trust and quality review.',
  }),
  ref({
    id: 'tons-of-skills',
    name: 'Tons of Skills Marketplace',
    url: 'https://github.com/jeremylongshore/tons-of-skills-marketplace',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills'],
    commitSha: 'a58233ed4b9a9fda3ff0d37a304a570f4cc98083',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Large skill marketplace and packaging reference. Individual marketplace entries are not trusted merely because the repository is catalogued.',
  }),
  ref({
    id: 'claude-squad',
    name: 'Claude Squad',
    url: 'https://github.com/smtg-ai/claude-squad',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['multi-agent-orchestration'],
    commitSha: 'ce1ffb4392b01f38e2c4599c7c84d2a93973b138',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'AGPL-3.0',
    notes: 'Worktree/tmux multi-agent orchestration reference. AGPL source remains external/reference-only.',
  }),
  ref({
    id: 'playwright-cli',
    name: 'Microsoft Playwright CLI',
    url: 'https://github.com/microsoft/playwright-cli',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['browser-automation', 'ui-design'],
    commitSha: '655530f6d0dc71a0d6bf46ae165877d3c7311099',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Preferred candidate for token-efficient browser QA in Web Studio. Must remain an optional host adapter, not a mandatory runtime dependency.',
  }),
  ref({
    id: 'strix-claude-code',
    name: 'Strix Claude Code',
    url: 'https://github.com/tghastings/strix-claude-code',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['security-testing', 'browser-automation'],
    commitSha: '55d7a39768ce7c4ff2e1e140114246cfbcaf9ff2',
    licenseStatus: 'UNKNOWN',
    notes: 'Security testing workflow reference only. No automatic offensive tooling, container launch or target scanning is enabled by FuryPipe.',
  }),
  ref({
    id: 'supabase-ai-plugin',
    name: 'Supabase Plugin for AI Coding Agents',
    url: 'https://supabase.com/docs/guides/ai-tools/plugins',
    kind: 'official-docs',
    mode: 'EXTERNAL_OPT_IN',
    capabilities: ['app-backend', 'agent-skills'],
    licenseStatus: 'NOT_APPLICABLE',
    notes: 'Official Supabase plugin documentation for MCP plus agent skills. Connection remains user-authorized and external.',
  }),
  ref({
    id: 'ui-skills',
    name: 'UI Skills',
    url: 'https://www.ui-skills.com',
    kind: 'service',
    mode: 'REFERENCE_ONLY',
    capabilities: ['ui-design', 'agent-skills'],
    licenseStatus: 'UNKNOWN',
    notes: 'Design-engineering catalogue aggregating skills from multiple authors. Individual skill provenance/licence must be reviewed separately.',
  }),
  ref({
    id: 'context7',
    name: 'Context7',
    url: 'https://context7.com/docs/clients/claude-code',
    kind: 'official-docs',
    mode: 'EXTERNAL_OPT_IN',
    capabilities: ['documentation-retrieval', 'agent-skills'],
    licenseStatus: 'NOT_APPLICABLE',
    notes: 'Current-library documentation via CLI/MCP/plugin. Requires explicit external setup/API policy and must not become an implicit network dependency.',
  }),
  ref({
    id: 'horizonx',
    name: 'HorizonX',
    url: 'https://horizonx.so',
    kind: 'service',
    mode: 'REFERENCE_ONLY',
    capabilities: ['ui-design'],
    licenseStatus: 'COMMERCIAL',
    notes: 'Commercial Figma/React/Tailwind design library. Use only as licensed design reference; no copying or vendoring without user-held rights.',
  }),
  ref({
    id: 'omniroute',
    name: 'OmniRoute',
    url: 'https://github.com/diegosouzapw/OmniRoute',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['provider-gateway', 'multi-agent-orchestration'],
    commitSha: '152d95108c9c3d557562311ffed63240a511eb31',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Multi-provider gateway with OpenAI, Anthropic and Gemini compatibility surfaces. Candidate for an explicit Provider Fabric gateway adapter.',
  }),
  ref({
    id: 'multica-karpathy-guidelines',
    name: 'Multica Andrej Karpathy Skills',
    url: 'https://github.com/multica-ai/andrej-karpathy-skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'code-simplification'],
    commitSha: '2c606141936f1eeef17fa3043a72095b4765b9c2',
    licenseStatus: 'REPORTED',
    notes: 'Karpathy-inspired coding discipline: surface assumptions, minimize code, keep diffs surgical and define verifiable goals. README/SKILL/plugin metadata report MIT, but no root LICENSE file was resolved; FuryPipe adapts the behavior into a native instruction profile instead of copying the upstream CLAUDE.md.',
  }),
  ref({
    id: 'agent-skills-standard',
    name: 'Agent Skills Open Standard',
    url: 'https://github.com/agentskills/agentskills',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'skill-standard'],
    commitSha: '69ef37e9424c0a7ea9dd2293b559e43ec8176379',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Open Agent Skills format. FuryPipe adopts format compatibility while preserving its own provenance, permission, health and licence trust gates.',
  }),
  ref({
    id: 'github-spec-kit',
    name: 'GitHub Spec Kit',
    url: 'https://github.com/github/spec-kit',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['spec-driven-development', 'agent-skills', 'multi-agent-orchestration'],
    commitSha: 'd848fb4e18f44640ad6b42e60a280551ee90cdce',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Spec-driven development reference. FuryPipe adapts spec-before-plan-before-task workflow into a native instruction profile rather than importing the toolkit runtime.',
  }),
  ref({
    id: 'mem0',
    name: 'Mem0',
    url: 'https://github.com/mem0ai/mem0',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['memory-backend', 'agent-framework'],
    commitSha: 'c7ee362aff94a369af70f13f2b4f853f6793ff4c',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Optional external memory backend/reference for consolidation semantics. Native FuryPipe Long-Term Memory remains the default durable store.',
  }),
  ref({
    id: 'letta',
    name: 'Letta',
    url: 'https://github.com/letta-ai/letta',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['memory-backend', 'agent-framework'],
    commitSha: '5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Stateful-agent memory architecture reference and optional external adapter. FuryPipe does not replace Agent Fabric or Recovery with Letta by default.',
  }),
  ref({
    id: 'graphiti',
    name: 'Zep Graphiti',
    url: 'https://github.com/getzep/graphiti',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['memory-backend', 'temporal-knowledge'],
    commitSha: 'c035afb7990b6077331a81e98b04efcfd9bf8184',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Temporal knowledge graph candidate for a future semantic/temporal backend behind FuryPipe Knowledge and Long-Term Memory interfaces.',
  }),
  ref({
    id: 'api-evangelist-api-layer',
    name: 'API Evangelist API Layer Profile',
    url: 'https://github.com/api-evangelist/api-layer',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['api-discovery'],
    commitSha: '549115d70ebd9f0163810b1e5fc3a1b264c53df6',
    licenseStatus: 'UNKNOWN',
    notes: 'Archived third-party public profile of APILayer, not an APILayer-operated repository. Useful as API discovery metadata only; no root license was resolved and its Kin/agent-readiness ratings are not FuryPipe verification evidence.',
  }),
  ref({
    id: 'antigravity-awesome-skills',
    name: 'Antigravity Awesome Skills',
    url: 'https://github.com/benjaminasterA/antigravity-awesome-skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'skill-registry', 'multi-agent-orchestration', 'ui-design', 'security-testing'],
    commitSha: 'fa724b5e12b4e77870ab8a85e5e587474d6cee91',
    licenseStatus: 'REPORTED',
    notes: 'Large multi-agent skill catalogue. The repository has an MIT root license, but its attribution ledger contains mixed third-party licenses and terms, so every individual skill requires independent provenance/license/security review before reuse.',
  }),
  ref({
    id: 'skills-re',
    name: 'skills.re Agent Skills Registry',
    url: 'https://skills.re/',
    kind: 'service',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'skill-registry'],
    licenseStatus: 'NOT_APPLICABLE',
    notes: 'Discovery/version/evaluation registry only. A registry entry, signature, install count or editor pick is not FuryPipe execution trust and must never trigger automatic installation or activation.',
  }),
  ref({
    id: 'openai-skills',
    name: 'OpenAI Skills',
    url: 'https://github.com/openai/skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'skill-standard'],
    commitSha: '49f948faa9258a0c61caceaf225e179651397431',
    licenseStatus: 'UNKNOWN',
    notes: 'First-party OpenAI skill source. No repository-wide root LICENSE was resolved in this audit, so terms must be checked per artifact before porting or vendoring.',
  }),
  ref({
    id: 'microsoft-skills',
    name: 'Microsoft Skills',
    url: 'https://github.com/microsoft/skills',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'skill-standard'],
    commitSha: '903dc62b1e4c833235b54db918a9a51cb6d3cc8f',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Official Microsoft Agent Skills source with a verified MIT root license. Candidate for selective, per-skill import through FuryTrust; never bulk-installed.',
  }),
  ref({
    id: 'gemini-skills',
    name: 'Google Gemini Skills',
    url: 'https://github.com/google-gemini/gemini-skills',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'skill-standard'],
    commitSha: '80dd31dda25bbe1410207df0adb3e0d591c2c634',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
    notes: 'Official Gemini skill source with Apache-2.0 root license. Candidate for selective compatibility and provider-specific guidance, subject to per-skill trust review.',
  }),
  ref({
    id: 'supabase-agent-skills',
    name: 'Supabase Agent Skills',
    url: 'https://github.com/supabase/agent-skills',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'app-backend'],
    commitSha: '8331f910845103c08d51f6ca1d86ebb7d1f745e3',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'Official Supabase skill repository with MIT root license. Candidate for selected Postgres/backend guidance without granting database or network authority.',
  }),
  ref({
    id: 'remotion-skills',
    name: 'Remotion Skills',
    url: 'https://github.com/remotion-dev/skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'video-production'],
    commitSha: 'bd566b65d521b40fe92e1f26766e82de9e291693',
    licenseStatus: 'UNKNOWN',
    notes: 'Official Remotion skill source for React video workflows. No root LICENSE was resolved in this audit; review artifact terms before reuse.',
  }),
  ref({
    id: 'voltagent-awesome-agent-skills',
    name: 'VoltAgent Awesome Agent Skills',
    url: 'https://github.com/VoltAgent/awesome-agent-skills',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'skill-registry'],
    commitSha: '8873794bcb26ff5dcf9cd518c87cf5638ca44b92',
    licenseStatus: 'REPORTED',
    notes: 'Curated aggregator with an MIT root repository license, but individual upstream skills retain their own provenance and terms. Discovery only until each artifact is reviewed.',
  }),
  ref({
    id: 'caveman',
    name: 'Caveman',
    url: 'https://github.com/JuliusBrussee/caveman',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'context-efficiency', 'code-simplification'],
    commitSha: '15581d14007fd01fb3f132016741962f34936ca2',
    licenseStatus: 'REPORTED',
    notes: 'Mixed-license repository: its small instruction skill is described as MIT while Engine-linked runtime directories are BSL-1.1. FuryPipe may study concise-output patterns but must not treat repository-wide code as MIT or repeat token-saving claims as verified.',
  }),
  ref({
    id: 'context-mode',
    name: 'Context Mode',
    url: 'https://github.com/mksglu/context-mode',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['context-efficiency', 'codebase-context', 'session-observability'],
    commitSha: 'ba5f5dfd1a0cd3e8a8f812c219d50390ed0a61c8',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Elastic-2.0',
    notes: 'Context-management MCP/runtime licensed under Elastic-2.0. Reference for architecture and benchmark design only; FuryPipe keeps a native context optimizer and does not vendor or silently proxy through it.',
  }),
  ref({
    id: 'tech-debt-skill',
    name: 'Tech Debt Audit Skill',
    url: 'https://github.com/ksimback/tech-debt-skill',
    kind: 'github',
    mode: 'REFERENCE_ONLY',
    capabilities: ['agent-skills', 'code-review', 'codebase-context'],
    commitSha: '5a15c1ca4a929b2759461c218478de391a8bda0f',
    licenseStatus: 'REPORTED',
    notes: 'Codebase-audit method emphasizing orientation, file-line evidence, false-positive review and scoped remediation. README declares MIT but no root LICENSE file was resolved; FuryPipe adapts the method into native instructions without copying upstream text.',
  }),
  ref({
    id: 'ui-ux-pro-max',
    name: 'UI UX Pro Max Skill',
    url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'ui-design'],
    commitSha: '7f69fed6a2717900085f1bc3b263721f8ba025e2',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'MIT design-system and UI/UX skill source. Candidate for selective Web Studio design guidance after per-skill static review.',
  }),
  ref({
    id: 'hallmark',
    name: 'Hallmark',
    url: 'https://github.com/Nutlope/hallmark',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'ui-design', 'code-review'],
    commitSha: '13ac0ec7e148655948100b6396439e481361d690',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'MIT anti-generic-design review skill. Candidate for Web Studio quality checks; reference patterns must not become instructions to copy protected designs.',
  }),
  ref({
    id: 'marketing-skills',
    name: 'Marketing Skills',
    url: 'https://github.com/coreyhaines31/marketingskills',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['agent-skills', 'marketing'],
    commitSha: '5b2c0007766c6a1cf1d53fd8fc73e979e0821022',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'MIT marketing/CRO/SEO/growth skill source. Candidate for selective non-executing marketing instruction profiles; external campaign/account writes require separate explicit authority.',
  }),
  ref({
    id: 'code-review-graph',
    name: 'Code Review Graph',
    url: 'https://github.com/tirth8205/code-review-graph',
    kind: 'github',
    mode: 'ADAPTER_CANDIDATE',
    capabilities: ['code-review', 'codebase-context', 'context-efficiency'],
    commitSha: 'b58668751ab0c7670c078cf7cbd4d1f5b8e54f81',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
    notes: 'MIT graph-oriented code review/context reference. Candidate for codebase-context experiments; external token-reduction claims remain unverified until FuryPipe Benchmark Contract evidence exists.',
  }),

]);

export function inspectExternalReferences(): readonly ExternalReferenceEntry[] {
  return EXTERNAL_REFERENCE_CATALOG.map((entry) => ({
    ...entry,
    capabilities: [...entry.capabilities],
  }));
}

export function referencesByCapability(
  capability: ExternalReferenceCapability,
): readonly ExternalReferenceEntry[] {
  return inspectExternalReferences().filter((entry) => entry.capabilities.includes(capability));
}
