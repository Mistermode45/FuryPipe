import type {
  AgentSkillRegistry,
  SkillLicenseStatus,
  SkillSourceDecision,
} from './skill-registry.js';
import type {
  FuryPluginBundleRegistry,
  FuryPluginPermission,
} from './plugin-bundles.js';
import type {
  ModelFabricEntry,
  ModelFabricRegistry,
} from './core/model-fabric.js';
import type {
  FuryKernelToolBridge,
  FuryKernelToolSourceInspection,
  FuryKernelToolSourceSummary,
} from './fury-kernel-tool-bridge-node.js';
import type { McpToolRiskClass } from './mcp-tool-risk.js';
import {
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
  type FuryCapabilityIndex,
  type FuryCapabilityIndexEntryInput,
  type FuryCapabilityIndexHealthState,
  type FuryCapabilityIndexKind,
  type FuryCapabilityIndexLicenseState,
  type FuryCapabilityIndexRiskClass,
  type FuryCapabilityIndexTrustState,
} from './capability-index.js';
import type {
  FuryCapabilitySelectionPlan,
} from './capability-autopilot.js';

export const FURY_CAPABILITY_REVALIDATION_FORMAT =
  'furypipe-capability-revalidation/v1' as const;

export interface FuryCapabilityIndexHealthOverrides {
  readonly skills?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly plugins?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly models?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
  readonly mcpServers?: Readonly<Record<string, FuryCapabilityIndexHealthState>>;
}

export interface FuryCapabilityIndexProjectionReport {
  readonly indexed: number;
  readonly source: 'skill-registry' | 'plugin-registry' | 'model-fabric' | 'mcp-host';
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

const INDEX_TRUST = new Set<FuryCapabilityIndexTrustState>([
  'trusted', 'verified', 'unverified', 'blocked', 'unknown',
]);
const INDEX_HEALTH = new Set<FuryCapabilityIndexHealthState>([
  'ready', 'degraded', 'unavailable', 'blocked', 'unknown',
]);

function healthOverride(
  record: Readonly<Record<string, FuryCapabilityIndexHealthState>> | undefined,
  id: string,
): FuryCapabilityIndexHealthState {
  const value = record?.[id];
  if (value === undefined) return 'unknown';
  if (!INDEX_HEALTH.has(value)) {
    throw new Error('Capability Autopilot health override is invalid');
  }
  return value;
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
  const timestamps = [
    entry.lastObservedAt,
    ...entry.provenance.map((item) => item.observedAt),
  ]
    .filter((value): value is string =>
      typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0];
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

function put(
  index: FuryCapabilityIndex,
  entry: FuryCapabilityIndexEntryInput,
): void {
  index.upsert(entry);
}

export function projectSkillsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: AgentSkillRegistry,
  health: FuryCapabilityIndexHealthOverrides['skills'] = {},
): FuryCapabilityIndexProjectionReport {
  const inspections = registry.inspect();
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
      families: [skill.category],
      tags: [...skill.stages, `health-${skill.healthPolicy}`],
      keywords: [skill.id, skill.category, ...skill.stages],
      trust: skillTrust(skill.provenance.decision, skill.executableByProvenance),
      license: skillLicense(skill.provenance.licenseStatus),
      health: healthOverride(health, skill.id),
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
    source: 'skill-registry' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectPluginsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: FuryPluginBundleRegistry,
  health: FuryCapabilityIndexHealthOverrides['plugins'] = {},
): FuryCapabilityIndexProjectionReport {
  const inspections = registry.inspect();
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
      families: [...families],
      tags,
      keywords: [plugin.id, plugin.name, ...plugin.skills],
      trust: pluginTrust(plugin.source.licenseStatus),
      license: pluginLicense(plugin.source.licenseStatus),
      health: healthOverride(health, plugin.id),
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
    source: 'plugin-registry' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function projectModelsIntoCapabilityIndex(
  index: FuryCapabilityIndex,
  registry: ModelFabricRegistry,
  health: FuryCapabilityIndexHealthOverrides['models'] = {},
): FuryCapabilityIndexProjectionReport {
  const entries = registry.list();
  for (const model of entries) {
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
      id: `${model.provider}/${model.id}`,
      name: model.displayName,
      description:
        `Model ${model.displayName} from ${model.provider}; lifecycle ${model.lifecycle}; context limit ${model.limits.contextTokens ?? 'unknown'}; output limit ${model.limits.outputTokens ?? 'unknown'}.`,
      families: modelFamilies(model),
      tags,
      keywords,
      trust: modelTrust(model),
      license: 'not-applicable',
      health: healthOverride(health, `${model.provider}/${model.id}`),
      riskClass: 'process',
      requiredPermissions: ['provider-inference'],
      compatibility: [],
      source: {
        system: 'model-fabric',
        sourceId: `${model.provider}/${model.id}`,
        ...(observedAt === undefined ? {} : { observedAt }),
      },
    });
  }
  return Object.freeze({
    indexed: entries.length,
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
  const summaries = bridge.inspectSources();
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
      families: ['mcp', summary.transport === 'stdio' ? 'local-process' : 'network'],
      tags: [`transport-${summary.transport}`, `trust-${summary.trust}`],
      keywords: [summary.sourceId, 'mcp', summary.transport],
      trust: mcpSourceTrust(summary),
      license: 'not-applicable',
      health: inspection
        ? 'ready'
        : healthOverride(options.health, summary.sourceId),
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
        families: ['mcp', 'tool'],
        tags: [
          `risk-${tool.riskClass}`,
          tool.closedWorldReadCandidate ? 'closed-world-read-candidate' : 'policy-gate-required',
        ],
        keywords: [summary.sourceId, tool.name, 'mcp tool'],
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
    source: 'mcp-host' as const,
    authority: 'projection-only' as const,
    executionAuthority: false as const,
  });
}

export function revalidateFuryCapabilitySelection(
  plan: FuryCapabilitySelectionPlan,
  index: FuryCapabilityIndex,
): FuryCapabilitySelectionRevalidation {
  if (
    !plan
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
