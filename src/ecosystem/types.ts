export const CAPABILITY_CANDIDATE_FORMAT = 'furypipe-capability/v1' as const;
export const CAPABILITY_MANIFEST_FORMAT = 'furypipe-capability-manifest/v1' as const;

export const CAPABILITY_TYPES = Object.freeze([
  'agent',
  'subagent',
  'skill',
  'skill-pack',
  'instruction',
  'plugin',
  'mcp',
  'mcp-server',
  'connector',
  'cli',
  'cli-tool',
  'api',
  'provider',
  'provider-adapter',
  'model',
  'hook',
  'rule',
  'template',
  'workflow',
  'automation',
  'framework',
  'standard',
  'tool',
  'memory-backend',
  'memory-provider',
  'context-provider',
  'search-provider',
  'browser-tool',
  'browser-provider',
  'image-provider',
  'video-provider',
  'audio-provider',
  'voice-provider',
  'embedding-provider',
  'reranker',
  'code-runtime',
  'sandbox',
  'database-connector',
  'design-tool',
  'cloud-integration',
  'dataset',
  'other',
] as const);

export type CapabilityType = typeof CAPABILITY_TYPES[number];
export type ProvenanceClassification =
  | 'FIRST_PARTY'
  | 'OFFICIAL'
  | 'VERIFIED_COMMUNITY'
  | 'COMMUNITY'
  | 'FORK'
  | 'MIRROR'
  | 'UNKNOWN';
export type ProvenanceReviewStatus = 'UNREVIEWED' | 'REVIEWED';
export type CapabilityLicenseStatus = 'VERIFIED' | 'MISSING' | 'AMBIGUOUS' | 'INCOMPATIBLE' | 'UNKNOWN';
export type IntegrationDecision = 'ADOPT' | 'PORT' | 'ADAPT' | 'WRAP' | 'REFERENCE_ONLY' | 'REJECT';
export type CapabilityPinStatus = 'PINNED' | 'UNPINNED' | 'MUTABLE_SOURCE';
export type CapabilitySourceKind = 'git' | 'package' | 'marketplace' | 'service' | 'internal';
export type ExternalWritePermission =
  | 'communication'
  | 'publish'
  | 'deploy'
  | 'financial'
  | 'infrastructure'
  | 'database'
  | 'admin';

export interface CapabilityPermissions {
  readonly network: 'none' | 'restricted' | 'arbitrary';
  readonly filesystem: 'none' | 'read' | 'write' | 'delete' | 'arbitrary-write';
  readonly subprocess: 'none' | 'restricted' | 'arbitrary';
  readonly credentials: 'none' | 'read' | 'use' | 'manage';
  readonly externalWrites: readonly ExternalWritePermission[];
  readonly database: 'none' | 'read' | 'scoped-write' | 'admin';
  readonly browser: 'none' | 'read' | 'interact';
  readonly provider: 'none' | 'invoke' | 'configure';
  readonly cloud: 'none' | 'read' | 'scoped-write' | 'admin';
}

export type CapabilityAliasKind = 'repository' | 'package' | 'marketplace' | 'registry' | 'service';
export type CapabilityRelationshipKind =
  | 'fork-of'
  | 'mirror-of'
  | 'renamed-from'
  | 'package-for'
  | 'marketplace-entry-for';

export interface CapabilitySourceAlias {
  readonly kind: CapabilityAliasKind;
  readonly value: string;
}

export interface CapabilityRelationship {
  readonly kind: CapabilityRelationshipKind;
  readonly targetUrl: string;
}

export interface CapabilitySource {
  readonly kind: CapabilitySourceKind;
  readonly url: string;
  readonly repositoryUrl?: string;
  readonly package?: {
    readonly ecosystem: string;
    readonly name: string;
    readonly version?: string;
  };
  readonly version?: string;
  readonly commitSha?: string;
  readonly contentSha256?: string;
  readonly mutableRef?: string;
  readonly pinStatus: CapabilityPinStatus;
}

