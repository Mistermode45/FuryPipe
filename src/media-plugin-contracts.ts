import { createHash } from 'node:crypto';

export const FURY_MEDIA_PLUGIN_BUNDLE_FORMAT = 'furypipe-media-plugin-bundle/v1' as const;
export const FURY_MEDIA_PLUGIN_PROFILE_FORMAT = 'furypipe-media-plugin-profile/v1' as const;

export type FuryMediaPluginPermission =
  | 'device-discovery'
  | 'device-notify'
  | 'device-camera'
  | 'device-microphone'
  | 'device-speaker'
  | 'media-read'
  | 'media-write'
  | 'voice-stt'
  | 'voice-tts'
  | 'voice-realtime';

export type FuryMediaCapabilityFamily =
  | 'device-adapter'
  | 'stt-provider'
  | 'tts-provider'
  | 'realtime-voice-provider'
  | 'multimodal-input'
  | 'image-generation'
  | 'audio-generation'
  | 'video-generation';

export type FuryMediaProfileLifecycle = 'registered' | 'disabled';
export type FuryMediaHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface FuryMediaProfileBounds {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxItems: number;
  readonly maxDurationMs?: number;
}

export interface FuryMediaProfileHealth {
  readonly status: FuryMediaHealthStatus;
  readonly observedAt: number;
  readonly detailDigestSha256?: string;
  readonly authority: 'health-observation-only';
  readonly executionAuthority: false;
}

export interface FuryMediaPluginSource {
  readonly url: string;
  readonly commitSha?: string;
  readonly licenseStatus: 'VERIFIED' | 'NOT_APPLICABLE' | 'UNKNOWN';
  readonly licenseSpdx?: string;
}

export interface FuryMediaPluginProfile {
  readonly format: typeof FURY_MEDIA_PLUGIN_PROFILE_FORMAT;
  readonly id: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly family: FuryMediaCapabilityFamily;
  readonly permissions: readonly FuryMediaPluginPermission[];
  readonly supportedMediaTypes: readonly string[];
  readonly bounds: FuryMediaProfileBounds;
  readonly health: FuryMediaProfileHealth;
  readonly secretRefs: readonly string[];
  readonly lifecycle: FuryMediaProfileLifecycle;
  readonly compatibility: readonly string[];
  readonly sourceDigestSha256: string;
  readonly authority: 'profile-observation-only';
  readonly executionAuthority: false;
  readonly selectionAuthority: false;
}

export interface FuryMediaPluginBundle {
  readonly format: typeof FURY_MEDIA_PLUGIN_BUNDLE_FORMAT;
  readonly id: string;
  readonly version: string;
  readonly permissions: readonly FuryMediaPluginPermission[];
  readonly source: FuryMediaPluginSource;
  readonly profiles: readonly FuryMediaPluginProfile[];
  readonly authority: 'plugin-contract-only';
  readonly executionAuthority: false;
  readonly automaticExecutionAllowed: false;
}

export interface FuryMediaPluginProfileInput {
  readonly format: typeof FURY_MEDIA_PLUGIN_PROFILE_FORMAT;
  readonly id: string;
  readonly family: FuryMediaCapabilityFamily;
  readonly permissions: readonly FuryMediaPluginPermission[];
  readonly supportedMediaTypes: readonly string[];
  readonly bounds: FuryMediaProfileBounds;
  readonly health: FuryMediaProfileHealth;
  readonly secretRefs: readonly string[];
  readonly lifecycle: FuryMediaProfileLifecycle;
  readonly compatibility: readonly string[];
}

export interface FuryMediaPluginBundleInput {
  readonly format: typeof FURY_MEDIA_PLUGIN_BUNDLE_FORMAT;
  readonly id: string;
  readonly version: string;
  readonly permissions: readonly FuryMediaPluginPermission[];
  readonly source: FuryMediaPluginSource;
  readonly profiles: readonly FuryMediaPluginProfileInput[];
}

export interface FuryMediaPluginInspection {
  readonly id: string;
  readonly version: string;
  readonly permissions: readonly FuryMediaPluginPermission[];
  readonly sourceDigestSha256: string;
  readonly profileCount: number;
  readonly profiles: readonly Readonly<{
    id: string;
    family: FuryMediaCapabilityFamily;
    permissions: readonly FuryMediaPluginPermission[];
    supportedMediaTypes: readonly string[];
    lifecycle: FuryMediaProfileLifecycle;
    health: FuryMediaHealthStatus;
    secretRefs: readonly string[];
    executionAuthority: false;
    selectionAuthority: false;
  }>[];
  readonly authority: 'inspection-only';
  readonly executionAuthority: false;
}

