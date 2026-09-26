import type {
  AgentSkillRegistry,
  SkillLicenseStatus,
  SkillSourceDecision,
} from './skill-registry.js';
import type { CapabilityRegistry } from './ecosystem/registry.js';
import type { CapabilityCandidate, CapabilityPermissions, CapabilityType } from './ecosystem/types.js';
import type {
  FuryPluginBundleRegistry,
  FuryPluginPermission,
} from './plugin-bundles.js';
import type {
  ModelFabricEntry,
  ModelFabricRegistry,
} from './core/model-fabric.js';
import type {
  ProviderDefinition,
  ProviderRegistry,
} from './core/provider-fabric.js';
import type {
  FuryKernelToolBridge,
  FuryKernelToolSourceInspection,
  FuryKernelToolSourceSummary,
} from './fury-kernel-tool-bridge-node.js';
import type { McpToolRiskClass } from './mcp-tool-risk.js';
import type { FurySkillEntry, FurySkillHub } from './fury-skill-hub.js';
import type { FuryHarnessDiscovery, FuryHarnessStatus } from './fury-harness-hub.js';
import type { FuryMcpHub, FuryMcpSourceView } from './fury-mcp-hub.js';
import {
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  isGeneratedFuryCapabilityIndex,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexEntryInput,
  type FuryCapabilityIndexHealthState,
  type FuryCapabilityIndexKind,
  type FuryCapabilityIndexLicenseState,
  type FuryCapabilityIndexRiskClass,
  type FuryCapabilityIndexTrustState,
} from './capability-index.js';
import {
  isGeneratedFuryCapabilitySelectionPlan,
  type FuryCapabilitySelectionPlan,
} from './capability-autopilot.js';

export const FURY_CAPABILITY_REVALIDATION_FORMAT =
  'furypipe-capability-revalidation/v1' as const;

export interface FuryCapabilityIndexHealthOverrides {
  readonly skills?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly plugins?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly models?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly providers?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly mcpServers?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
}

export interface FuryCapabilityIndexProjectionReport {
  readonly indexed: number;
  readonly skipped: number;
  readonly source: 'capability-registry' | 'skill-registry' | 'skill-hub' | 'plugin-registry' | 'model-fabric' | 'provider-fabric' | 'harness-hub' | 'mcp-host' | 'mcp-hub';
  readonly authority: 'projection-only';
  readonly executionAuthority: false;
}

export interface FuryCapabilitySelectionRevalidationItem {
  readonly kind: FuryCapabilityIndexKind;
  readonly id: string;
  readonly status: 'current' | 'stale' | 'missing';
  readonly selectedFingerprintSha256: string;
  readonly currentFingerprintSha256?: string;
}

export interface FuryCapabilitySelectionRevalidation {
  readonly format: typeof FURY_CAPABILITY_REVALIDATION_FORMAT;
  readonly selectionDigestSha256: string;
  readonly selectedIndexDigestSha256: string;
  readonly currentIndexDigestSha256: string;
  readonly indexDigestMatches: boolean;
  readonly reselectionRequired: boolean;
  readonly validForExposure: boolean;
  readonly current: number;
  readonly stale: number;
  readonly missing: number;
  readonly items: readonly FuryCapabilitySelectionRevalidationItem[];
  readonly authority: 'revalidation-only';
  readonly executionAuthority: false;
}

const INDEX_HEALTH = new Set<FuryCapabilityIndexHealthState>([
  'ready', 'degraded', 'unavailable', 'blocked', 'unknown',
]);

function uniqueMetadata(
  values: readonly string[],
  maxChars = 128,
): readonly string[] {
  const output = new Map<string, string>();
  for (const value of values) {
    const normalized = value
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('en-US');
    if (
      !normalized
      || normalized.length > maxChars
      || output.has(normalized)
    ) continue;
    output.set(normalized, normalized);
  }
  return Object.freeze([...output.values()]);
}

function validateHealthOverrides(
  value: Readonly<Record<string, FuryCapabilityIndexHealthState>> | undefined,
  label: string,
): Readonly<Record<string, FuryCapabilityIndexHealthState>> {
  if (value === undefined) return Object.freeze({});
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length > 20_000) {
    throw new RangeError(`${label} exceeds its entry bound`);
  }
  const output: Record<string, FuryCapabilityIndexHealthState> = {};
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u.test(name)) {
      throw new TypeError(`${label} contains an invalid capability id`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !INDEX_HEALTH.has(descriptor.value as FuryCapabilityIndexHealthState)
    ) {
      throw new TypeError(`${label} contains unsafe or invalid health state`);
    }
    output[name] = descriptor.value as FuryCapabilityIndexHealthState;
  }
  return Object.freeze(output);
}

function healthOverride(
  record: Readonly<Record<string, FuryCapabilityIndexHealthState>>,
  id: string,
): FuryCapabilityIndexHealthState {
  return record[id] ?? 'unknown';
}

function indexableIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,255}$/u.test(value);
}

