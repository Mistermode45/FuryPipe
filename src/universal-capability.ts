import type { CapabilityCandidate, JsonValue } from './ecosystem/types.js';

export const FURY_UNIVERSAL_CAPABILITY_FORMAT = 'furypipe-universal-capability/v1' as const;

export type FuryUniversalCapabilityRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
export type FuryUniversalCapabilityStatus =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'REFERENCE_ONLY'
  | 'BLOCKED'
  | 'UNKNOWN';
export type FuryTelemetryPolicy = 'NONE' | 'LOCAL_ONLY' | 'OPT_IN' | 'PROVIDER_DEFINED' | 'UNKNOWN';

export interface FuryUniversalCapabilityDescriptor {
  readonly format: typeof FURY_UNIVERSAL_CAPABILITY_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly description: string;
  readonly kind: CapabilityCandidate['type'];
  readonly category: string;
  readonly provider: string;
  readonly source: CapabilityCandidate['source'];
  readonly license: CapabilityCandidate['license'];
  readonly authors: readonly string[];
  readonly capabilities: readonly string[];
  readonly requirements: readonly string[];
  readonly dependencies: readonly string[];
  readonly permissions: CapabilityCandidate['permissions'];
  readonly riskLevel: FuryUniversalCapabilityRisk;
  readonly health: CapabilityCandidate['health'];
  readonly status: FuryUniversalCapabilityStatus;
  readonly configurationSchema: JsonValue | null;
  readonly compatibility: {
    readonly platforms: readonly string[];
    readonly models: readonly string[];
    readonly languages: readonly string[];
    readonly stages: readonly string[];
  };
  readonly installSource: string;
  readonly updateSource: string;
  readonly checksum: string | null;
  readonly lastUpdate: string | null;
  readonly telemetryPolicy: FuryTelemetryPolicy;
  readonly costModel: CapabilityCandidate['costModel'];
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly documentation: readonly string[];
  readonly executionAuthorized: false;
}

function extension(candidate: CapabilityCandidate, key: string): JsonValue | undefined {
  return candidate.extensions?.[key];
}

function extensionStrings(candidate: CapabilityCandidate, key: string): readonly string[] {
  const value = extension(candidate, key);
  if (!Array.isArray(value)) return Object.freeze([]);
  const values = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).slice(0, 128);
  return Object.freeze([...new Set(values)]);
}

function telemetryPolicy(candidate: CapabilityCandidate): FuryTelemetryPolicy {
  const value = extension(candidate, 'telemetryPolicy');
  return value === 'NONE' || value === 'LOCAL_ONLY' || value === 'OPT_IN' || value === 'PROVIDER_DEFINED'
    ? value
    : 'UNKNOWN';
}

function riskLevel(candidate: CapabilityCandidate): FuryUniversalCapabilityRisk {
  if (candidate.decision === 'REJECT') return 'BLOCKED';
  const p = candidate.permissions;
  if (
    p.network === 'arbitrary'
    || p.filesystem === 'delete'
    || p.filesystem === 'arbitrary-write'
    || p.subprocess === 'arbitrary'
    || p.credentials === 'manage'
    || p.database === 'admin'
    || p.cloud === 'admin'
    || p.externalWrites.length > 0
  ) return 'HIGH';
  if (
    p.network === 'restricted'
    || p.filesystem === 'write'
    || p.subprocess === 'restricted'
    || p.credentials === 'read'
    || p.credentials === 'use'
    || p.database === 'read'
    || p.database === 'scoped-write'
    || p.browser === 'read'
    || p.browser === 'interact'
    || p.provider === 'invoke'
    || p.provider === 'configure'
    || p.cloud === 'read'
    || p.cloud === 'scoped-write'
  ) return 'MEDIUM';
  return 'LOW';
}

function capabilityStatus(candidate: CapabilityCandidate): FuryUniversalCapabilityStatus {
  if (candidate.decision === 'REJECT') return 'BLOCKED';
  if (candidate.decision === 'REFERENCE_ONLY') return 'REFERENCE_ONLY';
  if (candidate.maintenance.status === 'ARCHIVED' || candidate.health.status === 'UNHEALTHY') return 'UNAVAILABLE';
  if (candidate.health.status === 'DEGRADED') return 'DEGRADED';
  if (candidate.health.status === 'HEALTHY') return 'AVAILABLE';
  return 'UNKNOWN';
}

/**
 * Project a validated v1 CapabilityCandidate into the universal product-facing
 * descriptor requested by the 2026-09-26 product spec.
 *
 * This is deliberately a projection, not a second registry. Missing metadata
 * stays explicit (null/empty/UNKNOWN) instead of being invented.
 */
export function projectUniversalCapability(candidate: CapabilityCandidate): FuryUniversalCapabilityDescriptor {
  const configurationSchema = extension(candidate, 'configurationSchema') ?? null;
  const metadata = candidate.extensions ?? Object.freeze({});
  const provider = candidate.publisher ?? candidate.source.package?.ecosystem ?? candidate.source.kind;
  const lastUpdate = candidate.maintenance.lastActivityAt
    ?? candidate.maintenance.lastReleaseAt
    ?? candidate.releaseDate
    ?? candidate.lastAuditedAt
    ?? null;

  return Object.freeze({
    format: FURY_UNIVERSAL_CAPABILITY_FORMAT,
    id: candidate.id,
    name: candidate.name,
    version: candidate.version ?? null,
    description: candidate.description,
    kind: candidate.type,
    category: candidate.categories[0] ?? candidate.type,
    provider,
    source: candidate.source,
    license: candidate.license,
    authors: candidate.authors,
    capabilities: candidate.capabilities,
    requirements: extensionStrings(candidate, 'requirements'),
    dependencies: extensionStrings(candidate, 'dependencies'),
    permissions: candidate.permissions,
    riskLevel: riskLevel(candidate),
    health: candidate.health,
    status: capabilityStatus(candidate),
    configurationSchema,
    compatibility: Object.freeze({
      platforms: candidate.supportedPlatforms,
      models: candidate.supportedModels,
      languages: candidate.supportedLanguages,
      stages: candidate.supportedStages,
    }),
    installSource: candidate.source.url,
    updateSource: candidate.source.repositoryUrl ?? candidate.source.url,
    checksum: candidate.source.contentSha256 ?? null,
    lastUpdate,
    telemetryPolicy: telemetryPolicy(candidate),
    costModel: candidate.costModel,
    metadata,
    documentation: extensionStrings(candidate, 'documentation'),
    executionAuthorized: false,
  });
}