export interface CanonicalCapabilityIdentity {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly repository?: string;
  readonly revisionKey: string;
}

export interface CapabilityProvenanceEvidence {
  readonly kind:
    | 'official-domain'
    | 'signed-release'
    | 'repository-link'
    | 'maintainer-statement'
    | 'manual-review'
    | 'other';
  readonly reference: string;
}

export interface CapabilityProvenance {
  readonly classification: ProvenanceClassification;
  readonly reviewStatus: ProvenanceReviewStatus;
  readonly evidence: readonly CapabilityProvenanceEvidence[];
}

export interface CapabilityLicense {
  readonly status: CapabilityLicenseStatus;
  readonly declaredSpdx?: string;
  readonly discoveredSpdx?: string;
  readonly spdx?: string;
  readonly source: 'repository-file' | 'registry-metadata' | 'official-source' | 'operator-review' | 'unknown';
  readonly evidence: readonly {
    readonly kind: 'repository-file' | 'registry-metadata' | 'official-source' | 'manual-review' | 'other';
    readonly reference: string;
  }[];
  readonly evidenceUrl?: string;
  readonly reviewedAt?: string;
  readonly conflict: boolean;
}

export interface RawCapabilityLicense {
  readonly status: CapabilityLicenseStatus;
  readonly declaredSpdx?: string;
  readonly discoveredSpdx?: string;
  readonly spdx?: string;
  readonly source?: CapabilityLicense['source'];
  readonly evidence?: CapabilityLicense['evidence'];
  readonly evidenceUrl?: string;
  readonly reviewedAt?: string;
  readonly conflict?: boolean;
}

export type CapabilityCostModel = 'FREE' | 'PAID' | 'SUBSCRIPTION' | 'USAGE_BASED' | 'CUSTOM' | 'UNKNOWN';

export interface CapabilityCost {
  readonly model: CapabilityCostModel;
  readonly currency?: string;
  readonly amount?: number;
  readonly period?: 'once' | 'hour' | 'month' | 'year' | 'usage';
}

export type MaintenanceStatus = 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED' | 'UNKNOWN';

export interface CapabilityMaintenance {
  readonly status: MaintenanceStatus;
  readonly maintainerCount?: number;
  readonly lastActivityAt?: string;
  readonly lastReleaseAt?: string;
}

export interface CapabilityActivity {
  readonly stars?: number;
  readonly downloads?: number;
  readonly dependents?: number;
  readonly observedAt?: string;
}

export interface CapabilityBenchmark {
  readonly id: string;
  readonly metric?: string;
  readonly value?: number;
  readonly unit?: string;
  readonly measuredAt?: string;
  readonly model?: string;
  readonly task?: string;
  readonly baselineScore?: number;
  readonly withCapabilityScore?: number;
  readonly tokenDelta?: number;
  readonly latencyDelta?: number;
  readonly costDelta?: number;
  readonly regressions?: readonly string[];
  readonly sourceUrl?: string;
  readonly method?: string;
}