function skillTrust(
  decision: SkillSourceDecision,
  executableByProvenance: boolean,
): FuryCapabilityIndexTrustState {
  if (decision === 'REJECT' || decision === 'REFERENCE_ONLY') return 'blocked';
  return executableByProvenance ? 'verified' : 'unverified';
}

function skillLicense(
  status: SkillLicenseStatus,
): FuryCapabilityIndexLicenseState {
  if (status === 'VERIFIED') return 'verified';
  if (status === 'NOT_APPLICABLE') return 'not-applicable';
  return 'unknown';
}

function pluginTrust(
  licenseStatus: 'VERIFIED' | 'NOT_APPLICABLE' | 'UNKNOWN',
): FuryCapabilityIndexTrustState {
  return licenseStatus === 'UNKNOWN' ? 'unverified' : 'verified';
}

function pluginLicense(
  status: 'VERIFIED' | 'NOT_APPLICABLE' | 'UNKNOWN',
): FuryCapabilityIndexLicenseState {
  if (status === 'VERIFIED') return 'verified';
  if (status === 'NOT_APPLICABLE') return 'not-applicable';
  return 'unknown';
}

function pluginRisk(
  permissions: readonly FuryPluginPermission[],
): FuryCapabilityIndexRiskClass {
  if (permissions.includes('provider-management')) return 'admin';
  if (permissions.some((permission) =>
    permission === 'repository-write'
    || permission === 'database-write'
    || permission === 'design-write'
    || permission === 'cloud-write')) {
    return 'write';
  }
  if (permissions.some((permission) =>
    permission === 'network'
    || permission === 'browser'
    || permission === 'process'
    || permission === 'provider-inference')) {
    return 'process';
  }
  if (permissions.length > 0) return 'read';
  return 'none';
}

function modelTrust(entry: ModelFabricEntry): FuryCapabilityIndexTrustState {
  if (entry.provenance.some((item) => item.kind === 'operator_override')) {
    return 'trusted';
  }
  if (entry.provenance.some((item) =>
    item.kind === 'provider_api'
    || item.kind === 'official_family_rule'
    || item.kind === 'openrouter_catalog'
    || item.kind === 'local_profile')) {
    return 'verified';
  }
  if (entry.provenance.some((item) => item.kind === 'runtime_observation')) {
    return 'unverified';
  }
  return 'unknown';
}

function modelFamilies(entry: ModelFabricEntry): readonly string[] {
  const values = new Set<string>([
    'model',
    `provider-${entry.provider}`,
    `lifecycle-${entry.lifecycle}`,
  ]);
  for (const [key, value] of Object.entries(entry.capabilities)) {
    if (value === 'yes') values.add(key.toLocaleLowerCase('en-US'));
  }
  for (const [key, value] of Object.entries(entry.modalities)) {
    if (value === 'yes') values.add(key.toLocaleLowerCase('en-US'));
  }
  return Object.freeze([...values].sort((a, b) => a.localeCompare(b)));
}

