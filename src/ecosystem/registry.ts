import { deduplicateCapabilities, type CapabilityDuplicateMatch } from './deduplicate.js';
import { serializeCapabilityManifest } from './importer.js';
import { normalizeCapabilityCandidate, serializeCapabilityCandidate } from './normalize.js';
import { isGeneratedFuryTrustReport, MAX_STATIC_EVIDENCE_FILES, MAX_STATIC_EVIDENCE_TOTAL_BYTES } from '../fury-trust.js';
import type { FuryTrustReport, FuryTrustVerdict } from '../fury-trust.js';
import { CAPABILITY_TYPES } from './types.js';
import type {
  CapabilityCandidate,
  CapabilityLicenseStatus,
  CapabilityPermissions,
  CapabilityPinStatus,
  CapabilityType,
  IntegrationDecision,
  ProvenanceClassification,
} from './types.js';

export const MAX_CAPABILITY_REGISTRY_SIZE = 5_000;

export interface CapabilityRegistryQuery {
  readonly query?: string;
  readonly types?: readonly CapabilityType[];
  readonly categories?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly domains?: readonly string[];
  readonly provenance?: readonly ProvenanceClassification[];
  readonly licenseStatuses?: readonly CapabilityLicenseStatus[];
  readonly decisions?: readonly IntegrationDecision[];
  readonly pinStatuses?: readonly CapabilityPinStatus[];
  readonly trustVerdicts?: readonly FuryTrustVerdict[];
  readonly permissions?: Partial<CapabilityPermissions>;
  readonly excludePermissions?: Partial<CapabilityPermissions>;
}

export type CapabilityRegistrationStatus = 'registered' | 'duplicate' | 'identity-conflict';

export interface CapabilityRegistrationResult {
  readonly status: CapabilityRegistrationStatus;
  readonly candidate: CapabilityCandidate;
  readonly duplicateMatches: readonly CapabilityDuplicateMatch[];
}

export interface CapabilityRegistry {
  register(value: unknown): CapabilityRegistrationResult;
  recordTrustReport(report: FuryTrustReport): void;
  getTrustReport(candidateId: string): FuryTrustReport | undefined;
  get(idOrCanonicalUrl: string): CapabilityCandidate | undefined;
  list(query?: CapabilityRegistryQuery): readonly CapabilityCandidate[];
  serialize(): string;
  readonly size: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateFilterList(value: unknown, label: string, allowed?: readonly string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 128) throw new Error(`${label} must contain at most 128 values`);
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 256 || /[\u0000-\u001f\u007f]/u.test(item)) {
      throw new Error(`${label} contains an invalid value`);
    }
    if (allowed && !allowed.includes(item)) throw new Error(`${label} contains an unsupported value`);
    if (seen.has(item)) throw new Error(`${label} contains duplicate values`);
    seen.add(item);
  }
}

function validateQuery(value: CapabilityRegistryQuery): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('registry query is invalid');
  const allowedKeys = new Set([
    'query', 'types', 'categories', 'capabilities', 'domains', 'provenance', 'licenseStatuses',
    'decisions', 'pinStatuses', 'trustVerdicts', 'permissions', 'excludePermissions',
  ]);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error('registry query contains an unsupported field');
  validateFilterList(value.types, 'types', CAPABILITY_TYPES);
  validateFilterList(value.categories, 'categories');
  validateFilterList(value.capabilities, 'capabilities');
  validateFilterList(value.domains, 'domains');
  validateFilterList(value.provenance, 'provenance', ['FIRST_PARTY', 'OFFICIAL', 'VERIFIED_COMMUNITY', 'COMMUNITY', 'FORK', 'MIRROR', 'UNKNOWN']);
  validateFilterList(value.licenseStatuses, 'licenseStatuses', ['VERIFIED', 'MISSING', 'AMBIGUOUS', 'INCOMPATIBLE', 'UNKNOWN']);
  validateFilterList(value.decisions, 'decisions', ['ADOPT', 'PORT', 'ADAPT', 'WRAP', 'REFERENCE_ONLY', 'REJECT']);
  validateFilterList(value.pinStatuses, 'pinStatuses', ['PINNED', 'UNPINNED', 'MUTABLE_SOURCE']);
  validateFilterList(value.trustVerdicts, 'trustVerdicts', ['TRUSTED', 'AUDITED', 'RESTRICTED', 'QUARANTINED', 'BLOCKED', 'UNKNOWN']);
  if (value.query !== undefined) {
    if (typeof value.query !== 'string' || value.query.length > 256 || /[\u0000-\u001f\u007f]/u.test(value.query)) {
      throw new Error('registry query exceeds its text limit');
    }
    if (value.query.trim().split(/\s+/u).filter(Boolean).length > 16) throw new Error('registry query exceeds its term limit');
  }
  for (const [permissionField, label] of [[value.permissions, 'permissions'], [value.excludePermissions, 'excludePermissions']] as const) {
    if (permissionField === undefined) continue;
    if (permissionField === null || typeof permissionField !== 'object' || Array.isArray(permissionField)) {
      throw new Error(`registry ${label} filter is invalid`);
    }
    const allowedPermissions = new Set(['network', 'filesystem', 'subprocess', 'credentials', 'externalWrites', 'database', 'browser', 'provider', 'cloud']);
    for (const [key, permission] of Object.entries(permissionField)) {
      if (!allowedPermissions.has(key)) throw new Error('registry permission filter contains an unsupported field');
      if (key === 'externalWrites') {
        validateFilterList(permission, 'externalWrites', ['communication', 'publish', 'deploy', 'financial', 'infrastructure', 'database', 'admin']);
      } else {
        const enumValues: Readonly<Record<string, readonly string[]>> = {
          network: ['none', 'restricted', 'arbitrary'],
          filesystem: ['none', 'read', 'write', 'delete', 'arbitrary-write'],
          subprocess: ['none', 'restricted', 'arbitrary'],
          credentials: ['none', 'read', 'use', 'manage'],
          database: ['none', 'read', 'scoped-write', 'admin'],
          browser: ['none', 'read', 'interact'],
          provider: ['none', 'invoke', 'configure'],
          cloud: ['none', 'read', 'scoped-write', 'admin'],
        };
        if (typeof permission !== 'string' || !enumValues[key]!.includes(permission)) throw new Error(`registry permission filter ${key} is invalid`);
      }
    }
  }
}

