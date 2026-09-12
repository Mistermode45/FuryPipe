import {
  CAPABILITY_CANDIDATE_FORMAT,
  CAPABILITY_TYPES,
  type CapabilityActivity,
  type CapabilityAliasKind,
  type CapabilityBenchmark,
  type CapabilityCandidate,
  type CapabilityCost,
  type CapabilityCostModel,
  type CapabilityLicense,
  type CapabilityLicenseStatus,
  type CapabilityMaintenance,
  type CapabilityPinStatus,
  type CapabilityProvenance,
  type CapabilityRelationship,
  type CapabilityRelationshipKind,
  type CapabilitySourceAlias,
  type CapabilitySourceKind,
  type CapabilityType,
  type IntegrationDecision,
  type JsonValue,
  type MaintenanceStatus,
  type ProvenanceClassification,
  type ProvenanceReviewStatus,
  type RawCapabilityCandidate,
} from './types.js';

export const MAX_CANDIDATE_JSON_BYTES = 1_048_576;
export const MAX_CAPABILITY_DESCRIPTION_CHARS = 8_192;
export const MAX_CAPABILITY_URL_CHARS = 2_048;
export const CAPABILITY_ID_PREFIX = 'furypipe-capability/v1:';

const SECRET_MATERIAL = /(?:\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,})/u;
const HEX_SHA1_OR_SHA256 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u;
const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const MUTABLE_VERSION = /^(?:main|master|head|latest|stable|nightly|next)$/iu;
const PERMISSION_LEVELS = {
  network: new Set(['none', 'restricted', 'arbitrary']),
  filesystem: new Set(['none', 'read', 'write', 'delete', 'arbitrary-write']),
  subprocess: new Set(['none', 'restricted', 'arbitrary']),
  credentials: new Set(['none', 'read', 'use', 'manage']),
  database: new Set(['none', 'read', 'scoped-write', 'admin']),
  browser: new Set(['none', 'read', 'interact']),
  provider: new Set(['none', 'invoke', 'configure']),
  cloud: new Set(['none', 'read', 'scoped-write', 'admin']),
} as const;
const EXTERNAL_WRITES = ['communication', 'publish', 'deploy', 'financial', 'infrastructure', 'database', 'admin'] as const;

type RecordValue = Record<string, unknown>;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function record(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${label} contains an unsupported field`);
  }
}

function text(value: unknown, label: string, max: number, options: { multiline?: boolean; allowEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  if (hasUnpairedSurrogate(value)) throw new Error(`${label} contains malformed Unicode`);
  const normalized = value.normalize('NFC').trim();
  const control = options.multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if ((!options.allowEmpty && normalized.length === 0) || normalized.length > max || control.test(normalized)) {
    throw new Error(`${label} must be bounded printable text`);
  }
  if (SECRET_MATERIAL.test(normalized)) throw new Error(`${label} contains credential-like material; secret values are not accepted`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number, multiline = false): string | undefined {
  return value === undefined ? undefined : text(value, label, max, { multiline });
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function safeInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function finiteAmount(value: unknown, label: string, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a finite non-negative amount`);
  }
  return value;
}

function finiteDelta(value: unknown, label: string, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -max || value > max) {
    throw new Error(`${label} must be a finite bounded delta`);
  }
  return value;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringList(value: unknown, label: string, maxItems = 64, itemMax = 128): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} exceeds its item limit`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`, itemMax));
  if (new Set(result.map((item) => item.normalize('NFKC').toLowerCase())).size !== result.length) {
    throw new Error(`${label} contains duplicate values`);
  }
  result.sort(compareText);
  return Object.freeze(result);
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 40 || (!ISO_DATE_TIME.test(value) && !ISO_DATE_ONLY.test(value))) {
    throw new Error(`${label} must be an ISO date or date-time`);
  }
  const datePart = value.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) {
    throw new Error(`${label} contains an invalid calendar date`);
  }
  if (ISO_DATE_TIME.test(value)) {
    const match = /T(\d{2}):(\d{2}):(\d{2})/u.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) {
      throw new Error(`${label} contains an invalid time`);
    }
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO date-time`);
  return new Date(time).toISOString();
}

function canonicalUrl(value: unknown, label: string, allowInternal = false, repository = false): string {
  const input = text(value, label, MAX_CAPABILITY_URL_CHARS);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query parameters or fragments`);
  }

  if (url.protocol === 'furypipe:' && allowInternal) {
    if (url.hostname.toLowerCase() !== 'local' || url.port || !url.pathname || url.pathname === '/') {
      throw new Error(`${label} must use furypipe://local/<stable-path>`);
    }
    const path = url.pathname.normalize('NFC').replace(/\/+$/u, '').toLowerCase();
    if (path.split('/').some((part) => part === '.' || part === '..')) throw new Error(`${label} has an invalid path`);
    return `furypipe://local${path}`;
  }

  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error(`${label} must be credential-free HTTPS`);
  }
  const host = url.hostname.toLowerCase();
  let path = url.pathname.normalize('NFC').replace(/\/+$/u, '');
  if (repository) {
    path = path.replace(/\.git$/iu, '');
    if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(host)) path = path.toLowerCase();
  }
  const authority = url.port ? `${host}:${url.port}` : host;
  return `https://${authority}${path}`;
}

