import type {
  AgentSkillDefinition,
  AgentSkillHealthStatus,
} from './agent-runtime.js';
import type {
  AgentFabricPermission,
  AgentFabricStageId,
} from './agent-fabric.js';

export const SKILL_CATEGORIES = Object.freeze([
  'repository',
  'debugging',
  'security',
  'architecture',
  'testing',
  'documentation',
  'frontend',
  'design',
  'seo',
  'research',
  'context',
  'learning',
] as const);

export type SkillCategory = typeof SKILL_CATEGORIES[number];
export type SkillSourceKind = 'local' | 'external-reference' | 'vendored';
export type SkillSourceDecision = 'ADOPT' | 'ADAPT' | 'WRAP' | 'REFERENCE_ONLY' | 'REJECT';
export type SkillLicenseStatus = 'VERIFIED' | 'NOT_APPLICABLE' | 'UNKNOWN';
export type SkillHealthPolicy = 'required' | 'optional';

export interface SkillProvenance {
  readonly sourceKind: SkillSourceKind;
  readonly repository?: string;
  readonly commitSha?: string;
  readonly licenseStatus: SkillLicenseStatus;
  readonly licenseSpdx?: string;
  readonly decision: SkillSourceDecision;
}

export interface SkillRegistrationMetadata {
  readonly id: string;
  readonly category: SkillCategory;
  readonly priority: number;
  readonly provenance: SkillProvenance;
  readonly healthPolicy?: SkillHealthPolicy;
  readonly description?: string;
}

export interface SkillRegistryInspection {
  readonly id: string;
  readonly version: string;
  readonly category: SkillCategory;
  readonly priority: number;
  readonly stages: readonly AgentFabricStageId[];
  readonly permission: AgentFabricPermission;
  readonly network: 'disabled' | 'required';
  readonly provenance: SkillProvenance;
  readonly healthPolicy: SkillHealthPolicy;
  readonly executableByProvenance: boolean;
}

export interface SkillResolution {
  readonly metadata: SkillRegistryInspection;
  readonly health: AgentSkillHealthStatus;
  readonly eligible: boolean;
  readonly reason:
    | 'eligible'
    | 'reference_only'
    | 'rejected_source'
    | 'unverified_provenance'
    | 'network_required'
    | 'unhealthy'
    | 'health_required_but_unknown';
  readonly definition?: AgentSkillDefinition;
}