export interface CapabilityRoiEstimate {
  readonly estimatedCostUsd?: number;
  readonly estimatedSavingsUsd?: number;
  readonly qualityGain?: number;
  readonly tokenDelta?: number;
  readonly timeDelta?: number;
  readonly costDelta?: number;
  readonly userEffortDelta?: number;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  readonly sampleSize?: number;
  readonly benchmarkId?: string;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface CapabilityCandidate {
  readonly format: typeof CAPABILITY_CANDIDATE_FORMAT;
  readonly schemaVersion: 1;
  /** Stable, deterministic identity derived from the canonical source URL. */
  readonly id: string;
  readonly canonicalUrl: string;
  readonly identity: CanonicalCapabilityIdentity;
  readonly name: string;
  readonly type: CapabilityType;
  readonly description: string;
  readonly repository?: string;
  readonly publisher?: string;
  readonly authors: readonly string[];
  readonly version?: string;
  readonly commitSha?: string;
  readonly releaseDate?: string;
  readonly source: CapabilitySource;
  readonly provenance: CapabilityProvenance;
  readonly license: CapabilityLicense;
  readonly licenseStatus: CapabilityLicenseStatus;
  readonly categories: readonly string[];
  readonly capabilities: readonly string[];
  readonly domains: readonly string[];
  readonly supportedStages: readonly string[];
  readonly supportedPlatforms: readonly string[];
  readonly supportedModels: readonly string[];
  readonly supportedLanguages: readonly string[];
  readonly permissions: CapabilityPermissions;
  /** Product integration choice; it is not a trust verdict or execution grant. */
  readonly decision: IntegrationDecision;
  readonly decisionReason?: string;
  readonly integrationMode: 'LOCAL_NATIVE' | 'IN_PROCESS' | 'MCP' | 'CLI' | 'REMOTE_API' | 'REFERENCE_ONLY' | 'VENDORED' | 'EXTERNAL_OPT_IN';
  readonly costModel: CapabilityCostModel;
  readonly cost: CapabilityCost;
  readonly maintenance: CapabilityMaintenance;
  readonly activity: CapabilityActivity;
  readonly health: {
    readonly status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
    readonly observedAt?: string;
    readonly evidence?: string;
  };
  readonly security: {
    readonly staticReviewStatus: 'NOT_REVIEWED' | 'PARTIAL' | 'REVIEWED' | 'UNKNOWN';
    readonly lastScannedAt?: string;
    readonly sourceFilesScanned?: number;
    readonly advisoryIds: readonly string[];
  };
  readonly aliases: readonly CapabilitySourceAlias[];
  readonly relationships: readonly CapabilityRelationship[];
  readonly benchmarks: readonly CapabilityBenchmark[];
  readonly roi?: CapabilityRoiEstimate;
  readonly createdAt?: string;
  readonly lastAuditedAt?: string;
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** Untrusted JSON input. Canonical identity and pin state are always derived by the validator. */
export interface RawCapabilityCandidate {
  readonly format: typeof CAPABILITY_CANDIDATE_FORMAT;
  readonly schemaVersion?: 1;
  readonly identity?: CanonicalCapabilityIdentity;
  readonly name: string;
  readonly type: CapabilityType;
  readonly description: string;
  readonly repository?: string;
  readonly publisher?: string;
  readonly authors?: readonly string[];
  readonly version?: string;
  readonly commitSha?: string;
  readonly releaseDate?: string;
  readonly source: Omit<CapabilitySource, 'pinStatus'>;
  readonly provenance: CapabilityProvenance;
  readonly license: RawCapabilityLicense;
  readonly licenseStatus?: CapabilityLicenseStatus;
  readonly categories?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly domains?: readonly string[];
  readonly supportedStages?: readonly string[];
  readonly supportedPlatforms?: readonly string[];
  readonly supportedModels?: readonly string[];
  readonly supportedLanguages?: readonly string[];
  readonly permissions: CapabilityPermissions;
  readonly decision: IntegrationDecision;
  readonly decisionReason?: string;
  readonly integrationMode?: CapabilityCandidate['integrationMode'];
  readonly cost?: CapabilityCost;
  readonly maintenance?: CapabilityMaintenance;
  readonly activity?: CapabilityActivity;
  readonly health?: CapabilityCandidate['health'];
  readonly security?: CapabilityCandidate['security'];
  readonly aliases?: readonly CapabilitySourceAlias[];
  readonly relationships?: readonly CapabilityRelationship[];
  readonly benchmarks?: readonly CapabilityBenchmark[];
  readonly roi?: CapabilityRoiEstimate;
  readonly createdAt?: string;
  readonly lastAuditedAt?: string;
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}