function sourceKind(value: unknown): CapabilitySourceKind {
  return enumValue(value, ['git', 'package', 'marketplace', 'service', 'internal'] as const, 'source.kind');
}

function mutableRefInUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    const marker = parts[index]!.toLowerCase();
    if (marker === 'tree' || marker === 'branches' || marker === 'tags') {
      return parts.slice(index + 1).join('/').slice(0, 256) || undefined;
    }
    if (marker === 'refs' && (parts[index + 1]?.toLowerCase() === 'heads' || parts[index + 1]?.toLowerCase() === 'tags')) {
      return parts.slice(index + 2).join('/').slice(0, 256) || undefined;
    }
  }
  return undefined;
}

function normalizeSource(value: unknown): CapabilityCandidate['source'] {
  const input = record(value, 'source');
  exactKeys(input, ['kind', 'url', 'repositoryUrl', 'package', 'version', 'commitSha', 'contentSha256', 'mutableRef', 'pinStatus'], 'source');
  const kind = sourceKind(input.kind);
  const url = canonicalUrl(input.url, 'source.url', kind === 'internal', kind === 'git');
  if (kind === 'internal' && !url.startsWith('furypipe://')) throw new Error('internal sources must use furypipe:// URLs');
  if (kind !== 'internal' && url.startsWith('furypipe://')) throw new Error('furypipe:// URLs are reserved for internal sources');
  const repositoryUrl = input.repositoryUrl === undefined
    ? undefined
    : canonicalUrl(input.repositoryUrl, 'source.repositoryUrl', false, true);
  if (kind === 'git' && repositoryUrl === undefined && !url.startsWith('https://')) {
    throw new Error('git sources require an HTTPS repository URL');
  }

  let packageInfo: CapabilityCandidate['source']['package'];
  if (input.package !== undefined) {
    const pkg = record(input.package, 'source.package');
    exactKeys(pkg, ['ecosystem', 'name', 'version'], 'source.package');
    const ecosystem = text(pkg.ecosystem, 'source.package.ecosystem', 32).toLowerCase();
    if (!/^[a-z0-9][a-z0-9.+_-]{0,31}$/u.test(ecosystem)) throw new Error('source.package.ecosystem is invalid');
    const name = text(pkg.name, 'source.package.name', 214).toLowerCase();
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) throw new Error('source.package.name is invalid');
    const version = optionalText(pkg.version, 'source.package.version', 128);
    if (version !== undefined && !SEMVER.test(version) && !MUTABLE_VERSION.test(version)) throw new Error('source.package.version must be an exact semantic version or an explicit mutable label');
    packageInfo = Object.freeze({ ecosystem, name, ...(version ? { version } : {}) });
  }
  if (kind === 'package' && packageInfo === undefined) throw new Error('package sources require package coordinates');

  const version = optionalText(input.version, 'source.version', 128);
  if (version !== undefined && !SEMVER.test(version) && !MUTABLE_VERSION.test(version)) throw new Error('source.version must be an exact semantic version or an explicit mutable label');
  const commitShaRaw = optionalText(input.commitSha, 'source.commitSha', 64);
  const commitSha = commitShaRaw?.toLowerCase();
  if (commitSha !== undefined && !HEX_SHA1_OR_SHA256.test(commitSha)) throw new Error('source.commitSha must be a full 40- or 64-character hexadecimal commit');
  const contentSha256Raw = optionalText(input.contentSha256, 'source.contentSha256', 64);
  const contentSha256 = contentSha256Raw?.toLowerCase();
  if (contentSha256 !== undefined && !SHA256.test(contentSha256)) throw new Error('source.contentSha256 must be a 64-character SHA-256');
  const suppliedMutableRef = optionalText(input.mutableRef, 'source.mutableRef', 256);
  const mutableRef = suppliedMutableRef
    ?? (version && MUTABLE_VERSION.test(version) ? version : undefined)
    ?? (packageInfo?.version && MUTABLE_VERSION.test(packageInfo.version) ? packageInfo.version : undefined)
    ?? mutableRefInUrl(url)
    ?? mutableRefInUrl(repositoryUrl ?? url);
  const pinStatus: CapabilityPinStatus = commitSha || contentSha256
    ? 'PINNED'
    : mutableRef
      ? 'MUTABLE_SOURCE'
      : 'UNPINNED';
  if (input.pinStatus !== undefined && input.pinStatus !== pinStatus) throw new Error('source.pinStatus does not match the supplied immutable pin');

  return Object.freeze({
    kind,
    url,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(packageInfo ? { package: packageInfo } : {}),
    ...(version ? { version } : {}),
    ...(commitSha ? { commitSha } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(mutableRef ? { mutableRef } : {}),
    pinStatus,
  });
}

