import { createHash, randomBytes } from 'node:crypto';

import {
  FURY_GATEWAY_NODE_OPERATION_FORMAT,
  isGeneratedFuryGatewayNodeOperationCoordinator,
  type FuryGatewayNodeOperation,
  type FuryGatewayNodeOperationCoordinator,
  type FuryGatewayNodeOperationPermit,
} from './gateway-node-operation-node.js';
import {
  isGeneratedFuryGatewayNodeCapabilityAdvertisement,
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
  type FuryGatewayNodeCapabilityAdvertisement,
  type FuryGatewayNodeDescriptor,
  type FuryGatewayNodeRegistry,
} from './gateway-node-registry-node.js';
import {
  isGeneratedFuryGatewayNodeSession,
  isGeneratedFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSession,
  type FuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSessionObservation,
} from './gateway-node-session-node.js';
import {
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  FURY_MEDIA_INGESTION_INPUT_FORMAT,
  FURY_MEDIA_INGESTION_SOURCE_FORMAT,
  isGeneratedFuryMediaIngestionCoordinator,
  type FuryMediaIngestionCoordinator,
  type FuryMediaIngestionHandle,
} from './media-ingestion.js';
import type { FuryMediaPluginBundle, FuryMediaPluginProfile } from './media-plugin-contracts.js';

export const FURY_DEVICE_CAPTURE_REQUEST_FORMAT = 'furypipe-device-capture-request/v1' as const;
export const FURY_DEVICE_CAPTURE_CONSENT_INPUT_FORMAT = 'furypipe-device-capture-consent-input/v1' as const;
export const FURY_DEVICE_CAPTURE_CONSENT_FORMAT = 'furypipe-device-capture-consent/v1' as const;
export const FURY_DEVICE_CAPTURE_PERMIT_FORMAT = 'furypipe-device-capture-permit/v1' as const;
export const FURY_DEVICE_CAPTURE_RESULT_FORMAT = 'furypipe-device-capture-result/v1' as const;
export const FURY_DEVICE_CAPTURE_RECEIPT_FORMAT = 'furypipe-device-capture-receipt/v1' as const;

export type FuryDeviceCaptureKind = 'camera' | 'microphone';
export type FuryDeviceCaptureOutcome = 'captured' | 'rejected';

export interface FuryDeviceCapturePrepareInput {
  readonly bundle: FuryMediaPluginBundle;
  readonly profileId: string;
  readonly kind: FuryDeviceCaptureKind;
  readonly mimeType: string;
  readonly maxBytes: number;
  readonly maxDurationMs?: number;
}