function latestModelObservedAt(entry: ModelFabricEntry): string | undefined {
  const evidenceTimestamps = entry.provenance
    .map((item) => item.observedAt)
    .filter((value): value is string =>
      typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const selected = evidenceTimestamps[0] ?? entry.lastObservedAt;
  if (selected === undefined || !Number.isFinite(Date.parse(selected))) {
    return undefined;
  }
  return new Date(Date.parse(selected)).toISOString();
}

function providerHealth(
  provider: ProviderDefinition,
  overrides: Readonly<Record<string, FuryCapabilityIndexHealthState>>,
): FuryCapabilityIndexHealthState {
  if (provider.status !== 'registered') return 'blocked';
  if (provider.availability === 'available') return 'ready';
  if (provider.availability === 'unavailable') return 'unavailable';
  return healthOverride(overrides, provider.id);
}

function providerTrust(provider: ProviderDefinition): FuryCapabilityIndexTrustState {
  if (provider.evidence.some((item) => item.kind === 'live-probe' || item.kind === 'transport-result')) {
    return 'trusted';
  }
  if (provider.evidence.some((item) => item.kind === 'local-contract' || item.kind === 'operator-config')) {
    return 'verified';
  }
  return 'unverified';
}

function harnessHealth(status: FuryHarnessStatus): FuryCapabilityIndexHealthState {
  if (status.versionStatus === 'builtin' || status.versionStatus === 'ok') return 'ready';
  if (status.versionStatus === 'failed' || status.versionStatus === 'timeout') return 'degraded';
  if (status.versionStatus === 'not-installed') return 'unavailable';
  return 'unknown';
}

function harnessTrust(status: FuryHarnessStatus): FuryCapabilityIndexTrustState {
  if (status.definition.evidence === 'BUILTIN' || status.definition.evidence === 'OFFICIAL_FACT') {
    return 'verified';
  }
  if (status.definition.evidence === 'COMMUNITY') return 'unverified';
  return 'unknown';
}

function harnessPermissions(status: FuryHarnessStatus): readonly string[] {
  const permissions = new Set<string>();
  if (status.definition.integrations.includes('native')) return Object.freeze([]);
  if (status.definition.executables.length > 0) permissions.add('process');
  if (status.definition.integrations.includes('a2a')) permissions.add('network');
  if (status.definition.integrations.includes('acp') && status.definition.executables.length === 0) {
    permissions.add('process');
  }
  return Object.freeze([...permissions]);
}

function registryKind(type: CapabilityType): FuryCapabilityIndexKind | undefined {
  switch (type) {
    case 'agent': return 'agent';
    case 'skill': return 'skill';
    case 'skill-pack': return 'skill-pack';
    case 'instruction': return 'instruction';
    case 'plugin': return 'plugin';
    case 'mcp': return 'mcp';
    case 'mcp-server': return 'mcp-server';
    case 'connector':
    case 'database-connector':
    case 'cloud-integration':
      return 'connector';
    case 'tool':
    case 'cli-tool':
    case 'browser-tool':
      return 'tool';
    case 'provider':
    case 'provider-adapter':
      return 'provider';
    case 'model': return 'model';
    case 'workflow': return 'workflow';
    case 'automation': return 'automation';
    case 'memory-backend':
    case 'memory-provider':
      return 'memory-provider';
    case 'search-provider': return 'search-provider';
    case 'browser-provider': return 'browser-provider';
    case 'image-provider': return 'image-provider';
    case 'video-provider': return 'video-provider';
    case 'audio-provider': return 'audio-provider';
    case 'voice-provider': return 'voice-provider';
    case 'embedding-provider': return 'embedding-provider';
    case 'reranker': return 'reranker';
    case 'code-runtime': return 'code-runtime';
    case 'sandbox': return 'sandbox';
    default: return undefined;
  }
}

function registryLicense(candidate: CapabilityCandidate): FuryCapabilityIndexLicenseState {
  return candidate.license.status === 'VERIFIED' ? 'verified' : 'unknown';
}

function registryHealth(candidate: CapabilityCandidate): FuryCapabilityIndexHealthState {
  if (candidate.decision === 'REJECT' || candidate.decision === 'REFERENCE_ONLY') return 'blocked';
  if (candidate.health.status === 'HEALTHY') return 'ready';
  if (candidate.health.status === 'DEGRADED') return 'degraded';
  if (candidate.health.status === 'UNHEALTHY') return 'unavailable';
  return 'unknown';
}

function registryTrust(
  registry: CapabilityRegistry,
  candidate: CapabilityCandidate,
): FuryCapabilityIndexTrustState {
  if (candidate.decision === 'REJECT' || candidate.decision === 'REFERENCE_ONLY') return 'blocked';
  const report = registry.getTrustReport(candidate.id);
  if (!report) return 'unknown';
  if (report.verdict === 'TRUSTED') return 'trusted';
  if (report.verdict === 'AUDITED') return 'verified';
  if (report.verdict === 'RESTRICTED' || report.verdict === 'QUARANTINED' || report.verdict === 'BLOCKED') return 'blocked';
  return 'unknown';
}

function registryRisk(permissions: CapabilityPermissions): FuryCapabilityIndexRiskClass {
  if (
    permissions.credentials === 'manage'
    || permissions.database === 'admin'
    || permissions.cloud === 'admin'
    || permissions.filesystem === 'delete'
    || permissions.filesystem === 'arbitrary-write'
    || permissions.subprocess === 'arbitrary'
    || permissions.network === 'arbitrary'
    || permissions.externalWrites.includes('admin')
    || permissions.externalWrites.includes('financial')
    || permissions.externalWrites.includes('deploy')
  ) return 'admin';
  if (
    permissions.filesystem === 'write'
    || permissions.database === 'scoped-write'
    || permissions.cloud === 'scoped-write'
    || permissions.externalWrites.length > 0
  ) return 'write';
  if (
    permissions.network !== 'none'
    || permissions.subprocess !== 'none'
    || permissions.provider !== 'none'
    || permissions.browser === 'interact'
  ) return 'process';
  if (
    permissions.filesystem === 'read'
    || permissions.credentials !== 'none'
    || permissions.database === 'read'
    || permissions.browser === 'read'
    || permissions.cloud === 'read'
  ) return 'read';
  return 'none';
}

function registryPermissions(permissions: CapabilityPermissions): readonly string[] {
  const values = new Set<string>();
  if (permissions.network !== 'none') values.add('network');
  if (permissions.filesystem === 'read') values.add('filesystem-read');
  if (permissions.filesystem === 'write' || permissions.filesystem === 'delete' || permissions.filesystem === 'arbitrary-write') values.add('filesystem-write');
  if (permissions.subprocess !== 'none') values.add('process');
  if (permissions.credentials !== 'none') values.add('credentials');
  if (permissions.database === 'read') values.add('database-read');
  if (permissions.database === 'scoped-write' || permissions.database === 'admin') values.add('database-write');
  if (permissions.browser === 'read') values.add('browser-read');
  if (permissions.browser === 'interact') values.add('browser-interact');
  if (permissions.provider === 'invoke') values.add('provider-inference');
  if (permissions.provider === 'configure') values.add('provider-management');
  if (permissions.cloud === 'read') values.add('cloud-read');
  if (permissions.cloud === 'scoped-write' || permissions.cloud === 'admin') values.add('cloud-write');
  for (const write of permissions.externalWrites) values.add(`external-write:${write}`);
  return Object.freeze([...values]);
}

function mcpRisk(risk: McpToolRiskClass): FuryCapabilityIndexRiskClass {
  switch (risk) {
    case 'trusted_read_only_closed_world':
    case 'trusted_read_only_open_world':
      return 'read';
    case 'trusted_mutating_additive':
      return 'write';
    case 'trusted_mutating_destructive':
      return 'admin';
    case 'untrusted_unknown':
    default:
      return 'unknown';
  }
}

function sourcePermission(
  summary: FuryKernelToolSourceSummary,
): 'process' | 'network' {
  return summary.transport === 'stdio' ? 'process' : 'network';
}

function mcpSourceTrust(
  summary: FuryKernelToolSourceSummary,
): FuryCapabilityIndexTrustState {
  return summary.trust === 'trusted' ? 'verified' : 'unverified';
}

function mcpInspectionMap(
  inspections: readonly FuryKernelToolSourceInspection[] | undefined,
): ReadonlyMap<string, FuryKernelToolSourceInspection> {
  const output = new Map<string, FuryKernelToolSourceInspection>();
  for (const inspection of inspections ?? []) {
    if (
      !inspection
      || inspection.format !== 'furypipe-kernel-tool-bridge/v1'
      || inspection.connected !== true
      || inspection.healthy !== true
      || inspection.listed !== true
      || inspection.executionAuthority !== false
    ) {
      throw new Error('Capability Autopilot MCP inspection evidence is invalid');
    }
    if (output.has(inspection.source.sourceId)) {
      throw new Error('Capability Autopilot MCP inspections must be unique per source');
    }
    output.set(inspection.source.sourceId, inspection);
  }
  return output;
}

function requireIndex(index: FuryCapabilityIndex): FuryCapabilityIndex {
  if (!isGeneratedFuryCapabilityIndex(index)) {
    throw new TypeError(
      'Capability Autopilot projection requires a process-local FuryPipe index',
    );
  }
  return index;
}

function put(
  index: FuryCapabilityIndex,
  entry: FuryCapabilityIndexEntryInput,
): void {
  index.upsert(entry);
}

export function projectCapabilityRegistryIntoIndex(
  index: FuryCapabilityIndex,
  registry: CapabilityRegistry,
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const candidates = registry.list();
  let indexed = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const kind = registryKind(candidate.type);
    if (!kind || !indexableIdentity(candidate.id)) {
      skipped += 1;
      continue;
    }
    const revision = candidate.source.contentSha256
      ?? candidate.commitSha
      ?? candidate.version
      ?? candidate.source.version;
    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind,
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      families: uniqueMetadata([
        candidate.type,
        ...candidate.categories,
        ...candidate.domains,
        ...candidate.capabilities,
      ]),
      tags: uniqueMetadata([
        `decision-${candidate.decision}`,
        `integration-${candidate.integrationMode}`,
        `provenance-${candidate.provenance.classification}`,
        `pin-${candidate.source.pinStatus}`,
      ]),
      keywords: uniqueMetadata([
        candidate.name,
        candidate.publisher ?? '',
        ...candidate.authors,
        ...candidate.categories,
        ...candidate.capabilities,
        ...candidate.domains,
      ], 160),
      trust: registryTrust(registry, candidate),
      license: registryLicense(candidate),
      health: registryHealth(candidate),
      riskClass: registryRisk(candidate.permissions),
      requiredPermissions: registryPermissions(candidate.permissions),
      compatibility: uniqueMetadata([
        ...candidate.supportedPlatforms,
        ...candidate.supportedModels,
        ...candidate.supportedLanguages,
        ...candidate.supportedStages,
      ]),
      source: {
        system: 'other',
        sourceId: candidate.id,
        ...(revision === undefined ? {} : { sourceRevision: revision }),
        ...(candidate.lastAuditedAt === undefined ? {} : { observedAt: candidate.lastAuditedAt }),
      },
    });
    indexed += 1;
  }
  return Object.freeze({
    indexed,
    skipped,
    source: 'capability-registry' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectSkillsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: AgentSkillRegistry,
  health: FuryCapabilityIndexHealthOverrides['skills'] = {},
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const inspections = registry.inspect();
  const validatedHealth = validateHealthOverrides(health, 'skill health overrides');
  for (const skill of inspections) {
    const permissions = new Set<string>([skill.permission]);
    if (skill.network === 'required') permissions.add('network');

    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: skill.id,
      name: skill.id.replace(/[._-]+/gu, ' '),
      description:
        `Registered skill ${skill.id}; category ${skill.category}; stages ${skill.stages.join(', ')}; version ${skill.version}.`,
      families: uniqueMetadata([skill.category]),
      tags: uniqueMetadata([...skill.stages, `health-${skill.healthPolicy}`]),
      keywords: uniqueMetadata([skill.id, skill.category, ...skill.stages]),
      trust: skillTrust(skill.provenance.decision, skill.executableByProvenance),
      license: skillLicense(skill.provenance.licenseStatus),
      health: healthOverride(validatedHealth, skill.id),
      riskClass: skill.permission === 'scoped-write' ? 'write' : 'read',
      requiredPermissions: [...permissions],
      compatibility: [],
      source: {
        system: 'skill-registry',
        sourceId: skill.id,
        sourceRevision: skill.provenance.commitSha ?? skill.version,
      },
    });
  }
  return Object.freeze({
    indexed: inspections.length,
    skipped: 0,
    source: 'skill-registry' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}


function skillHubHealth(skill: FurySkillEntry): FuryCapabilityIndexHealthState {
  if (!skill.enabled || skill.pinMismatch) return 'blocked';
  return 'ready';
}

function skillHubTrust(skill: FurySkillEntry): FuryCapabilityIndexTrustState {
  return skill.trust === 'trusted-instructions' ? 'verified' : 'unverified';
}

/**
 * Project Studio's progressive instruction Skill Hub into the same process-local
 * Capability Index used by Capability Autopilot.
 *
 * This only reads already-discovered metadata/checksums. It does not activate a
 * skill, load its instruction body into the turn, execute allowed-tools, or
 * grant runtime authority.
 */
export async function projectSkillHubIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  hub: FurySkillHub,
): Promise<FuryCapabilityIndexProjectionReport> {
  requireIndex(index);
  const view = await hub.list();
  let indexed = 0;
  let skipped = 0;
  for (const skill of view.skills) {
    if (!indexableIdentity(skill.name)) {
      skipped += 1;
      continue;
    }
    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: skill.name,
      name: skill.name.replace(/[._-]+/gu, ' '),
      description: skill.description,
      families: uniqueMetadata(['skill', skill.scope, skill.type]),
      tags: uniqueMetadata([
        `scope-${skill.scope}`,
        `type-${skill.type}`,
        `governance-${skill.governance}`,
        skill.pinMismatch ? 'pin-mismatch' : 'pin-current',
      ]),
      keywords: uniqueMetadata([skill.name, skill.description], 160),
      trust: skillHubTrust(skill),
      // Runtime activation does not redistribute the local skill. Import/install
      // governance remains the place that audits third-party licensing.
      license: 'not-applicable',
      health: skillHubHealth(skill),
      riskClass: 'none',
      requiredPermissions: [],
      compatibility: uniqueMetadata(skill.compatibleHarnesses),
      source: {
        system: 'skill-registry',
        sourceId: skill.name,
        sourceRevision: skill.checksum,
      },
    });
    indexed += 1;
  }
  return Object.freeze({
    indexed,
    skipped,
    source: 'skill-hub' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

function mcpHubPermission(source: FuryMcpSourceView): 'process' | 'network' {
  return source.transport === 'stdio' ? 'process' : 'network';
}

function mcpHubHealth(source: FuryMcpSourceView): FuryCapabilityIndexHealthState {
  if (!source.enabled || source.defaultPolicy === 'DENY') return 'blocked';
  if (source.health?.ok === true) return 'ready';
  if (source.health?.ok === false) return 'unavailable';
  return 'unknown';
}

function mcpHubTrust(source: FuryMcpSourceView): FuryCapabilityIndexTrustState {
  return source.trusted ? 'verified' : 'unverified';
}

function mcpHubToolRisk(
  tool: NonNullable<FuryMcpSourceView['health']>['tools'][number],
): FuryCapabilityIndexRiskClass {
  if (tool.readOnly) return 'read';
  if (/destructive|delete|admin/iu.test(tool.riskClass)) return 'admin';
  return /write|mutat/iu.test(tool.riskClass) ? 'write' : 'unknown';
}

/**
 * Project Studio's MCP Hub inventory without starting a configured process or
 * issuing a network probe. Only tools already present in stored health evidence
 * are indexed.
 */
export async function projectMcpHubIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  hub: FuryMcpHub,
): Promise<FuryCapabilityIndexProjectionReport> {
  requireIndex(index);
  const view = await hub.list();
  let indexed = 0;
  let skipped = 0;
  for (const source of view.sources) {
    if (!indexableIdentity(source.sourceId)) {
      skipped += 1;
      continue;
    }
    const permission = mcpHubPermission(source);
    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'mcp-server',
      id: source.sourceId,
      name: source.name,
      description:
        `Configured Studio MCP source ${source.name}; transport ${source.transport}; locality ${source.locality}; live tool inventory is ${source.health?.ok === true ? 'available' : 'not-verified'}.`,
      families: uniqueMetadata(['mcp', source.locality, source.transport]),
      tags: uniqueMetadata([
        `transport-${source.transport}`,
        `locality-${source.locality}`,
        `policy-${source.defaultPolicy}`,
        source.trusted ? 'trusted' : 'untrusted',
      ]),
      keywords: uniqueMetadata([source.sourceId, source.name, 'mcp'], 160),
      trust: mcpHubTrust(source),
      license: 'not-applicable',
      health: mcpHubHealth(source),
      riskClass: source.transport === 'stdio' ? 'process' : 'read',
      requiredPermissions: [permission],
      compatibility: [],
      source: {
        system: 'mcp-host',
        sourceId: source.sourceId,
        ...(source.health?.at === undefined
          ? {}
          : { observedAt: new Date(source.health.at).toISOString() }),
      },
    });
    indexed += 1;

    if (source.health?.ok !== true) continue;
    for (const tool of source.health.tools) {
      const id = `${source.sourceId}/${tool.name}`;
      if (!indexableIdentity(id)) {
        skipped += 1;
        continue;
      }
      put(index, {
        format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
        kind: 'mcp-tool',
        id,
        name: tool.name,
        description:
          `Probed Studio MCP tool ${tool.name} from ${source.name}; risk ${tool.riskClass}; selection never grants execution authority.`,
        families: uniqueMetadata(['mcp', 'tool']),
        tags: uniqueMetadata([
          `risk-${tool.riskClass}`,
          tool.readOnly ? 'read-only' : 'mutation-or-unknown',
          `policy-${source.toolPolicies[tool.name] ?? source.defaultPolicy}`,
        ]),
        keywords: uniqueMetadata([source.sourceId, source.name, tool.name, 'mcp tool'], 160),
        trust: mcpHubTrust(source),
        license: 'not-applicable',
        health: 'ready',
        riskClass: mcpHubToolRisk(tool),
        requiredPermissions: [permission],
        compatibility: [],
        source: {
          system: 'mcp-host',
          sourceId: id,
          sourceRevision: `${source.health.at}:${tool.riskClass}:${tool.readOnly ? 'ro' : 'rw'}`,
          observedAt: new Date(source.health.at).toISOString(),
        },
      });
      indexed += 1;
    }
  }

  return Object.freeze({
    indexed,
    skipped,
    source: 'mcp-hub' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectPluginsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: FuryPluginBundleRegistry,
  health: FuryCapabilityIndexHealthOverrides['plugins'] = {},
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const inspections = registry.inspect();
  const validatedHealth = validateHealthOverrides(health, 'plugin health overrides');
  for (const plugin of inspections) {
    const families = new Set<string>(['plugin']);
    if (plugin.mcpProfiles.length > 0) families.add('mcp');
    if (plugin.cliProfiles.length > 0) families.add('cli');
    if (plugin.providerProfiles.length > 0) families.add('provider');
    for (const skill of plugin.skills) families.add(`skill-${skill}`);

    const tags = [
      'external-opt-in',
      ...plugin.mcpProfiles.map((profile) => `mcp-${profile.transport}`),
      ...plugin.permissions.map((permission) => `permission-${permission}`),
    ];

    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'plugin',
      id: plugin.id,
      name: plugin.name,
      description:
        `Registered opt-in plugin ${plugin.name}; skills ${plugin.skills.length}; MCP profiles ${plugin.mcpProfiles.length}; CLI profiles ${plugin.cliProfiles.length}; provider profiles ${plugin.providerProfiles.length}.`,
      families: uniqueMetadata([...families]),
      tags: uniqueMetadata(tags),
      keywords: uniqueMetadata([plugin.id, plugin.name, ...plugin.skills]),
      trust: pluginTrust(plugin.source.licenseStatus),
      license: pluginLicense(plugin.source.licenseStatus),
      health: healthOverride(validatedHealth, plugin.id),
      riskClass: pluginRisk(plugin.permissions),
      requiredPermissions: plugin.permissions,
      compatibility: [],
      source: {
        system: 'plugin-registry',
        sourceId: plugin.id,
        sourceRevision: plugin.source.commitSha ?? plugin.version,
      },
    });
  }
  return Object.freeze({
    indexed: inspections.length,
    skipped: 0,
    source: 'plugin-registry' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectHarnessesIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  discovery: FuryHarnessDiscovery,
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  if (
    !discovery
    || discovery.format !== 'furypipe-harness-discovery/v1'
    || !Array.isArray(discovery.harnesses)
  ) {
    throw new TypeError('harness projection requires FuryPipe discovery evidence');
  }
  let indexed = 0;
  let skipped = 0;
  for (const status of discovery.harnesses) {
    if (!indexableIdentity(status.id)) {
      skipped += 1;
      continue;
    }
    const permissions = harnessPermissions(status);
    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'agent',
      id: status.id,
      name: status.displayName,
      description:
        `Agent runtime ${status.displayName}; installed ${status.installed}; version status ${status.versionStatus}; authentication not probed.`,
      families: uniqueMetadata(['agent', 'harness', ...status.definition.integrations, ...status.definition.protocols]),
      tags: uniqueMetadata([
        `evidence-${status.definition.evidence}`,
        `version-${status.versionStatus}`,
        ...Object.entries(status.definition.capabilities)
          .filter(([, value]) => value === true)
          .map(([key]) => `capability-${key}`),
      ]),
      keywords: uniqueMetadata([status.id, status.displayName, ...status.definition.integrations, ...status.definition.protocols]),
      trust: harnessTrust(status),
      license: 'not-applicable',
      health: harnessHealth(status),
      riskClass: permissions.length === 0 ? 'none' : 'process',
      requiredPermissions: permissions,
      compatibility: uniqueMetadata([discovery.platform, ...status.definition.protocols]),
      source: {
        system: 'host',
        sourceId: status.id,
        ...(status.version === undefined ? {} : { sourceRevision: status.version }),
      },
    });
    indexed += 1;
  }
  return Object.freeze({
    indexed,
    skipped,
    source: 'harness-hub' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectProvidersIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: ProviderRegistry,
  health: FuryCapabilityIndexHealthOverrides['providers'] = {},
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const entries = registry.list();
  const validatedHealth = validateHealthOverrides(health, 'provider health overrides');
  let indexed = 0;
  let skipped = 0;
  for (const provider of entries) {
    if (!indexableIdentity(provider.id)) {
      skipped += 1;
      continue;
    }
    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'provider',
      id: provider.id,
      name: provider.id,
      description:
        `Registered provider ${provider.id}; protocol ${provider.protocol}; availability ${provider.availability}. No provider call is performed by capability projection.`,
      families: uniqueMetadata(['provider', provider.protocol]),
      tags: uniqueMetadata([
        `status-${provider.status}`,
        `availability-${provider.availability}`,
        ...provider.aliases.map((alias) => `alias-${alias}`),
      ]),
      keywords: uniqueMetadata([provider.id, provider.protocol, ...provider.aliases]),
      trust: providerTrust(provider),
      license: 'not-applicable',
      health: providerHealth(provider, validatedHealth),
      riskClass: 'process',
      requiredPermissions: ['provider-inference'],
      compatibility: uniqueMetadata([provider.protocol]),
      source: {
        system: 'host',
        sourceId: provider.id,
      },
    });
    indexed += 1;
  }
  return Object.freeze({
    indexed,
    skipped,
    source: 'provider-fabric' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectModelsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: ModelFabricRegistry,
  health: FuryCapabilityIndexHealthOverrides['models'] = {},
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const entries = registry.list();
  const validatedHealth = validateHealthOverrides(health, 'model health overrides');
  let indexed = 0;
  let skipped = 0;
  for (const model of entries) {
    const capabilityId = `${model.provider}/${model.id}`;
    if (!indexableIdentity(capabilityId)) {
      skipped += 1;
      continue;
    }
    const observedAt = latestModelObservedAt(model);
    const tags = [
      `provider-${model.provider}`,
      `lifecycle-${model.lifecycle}`,
      `visual-${model.visual.profile}`,
      `visual-policy-${model.visual.policy}`,
    ];
    const keywords = [
      model.id,
      model.displayName,
      ...model.aliases,
      ...modelFamilies(model),
    ];

    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'model',
      id: capabilityId,
      name: model.displayName.length <= 256 ? model.displayName : model.id,
      description:
        `Model ${model.displayName} from ${model.provider}; lifecycle ${model.lifecycle}; context limit ${model.limits.contextTokens ?? 'unknown'}; output limit ${model.limits.outputTokens ?? 'unknown'}.`,
      families: uniqueMetadata(modelFamilies(model)),
      tags: uniqueMetadata(tags),
      keywords: uniqueMetadata(keywords, 160),
      trust: modelTrust(model),
      license: 'not-applicable',
      health: healthOverride(validatedHealth, capabilityId),
      riskClass: 'process',
      requiredPermissions: ['provider-inference'],
      compatibility: [],
      source: {
        system: 'model-fabric',
        sourceId: capabilityId,
        ...(observedAt === undefined ? {} : { observedAt }),
      },
    });
    indexed += 1;
  }
  return Object.freeze({
    indexed,
    skipped,
    source: 'model-fabric' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectMcpIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  bridge: FuryKernelToolBridge,
  options: {
    readonly inspections?: readonly FuryKernelToolSourceInspection[];
    readonly health?: FuryCapabilityIndexHealthOverrides['mcpServers'];
  } = {},
): FuryCapabilityIndexProjectionReport {
  requireIndex(index);
  const summaries = bridge.inspectSources();
  const validatedHealth = validateHealthOverrides(
    options.health,
    'MCP health overrides',
  );
  const summaryById = new Map(summaries.map((summary) => [summary.sourceId, summary]));
  const inspections = mcpInspectionMap(options.inspections);

  for (const [sourceId, inspection] of inspections) {
    const summary = summaryById.get(sourceId);
    if (
      !summary
      || summary.endpointFingerprint !== inspection.source.endpointFingerprint
      || summary.transport !== inspection.source.transport
      || summary.trust !== inspection.source.trust
    ) {
      throw new Error('Capability Autopilot MCP inspection does not match current source metadata');
    }
  }

  let indexed = 0;
  for (const summary of summaries) {
    const permission = sourcePermission(summary);
    const inspection = inspections.get(summary.sourceId);

    put(index, {
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'mcp-server',
      id: summary.sourceId,
      name: summary.sourceId.replace(/[._:-]+/gu, ' '),
      description:
        `Configured MCP source ${summary.sourceId}; transport ${summary.transport}; live inventory is ${inspection ? 'already-provided' : 'not-probed-by-autopilot'}.`,
      families: uniqueMetadata(['mcp', summary.transport === 'stdio' ? 'local-process' : 'network']),
      tags: uniqueMetadata([`transport-${summary.transport}`, `trust-${summary.trust}`]),
      keywords: uniqueMetadata([summary.sourceId, 'mcp', summary.transport]),
      trust: mcpSourceTrust(summary),
      license: 'not-applicable',
      health: inspection
        ? 'ready'
        : healthOverride(validatedHealth, summary.sourceId),
      riskClass: 'process',
      requiredPermissions: [permission],
      compatibility: [],
      source: {
        system: 'mcp-host',
        sourceId: summary.sourceId,
        sourceRevision: summary.endpointFingerprint,
      },
    });
    indexed += 1;

    if (!inspection) continue;
    for (const tool of inspection.tools) {
      put(index, {
        format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
        kind: 'mcp-tool',
        id: `${summary.sourceId}/${tool.name}`,
        name: tool.name,
        description:
          `Listed MCP tool ${tool.name} from ${summary.sourceId}; risk ${tool.riskClass}; authorization remains false.`,
        families: uniqueMetadata(['mcp', 'tool']),
        tags: uniqueMetadata([
          `risk-${tool.riskClass}`,
          tool.closedWorldReadCandidate ? 'closed-world-read-candidate' : 'policy-gate-required',
        ]),
        keywords: uniqueMetadata([summary.sourceId, tool.name, 'mcp tool'], 160),
        trust: mcpSourceTrust(summary),
        license: 'not-applicable',
        health: 'ready',
        riskClass: mcpRisk(tool.riskClass),
        requiredPermissions: [permission],
        compatibility: [],
        source: {
          system: 'mcp-host',
          sourceId: `${summary.sourceId}/${tool.name}`,
          sourceRevision:
            `${summary.endpointFingerprint}:${tool.inputSchemaSha256}`,
        },
      });
      indexed += 1;
    }
  }

  return Object.freeze({
    indexed,
    skipped: 0,
    source: 'mcp-host' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function revalidateFuryCapabilitySelection(
  plan: FuryCapabilitySelectionPlan,
  index: FuryCapabilityIndex,
): FuryCapabilitySelectionRevalidation {
  requireIndex(index);
  if (
    !isGeneratedFuryCapabilitySelectionPlan(plan)
    || plan.format !== 'furypipe-capability-selection/v1'
    || plan.executionAuthority !== false
  ) {
    throw new Error('Capability Autopilot revalidation requires a selection-only plan');
  }

  const currentSnapshot = index.snapshot();
  const items: FuryCapabilitySelectionRevalidationItem[] = plan.selected.map(
    (selected) => {
      const current = index.get(selected.kind, selected.id);
      if (!current) {
        return Object.freeze({
          kind: selected.kind,
          id: selected.id,
          status: 'missing' as const,
          selectedFingerprintSha256: selected.fingerprintSha256,
        });
      }
      if (current.fingerprintSha256 !== selected.fingerprintSha256) {
        return Object.freeze({
          kind: selected.kind,
          id: selected.id,
          status: 'stale' as const,
          selectedFingerprintSha256: selected.fingerprintSha256,
          currentFingerprintSha256: current.fingerprintSha256,
        });
      }
      return Object.freeze({
        kind: selected.kind,
        id: selected.id,
        status: 'current' as const,
        selectedFingerprintSha256: selected.fingerprintSha256,
        currentFingerprintSha256: current.fingerprintSha256,
      });
    },
  );

  const current = items.filter((item) => item.status === 'current').length;
  const stale = items.filter((item) => item.status === 'stale').length;
  const missing = items.filter((item) => item.status === 'missing').length;
  const indexDigestMatches =
    plan.indexDigestSha256 === currentSnapshot.digestSha256;
  const reselectionRequired =
    !indexDigestMatches || stale > 0 || missing > 0;

  return Object.freeze({
    format: FURY_CAPABILITY_REVALIDATION_FORMAT,
    selectionDigestSha256: plan.selectionDigestSha256,
    selectedIndexDigestSha256: plan.indexDigestSha256,
    currentIndexDigestSha256: currentSnapshot.digestSha256,
    indexDigestMatches,
    reselectionRequired,
    validForExposure: !reselectionRequired,
    current,
    stale,
    missing,
    items: Object.freeze(items),
    authority: 'revalidation-only' as const,
    executionAuthority: false as const,
  });
}