function normalizeProvenance(value: unknown): CapabilityProvenance {
  const input = record(value, 'provenance');
  exactKeys(input, ['classification', 'reviewStatus', 'evidence'], 'provenance');
  const classification = enumValue(input.classification, [
    'FIRST_PARTY', 'OFFICIAL', 'VERIFIED_COMMUNITY', 'COMMUNITY', 'FORK', 'MIRROR', 'UNKNOWN',
  ] as const, 'provenance.classification') as ProvenanceClassification;
  const reviewStatus = enumValue(input.reviewStatus, ['UNREVIEWED', 'REVIEWED'] as const, 'provenance.reviewStatus') as ProvenanceReviewStatus;
  if (!Array.isArray(input.evidence) || input.evidence.length > 32) throw new Error('provenance.evidence exceeds its item limit');
  const evidence = input.evidence.map((item, index) => {
    const row = record(item, `provenance.evidence[${index}]`);
    exactKeys(row, ['kind', 'reference'], `provenance.evidence[${index}]`);
    const kind = enumValue(row.kind, [
      'official-domain', 'signed-release', 'repository-link', 'maintainer-statement', 'manual-review', 'other',
    ] as const, 'provenance evidence kind');
    const reference = text(row.reference, 'provenance evidence reference', 512);
    return Object.freeze({ kind, reference });
  });
  const evidenceKeys = evidence.map((item) => `${item.kind}:${item.reference}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) throw new Error('provenance.evidence contains duplicates');
  evidence.sort((a, b) => compareText(`${a.kind}:${a.reference}`, `${b.kind}:${b.reference}`));
  if (reviewStatus === 'REVIEWED' && evidence.length === 0) throw new Error('reviewed provenance requires at least one evidence reference');
  return Object.freeze({ classification, reviewStatus, evidence: Object.freeze(evidence) });
}

function normalizeLicense(value: unknown): CapabilityLicense {
  const input = record(value, 'license');
  exactKeys(input, ['status', 'declaredSpdx', 'discoveredSpdx', 'spdx', 'source', 'evidence', 'evidenceUrl', 'reviewedAt', 'conflict'], 'license');
  const status = enumValue(input.status, ['VERIFIED', 'MISSING', 'AMBIGUOUS', 'INCOMPATIBLE', 'UNKNOWN'] as const, 'license.status') as CapabilityLicenseStatus;
  const legacySpdx = optionalText(input.spdx, 'license.spdx', 64);
  const declaredSpdx = optionalText(input.declaredSpdx, 'license.declaredSpdx', 64) ?? legacySpdx;
  const discoveredSpdx = optionalText(input.discoveredSpdx, 'license.discoveredSpdx', 64) ?? legacySpdx;
  for (const [label, spdx] of [['declaredSpdx', declaredSpdx], ['discoveredSpdx', discoveredSpdx]] as const) {
    if (spdx !== undefined && !SPDX.test(spdx)) throw new Error(`license.${label} is invalid`);
  }
  const source = enumValue(input.source ?? 'unknown', ['repository-file', 'registry-metadata', 'official-source', 'operator-review', 'unknown'] as const, 'license.source');
  const evidenceUrl = input.evidenceUrl === undefined ? undefined : canonicalUrl(input.evidenceUrl, 'license.evidenceUrl');
  const reviewedAt = input.reviewedAt === undefined ? undefined : isoDate(input.reviewedAt, 'license.reviewedAt');
  if (reviewedAt !== undefined && status !== 'VERIFIED') throw new Error('license.reviewedAt is only valid for a verified license');
  const evidenceInput: unknown = input.evidence ?? [];
  if (!Array.isArray(evidenceInput) || evidenceInput.length > 16) throw new Error('license.evidence exceeds its item limit');
  const evidence: Array<CapabilityLicense['evidence'][number]> = evidenceInput.map((item: unknown, index: number) => {
    const row = record(item, `license.evidence[${index}]`);
    exactKeys(row, ['kind', 'reference'], `license.evidence[${index}]`);
    const kind = enumValue(row.kind, ['repository-file', 'registry-metadata', 'official-source', 'manual-review', 'other'] as const, 'license evidence kind');
    return Object.freeze({ kind, reference: text(row.reference, 'license evidence reference', 512) });
  });
  if (evidenceUrl && !evidence.some((item) => item.reference === evidenceUrl)) evidence.push(Object.freeze({ kind: 'repository-file' as const, reference: evidenceUrl }));
  const conflict = declaredSpdx !== undefined && discoveredSpdx !== undefined && declaredSpdx !== discoveredSpdx;
  if (input.conflict !== undefined && input.conflict !== conflict) throw new Error('license.conflict does not match declared and discovered values');
  if (status === 'VERIFIED' && (!discoveredSpdx || source === 'unknown' || !reviewedAt || evidence.length === 0 || conflict)) {
    throw new Error('verified license requires a resolved SPDX value, evidence source and review timestamp without a conflict');
  }
  const spdx = discoveredSpdx ?? declaredSpdx;
  return Object.freeze({
    status,
    ...(declaredSpdx ? { declaredSpdx } : {}),
    ...(discoveredSpdx ? { discoveredSpdx } : {}),
    ...(spdx ? { spdx } : {}),
    source,
    evidence: Object.freeze(evidence.sort((a, b) => compareText(`${a.kind}:${a.reference}`, `${b.kind}:${b.reference}`))),
    ...(evidenceUrl ? { evidenceUrl } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
    conflict,
  });
}

function normalizePermissions(value: unknown): CapabilityCandidate['permissions'] {
  const input = record(value, 'permissions');
  const keys = ['network', 'filesystem', 'subprocess', 'credentials', 'externalWrites', 'database', 'browser', 'provider', 'cloud'] as const;
  exactKeys(input, keys, 'permissions');
  const result: Record<string, string | readonly string[]> = {};
  for (const key of keys) {
    if (key === 'externalWrites') {
      if (!Array.isArray(input[key]) || input[key].length > EXTERNAL_WRITES.length) throw new Error('permissions.externalWrites is invalid');
      const writes = input[key].map((item, index) => enumValue(item, EXTERNAL_WRITES, `permissions.externalWrites[${index}]`));
      if (new Set(writes).size !== writes.length) throw new Error('permissions.externalWrites contains duplicates');
      result[key] = Object.freeze(writes.sort(compareText));
      continue;
    }
    if (!PERMISSION_LEVELS[key].has(input[key] as never)) throw new Error(`permissions.${key} is invalid`);
    result[key] = input[key] as string;
  }
  return Object.freeze(result) as unknown as CapabilityCandidate['permissions'];
}

function normalizeCost(value: unknown): CapabilityCost {
  if (value === undefined) return Object.freeze({ model: 'UNKNOWN' });
  const input = record(value, 'cost');
  exactKeys(input, ['model', 'currency', 'amount', 'period'], 'cost');
  const model = enumValue(input.model, ['FREE', 'PAID', 'SUBSCRIPTION', 'USAGE_BASED', 'CUSTOM', 'UNKNOWN'] as const, 'cost.model') as CapabilityCostModel;
  const currency = optionalText(input.currency, 'cost.currency', 3)?.toUpperCase();
  if (currency !== undefined && !/^[A-Z]{3}$/u.test(currency)) throw new Error('cost.currency must be a three-letter currency code');
  const amount = input.amount === undefined ? undefined : finiteAmount(input.amount, 'cost.amount');
  if (amount !== undefined && currency === undefined) throw new Error('cost.amount requires cost.currency');
  if (model === 'UNKNOWN' && (currency !== undefined || amount !== undefined || input.period !== undefined)) {
    throw new Error('unknown cost must not include a price');
  }
  const period = input.period === undefined ? undefined : enumValue(input.period, ['once', 'hour', 'month', 'year', 'usage'] as const, 'cost.period');
  return Object.freeze({ model, ...(currency ? { currency } : {}), ...(amount !== undefined ? { amount } : {}), ...(period ? { period } : {}) });
}

function normalizeMaintenance(value: unknown): CapabilityMaintenance {
  if (value === undefined) return Object.freeze({ status: 'UNKNOWN' });
  const input = record(value, 'maintenance');
  exactKeys(input, ['status', 'maintainerCount', 'lastActivityAt', 'lastReleaseAt'], 'maintenance');
  const status = enumValue(input.status, ['ACTIVE', 'MAINTENANCE', 'ARCHIVED', 'UNKNOWN'] as const, 'maintenance.status') as MaintenanceStatus;
  const maintainerCount = input.maintainerCount === undefined ? undefined : safeInteger(input.maintainerCount, 'maintenance.maintainerCount', 10_000);
  const lastActivityAt = input.lastActivityAt === undefined ? undefined : isoDate(input.lastActivityAt, 'maintenance.lastActivityAt');
  const lastReleaseAt = input.lastReleaseAt === undefined ? undefined : isoDate(input.lastReleaseAt, 'maintenance.lastReleaseAt');
  return Object.freeze({ status, ...(maintainerCount !== undefined ? { maintainerCount } : {}), ...(lastActivityAt ? { lastActivityAt } : {}), ...(lastReleaseAt ? { lastReleaseAt } : {}) });
}

function normalizeActivity(value: unknown): CapabilityActivity {
  if (value === undefined) return Object.freeze({});
  const input = record(value, 'activity');
  exactKeys(input, ['stars', 'downloads', 'dependents', 'observedAt'], 'activity');
  const stars = input.stars === undefined ? undefined : safeInteger(input.stars, 'activity.stars', 1_000_000_000);
  const downloads = input.downloads === undefined ? undefined : safeInteger(input.downloads, 'activity.downloads', 1_000_000_000_000);
  const dependents = input.dependents === undefined ? undefined : safeInteger(input.dependents, 'activity.dependents', 1_000_000_000);
  const observedAt = input.observedAt === undefined ? undefined : isoDate(input.observedAt, 'activity.observedAt');
  return Object.freeze({ ...(stars !== undefined ? { stars } : {}), ...(downloads !== undefined ? { downloads } : {}), ...(dependents !== undefined ? { dependents } : {}), ...(observedAt ? { observedAt } : {}) });
}

function normalizeHealth(value: unknown): CapabilityCandidate['health'] {
  if (value === undefined) return Object.freeze({ status: 'UNKNOWN' });
  const input = record(value, 'health');
  exactKeys(input, ['status', 'observedAt', 'evidence'], 'health');
  const status = enumValue(input.status, ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'] as const, 'health.status');
  const observedAt = input.observedAt === undefined ? undefined : isoDate(input.observedAt, 'health.observedAt');
  const evidence = optionalText(input.evidence, 'health.evidence', 512);
  return Object.freeze({ status, ...(observedAt ? { observedAt } : {}), ...(evidence ? { evidence } : {}) });
}

function normalizeSecurity(value: unknown): CapabilityCandidate['security'] {
  if (value === undefined) return Object.freeze({ staticReviewStatus: 'UNKNOWN', advisoryIds: Object.freeze([]) });
  const input = record(value, 'security');
  exactKeys(input, ['staticReviewStatus', 'lastScannedAt', 'sourceFilesScanned', 'advisoryIds'], 'security');
  const staticReviewStatus = enumValue(input.staticReviewStatus, ['NOT_REVIEWED', 'PARTIAL', 'REVIEWED', 'UNKNOWN'] as const, 'security.staticReviewStatus');
  const lastScannedAt = input.lastScannedAt === undefined ? undefined : isoDate(input.lastScannedAt, 'security.lastScannedAt');
  const sourceFilesScanned = input.sourceFilesScanned === undefined ? undefined : safeInteger(input.sourceFilesScanned, 'security.sourceFilesScanned', 1_000_000);
  const advisoryIds = stringList(input.advisoryIds, 'security.advisoryIds', 128, 128);
  return Object.freeze({ staticReviewStatus, ...(lastScannedAt ? { lastScannedAt } : {}), ...(sourceFilesScanned !== undefined ? { sourceFilesScanned } : {}), advisoryIds });
}

function normalizeAliases(value: unknown): readonly CapabilitySourceAlias[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) throw new Error('aliases exceeds its item limit');
  const seen = new Set<string>();
  const aliases = value.map((item, index) => {
    const row = record(item, `aliases[${index}]`);
    exactKeys(row, ['kind', 'value'], `aliases[${index}]`);
    const kind = enumValue(row.kind, ['repository', 'package', 'marketplace', 'registry', 'service'] as const, 'alias.kind') as CapabilityAliasKind;
    let aliasValue = text(row.value, 'alias.value', 512);
    if (kind === 'package') {
      aliasValue = aliasValue.toLowerCase();
      if (!/^[a-z0-9.+_-]+:(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(aliasValue)) throw new Error('package aliases must use ecosystem:package-name');
    } else {
      aliasValue = canonicalUrl(aliasValue, 'alias.value', false, kind === 'repository');
    }
    const key = `${kind}:${aliasValue}`;
    if (seen.has(key)) throw new Error('aliases contains duplicate values');
    seen.add(key);
    return Object.freeze({ kind, value: aliasValue });
  });
  return Object.freeze(aliases.sort((a, b) => compareText(`${a.kind}:${a.value}`, `${b.kind}:${b.value}`)));
}

function normalizeRelationships(value: unknown): readonly CapabilityRelationship[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 32) throw new Error('relationships exceeds its item limit');
  const seen = new Set<string>();
  const relationships = value.map((item, index) => {
    const row = record(item, `relationships[${index}]`);
    exactKeys(row, ['kind', 'targetUrl'], `relationships[${index}]`);
    const kind = enumValue(row.kind, ['fork-of', 'mirror-of', 'renamed-from', 'package-for', 'marketplace-entry-for'] as const, 'relationship.kind') as CapabilityRelationshipKind;
    const targetUrl = canonicalUrl(row.targetUrl, 'relationship.targetUrl', true, true);
    const key = `${kind}:${targetUrl}`;
    if (seen.has(key)) throw new Error('relationships contains duplicate values');
    seen.add(key);
    return Object.freeze({ kind, targetUrl });
  });
  return Object.freeze(relationships.sort((a, b) => compareText(`${a.kind}:${a.targetUrl}`, `${b.kind}:${b.targetUrl}`)));
}

function normalizeBenchmarks(value: unknown): readonly CapabilityBenchmark[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) throw new Error('benchmarks exceeds its item limit');
  const seen = new Set<string>();
  const result = value.map((item, index) => {
    const row = record(item, `benchmarks[${index}]`);
    exactKeys(row, [
      'id', 'metric', 'value', 'unit', 'measuredAt', 'model', 'task', 'baselineScore', 'withCapabilityScore',
      'tokenDelta', 'latencyDelta', 'costDelta', 'regressions', 'sourceUrl', 'method',
    ], `benchmarks[${index}]`);
    const id = text(row.id, 'benchmark.id', 96);
    if (!ID.test(id) || seen.has(id)) throw new Error('benchmark.id is invalid or duplicated');
    seen.add(id);
    const metric = optionalText(row.metric, 'benchmark.metric', 96);
    const valueNumber = row.value === undefined ? undefined : finiteAmount(row.value, 'benchmark.value', 1_000_000_000_000);
    const unit = optionalText(row.unit, 'benchmark.unit', 48);
    const measuredAt = row.measuredAt === undefined ? undefined : isoDate(row.measuredAt, 'benchmark.measuredAt');
    const model = optionalText(row.model, 'benchmark.model', 128);
    const task = optionalText(row.task, 'benchmark.task', 256);
    const baselineScore = row.baselineScore === undefined ? undefined : finiteDelta(row.baselineScore, 'benchmark.baselineScore');
    const withCapabilityScore = row.withCapabilityScore === undefined ? undefined : finiteDelta(row.withCapabilityScore, 'benchmark.withCapabilityScore');
    const tokenDelta = row.tokenDelta === undefined ? undefined : finiteDelta(row.tokenDelta, 'benchmark.tokenDelta');
    const latencyDelta = row.latencyDelta === undefined ? undefined : finiteDelta(row.latencyDelta, 'benchmark.latencyDelta');
    const costDelta = row.costDelta === undefined ? undefined : finiteDelta(row.costDelta, 'benchmark.costDelta');
    const regressions = stringList(row.regressions, 'benchmark.regressions', 32, 256);
    const hasGenericMetric = metric !== undefined || valueNumber !== undefined || unit !== undefined;
    if (hasGenericMetric && (!metric || valueNumber === undefined || !unit || !measuredAt)) {
      throw new Error('generic benchmark data requires metric, value, unit and measuredAt');
    }
    if (!hasGenericMetric && (!model || !task || (baselineScore === undefined && withCapabilityScore === undefined))) {
      throw new Error('FuryBench data requires model, task and at least one score');
    }
    const sourceUrl = row.sourceUrl === undefined ? undefined : canonicalUrl(row.sourceUrl, 'benchmark.sourceUrl');
    const method = optionalText(row.method, 'benchmark.method', 1_024, true);
    return Object.freeze({
      id,
      ...(metric ? { metric } : {}),
      ...(valueNumber !== undefined ? { value: valueNumber } : {}),
      ...(unit ? { unit } : {}),
      ...(measuredAt ? { measuredAt } : {}),
      ...(model ? { model } : {}),
      ...(task ? { task } : {}),
      ...(baselineScore !== undefined ? { baselineScore } : {}),
      ...(withCapabilityScore !== undefined ? { withCapabilityScore } : {}),
      ...(tokenDelta !== undefined ? { tokenDelta } : {}),
      ...(latencyDelta !== undefined ? { latencyDelta } : {}),
      ...(costDelta !== undefined ? { costDelta } : {}),
      ...(regressions.length ? { regressions } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(method ? { method } : {}),
    });
  });
  return Object.freeze(result.sort((a, b) => compareText(a.id, b.id)));
}

function normalizeRoi(value: unknown): CapabilityCandidate['roi'] {
  if (value === undefined) return undefined;
  const input = record(value, 'roi');
  exactKeys(input, [
    'estimatedCostUsd', 'estimatedSavingsUsd', 'qualityGain', 'tokenDelta', 'timeDelta', 'costDelta',
    'userEffortDelta', 'confidence', 'sampleSize', 'benchmarkId',
  ], 'roi');
  const estimatedCostUsd = input.estimatedCostUsd === undefined ? undefined : finiteAmount(input.estimatedCostUsd, 'roi.estimatedCostUsd');
  const estimatedSavingsUsd = input.estimatedSavingsUsd === undefined ? undefined : finiteAmount(input.estimatedSavingsUsd, 'roi.estimatedSavingsUsd');
  const qualityGain = input.qualityGain === undefined ? undefined : finiteDelta(input.qualityGain, 'roi.qualityGain');
  const tokenDelta = input.tokenDelta === undefined ? undefined : finiteDelta(input.tokenDelta, 'roi.tokenDelta');
  const timeDelta = input.timeDelta === undefined ? undefined : finiteDelta(input.timeDelta, 'roi.timeDelta');
  const costDelta = input.costDelta === undefined ? undefined : finiteDelta(input.costDelta, 'roi.costDelta');
  const userEffortDelta = input.userEffortDelta === undefined ? undefined : finiteDelta(input.userEffortDelta, 'roi.userEffortDelta');
  const confidence = enumValue(input.confidence, ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const, 'roi.confidence');
  const sampleSize = input.sampleSize === undefined ? undefined : safeInteger(input.sampleSize, 'roi.sampleSize', 1_000_000_000, 1);
  const benchmarkId = optionalText(input.benchmarkId, 'roi.benchmarkId', 96);
  if (benchmarkId !== undefined && !ID.test(benchmarkId)) throw new Error('roi.benchmarkId is invalid');
  return Object.freeze({
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    ...(estimatedSavingsUsd !== undefined ? { estimatedSavingsUsd } : {}),
    ...(qualityGain !== undefined ? { qualityGain } : {}),
    ...(tokenDelta !== undefined ? { tokenDelta } : {}),
    ...(timeDelta !== undefined ? { timeDelta } : {}),
    ...(costDelta !== undefined ? { costDelta } : {}),
    ...(userEffortDelta !== undefined ? { userEffortDelta } : {}),
    confidence,
    ...(sampleSize !== undefined ? { sampleSize } : {}),
    ...(benchmarkId ? { benchmarkId } : {}),
  });
}

function normalizeJson(value: unknown, state: { nodes: number; chars: number }, label: string, depth = 0): JsonValue {
  state.nodes += 1;
  if (state.nodes > 2_048 || depth > 8) throw new Error(`${label} exceeds JSON complexity limits`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const result = text(value, label, 4_096, { multiline: true, allowEmpty: true });
    state.chars += result.length;
    if (state.chars > 65_536) throw new Error(`${label} exceeds the extension size limit`);
    return result;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) throw new Error(`${label} array exceeds its item limit`);
    const result = value.map((item) => normalizeJson(item, state, label, depth + 1));
    return Object.freeze(result);
  }
  const input = record(value, label);
  const keys = Object.keys(input);
  if (keys.length > 64) throw new Error(`${label} object exceeds its key limit`);
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of keys.sort()) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor' || /secret|token|password|credential|api.?key/iu.test(key)) {
      throw new Error(`${label} contains a forbidden extension key`);
    }
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(key) || key.startsWith('furypipe:')) throw new Error(`${label} contains an invalid extension key`);
    result[key] = normalizeJson(input[key], state, label, depth + 1);
  }
  return Object.freeze(result);
}

function normalizeExtensions(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) return undefined;
  const input = record(value, 'extensions');
  const normalized = normalizeJson(input, { nodes: 0, chars: 0 }, 'extensions');
  return normalized as Readonly<Record<string, JsonValue>>;
}

export function createCanonicalCapabilityIdentity(source: CapabilityCandidate['source']): CapabilityCandidate['identity'] {
  const canonicalUrlValue = source.repositoryUrl ?? source.url;
  const revisionParts = [
    ...(source.commitSha ? [`commit:${source.commitSha}`] : []),
    ...(source.contentSha256 ? [`sha256:${source.contentSha256}`] : []),
  ];
  if (revisionParts.length === 0 && source.version) revisionParts.push(`version:${source.version}`);
  if (revisionParts.length === 0 && source.mutableRef) revisionParts.push(`ref:${source.mutableRef}`);
  if (revisionParts.length === 0) revisionParts.push('unversioned');
  const revisionKey = revisionParts.join('+');
  return Object.freeze({
    id: `${CAPABILITY_ID_PREFIX}${canonicalUrlValue}#${encodeURIComponent(revisionKey)}`,
    canonicalUrl: canonicalUrlValue,
    ...(source.repositoryUrl ? { repository: source.repositoryUrl } : source.kind === 'git' ? { repository: source.url } : {}),
    revisionKey,
  });
}