export interface FuryDeviceCaptureRequest {
  readonly format: typeof FURY_DEVICE_CAPTURE_REQUEST_FORMAT;
  readonly requestDigestSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly kind: FuryDeviceCaptureKind;
  readonly capability: 'camera' | 'microphone';
  readonly mimeType: string;
  readonly maxBytes: number;
  readonly maxDurationMs?: number;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly livenessEpochSha256: string;
  readonly registrationIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly capabilityGeneration: number;
  readonly capabilitiesDigestSha256: string;
  readonly authority: 'device-capture-request-evidence-only';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryDeviceCaptureConsentInput {
  readonly format: typeof FURY_DEVICE_CAPTURE_CONSENT_INPUT_FORMAT;
  readonly requestDigestSha256: string;
  readonly userPresenceObservedAt: number;
  readonly localConfirmationDigestSha256: string;
  readonly consentTextDigestSha256: string;
  readonly expiresInMs: number;
}

export interface FuryDeviceCaptureConsent {
  readonly format: typeof FURY_DEVICE_CAPTURE_CONSENT_FORMAT;
  readonly consentIdSha256: string;
  readonly requestDigestSha256: string;
  readonly kind: FuryDeviceCaptureKind;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly userPresenceObservedAt: number;
  readonly localConfirmationDigestSha256: string;
  readonly consentTextDigestSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly mode: 'one-shot';
  readonly authority: 'capture-consent-evidence-only';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryDeviceCapturePermit {
  readonly format: typeof FURY_DEVICE_CAPTURE_PERMIT_FORMAT;
  readonly permitIdSha256: string;
  readonly requestDigestSha256: string;
  readonly consentIdSha256: string;
  readonly nodeOperationPermitIdSha256: string;
  readonly kind: FuryDeviceCaptureKind;
  readonly capability: 'camera' | 'microphone';
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'device-capture-permit';
  readonly executionAuthority: true;
  readonly automaticReplayAllowed: false;
}

export interface FuryDeviceCaptureAdapterContext {
  readonly requestDigestSha256: string;
  readonly consentIdSha256: string;
  readonly maxBytes: number;
  readonly maxDurationMs?: number;
  readonly signal?: AbortSignal;
}

export interface FuryDeviceCaptureAdapter {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly kind: FuryDeviceCaptureKind;
  capture(context: FuryDeviceCaptureAdapterContext): Promise<unknown>;
}

export interface FuryDeviceCaptureAdapterRegistry {
  get(bundleId: string, bundleVersion: string, profileId: string, kind: FuryDeviceCaptureKind): FuryDeviceCaptureAdapter | undefined;
}

export interface FuryDeviceCaptureReceipt {
  readonly format: typeof FURY_DEVICE_CAPTURE_RECEIPT_FORMAT;
  readonly requestDigestSha256: string;
  readonly consentIdSha256: string;
  readonly permitIdSha256: string;
  readonly nodeOperationPermitIdSha256: string;
  readonly nodeOperationReceiptDigestSha256: string;
  readonly kind: FuryDeviceCaptureKind;
  readonly capability: 'camera' | 'microphone';
  readonly outcome: FuryDeviceCaptureOutcome;
  readonly mediaSha256?: string;
  readonly mediaBytes?: number;
  readonly mimeType?: string;
  readonly durationMs?: number;
  readonly providerCaptureIdSha256?: string;
  readonly postDispatchAuthority: 'current' | 'stale';
  readonly userPresence: 'fresh-at-consent';
  readonly localConfirmation: 'explicit-digest-evidence';
  readonly rawMediaPersisted: false;
  readonly retrySafe: false;
  readonly automaticReplayAllowed: false;
  readonly executionAuthority: false;
  readonly adapterResult: 'adapter-reported-unverified';
}

export interface FuryDeviceCaptureResult {
  readonly format: typeof FURY_DEVICE_CAPTURE_RESULT_FORMAT;
  readonly kind: FuryDeviceCaptureKind;
  readonly outcome: FuryDeviceCaptureOutcome;
  readonly mediaHandle?: FuryMediaIngestionHandle;
  readonly receipt: FuryDeviceCaptureReceipt;
}

export interface FuryDeviceCaptureCoordinatorOptions {
  readonly gatewaySession: FuryGatewaySessionLease;
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator;
  readonly node: FuryGatewayNodeDescriptor;
  readonly nodeSession: FuryGatewayNodeSession;
  readonly nodeOperationCoordinator: FuryGatewayNodeOperationCoordinator;
  readonly mediaCoordinator: FuryMediaIngestionCoordinator;
  readonly adapters: FuryDeviceCaptureAdapterRegistry;
  readonly now?: () => number;
  readonly maxPresenceAgeMs?: number;
  readonly maxConsentTtlMs?: number;
  readonly maxProfileHealthAgeMs?: number;
  readonly maxActiveConsents?: number;
  readonly maxActivePermits?: number;
}

export interface FuryDeviceCaptureCoordinator {
  prepare(input: FuryDeviceCapturePrepareInput): FuryDeviceCaptureRequest;
  grantConsent(request: FuryDeviceCaptureRequest, input: FuryDeviceCaptureConsentInput): FuryDeviceCaptureConsent;
  authorize(request: FuryDeviceCaptureRequest, consent: FuryDeviceCaptureConsent): FuryDeviceCapturePermit;
  execute(request: FuryDeviceCaptureRequest, permit: FuryDeviceCapturePermit, options?: { readonly signal?: AbortSignal }): Promise<FuryDeviceCaptureResult>;
  activeConsentCount(): number;
  activePermitCount(): number;
}

export type FuryDeviceCaptureErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'invalid-request'
  | 'invalid-consent'
  | 'consent-expired'
  | 'consent-already-used'
  | 'user-presence-stale'
  | 'profile-not-found'
  | 'profile-not-eligible'
  | 'profile-health-not-fresh'
  | 'node-authority-stale'
  | 'execution-not-authorized'
  | 'invalid-permit'
  | 'permit-expired'
  | 'permit-consumed'
  | 'adapter-not-registered'
  | 'adapter-result-invalid'
  | 'media-type-not-supported'
  | 'output-limit'
  | 'media-ingestion-failed'
  | 'adapter-error'
  | 'limit-exceeded';

export class FuryDeviceCaptureError extends Error {
  readonly retrySafe = false;
  constructor(
    readonly code: FuryDeviceCaptureErrorCode,
    message: string,
    readonly adapterInvoked = false,
    readonly outcome: 'not-started' | 'unknown' = adapterInvoked ? 'unknown' : 'not-started',
  ) {
    super(message);
    this.name = 'FuryDeviceCaptureError';
  }
}

interface RequestState {
  readonly coordinator: FuryDeviceCaptureCoordinator;
  readonly request: FuryDeviceCaptureRequest;
  readonly bundle: FuryMediaPluginBundle;
  readonly profile: FuryMediaPluginProfile;
  readonly advertisement: FuryGatewayNodeCapabilityAdvertisement;
  readonly operation: FuryGatewayNodeOperation;
}

interface ConsentState {
  readonly coordinator: FuryDeviceCaptureCoordinator;
  readonly request: FuryDeviceCaptureRequest;
  readonly consent: FuryDeviceCaptureConsent;
  reserved: boolean;
  consumed: boolean;
}

interface PermitState {
  readonly coordinator: FuryDeviceCaptureCoordinator;
  readonly request: FuryDeviceCaptureRequest;
  readonly consentState: ConsentState;
  readonly permit: FuryDeviceCapturePermit;
  readonly nodePermit: FuryGatewayNodeOperationPermit;
  consumed: boolean;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const GENERATED_ADAPTER_REGISTRIES = new WeakSet<object>();
const REQUEST_STATES = new WeakMap<object, RequestState>();
const CONSENT_STATES = new WeakMap<object, ConsentState>();
const PERMIT_STATES = new WeakMap<object, PermitState>();
const GENERATED_RESULTS = new WeakSet<object>();

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[-a-z0-9!#$&^_.+]{1,128}$/u;
const CAMERA_MIME = new Set(['image/png', 'image/jpeg', 'image/gif']);
const MICROPHONE_MIME = new Set(['audio/wav']);
const DEFAULT_PRESENCE_AGE_MS = 15_000;
const HARD_PRESENCE_AGE_MS = 60_000;
const DEFAULT_CONSENT_TTL_MS = 15_000;
const HARD_CONSENT_TTL_MS = 60_000;
const DEFAULT_PROFILE_HEALTH_AGE_MS = 60_000;
const HARD_PROFILE_HEALTH_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_ACTIVE_CONSENTS = 128;
const HARD_MAX_ACTIVE_CONSENTS = 4_096;
const DEFAULT_MAX_ACTIVE_PERMITS = 128;
const HARD_MAX_ACTIVE_PERMITS = 4_096;
const HARD_MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_CAPTURE_DURATION_MS = 10 * 60_000;
const MAX_ADAPTERS = 256;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256')
    .update('furypipe-device-capture/v1\0', 'utf8')
    .update(label, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function fail(code: FuryDeviceCaptureErrorCode, message: string, adapterInvoked = false): never {
  throw new FuryDeviceCaptureError(code, message, adapterInvoked, adapterInvoked ? 'unknown' : 'not-started');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) fail('invalid-config', `${label} must be an integer between ${min} and ${max}`);
  return resolved;
}

function safeNow(now: () => number): number {
  let value: number;
  try { value = now(); } catch { fail('invalid-config', 'device capture clock failed'); }
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-config', 'device capture clock must return a safe non-negative timestamp');
  return value;
}

function plainRecord(value: unknown, label: string, code: FuryDeviceCaptureErrorCode = 'invalid-input'): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FuryDeviceCaptureError(code, `${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new FuryDeviceCaptureError(code, `${label} must use a plain-object prototype`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new FuryDeviceCaptureError(code, `${label} must not contain symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new FuryDeviceCaptureError(code, `${label} must contain enumerable data properties only`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[], required: readonly string[], label: string, code: FuryDeviceCaptureErrorCode = 'invalid-input'): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(record)) if (!accepted.has(key)) throw new FuryDeviceCaptureError(code, `${label} contains unsupported field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new FuryDeviceCaptureError(code, `${label} is missing required field: ${key}`);
}

function capabilityFor(kind: FuryDeviceCaptureKind): 'camera' | 'microphone' {
  return kind === 'camera' ? 'camera' : 'microphone';
}

function permissionFor(kind: FuryDeviceCaptureKind): 'device-camera' | 'device-microphone' {
  return kind === 'camera' ? 'device-camera' : 'device-microphone';
}

function mediaTypesFor(kind: FuryDeviceCaptureKind): ReadonlySet<string> {
  return kind === 'camera' ? CAMERA_MIME : MICROPHONE_MIME;
}

function operationFor(request: FuryDeviceCaptureRequest): FuryGatewayNodeOperation {
  return Object.freeze({
    format: FURY_GATEWAY_NODE_OPERATION_FORMAT,
    operationId: `capture.${request.kind}`,
    capability: request.capability,
    action: 'capture',
    targetDigestSha256: request.requestDigestSha256,
    sideEffecting: true,
  });
}

function validateProfile(bundle: FuryMediaPluginBundle, profileId: string, kind: FuryDeviceCaptureKind, at: number, maxHealthAgeMs: number): FuryMediaPluginProfile {
  if (!bundle || bundle.format !== 'furypipe-media-plugin-bundle/v1' || bundle.authority !== 'plugin-contract-only' || bundle.executionAuthority !== false || bundle.automaticExecutionAllowed !== false) {
    fail('profile-not-eligible', 'validated media plugin bundle is required');
  }
  if (!ID.test(profileId)) fail('invalid-input', 'capture profileId is invalid');
  const profile = bundle.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) fail('profile-not-found', 'device capture profile was not found');
  if (profile.bundleId !== bundle.id || profile.bundleVersion !== bundle.version || profile.family !== 'device-adapter') fail('profile-not-eligible', 'device capture profile binding or family is invalid');
  if (profile.lifecycle !== 'registered' || profile.authority !== 'profile-observation-only' || profile.executionAuthority !== false || profile.selectionAuthority !== false) fail('profile-not-eligible', 'device capture profile lifecycle is not eligible');
  const required = new Set([permissionFor(kind), 'media-write']);
  if (profile.permissions.length !== required.size || !profile.permissions.every((permission) => required.has(permission))) fail('profile-not-eligible', 'device capture profile permissions must be least-privilege for the requested capture');
  if (profile.health.status !== 'healthy' || !Number.isSafeInteger(profile.health.observedAt) || profile.health.observedAt < 0 || profile.health.observedAt > at) fail('profile-not-eligible', 'device capture profile is not healthy');
  if (at - profile.health.observedAt > maxHealthAgeMs) fail('profile-health-not-fresh', 'device capture profile health is stale');
  if (profile.supportedMediaTypes.length < 1 || !profile.supportedMediaTypes.every((mime) => MIME.test(mime))) fail('profile-not-eligible', 'device capture profile media declarations are invalid');
  return profile;
}

function validSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object' && value !== null
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function';
}

export function createFuryDeviceCaptureAdapterRegistry(adapters: readonly FuryDeviceCaptureAdapter[]): FuryDeviceCaptureAdapterRegistry {
  if (!Array.isArray(adapters) || adapters.length > MAX_ADAPTERS) throw new TypeError(`device capture adapter registry must contain at most ${MAX_ADAPTERS} entries`);
  const byKey = new Map<string, FuryDeviceCaptureAdapter>();
  for (let index = 0; index < adapters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(adapters, String(index));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('device capture adapter registry entry is invalid');
    const raw = descriptor.value as FuryDeviceCaptureAdapter;
    const record = plainRecord(raw, 'device capture adapter', 'invalid-config');
    exactKeys(record, ['bundleId', 'bundleVersion', 'profileId', 'kind', 'capture'], ['bundleId', 'bundleVersion', 'profileId', 'kind', 'capture'], 'device capture adapter', 'invalid-config');
    if (!ID.test(raw.bundleId) || !ID.test(raw.bundleVersion) || !ID.test(raw.profileId) || !['camera', 'microphone'].includes(raw.kind) || typeof raw.capture !== 'function') throw new TypeError('device capture adapter registration is invalid');
    const key = `${raw.bundleId}\0${raw.bundleVersion}\0${raw.profileId}\0${raw.kind}`;
    if (byKey.has(key)) throw new TypeError('device capture adapter registration is duplicated');
    byKey.set(key, Object.freeze({ bundleId: raw.bundleId, bundleVersion: raw.bundleVersion, profileId: raw.profileId, kind: raw.kind, capture: raw.capture }));
  }
  const registry: FuryDeviceCaptureAdapterRegistry = Object.freeze({
    get(bundleId: string, bundleVersion: string, profileId: string, kind: FuryDeviceCaptureKind) {
      return byKey.get(`${bundleId}\0${bundleVersion}\0${profileId}\0${kind}`);
    },
  });
  GENERATED_ADAPTER_REGISTRIES.add(registry);
  return registry;
}

export function isGeneratedFuryDeviceCaptureAdapterRegistry(value: unknown): value is FuryDeviceCaptureAdapterRegistry {
  return typeof value === 'object' && value !== null && GENERATED_ADAPTER_REGISTRIES.has(value);
}

export function isGeneratedFuryDeviceCaptureCoordinator(value: unknown): value is FuryDeviceCaptureCoordinator {
  return typeof value === 'object' && value !== null && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryDeviceCaptureRequest(value: unknown): value is FuryDeviceCaptureRequest {
  return typeof value === 'object' && value !== null && REQUEST_STATES.has(value);
}

export function isGeneratedFuryDeviceCaptureConsent(value: unknown): value is FuryDeviceCaptureConsent {
  return typeof value === 'object' && value !== null && CONSENT_STATES.has(value);
}

export function isGeneratedFuryDeviceCapturePermit(value: unknown): value is FuryDeviceCapturePermit {
  return typeof value === 'object' && value !== null && PERMIT_STATES.has(value);
}

export function isGeneratedFuryDeviceCaptureResult(value: unknown): value is FuryDeviceCaptureResult {
  return typeof value === 'object' && value !== null && GENERATED_RESULTS.has(value);
}

export function createFuryDeviceCaptureCoordinator(options: FuryDeviceCaptureCoordinatorOptions): FuryDeviceCaptureCoordinator {
  if (
    !options || typeof options !== 'object' || Array.isArray(options)
    || !isGeneratedFuryGatewaySessionLease(options.gatewaySession)
    || !isGeneratedFuryGatewayNodeRegistry(options.nodeRegistry)
    || !isGeneratedFuryGatewayNodeSessionCoordinator(options.nodeSessionCoordinator)
    || !isGeneratedFuryGatewayNodeDescriptor(options.node)
    || !isGeneratedFuryGatewayNodeSession(options.nodeSession)
    || !isGeneratedFuryGatewayNodeOperationCoordinator(options.nodeOperationCoordinator)
    || !isGeneratedFuryMediaIngestionCoordinator(options.mediaCoordinator)
    || !isGeneratedFuryDeviceCaptureAdapterRegistry(options.adapters)
  ) throw new TypeError('device capture coordinator requires current generated Gateway/node/media evidence');

  const now = options.now ?? Date.now;
  if (typeof now !== 'function') throw new TypeError('device capture coordinator clock must be a function');
  const maxPresenceAgeMs = boundedInteger(options.maxPresenceAgeMs, DEFAULT_PRESENCE_AGE_MS, 1, HARD_PRESENCE_AGE_MS, 'maxPresenceAgeMs');
  const maxConsentTtlMs = boundedInteger(options.maxConsentTtlMs, DEFAULT_CONSENT_TTL_MS, 1, HARD_CONSENT_TTL_MS, 'maxConsentTtlMs');
  const maxProfileHealthAgeMs = boundedInteger(options.maxProfileHealthAgeMs, DEFAULT_PROFILE_HEALTH_AGE_MS, 1, HARD_PROFILE_HEALTH_AGE_MS, 'maxProfileHealthAgeMs');
  const maxActiveConsents = boundedInteger(options.maxActiveConsents, DEFAULT_MAX_ACTIVE_CONSENTS, 1, HARD_MAX_ACTIVE_CONSENTS, 'maxActiveConsents');
  const maxActivePermits = boundedInteger(options.maxActivePermits, DEFAULT_MAX_ACTIVE_PERMITS, 1, HARD_MAX_ACTIVE_PERMITS, 'maxActivePermits');

  const activeConsents = new Set<FuryDeviceCaptureConsent>();
  const activePermits = new Set<FuryDeviceCapturePermit>();
  let coordinator: FuryDeviceCaptureCoordinator;

  const currentAuthority = (expected?: FuryGatewayNodeCapabilityAdvertisement): { observation: FuryGatewayNodeSessionObservation; advertisement: FuryGatewayNodeCapabilityAdvertisement } => {
    let observation: FuryGatewayNodeSessionObservation;
    try { observation = options.nodeSessionCoordinator.inspectSession(options.nodeSession); }
    catch { fail('node-authority-stale', 'device capture node session is unavailable'); }
    if (observation.status !== 'live') fail('node-authority-stale', 'device capture node session is not live');
    if (options.nodeSession.registrationId !== options.node.registrationId || options.nodeSession.deviceId !== options.node.deviceId || options.nodeSession.pairingId !== options.node.pairingId) fail('node-authority-stale', 'device capture node identity changed');
    let advertisement: FuryGatewayNodeCapabilityAdvertisement | undefined;
    try { advertisement = options.nodeRegistry.currentAdvertisement(options.node); }
    catch { fail('node-authority-stale', 'device capture capability advertisement is unavailable'); }
    if (!advertisement || !isGeneratedFuryGatewayNodeCapabilityAdvertisement(advertisement) || observation.capability === undefined || advertisement.generation !== observation.capability.generation || advertisement.capabilitiesDigestSha256 !== observation.capability.capabilitiesDigestSha256) fail('node-authority-stale', 'device capture capability advertisement is not current');
    if (expected && (advertisement !== expected || advertisement.generation !== expected.generation || advertisement.capabilitiesDigestSha256 !== expected.capabilitiesDigestSha256)) fail('node-authority-stale', 'device capture capability generation changed');
    return { observation, advertisement };
  };

  const requestStateFor = (request: FuryDeviceCaptureRequest): RequestState => {
    if (!isGeneratedFuryDeviceCaptureRequest(request)) fail('invalid-request', 'device capture request must be process-local');
    const state = REQUEST_STATES.get(request)!;
    if (state.coordinator !== coordinator || state.request !== request) fail('invalid-request', 'device capture request belongs to another coordinator');
    return state;
  };

  const consentStateFor = (consent: FuryDeviceCaptureConsent): ConsentState => {
    if (!isGeneratedFuryDeviceCaptureConsent(consent)) fail('invalid-consent', 'device capture consent must be process-local');
    const state = CONSENT_STATES.get(consent)!;
    if (state.coordinator !== coordinator || state.consent !== consent) fail('invalid-consent', 'device capture consent belongs to another coordinator');
    return state;
  };

  const permitStateFor = (permit: FuryDeviceCapturePermit): PermitState => {
    if (!isGeneratedFuryDeviceCapturePermit(permit)) fail('invalid-permit', 'device capture permit must be process-local');
    const state = PERMIT_STATES.get(permit)!;
    if (state.coordinator !== coordinator || state.permit !== permit) fail('invalid-permit', 'device capture permit belongs to another coordinator');
    return state;
  };

  const prune = (at: number): void => {
    for (const consent of [...activeConsents]) {
      const state = CONSENT_STATES.get(consent);
      if (!state || state.consumed || at >= consent.expiresAt) activeConsents.delete(consent);
    }
    for (const permit of [...activePermits]) {
      const state = PERMIT_STATES.get(permit);
      if (!state || state.consumed || at >= permit.expiresAt) activePermits.delete(permit);
    }
  };

  coordinator = Object.freeze({
    prepare(input: FuryDeviceCapturePrepareInput): FuryDeviceCaptureRequest {
      const record = plainRecord(input, 'device capture prepare input');
      exactKeys(record, ['bundle','profileId','kind','mimeType','maxBytes','maxDurationMs'], ['bundle','profileId','kind','mimeType','maxBytes'], 'device capture prepare input');
      const at = safeNow(now);
      const authority = currentAuthority();
      if (!['camera', 'microphone'].includes(input.kind) || typeof input.mimeType !== 'string' || !MIME.test(input.mimeType) || !mediaTypesFor(input.kind).has(input.mimeType)) fail('invalid-input', 'device capture kind or MIME is invalid');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > HARD_MAX_CAPTURE_BYTES) fail('invalid-input', 'device capture maxBytes is invalid');
      if (input.kind === 'microphone') {
        if (!Number.isSafeInteger(input.maxDurationMs) || (input.maxDurationMs as number) < 1 || (input.maxDurationMs as number) > HARD_MAX_CAPTURE_DURATION_MS) fail('invalid-input', 'microphone capture requires a bounded maxDurationMs');
      } else if (input.maxDurationMs !== undefined) fail('invalid-input', 'camera still capture must not declare duration');
      const profile = validateProfile(input.bundle, input.profileId, input.kind, at, maxProfileHealthAgeMs);
      if (!profile.supportedMediaTypes.includes(input.mimeType)) fail('media-type-not-supported', 'device capture profile does not support requested MIME');
      if (input.maxBytes > profile.bounds.maxOutputBytes) fail('output-limit', 'device capture byte budget exceeds profile bound');
      if (input.kind === 'microphone' && profile.bounds.maxDurationMs !== undefined && (input.maxDurationMs as number) > profile.bounds.maxDurationMs) fail('output-limit', 'microphone capture duration exceeds profile bound');
      const capability = capabilityFor(input.kind);
      if (!authority.advertisement.capabilities.includes(capability)) fail('node-authority-stale', 'device capture capability is not advertised');
      const body = JSON.stringify({
        bundleId: input.bundle.id,
        bundleVersion: input.bundle.version,
        profileId: profile.id,
        kind: input.kind,
        capability,
        mimeType: input.mimeType,
        maxBytes: input.maxBytes,
        maxDurationMs: input.maxDurationMs ?? null,
        gatewaySessionId: options.gatewaySession.sessionId,
        principalId: options.gatewaySession.principalId,
        nodeSessionId: options.nodeSession.sessionId,
        livenessEpoch: options.nodeSession.livenessEpoch,
        registrationId: options.node.registrationId,
        deviceId: options.node.deviceId,
        pairingId: options.node.pairingId,
        capabilityGeneration: authority.advertisement.generation,
        capabilitiesDigestSha256: authority.advertisement.capabilitiesDigestSha256,
      });
      const requestDigestSha256 = digest('request', body);
      const request: FuryDeviceCaptureRequest = Object.freeze({
        format: FURY_DEVICE_CAPTURE_REQUEST_FORMAT,
        requestDigestSha256,
        bundleId: input.bundle.id,
        bundleVersion: input.bundle.version,
        profileId: profile.id,
        kind: input.kind,
        capability,
        mimeType: input.mimeType,
        maxBytes: input.maxBytes,
        ...(input.maxDurationMs === undefined ? {} : { maxDurationMs: input.maxDurationMs }),
        gatewaySessionIdSha256: sha256(options.gatewaySession.sessionId),
        principalIdSha256: sha256(options.gatewaySession.principalId),
        nodeSessionIdSha256: sha256(options.nodeSession.sessionId),
        livenessEpochSha256: sha256(options.nodeSession.livenessEpoch),
        registrationIdSha256: sha256(options.node.registrationId),
        deviceIdSha256: sha256(options.node.deviceId),
        pairingIdSha256: sha256(options.node.pairingId),
        capabilityGeneration: authority.advertisement.generation,
        capabilitiesDigestSha256: authority.advertisement.capabilitiesDigestSha256,
        authority: 'device-capture-request-evidence-only' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
      const state: RequestState = { coordinator, request, bundle: input.bundle, profile, advertisement: authority.advertisement, operation: operationFor(request) };
      REQUEST_STATES.set(request, state);
      return request;
    },

    grantConsent(request: FuryDeviceCaptureRequest, input: FuryDeviceCaptureConsentInput): FuryDeviceCaptureConsent {
      const state = requestStateFor(request);
      const at = safeNow(now);
      prune(at);
      if (activeConsents.size >= maxActiveConsents) fail('limit-exceeded', 'active device capture consent limit reached');
      currentAuthority(state.advertisement);
      validateProfile(state.bundle, state.profile.id, request.kind, at, maxProfileHealthAgeMs);
      const record = plainRecord(input, 'device capture consent input', 'invalid-consent');
      exactKeys(record, ['format','requestDigestSha256','userPresenceObservedAt','localConfirmationDigestSha256','consentTextDigestSha256','expiresInMs'], ['format','requestDigestSha256','userPresenceObservedAt','localConfirmationDigestSha256','consentTextDigestSha256','expiresInMs'], 'device capture consent input', 'invalid-consent');
      if (
        input.format !== FURY_DEVICE_CAPTURE_CONSENT_INPUT_FORMAT
        || input.requestDigestSha256 !== request.requestDigestSha256
        || !Number.isSafeInteger(input.userPresenceObservedAt)
        || input.userPresenceObservedAt < 0
        || input.userPresenceObservedAt > at
        || at - input.userPresenceObservedAt > maxPresenceAgeMs
        || !SHA256.test(input.localConfirmationDigestSha256)
        || !SHA256.test(input.consentTextDigestSha256)
        || !Number.isSafeInteger(input.expiresInMs)
        || input.expiresInMs < 1
        || input.expiresInMs > maxConsentTtlMs
      ) {
        if (Number.isSafeInteger(input.userPresenceObservedAt) && input.userPresenceObservedAt >= 0 && input.userPresenceObservedAt <= at && at - input.userPresenceObservedAt > maxPresenceAgeMs) fail('user-presence-stale', 'device capture user presence evidence is stale');
        fail('invalid-consent', 'device capture consent input is invalid');
      }
      const expiresAt = at + input.expiresInMs;
      if (!Number.isSafeInteger(expiresAt)) fail('invalid-consent', 'device capture consent expiry is invalid');
      const consent: FuryDeviceCaptureConsent = Object.freeze({
        format: FURY_DEVICE_CAPTURE_CONSENT_FORMAT,
        consentIdSha256: digest('consent', randomBytes(32).toString('base64url')),
        requestDigestSha256: request.requestDigestSha256,
        kind: request.kind,
        gatewaySessionIdSha256: request.gatewaySessionIdSha256,
        principalIdSha256: request.principalIdSha256,
        nodeSessionIdSha256: request.nodeSessionIdSha256,
        deviceIdSha256: request.deviceIdSha256,
        pairingIdSha256: request.pairingIdSha256,
        userPresenceObservedAt: input.userPresenceObservedAt,
        localConfirmationDigestSha256: input.localConfirmationDigestSha256,
        consentTextDigestSha256: input.consentTextDigestSha256,
        issuedAt: at,
        expiresAt,
        mode: 'one-shot' as const,
        authority: 'capture-consent-evidence-only' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
      const consentState: ConsentState = { coordinator, request, consent, reserved: false, consumed: false };
      CONSENT_STATES.set(consent, consentState);
      activeConsents.add(consent);
      return consent;
    },

    authorize(request: FuryDeviceCaptureRequest, consent: FuryDeviceCaptureConsent): FuryDeviceCapturePermit {
      const requestState = requestStateFor(request);
      const consentState = consentStateFor(consent);
      const at = safeNow(now);
      prune(at);
      if (activePermits.size >= maxActivePermits) fail('limit-exceeded', 'active device capture permit limit reached');
      if (consentState.request !== request || consent.requestDigestSha256 !== request.requestDigestSha256 || consent.kind !== request.kind) fail('invalid-consent', 'device capture consent does not match exact request');
      if (at >= consent.expiresAt) fail('consent-expired', 'device capture consent expired');
      if (consentState.reserved || consentState.consumed) fail('consent-already-used', 'device capture consent is already reserved or consumed');
      currentAuthority(requestState.advertisement);
      validateProfile(requestState.bundle, requestState.profile.id, request.kind, at, maxProfileHealthAgeMs);
      let nodePermit: FuryGatewayNodeOperationPermit;
      try {
        nodePermit = options.nodeOperationCoordinator.issuePermit(options.node, options.nodeSession, requestState.advertisement, requestState.operation);
      } catch {
        fail('execution-not-authorized', 'node operation authority did not authorize device capture');
      }
      const expiresAt = Math.min(consent.expiresAt, nodePermit.expiresAt);
      if (expiresAt <= at) fail('execution-not-authorized', 'device capture authority expires immediately');
      const permit: FuryDeviceCapturePermit = Object.freeze({
        format: FURY_DEVICE_CAPTURE_PERMIT_FORMAT,
        permitIdSha256: digest('permit', randomBytes(32).toString('base64url')),
        requestDigestSha256: request.requestDigestSha256,
        consentIdSha256: consent.consentIdSha256,
        nodeOperationPermitIdSha256: nodePermit.permitIdSha256,
        kind: request.kind,
        capability: request.capability,
        issuedAt: at,
        expiresAt,
        authority: 'device-capture-permit' as const,
        executionAuthority: true as const,
        automaticReplayAllowed: false as const,
      });
      consentState.reserved = true;
      const permitState: PermitState = { coordinator, request, consentState, permit, nodePermit, consumed: false };
      PERMIT_STATES.set(permit, permitState);
      activePermits.add(permit);
      return permit;
    },

    async execute(request: FuryDeviceCaptureRequest, permit: FuryDeviceCapturePermit, executionOptions?: { readonly signal?: AbortSignal }): Promise<FuryDeviceCaptureResult> {
      const requestState = requestStateFor(request);
      const permitState = permitStateFor(permit);
      const at = safeNow(now);
      prune(at);
      if (permitState.request !== request || permit.requestDigestSha256 !== request.requestDigestSha256 || permit.consentIdSha256 !== permitState.consentState.consent.consentIdSha256) fail('invalid-permit', 'device capture permit does not match exact request/consent');
      if (permitState.consumed) fail('permit-consumed', 'device capture permit was already consumed');
      if (at >= permit.expiresAt) fail('permit-expired', 'device capture permit expired');
      if (at >= permitState.consentState.consent.expiresAt) fail('consent-expired', 'device capture consent expired');
      if (permitState.consentState.consumed) fail('consent-already-used', 'device capture consent was already consumed');
      currentAuthority(requestState.advertisement);
      validateProfile(requestState.bundle, requestState.profile.id, request.kind, at, maxProfileHealthAgeMs);
      let signal: AbortSignal | undefined;
      if (executionOptions !== undefined) {
        const record = plainRecord(executionOptions, 'device capture execution options');
        exactKeys(record, ['signal'], [], 'device capture execution options');
        if (executionOptions.signal !== undefined && !validSignal(executionOptions.signal)) fail('invalid-input', 'device capture AbortSignal is invalid');
        signal = executionOptions.signal;
      }
      const adapter = options.adapters.get(request.bundleId, request.bundleVersion, request.profileId, request.kind);
      if (!adapter || adapter.bundleId !== request.bundleId || adapter.bundleVersion !== request.bundleVersion || adapter.profileId !== request.profileId || adapter.kind !== request.kind || typeof adapter.capture !== 'function') fail('adapter-not-registered', 'exact device capture adapter is not registered');
      let nodeReceipt;
      try { nodeReceipt = options.nodeOperationCoordinator.consumeForDispatch(permitState.nodePermit, requestState.operation); }
      catch { fail('execution-not-authorized', 'device capture node permit is stale before dispatch'); }
      permitState.consumed = true;
      permitState.consentState.consumed = true;
      activePermits.delete(permit);
      activeConsents.delete(permitState.consentState.consent);
      let raw: unknown;
      try {
        raw = await adapter.capture(Object.freeze({
          requestDigestSha256: request.requestDigestSha256,
          consentIdSha256: permit.consentIdSha256,
          maxBytes: request.maxBytes,
          ...(request.maxDurationMs === undefined ? {} : { maxDurationMs: request.maxDurationMs }),
          ...(signal === undefined ? {} : { signal }),
        }));
      } catch {
        fail('adapter-error', 'device capture adapter outcome is unknown after dispatch', true);
      }
      let result: Readonly<Record<string, unknown>>;
      try {
        result = plainRecord(raw, 'device capture adapter result', 'adapter-result-invalid');
        exactKeys(result, ['status','mimeType','bytes','providerCaptureId'], ['status'], 'device capture adapter result', 'adapter-result-invalid');
      } catch {
        fail('adapter-result-invalid', 'device capture adapter result is invalid', true);
      }
      const wipeReturnedBytes = (): void => {
        if (result.bytes instanceof Uint8Array) result.bytes.fill(0);
      };
      if (!['captured','rejected','unknown'].includes(result.status as string)) { wipeReturnedBytes(); fail('adapter-result-invalid', 'device capture adapter status is invalid', true); }
      if (result.providerCaptureId !== undefined && (typeof result.providerCaptureId !== 'string' || !ID.test(result.providerCaptureId))) { wipeReturnedBytes(); fail('adapter-result-invalid', 'device capture provider capture ID is invalid', true); }
      if (result.status === 'unknown') { wipeReturnedBytes(); fail('adapter-error', 'device capture adapter reported unknown outcome', true); }

      let postDispatchAuthority: 'current' | 'stale' = 'current';
      try { currentAuthority(requestState.advertisement); } catch { postDispatchAuthority = 'stale'; }
      const nodeOperationReceiptDigestSha256 = digest('node-operation-receipt', JSON.stringify(nodeReceipt));
      const providerCaptureIdSha256 = result.providerCaptureId === undefined ? undefined : sha256(result.providerCaptureId as string);

      if (result.status === 'rejected') {
        if (result.mimeType !== undefined || result.bytes !== undefined) { wipeReturnedBytes(); fail('adapter-result-invalid', 'rejected device capture must not return media bytes', true); }
        const receipt: FuryDeviceCaptureReceipt = Object.freeze({
          format: FURY_DEVICE_CAPTURE_RECEIPT_FORMAT,
          requestDigestSha256: request.requestDigestSha256,
          consentIdSha256: permit.consentIdSha256,
          permitIdSha256: permit.permitIdSha256,
          nodeOperationPermitIdSha256: permit.nodeOperationPermitIdSha256,
          nodeOperationReceiptDigestSha256,
          kind: request.kind,
          capability: request.capability,
          outcome: 'rejected' as const,
          ...(providerCaptureIdSha256 === undefined ? {} : { providerCaptureIdSha256 }),
          postDispatchAuthority,
          userPresence: 'fresh-at-consent' as const,
          localConfirmation: 'explicit-digest-evidence' as const,
          rawMediaPersisted: false as const,
          retrySafe: false as const,
          automaticReplayAllowed: false as const,
          executionAuthority: false as const,
          adapterResult: 'adapter-reported-unverified' as const,
        });
        const value: FuryDeviceCaptureResult = Object.freeze({ format: FURY_DEVICE_CAPTURE_RESULT_FORMAT, kind: request.kind, outcome: 'rejected' as const, receipt });
        GENERATED_RESULTS.add(value);
        return value;
      }

      if (!(result.bytes instanceof Uint8Array)) fail('adapter-result-invalid', 'captured device media bytes are invalid', true);
      const adapterBytes = result.bytes as Uint8Array;
      if (typeof result.mimeType !== 'string' || result.mimeType !== request.mimeType || !MIME.test(result.mimeType) || !mediaTypesFor(request.kind).has(result.mimeType)) { adapterBytes.fill(0); fail('media-type-not-supported', 'captured device media MIME does not match authorized request', true); }
      if (adapterBytes.byteLength < 1 || adapterBytes.byteLength > request.maxBytes || adapterBytes.byteLength > requestState.profile.bounds.maxOutputBytes) { adapterBytes.fill(0); fail('output-limit', 'captured device media exceeds authorized byte bound', true); }
      const retained = new Uint8Array(adapterBytes);
      adapterBytes.fill(0);
      let mediaHandle: FuryMediaIngestionHandle;
      try {
        mediaHandle = options.mediaCoordinator.ingestBatch([{
          format: FURY_MEDIA_INGESTION_INPUT_FORMAT,
          itemId: `capture-${request.kind}-${request.requestDigestSha256.slice(0, 40)}`,
          kind: request.kind === 'camera' ? 'image' : 'audio',
          mimeType: request.mimeType,
          bytes: retained,
          source: Object.freeze({
            format: FURY_MEDIA_INGESTION_SOURCE_FORMAT,
            origin: 'node-capture' as const,
            referenceDigestSha256: request.requestDigestSha256,
          }),
        }]).handles[0]!;
      } catch {
        retained.fill(0);
        fail('media-ingestion-failed', 'captured device media failed governed ingestion after dispatch', true);
      }
      retained.fill(0);
      if (request.maxDurationMs !== undefined && mediaHandle.evidence.durationMs !== undefined && mediaHandle.evidence.durationMs > request.maxDurationMs) {
        options.mediaCoordinator.release(mediaHandle);
        fail('output-limit', 'captured microphone duration exceeds authorized bound', true);
      }
      const receipt: FuryDeviceCaptureReceipt = Object.freeze({
        format: FURY_DEVICE_CAPTURE_RECEIPT_FORMAT,
        requestDigestSha256: request.requestDigestSha256,
        consentIdSha256: permit.consentIdSha256,
        permitIdSha256: permit.permitIdSha256,
        nodeOperationPermitIdSha256: permit.nodeOperationPermitIdSha256,
        nodeOperationReceiptDigestSha256,
        kind: request.kind,
        capability: request.capability,
        outcome: 'captured' as const,
        mediaSha256: mediaHandle.evidence.mediaSha256,
        mediaBytes: mediaHandle.evidence.byteCount,
        mimeType: mediaHandle.evidence.mimeType,
        ...(mediaHandle.evidence.durationMs === undefined ? {} : { durationMs: mediaHandle.evidence.durationMs }),
        ...(providerCaptureIdSha256 === undefined ? {} : { providerCaptureIdSha256 }),
        postDispatchAuthority,
        userPresence: 'fresh-at-consent' as const,
        localConfirmation: 'explicit-digest-evidence' as const,
        rawMediaPersisted: false as const,
        retrySafe: false as const,
        automaticReplayAllowed: false as const,
        executionAuthority: false as const,
        adapterResult: 'adapter-reported-unverified' as const,
      });
      const value: FuryDeviceCaptureResult = Object.freeze({ format: FURY_DEVICE_CAPTURE_RESULT_FORMAT, kind: request.kind, outcome: 'captured' as const, mediaHandle, receipt });
      GENERATED_RESULTS.add(value);
      return value;
    },

    activeConsentCount(): number {
      prune(safeNow(now));
      return activeConsents.size;
    },

    activePermitCount(): number {
      prune(safeNow(now));
      return activePermits.size;
    },
  });

  GENERATED_COORDINATORS.add(coordinator);
  return coordinator;
}