export interface AgentSkillRegistry {
  register(metadata: SkillRegistrationMetadata, definition: AgentSkillDefinition): void;
  inspect(): readonly SkillRegistryInspection[];
  resolveForStage(stage: AgentFabricStageId): Promise<readonly SkillResolution[]>;
  definitionsForStage(stage: AgentFabricStageId): Promise<readonly AgentSkillDefinition[]>;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u;
const MAX_DESCRIPTION = 1024;
const MAX_PRIORITY = 1_000_000;

function validateId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${label} is invalid`);
}

function validatePriority(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_PRIORITY) {
    throw new Error('skill priority must be an integer between 0 and 1000000');
  }
}

function validateRepository(value: string | undefined): void {
  if (value === undefined) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('skill provenance repository must be a valid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('skill provenance repository must be credential-free HTTPS');
  }
}

function validateProvenance(provenance: SkillProvenance): void {
  validateRepository(provenance.repository);
  if (!['local', 'external-reference', 'vendored'].includes(provenance.sourceKind)) {
    throw new Error('skill provenance sourceKind is invalid');
  }
  if (!['ADOPT', 'ADAPT', 'WRAP', 'REFERENCE_ONLY', 'REJECT'].includes(provenance.decision)) {
    throw new Error('skill provenance decision is invalid');
  }
  if (!['VERIFIED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(provenance.licenseStatus)) {
    throw new Error('skill provenance licenseStatus is invalid');
  }
  if (provenance.commitSha !== undefined && !SHA40.test(provenance.commitSha)) {
    throw new Error('skill provenance commitSha must be a lowercase 40-character SHA');
  }
  if (provenance.licenseSpdx !== undefined && !SPDX.test(provenance.licenseSpdx)) {
    throw new Error('skill provenance SPDX identifier is invalid');
  }

  if (provenance.sourceKind === 'local') {
    if (provenance.licenseStatus === 'UNKNOWN') {
      throw new Error('local executable skills must not have UNKNOWN license status');
    }
    return;
  }

  if (!provenance.repository || !provenance.commitSha) {
    throw new Error('external skill provenance requires repository and pinned commitSha');
  }
}

function executableByProvenance(provenance: SkillProvenance): boolean {
  if (provenance.decision === 'REFERENCE_ONLY' || provenance.decision === 'REJECT') return false;
  if (provenance.sourceKind === 'local') return provenance.licenseStatus !== 'UNKNOWN';
  return provenance.licenseStatus === 'VERIFIED' && provenance.commitSha !== undefined;
}

function inspection(
  metadata: SkillRegistrationMetadata,
  definition: AgentSkillDefinition,
): SkillRegistryInspection {
  return Object.freeze({
    id: metadata.id,
    version: definition.version,
    category: metadata.category,
    priority: metadata.priority,
    stages: Object.freeze([...definition.stages]),
    permission: definition.permission ?? 'read',
    network: definition.network ?? 'disabled',
    provenance: Object.freeze({ ...metadata.provenance }),
    healthPolicy: metadata.healthPolicy ?? 'optional',
    executableByProvenance: executableByProvenance(metadata.provenance),
  });
}

function validateRegistration(
  metadata: SkillRegistrationMetadata,
  definition: AgentSkillDefinition,
): void {
  validateId(metadata.id, 'skill metadata id');
  validateId(definition.id, 'skill definition id');
  if (metadata.id !== definition.id) throw new Error('skill metadata id must match definition id');
  if (!SEMVER.test(definition.version)) throw new Error('skill definition version must be pinned semver');
  if (!SKILL_CATEGORIES.includes(metadata.category)) throw new Error('skill category is invalid');
  validatePriority(metadata.priority);
  validateProvenance(metadata.provenance);
  if (metadata.healthPolicy !== undefined && metadata.healthPolicy !== 'required' && metadata.healthPolicy !== 'optional') {
    throw new Error('skill healthPolicy is invalid');
  }
  if (metadata.description !== undefined
    && (metadata.description.length < 1 || metadata.description.length > MAX_DESCRIPTION || metadata.description.includes('\0'))) {
    throw new Error('skill description must be bounded text');
  }
  if (!Array.isArray(definition.stages) || definition.stages.length < 1 || definition.stages.length > 5) {
    throw new Error('skill must declare between 1 and 5 Agent Fabric stages');
  }
  if (new Set(definition.stages).size !== definition.stages.length) {
    throw new Error('skill stages must be unique');
  }
  if (typeof definition.execute !== 'function') throw new Error('skill execute callback is required');
}

export function createAgentSkillRegistry(): AgentSkillRegistry {
  const records = new Map<string, {
    readonly metadata: SkillRegistrationMetadata;
    readonly definition: AgentSkillDefinition;
  }>();

  return {
    register(metadata, definition) {
      validateRegistration(metadata, definition);
      if (records.has(metadata.id)) throw new Error(`skill already registered: ${metadata.id}`);
      records.set(metadata.id, {
        metadata: Object.freeze({
          ...metadata,
          provenance: Object.freeze({ ...metadata.provenance }),
        }),
        definition,
      });
    },

    inspect() {
      return Object.freeze(
        [...records.values()]
          .map(({ metadata, definition }) => inspection(metadata, definition))
          .sort((a, b) => a.category.localeCompare(b.category)
            || b.priority - a.priority
            || a.id.localeCompare(b.id)),
      );
    },

    async resolveForStage(stage) {
      const resolutions: SkillResolution[] = [];
      const candidates = [...records.values()]
        .filter(({ definition }) => definition.stages.includes(stage))
        .sort((a, b) => b.metadata.priority - a.metadata.priority
          || a.metadata.id.localeCompare(b.metadata.id));

      for (const { metadata, definition } of candidates) {
        const view = inspection(metadata, definition);
        if (metadata.provenance.decision === 'REFERENCE_ONLY') {
          resolutions.push(Object.freeze({ metadata: view, health: 'unknown', eligible: false, reason: 'reference_only' }));
          continue;
        }
        if (metadata.provenance.decision === 'REJECT') {
          resolutions.push(Object.freeze({ metadata: view, health: 'unknown', eligible: false, reason: 'rejected_source' }));
          continue;
        }
        if (!view.executableByProvenance) {
          resolutions.push(Object.freeze({ metadata: view, health: 'unknown', eligible: false, reason: 'unverified_provenance' }));
          continue;
        }
        if (view.network === 'required') {
          resolutions.push(Object.freeze({ metadata: view, health: 'unknown', eligible: false, reason: 'network_required' }));
          continue;
        }

        let health: AgentSkillHealthStatus = 'unknown';
        if (definition.health) {
          const result = await definition.health();
          if (!result || !['healthy', 'degraded', 'unhealthy', 'unknown'].includes(result.status)) {
            throw new Error(`skill health callback returned an invalid status: ${metadata.id}`);
          }
          health = result.status;
        }

        if (health === 'unhealthy') {
          resolutions.push(Object.freeze({ metadata: view, health, eligible: false, reason: 'unhealthy' }));
          continue;
        }
        if (health === 'unknown' && view.healthPolicy === 'required') {
          resolutions.push(Object.freeze({ metadata: view, health, eligible: false, reason: 'health_required_but_unknown' }));
          continue;
        }

        resolutions.push(Object.freeze({
          metadata: view,
          health,
          eligible: true,
          reason: 'eligible',
          definition,
        }));
      }

      return Object.freeze(resolutions);
    },

    async definitionsForStage(stage) {
      const resolved = await this.resolveForStage(stage);
      return Object.freeze(
        resolved.flatMap((item) => item.eligible && item.definition ? [item.definition] : []),
      );
    },
  };
}