const PERMISSIONS = new Set<FuryMediaPluginPermission>([
  'device-discovery', 'device-notify', 'device-camera', 'device-microphone',
  'device-speaker', 'media-read', 'media-write', 'voice-stt', 'voice-tts',
  'voice-realtime',
]);
const FAMILIES = new Set<FuryMediaCapabilityFamily>([
  'device-adapter', 'stt-provider', 'tts-provider', 'realtime-voice-provider',
  'multimodal-input', 'image-generation', 'audio-generation', 'video-generation',
]);
const LIFECYCLES = new Set<FuryMediaProfileLifecycle>(['registered', 'disabled']);
const HEALTH = new Set<FuryMediaHealthStatus>(['healthy', 'degraded', 'unavailable', 'unknown']);
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u;
const ENV = /^[A-Z][A-Z0-9_]{0,127}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const COMPAT = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const MAX_PERMISSIONS = 16;
const MAX_PROFILES = 64;
const MAX_MEDIA_TYPES = 32;
const MAX_SECRET_REFS = 32;
const MAX_COMPATIBILITY = 32;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 128;
const MAX_DURATION_MS = 60 * 60 * 1000;

function digest(value: string): string {
  return createHash('sha256').update('furypipe-media-plugin/v1\0').update(value).digest('hex');
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must use a plain-object prototype`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${label} must contain enumerable data properties only`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], label: string): void {
  const set = new Set(required);
  for (const key of Object.keys(record)) if (!set.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new TypeError(`${label} is missing required field: ${key}`);
}

function normalizedUnique<T extends string>(
  values: readonly T[],
  allowed: ReadonlySet<T> | null,
  max: number,
  label: string,
  matcher?: RegExp,
): readonly T[] {
  const raw = values as unknown;
  if (!Array.isArray(raw) || raw.length > max) throw new RangeError(`${label} exceeds its bound`);
  const next: T[] = [];
  const seen = new Set<string>();
  for (const candidate of raw as readonly unknown[]) {
    if (typeof candidate !== 'string') throw new TypeError(`${label} contains an invalid or duplicate value`);
    const value = candidate as T;
    if ((allowed && !allowed.has(value)) || (matcher && !matcher.test(value)) || seen.has(value)) {
      throw new TypeError(`${label} contains an invalid or duplicate value`);
    }
    seen.add(value);
    next.push(value);
  }
  next.sort();
  return Object.freeze(next);
}

function safeBound(value: number, max: number, label: string, allowZero = false): number {
  const min = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
  return value;
}

function validateHttpsSource(source: FuryMediaPluginSource): FuryMediaPluginSource {
  const record = plainRecord(source, 'media plugin source');
  const allowed = new Set(['url', 'commitSha', 'licenseStatus', 'licenseSpdx']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`media plugin source contains unsupported field: ${key}`);
  if (typeof source.url !== 'string') throw new TypeError('media plugin source URL is required');
  let parsed: URL;
  try { parsed = new URL(source.url); } catch { throw new TypeError('media plugin source must use credential-free HTTPS'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError('media plugin source must use credential-free HTTPS');
  if (!['VERIFIED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(source.licenseStatus)) throw new TypeError('media plugin source license status is invalid');
  if (parsed.hostname.toLowerCase() === 'github.com' && (!source.commitSha || !COMMIT_SHA.test(source.commitSha))) {
    throw new TypeError('GitHub media plugin source requires a pinned commitSha');
  }
  if (source.commitSha !== undefined && !COMMIT_SHA.test(source.commitSha)) throw new TypeError('media plugin source commitSha is invalid');
  if (source.licenseSpdx !== undefined && (typeof source.licenseSpdx !== 'string' || source.licenseSpdx.length > 64)) throw new TypeError('media plugin source SPDX identifier is invalid');
  return Object.freeze({
    url: parsed.toString(),
    ...(source.commitSha === undefined ? {} : { commitSha: source.commitSha }),
    licenseStatus: source.licenseStatus,
    ...(source.licenseSpdx === undefined ? {} : { licenseSpdx: source.licenseSpdx }),
  });
}

function validateHealth(health: FuryMediaProfileHealth): FuryMediaProfileHealth {
  const record = plainRecord(health, 'media profile health');
  const allowed = new Set(['status', 'observedAt', 'detailDigestSha256', 'authority', 'executionAuthority']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`media profile health contains unsupported field: ${key}`);
  if (!HEALTH.has(health.status) || !Number.isSafeInteger(health.observedAt) || health.observedAt < 0) throw new TypeError('media profile health observation is invalid');
  if (health.detailDigestSha256 !== undefined && !SHA256.test(health.detailDigestSha256)) throw new TypeError('media profile health detail digest is invalid');
  if (health.authority !== 'health-observation-only' || health.executionAuthority !== false) throw new TypeError('media profile health must remain observation-only');
  return Object.freeze({ ...health });
}

function validateBounds(bounds: FuryMediaProfileBounds): FuryMediaProfileBounds {
  const record = plainRecord(bounds, 'media profile bounds');
  const allowed = new Set(['maxInputBytes', 'maxOutputBytes', 'maxItems', 'maxDurationMs']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`media profile bounds contains unsupported field: ${key}`);
  const normalized: FuryMediaProfileBounds = {
    maxInputBytes: safeBound(bounds.maxInputBytes, MAX_BYTES, 'maxInputBytes'),
    maxOutputBytes: safeBound(bounds.maxOutputBytes, MAX_BYTES, 'maxOutputBytes'),
    maxItems: safeBound(bounds.maxItems, MAX_ITEMS, 'maxItems'),
    ...(bounds.maxDurationMs === undefined ? {} : { maxDurationMs: safeBound(bounds.maxDurationMs, MAX_DURATION_MS, 'maxDurationMs') }),
  };
  return Object.freeze(normalized);
}

export function validateFuryMediaPluginBundle(input: FuryMediaPluginBundleInput): FuryMediaPluginBundle {
  const record = plainRecord(input, 'media plugin bundle');
  exactKeys(record, ['format', 'id', 'version', 'permissions', 'source', 'profiles'], 'media plugin bundle');
  if (input.format !== FURY_MEDIA_PLUGIN_BUNDLE_FORMAT || !ID.test(input.id) || !VERSION.test(input.version)) throw new TypeError('media plugin bundle identity is invalid');
  const permissions = normalizedUnique(input.permissions, PERMISSIONS, MAX_PERMISSIONS, 'media plugin permissions');
  const permissionSet = new Set(permissions);
  const source = validateHttpsSource(input.source);
  if (!Array.isArray(input.profiles) || input.profiles.length > MAX_PROFILES) throw new RangeError('media plugin profile count exceeds its bound');
  const ids = new Set<string>();
  const sourceDigestSha256 = digest(JSON.stringify(source));
  const profiles = input.profiles.map((raw): FuryMediaPluginProfile => {
    const profile = plainRecord(raw, 'media plugin profile');
    exactKeys(profile, ['format', 'id', 'family', 'permissions', 'supportedMediaTypes', 'bounds', 'health', 'secretRefs', 'lifecycle', 'compatibility'], 'media plugin profile');
    if (raw.format !== FURY_MEDIA_PLUGIN_PROFILE_FORMAT || !ID.test(raw.id) || ids.has(raw.id) || !FAMILIES.has(raw.family) || !LIFECYCLES.has(raw.lifecycle)) throw new TypeError('media plugin profile identity or lifecycle is invalid');
    ids.add(raw.id);
    const profilePermissions = normalizedUnique(raw.permissions, PERMISSIONS, MAX_PERMISSIONS, 'media profile permissions');
    for (const permission of profilePermissions) if (!permissionSet.has(permission)) throw new TypeError('media profile permissions must be a subset of bundle permissions');
    const supportedMediaTypes = normalizedUnique(raw.supportedMediaTypes, null, MAX_MEDIA_TYPES, 'supported media types', MIME);
    const secretRefs = normalizedUnique(raw.secretRefs, null, MAX_SECRET_REFS, 'media profile secret refs', ENV);
    const compatibility = normalizedUnique(raw.compatibility, null, MAX_COMPATIBILITY, 'media profile compatibility', COMPAT);
    return Object.freeze({
      format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
      id: raw.id,
      bundleId: input.id,
      bundleVersion: input.version,
      family: raw.family,
      permissions: profilePermissions,
      supportedMediaTypes,
      bounds: validateBounds(raw.bounds),
      health: validateHealth(raw.health),
      secretRefs,
      lifecycle: raw.lifecycle,
      compatibility,
      sourceDigestSha256,
      authority: 'profile-observation-only' as const,
      executionAuthority: false as const,
      selectionAuthority: false as const,
    });
  });
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
    id: input.id,
    version: input.version,
    permissions,
    source,
    profiles: Object.freeze(profiles),
    authority: 'plugin-contract-only' as const,
    executionAuthority: false as const,
    automaticExecutionAllowed: false as const,
  });
}

export function inspectFuryMediaPluginBundle(bundle: FuryMediaPluginBundle): FuryMediaPluginInspection {
  if (!bundle || bundle.format !== FURY_MEDIA_PLUGIN_BUNDLE_FORMAT || bundle.authority !== 'plugin-contract-only') throw new TypeError('validated media plugin bundle is required');
  const sourceDigestSha256 = digest(JSON.stringify(bundle.source));
  return Object.freeze({
    id: bundle.id,
    version: bundle.version,
    permissions: bundle.permissions,
    sourceDigestSha256,
    profileCount: bundle.profiles.length,
    profiles: Object.freeze(bundle.profiles.map((profile) => Object.freeze({
      id: profile.id,
      family: profile.family,
      permissions: profile.permissions,
      supportedMediaTypes: profile.supportedMediaTypes,
      lifecycle: profile.lifecycle,
      health: profile.health.status,
      secretRefs: profile.secretRefs,
      executionAuthority: false as const,
      selectionAuthority: false as const,
    }))),
    authority: 'inspection-only' as const,
    executionAuthority: false as const,
  });
}