/** Validate untrusted metadata, normalize it, derive identity/pin state, and freeze the result. */
export function normalizeCapabilityCandidate(value: unknown): CapabilityCandidate {
  const input = record(value, 'capability candidate');
  exactKeys(input, [
    'format', 'schemaVersion', 'id', 'canonicalUrl', 'identity', 'name', 'type', 'description', 'repository',
    'publisher', 'authors', 'version', 'commitSha', 'releaseDate', 'source', 'provenance', 'license', 'licenseStatus',
    'categories', 'capabilities', 'domains', 'supportedStages', 'supportedPlatforms', 'supportedModels',
    'supportedLanguages', 'permissions', 'decision', 'decisionReason', 'integrationMode', 'costModel', 'cost',
    'maintenance', 'activity', 'health', 'security', 'aliases', 'relationships', 'benchmarks', 'roi', 'createdAt',
    'lastAuditedAt', 'extensions',
  ], 'capability candidate');
  if (input.format !== CAPABILITY_CANDIDATE_FORMAT) throw new Error('unsupported capability schema version');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('unsupported capability schema version');
  const name = text(input.name, 'candidate.name', 160);
  const type = enumValue(input.type, CAPABILITY_TYPES, 'candidate.type') as CapabilityType;
  const description = text(input.description, 'candidate.description', MAX_CAPABILITY_DESCRIPTION_CHARS, { multiline: true, allowEmpty: true });
  const repositoryInputText = optionalText(input.repository, 'candidate.repository', MAX_CAPABILITY_URL_CHARS);
  const repositoryInput = repositoryInputText === undefined ? undefined : canonicalUrl(repositoryInputText, 'candidate.repository', false, true);
  const publisher = optionalText(input.publisher, 'candidate.publisher', 160);
  const authorsRaw = input.authors ?? [];
  if (!Array.isArray(authorsRaw) || authorsRaw.length > 32) throw new Error('candidate.authors exceeds its item limit');
  const authors = authorsRaw.map((author, index) => text(author, `candidate.authors[${index}]`, 160));
  if (new Set(authors.map((author) => author.toLowerCase())).size !== authors.length) throw new Error('candidate.authors contains duplicates');
  authors.sort(compareText);

  const sourceInput = record(input.source, 'source');
  const sourceRecord = { ...sourceInput };
  if (input.version !== undefined && sourceRecord.version === undefined) sourceRecord.version = input.version;
  if (input.commitSha !== undefined && sourceRecord.commitSha === undefined) sourceRecord.commitSha = input.commitSha;
  if (repositoryInput !== undefined && sourceRecord.repositoryUrl === undefined) sourceRecord.repositoryUrl = repositoryInput;
  const source = normalizeSource(sourceRecord);
  const identity = createCanonicalCapabilityIdentity(source);
  const canonicalUrlValue = identity.canonicalUrl;
  const id = identity.id;
  if (input.id !== undefined && input.id !== id) throw new Error('candidate.id does not match its canonical source identity');
  if (input.canonicalUrl !== undefined && input.canonicalUrl !== canonicalUrlValue) throw new Error('candidate.canonicalUrl does not match its source');
  if (input.identity !== undefined) {
    const suppliedIdentity = record(input.identity, 'candidate.identity');
    exactKeys(suppliedIdentity, ['id', 'canonicalUrl', 'repository', 'revisionKey'], 'candidate.identity');
    if (suppliedIdentity.id !== identity.id
      || suppliedIdentity.canonicalUrl !== identity.canonicalUrl
      || suppliedIdentity.repository !== identity.repository
      || suppliedIdentity.revisionKey !== identity.revisionKey) {
      throw new Error('candidate.identity does not match its canonical source');
    }
  }
  const repository = identity.repository;
  if (repositoryInput !== undefined && repositoryInput !== repository) throw new Error('candidate.repository does not match its source');
  const version = source.version ?? source.package?.version;
  const commitSha = source.commitSha;
  if (input.version !== undefined && input.version !== version) throw new Error('candidate.version does not match its source');
  if (input.commitSha !== undefined && input.commitSha !== commitSha) throw new Error('candidate.commitSha does not match its source');
  const releaseDate = input.releaseDate === undefined ? undefined : isoDate(input.releaseDate, 'candidate.releaseDate');
  const provenance = normalizeProvenance(input.provenance);
  const license = normalizeLicense(input.license);
  if (input.licenseStatus !== undefined && input.licenseStatus !== license.status) throw new Error('candidate.licenseStatus does not match license.status');
  const categories = stringList(input.categories, 'candidate.categories', 64);
  const capabilities = stringList(input.capabilities, 'candidate.capabilities', 128);
  const domains = stringList(input.domains, 'candidate.domains', 64);
  const supportedStages = stringList(input.supportedStages, 'candidate.supportedStages', 32);
  const supportedPlatforms = stringList(input.supportedPlatforms, 'candidate.supportedPlatforms', 32);
  const supportedModels = stringList(input.supportedModels, 'candidate.supportedModels', 64);
  const supportedLanguages = stringList(input.supportedLanguages, 'candidate.supportedLanguages', 64);
  const permissions = normalizePermissions(input.permissions);
  const decision = enumValue(input.decision, ['ADOPT', 'PORT', 'ADAPT', 'WRAP', 'REFERENCE_ONLY', 'REJECT'] as const, 'candidate.decision') as IntegrationDecision;
  const decisionReason = optionalText(input.decisionReason, 'candidate.decisionReason', 2_048, true);
  const integrationMode = enumValue(input.integrationMode ?? (decision === 'REFERENCE_ONLY' ? 'REFERENCE_ONLY' : 'EXTERNAL_OPT_IN'), [
    'LOCAL_NATIVE', 'IN_PROCESS', 'MCP', 'CLI', 'REMOTE_API', 'REFERENCE_ONLY', 'VENDORED', 'EXTERNAL_OPT_IN',
  ] as const, 'candidate.integrationMode');
  const cost = normalizeCost(input.cost);
  if (input.costModel !== undefined && input.costModel !== cost.model) throw new Error('candidate.costModel does not match cost.model');
  const maintenance = normalizeMaintenance(input.maintenance);
  const activity = normalizeActivity(input.activity);
  const health = normalizeHealth(input.health);
  const security = normalizeSecurity(input.security);
  const aliases = normalizeAliases(input.aliases);
  const relationships = normalizeRelationships(input.relationships);
  const benchmarks = normalizeBenchmarks(input.benchmarks);
  const roi = normalizeRoi(input.roi);
  const createdAt = input.createdAt === undefined ? undefined : isoDate(input.createdAt, 'candidate.createdAt');
  const lastAuditedAt = input.lastAuditedAt === undefined ? undefined : isoDate(input.lastAuditedAt, 'candidate.lastAuditedAt');
  const extensions = normalizeExtensions(input.extensions);
  const result: CapabilityCandidate = Object.freeze({
    format: CAPABILITY_CANDIDATE_FORMAT,
    schemaVersion: 1,
    id,
    canonicalUrl: canonicalUrlValue,
    identity,
    name,
    type,
    description,
    ...(repository ? { repository } : {}),
    ...(publisher ? { publisher } : {}),
    authors: Object.freeze(authors),
    ...(version ? { version } : {}),
    ...(commitSha ? { commitSha } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    source,
    provenance,
    license,
    licenseStatus: license.status,
    categories,
    capabilities,
    domains,
    supportedStages,
    supportedPlatforms,
    supportedModels,
    supportedLanguages,
    permissions,
    decision,
    ...(decisionReason ? { decisionReason } : {}),
    integrationMode,
    costModel: cost.model,
    cost,
    maintenance,
    activity,
    health,
    security,
    aliases,
    relationships,
    benchmarks,
    ...(roi ? { roi } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(lastAuditedAt ? { lastAuditedAt } : {}),
    ...(extensions ? { extensions } : {}),
  });
  return result;
}

export function parseCapabilityCandidateJson(json: string, maxBytes = MAX_CANDIDATE_JSON_BYTES): CapabilityCandidate {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CANDIDATE_JSON_BYTES) throw new Error('capability JSON byte limit is invalid');
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new Error('capability JSON exceeds the configured byte limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error('capability JSON is malformed');
  }
  return normalizeCapabilityCandidate(parsed);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = stableValue((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

export function serializeCapabilityCandidate(candidate: CapabilityCandidate): string {
  const normalized = normalizeCapabilityCandidate(candidate);
  return JSON.stringify(stableValue(normalized));
}

export function deriveCapabilityPinStatus(source: CapabilityCandidate['source']): CapabilityPinStatus {
  return source.pinStatus;
}