function matchesQuery(candidate: CapabilityCandidate, query: CapabilityRegistryQuery): boolean {
  if (query.types && !query.types.includes(candidate.type)) return false;
  if (query.categories && !query.categories.every((category) => candidate.categories.includes(category))) return false;
  if (query.capabilities && !query.capabilities.every((capability) => candidate.capabilities.includes(capability))) return false;
  if (query.domains && !query.domains.every((domain) => candidate.domains.includes(domain))) return false;
  if (query.provenance && !query.provenance.includes(candidate.provenance.classification)) return false;
  if (query.licenseStatuses && !query.licenseStatuses.includes(candidate.license.status)) return false;
  if (query.decisions && !query.decisions.includes(candidate.decision)) return false;
  if (query.pinStatuses && !query.pinStatuses.includes(candidate.source.pinStatus)) return false;
  if (query.permissions) {
    for (const [key, value] of Object.entries(query.permissions)) {
      if (key === 'externalWrites') {
        if (!Array.isArray(value) || !(value as readonly string[]).every((permission) => candidate.permissions.externalWrites.includes(permission as never))) return false;
      } else if (candidate.permissions[key as keyof CapabilityPermissions] !== value) return false;
    }
  }
  if (query.excludePermissions) {
    for (const [key, value] of Object.entries(query.excludePermissions)) {
      if (key === 'externalWrites') {
        if (Array.isArray(value) && value.some((permission) => candidate.permissions.externalWrites.includes(permission as never))) return false;
      } else if (candidate.permissions[key as keyof CapabilityPermissions] === value) return false;
    }
  }
  if (query.query !== undefined) {
    const terms = query.query.normalize('NFKC').toLowerCase().trim().split(/\s+/u).filter(Boolean);
    const haystack = [
      candidate.id,
      candidate.name,
      candidate.description,
      candidate.publisher ?? '',
      ...candidate.authors,
      ...candidate.categories,
      ...candidate.capabilities,
      ...candidate.domains,
      ...candidate.supportedStages,
      ...candidate.supportedPlatforms,
      ...candidate.supportedModels,
      ...candidate.supportedLanguages,
      candidate.type,
      ...candidate.aliases.map((alias) => alias.value),
      ...candidate.source.package ? [`${candidate.source.package.ecosystem}:${candidate.source.package.name}`] : [],
    ].join('\n').normalize('NFKC').toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

export function createCapabilityRegistry(initial: readonly unknown[] = []): CapabilityRegistry {
  if (!Array.isArray(initial) || initial.length > MAX_CAPABILITY_REGISTRY_SIZE) {
    throw new Error(`capability registry accepts at most ${MAX_CAPABILITY_REGISTRY_SIZE} initial candidates`);
  }
  const entries = new Map<string, CapabilityCandidate>();
  const trustReports = new Map<string, FuryTrustReport>();
  const byDeduplicationKey = new Map<string, Set<CapabilityCandidate>>();
  const byCanonicalUrl = new Map<string, Set<CapabilityCandidate>>();
  const byRelationshipTarget = new Map<string, Set<CapabilityCandidate>>();

  const index = (map: Map<string, Set<CapabilityCandidate>>, key: string, candidate: CapabilityCandidate): void => {
    const bucket = map.get(key) ?? new Set<CapabilityCandidate>();
    bucket.add(candidate);
    map.set(key, bucket);
  };

  const deduplicationKeys = (candidate: CapabilityCandidate): readonly string[] => {
    const keys = [
      `canonical:${candidate.id}`,
      `url-alias:${candidate.canonicalUrl}`,
      ...(candidate.source.contentSha256 ? [`digest:${candidate.source.contentSha256}`] : []),
      ...(candidate.identity.repository ? [`repository:${candidate.identity.repository}`] : []),
      ...candidate.aliases.map((alias) => `alias:${alias.kind}:${alias.value}`),
      ...candidate.aliases.filter((alias) => alias.kind !== 'package').map((alias) => `url-alias:${alias.value}`),
      ...(candidate.source.package
        ? [`package:${candidate.source.package.ecosystem}:${candidate.source.package.name}${candidate.source.package.version ? `@${candidate.source.package.version}` : ''}`]
        : []),
      `semantic:${candidate.type}:${candidate.publisher?.normalize('NFKC').toLowerCase() ?? ''}:${candidate.name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`,
    ];
    return Object.freeze(keys);
  };

  const indexCandidate = (candidate: CapabilityCandidate): void => {
    entries.set(candidate.id, candidate);
    for (const key of deduplicationKeys(candidate)) index(byDeduplicationKey, key, candidate);
    index(byCanonicalUrl, candidate.canonicalUrl, candidate);
    for (const relationship of candidate.relationships) index(byRelationshipTarget, relationship.targetUrl, candidate);
  };

  const register = (value: unknown): CapabilityRegistrationResult => {
    const candidate = normalizeCapabilityCandidate(value);
    const current = entries.get(candidate.id);
    if (current) {
      const status: CapabilityRegistrationStatus = serializeCapabilityCandidate(current) === serializeCapabilityCandidate(candidate)
        ? 'duplicate'
        : 'identity-conflict';
      return Object.freeze({ status, candidate: current, duplicateMatches: Object.freeze([]) });
    }
    if (entries.size >= MAX_CAPABILITY_REGISTRY_SIZE) throw new Error('capability registry size limit reached');
    const possibleMatches = new Set<CapabilityCandidate>();
    for (const key of deduplicationKeys(candidate)) {
      for (const existing of byDeduplicationKey.get(key) ?? []) possibleMatches.add(existing);
    }
    for (const relationship of candidate.relationships) {
      for (const existing of byCanonicalUrl.get(relationship.targetUrl) ?? []) possibleMatches.add(existing);
    }
    for (const existing of byRelationshipTarget.get(candidate.canonicalUrl) ?? []) possibleMatches.add(existing);
    const duplicateMatches = deduplicateCapabilities([candidate, ...possibleMatches]).filter((match) =>
      match.leftId === candidate.id || match.rightId === candidate.id);
    indexCandidate(candidate);
    return Object.freeze({ status: 'registered', candidate, duplicateMatches });
  };

  for (const value of initial) {
    const result = register(value);
    if (result.status !== 'registered') throw new Error(`initial capability registry contains a duplicate identity: ${result.candidate.id}`);
  }

  const registry: CapabilityRegistry = {
    register,
    recordTrustReport(report) {
      const reportKeys = new Set([
        'format', 'policyVersion', 'candidateId', 'integrationDecision', 'verdict', 'riskScore', 'confidence',
        'findings', 'requiredApprovals', 'blockingReasons', 'evidence', 'scannedFileCount', 'scannedByteCount',
        'evidenceCoverage', 'runtimeVerified', 'executionAuthorized',
      ]);
      if (!report || report.format !== 'furypipe-trust-report/v1'
        || !isGeneratedFuryTrustReport(report)
        || report.policyVersion !== 'furytrust-static-v1'
        || Object.keys(report).some((key) => !reportKeys.has(key))
        || !entries.has(report.candidateId)
        || !['TRUSTED', 'AUDITED', 'RESTRICTED', 'QUARANTINED', 'BLOCKED', 'UNKNOWN'].includes(report.verdict)
        || report.runtimeVerified !== false
        || report.executionAuthorized !== false
        || !Number.isSafeInteger(report.riskScore) || report.riskScore < 0 || report.riskScore > 100
        || !Number.isSafeInteger(report.scannedFileCount) || report.scannedFileCount < 0 || report.scannedFileCount > MAX_STATIC_EVIDENCE_FILES
        || !Number.isSafeInteger(report.scannedByteCount) || report.scannedByteCount < 0 || report.scannedByteCount > MAX_STATIC_EVIDENCE_TOTAL_BYTES
        || !['NO_SOURCE_TEXT_SUPPLIED', 'CALLER_SUPPLIED_TEXT_ONLY'].includes(report.evidenceCoverage)
        || (report.scannedFileCount === 0) !== (report.evidenceCoverage === 'NO_SOURCE_TEXT_SUPPLIED')
        || !Array.isArray(report.findings) || report.findings.length > 2_048
        || !['LOW', 'MEDIUM', 'HIGH'].includes(report.confidence)
        || !Array.isArray(report.requiredApprovals) || report.requiredApprovals.length > 16
        || !Array.isArray(report.blockingReasons) || report.blockingReasons.length > 2_048
        || !Array.isArray(report.evidence) || report.evidence.length > 256) {
        throw new Error('trust report is invalid or was not generated by the in-process FuryTrust policy');
      }
      const secretPattern = /(?:\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,})/iu;
      for (const item of report.findings) {
        const findingKeys = new Set(['code', 'severity', 'category', 'evidencePath', 'count']);
        if (!item || Object.keys(item).some((key) => !findingKeys.has(key))
          || typeof item.code !== 'string' || !/^[A-Z0-9_]{1,80}$/u.test(item.code)
          || !['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(item.severity)
          || !['metadata', 'permission', 'static-pattern', 'operator-review'].includes(item.category)
          || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 100
          || (item.evidencePath !== undefined && (typeof item.evidencePath !== 'string' || !item.evidencePath.trim()
            || item.evidencePath.length > 256 || item.evidencePath.startsWith('/') || /^[A-Za-z]:/u.test(item.evidencePath)
            || item.evidencePath.split(/[\\/]/u).includes('..') || /[\u0000-\u001f\u007f]/u.test(item.evidencePath)
            || secretPattern.test(item.evidencePath)))) {
          throw new Error('trust report contains an invalid finding');
        }
      }
      if (new Set(report.requiredApprovals).size !== report.requiredApprovals.length) throw new Error('trust report contains duplicate approvals');
      for (const approval of report.requiredApprovals) {
        if (!['SOURCE_PIN_REVIEW', 'PROVENANCE_REVIEW', 'LICENSE_REVIEW', 'SECURITY_REVIEW', 'OPERATOR_REVIEW', 'RUNTIME_SANDBOX'].includes(approval)) {
          throw new Error('trust report contains an invalid approval requirement');
        }
      }
      for (const reason of report.blockingReasons) {
        if (typeof reason !== 'string' || !/^[A-Z0-9_]{1,80}$/u.test(reason)) throw new Error('trust report contains an invalid blocking reason');
      }
      for (const item of report.evidence) {
        const evidenceKeys = new Set(['kind', 'reference']);
        if (!item || Object.keys(item).some((key) => !evidenceKeys.has(key))
          || !['source-text', 'provenance', 'license', 'operator-review'].includes(item.kind)
          || typeof item.reference !== 'string' || !item.reference.trim() || item.reference.length > 512
          || /[\u0000-\u001f\u007f]/u.test(item.reference) || secretPattern.test(item.reference)) {
          throw new Error('trust report contains an invalid evidence reference');
        }
      }
      const snapshot: FuryTrustReport = Object.freeze({
        ...report,
        findings: Object.freeze(report.findings.map((item) => Object.freeze({ ...item }))),
        requiredApprovals: Object.freeze([...report.requiredApprovals]),
        blockingReasons: Object.freeze([...report.blockingReasons]),
        evidence: Object.freeze(report.evidence.map((item) => Object.freeze({ ...item }))),
      });
      trustReports.set(report.candidateId, snapshot);
    },
    getTrustReport(candidateId) {
      return trustReports.get(candidateId);
    },
    get(idOrCanonicalUrl) {
      const direct = entries.get(idOrCanonicalUrl);
      if (direct) return direct;
      const identity = idOrCanonicalUrl.startsWith('furypipe-capability/v1:')
        ? idOrCanonicalUrl.slice('furypipe-capability/v1:'.length).replace(/#(?:commit|sha256|version|ref|unversioned).+$/u, '')
        : idOrCanonicalUrl;
      const matches = byCanonicalUrl.get(identity);
      return matches?.size === 1 ? matches.values().next().value : undefined;
    },
    list(query = {}) {
      validateQuery(query);
      const result = [...entries.values()].filter((candidate) => {
        if (!matchesQuery(candidate, query)) return false;
        if (query.trustVerdicts) {
          const report = trustReports.get(candidate.id);
          if (!report || !query.trustVerdicts.includes(report.verdict)) return false;
        }
        return true;
      });
      result.sort((a, b) => compareText(a.type, b.type)
        || compareText(a.name.normalize('NFKC').toLowerCase(), b.name.normalize('NFKC').toLowerCase())
        || compareText(a.id, b.id));
      return Object.freeze(result);
    },
    serialize() {
      return serializeCapabilityManifest(registry.list());
    },
    get size() {
      return entries.size;
    },
  };
  return Object.freeze(registry);
}
