import { createHash, randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  isGeneratedFuryGatewayNodeSession,
  isGeneratedFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSession,
  type FuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSessionObservation,
} from './gateway-node-session-node.js';
import {
  isGeneratedFuryGatewayNodeCapabilityAdvertisement,
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
  type FuryGatewayNodeDescriptor,
  type FuryGatewayNodeRegistry,
} from './gateway-node-registry-node.js';
import type {
  FuryMediaPluginBundle,
  FuryMediaPluginProfile,
} from './media-plugin-contracts.js';

export const FURY_REALTIME_VOICE_REQUEST_FORMAT = 'furypipe-realtime-voice-request/v1' as const;
export const FURY_REALTIME_VOICE_POLICY_FORMAT = 'furypipe-realtime-voice-policy/v1' as const;
export const FURY_REALTIME_VOICE_LEASE_FORMAT = 'furypipe-realtime-voice-lease/v1' as const;
export const FURY_REALTIME_VOICE_FRAME_FORMAT = 'furypipe-realtime-voice-frame/v1' as const;
export const FURY_REALTIME_VOICE_FRAME_RECEIPT_FORMAT = 'furypipe-realtime-voice-frame-receipt/v1' as const;
export const FURY_REALTIME_VOICE_INSPECTION_FORMAT = 'furypipe-realtime-voice-inspection/v1' as const;
export const FURY_REALTIME_VOICE_TERMINAL_RECEIPT_FORMAT = 'furypipe-realtime-voice-terminal-receipt/v1' as const;

export type FuryRealtimeVoiceDirection = 'input' | 'output' | 'duplex';
export type FuryRealtimeVoiceFrameDirection = 'input' | 'output';
export type FuryRealtimeVoiceLeaseStatus =
  | 'live'
  | 'expired'
  | 'cancelled'
  | 'revoked'
  | 'interrupted'
  | 'authority-stale'
  | 'unknown';

export interface FuryRealtimeVoicePrepareInput {
  readonly bundle: FuryMediaPluginBundle;
  readonly profileId: string;
  readonly direction: FuryRealtimeVoiceDirection;
  readonly sourceDigestSha256: string;
  readonly sinkDigestSha256: string;
  readonly maxBytes: number;
  readonly maxFrames: number;
  readonly maxDurationMs: number;
}

export interface FuryRealtimeVoiceRequest {
  readonly format: typeof FURY_REALTIME_VOICE_REQUEST_FORMAT;
  readonly requestDigestSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly direction: FuryRealtimeVoiceDirection;
  readonly sourceDigestSha256: string;
  readonly sinkDigestSha256: string;
  readonly maxBytes: number;
  readonly maxFrames: number;
  readonly maxDurationMs: number;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly livenessEpochSha256: string;
  readonly registrationIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly capabilityGeneration: number;
  readonly capabilitiesDigestSha256: string;
  readonly authority: 'realtime-voice-request-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryRealtimeVoicePolicy {
  readonly format: typeof FURY_REALTIME_VOICE_POLICY_FORMAT;
  readonly policyId: string;
  readonly allowStream: true;
  readonly requestDigestSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly direction: FuryRealtimeVoiceDirection;
  readonly sourceDigestSha256: string;
  readonly sinkDigestSha256: string;
  readonly expiresInMs: number;
}

export interface FuryRealtimeVoiceLease {
  readonly format: typeof FURY_REALTIME_VOICE_LEASE_FORMAT;
  readonly leaseIdSha256: string;
  readonly policyIdSha256: string;
  readonly requestDigestSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly direction: FuryRealtimeVoiceDirection;
  readonly sourceDigestSha256: string;
  readonly sinkDigestSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly livenessEpochSha256: string;
  readonly registrationIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly capabilityGeneration: number;
  readonly capabilitiesDigestSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly maxBytes: number;
  readonly maxFrames: number;
  readonly authority: 'realtime-voice-stream-lease';
  readonly executionAuthority: true;
  readonly automaticReplayAllowed: false;
}

export interface FuryRealtimeVoiceFrame {
  readonly format: typeof FURY_REALTIME_VOICE_FRAME_FORMAT;
  readonly sequence: number;
  readonly direction: FuryRealtimeVoiceFrameDirection;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface FuryRealtimeVoiceAdapterContext {
  readonly leaseIdSha256: string;
  readonly requestDigestSha256: string;
  readonly sequence: number;
  readonly direction: FuryRealtimeVoiceFrameDirection;
  readonly maxFrameBytes: number;
  readonly signal?: AbortSignal;
}

export interface FuryRealtimeVoiceAdapterFrameResult {
  readonly status: 'accepted' | 'rejected' | 'unknown';
  readonly providerSessionId?: string;
}

export interface FuryRealtimeVoiceAdapterTerminalResult {
  readonly status: 'acknowledged' | 'unknown';
  readonly providerSessionId?: string;
}

export interface FuryRealtimeVoiceAdapter {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  sendFrame(frame: Readonly<{ direction: FuryRealtimeVoiceFrameDirection; mimeType: string; bytes: Uint8Array }>, context: FuryRealtimeVoiceAdapterContext): Promise<unknown>;
  interrupt(context: Readonly<{ leaseIdSha256: string; requestDigestSha256: string; signal?: AbortSignal }>): Promise<unknown>;
  cancel(context: Readonly<{ leaseIdSha256: string; requestDigestSha256: string; reason: 'cancelled' | 'revoked'; signal?: AbortSignal }>): Promise<unknown>;
}

export interface FuryRealtimeVoiceAdapterRegistry {
  get(bundleId: string, bundleVersion: string, profileId: string): FuryRealtimeVoiceAdapter | undefined;
}

export interface FuryRealtimeVoiceFrameReceipt {
  readonly format: typeof FURY_REALTIME_VOICE_FRAME_RECEIPT_FORMAT;
  readonly leaseIdSha256: string;
  readonly requestDigestSha256: string;
  readonly sequence: number;
  readonly direction: FuryRealtimeVoiceFrameDirection;
  readonly frameSha256: string;
  readonly byteCount: number;
  readonly cumulativeBytes: number;
  readonly cumulativeFrames: number;
  readonly outcome: 'accepted' | 'rejected';
  readonly providerSessionIdSha256?: string;
  readonly providerResult: 'adapter-reported-unverified';
  readonly speakerPlaybackAuthorized: false;
  readonly retrySafe: false;
  readonly automaticReplayAllowed: false;
  readonly executionAuthority: false;
}

export interface FuryRealtimeVoiceInspection {
  readonly format: typeof FURY_REALTIME_VOICE_INSPECTION_FORMAT;
  readonly leaseIdSha256: string;
  readonly requestDigestSha256: string;
  readonly status: FuryRealtimeVoiceLeaseStatus;
  readonly direction: FuryRealtimeVoiceDirection;
  readonly sourceDigestSha256: string;
  readonly sinkDigestSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly frames: number;
  readonly bytes: number;
  readonly maxFrames: number;
  readonly maxBytes: number;
  readonly remoteTerminationVerified: false;
  readonly authority: 'realtime-voice-observation-only';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryRealtimeVoiceTerminalReceipt {
  readonly format: typeof FURY_REALTIME_VOICE_TERMINAL_RECEIPT_FORMAT;
  readonly leaseIdSha256: string;
  readonly requestDigestSha256: string;
  readonly action: 'interrupt' | 'cancel' | 'revoke';
  readonly status: 'interrupted' | 'cancelled' | 'revoked';
  readonly providerSessionIdSha256?: string;
  readonly providerResult: 'adapter-reported-unverified';
  readonly remoteRollbackAssumed: false;
  readonly retrySafe: false;
  readonly automaticReplayAllowed: false;
  readonly executionAuthority: false;
}

export interface FuryRealtimeVoiceCoordinatorOptions {
  readonly gatewaySessionCoordinator: FuryGatewaySessionCoordinator;
  readonly gatewaySession: FuryGatewaySessionLease;
  readonly nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator;
  readonly nodeSession: FuryGatewayNodeSession;
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly node: FuryGatewayNodeDescriptor;
  readonly adapters: FuryRealtimeVoiceAdapterRegistry;
  readonly now?: () => number;
  readonly maxHealthAgeMs?: number;
  readonly maxLeaseTtlMs?: number;
  readonly maxActiveLeases?: number;
}

export interface FuryRealtimeVoiceCoordinator {
  prepare(input: FuryRealtimeVoicePrepareInput): FuryRealtimeVoiceRequest;
  authorize(request: FuryRealtimeVoiceRequest, policy: FuryRealtimeVoicePolicy): FuryRealtimeVoiceLease;
  sendFrame(lease: FuryRealtimeVoiceLease, frame: FuryRealtimeVoiceFrame, options?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceFrameReceipt>;
  interrupt(lease: FuryRealtimeVoiceLease, options?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceTerminalReceipt>;
  cancel(lease: FuryRealtimeVoiceLease, options?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceTerminalReceipt>;
  revoke(lease: FuryRealtimeVoiceLease, options?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceTerminalReceipt>;
  inspect(lease: FuryRealtimeVoiceLease): FuryRealtimeVoiceInspection;
  activeLeaseCount(): number;
}

export type FuryRealtimeVoiceErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'invalid-session-evidence'
  | 'gateway-session-not-active'
  | 'gateway-session-scope-missing'
  | 'node-session-not-live'
  | 'capability-not-current'
  | 'profile-not-found'
  | 'profile-not-eligible'
  | 'profile-health-not-fresh'
  | 'execution-not-authorized'
  | 'invalid-request'
  | 'invalid-lease'
  | 'lease-expired'
  | 'lease-not-live'
  | 'lease-stale'
  | 'frame-order'
  | 'frame-direction'
  | 'media-type-not-supported'
  | 'frame-limit'
  | 'byte-limit'
  | 'adapter-not-registered'
  | 'adapter-result-invalid'
  | 'adapter-error'
  | 'limit-exceeded';

export class FuryRealtimeVoiceError extends Error {
  readonly retrySafe = false;
  constructor(
    readonly code: FuryRealtimeVoiceErrorCode,
    message: string,
    readonly adapterInvoked = false,
    readonly outcome: 'not-started' | 'unknown' = adapterInvoked ? 'unknown' : 'not-started',
  ) {
    super(message);
    this.name = 'FuryRealtimeVoiceError';
  }
}

interface RequestState {
  readonly coordinator: FuryRealtimeVoiceCoordinator;
  readonly request: FuryRealtimeVoiceRequest;
  readonly bundle: FuryMediaPluginBundle;
  readonly profile: FuryMediaPluginProfile;
  readonly capability: NonNullable<FuryGatewayNodeSessionObservation['capability']>;
}

interface LeaseState {
  readonly coordinator: FuryRealtimeVoiceCoordinator;
  readonly requestState: RequestState;
  readonly lease: FuryRealtimeVoiceLease;
  status: FuryRealtimeVoiceLeaseStatus;
  sequence: number;
  frames: number;
  bytes: number;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const GENERATED_ADAPTER_REGISTRIES = new WeakSet<object>();
const REQUEST_STATES = new WeakMap<object, RequestState>();
const LEASE_STATES = new WeakMap<object, LeaseState>();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const DEFAULT_HEALTH_AGE_MS = 60_000;
const HARD_HEALTH_AGE_MS = 5 * 60_000;
const DEFAULT_LEASE_TTL_MS = 30_000;
const HARD_LEASE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ACTIVE_LEASES = 32;
const HARD_MAX_ACTIVE_LEASES = 1_024;
const HARD_MAX_FRAMES = 65_536;
const HARD_MAX_BYTES = 64 * 1024 * 1024;
const HARD_MAX_DURATION_MS = 10 * 60_000;
const MAX_ADAPTERS = 256;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256').update('furypipe-realtime-voice/v1\0').update(label).update('\0').update(value).digest('hex');
}

function fail(code: FuryRealtimeVoiceErrorCode, message: string, adapterInvoked = false): never {
  throw new FuryRealtimeVoiceError(code, message, adapterInvoked, adapterInvoked ? 'unknown' : 'not-started');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) fail('invalid-config', `${label} must be an integer between ${min} and ${max}`);
  return resolved;
}

function safeNow(now: () => number): number {
  let value: number;
  try { value = now(); } catch { fail('invalid-config', 'realtime voice clock failed'); }
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-config', 'realtime voice clock must return a safe non-negative timestamp');
  return value;
}

function plainRecord(value: unknown, label: string, code: FuryRealtimeVoiceErrorCode = 'invalid-input'): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FuryRealtimeVoiceError(code, `${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new FuryRealtimeVoiceError(code, `${label} must use a plain-object prototype`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new FuryRealtimeVoiceError(code, `${label} must not contain symbol keys`);
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new FuryRealtimeVoiceError(code, `${label} must contain enumerable data properties only`);
  }
  return record;
}

function exactKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[], required: readonly string[], label: string, code: FuryRealtimeVoiceErrorCode = 'invalid-input'): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(record)) if (!accepted.has(key)) throw new FuryRealtimeVoiceError(code, `${label} contains unsupported field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) throw new FuryRealtimeVoiceError(code, `${label} is missing required field: ${key}`);
}

function validSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object' && value !== null
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function';
}

function signalFrom(options: { readonly signal?: AbortSignal } | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  const record = plainRecord(options, 'realtime voice execution options');
  exactKeys(record, ['signal'], [], 'realtime voice execution options');
  if (options.signal !== undefined && !validSignal(options.signal)) fail('invalid-input', 'realtime voice signal is invalid');
  return options.signal;
}

function directionAllows(leaseDirection: FuryRealtimeVoiceDirection, frameDirection: FuryRealtimeVoiceFrameDirection): boolean {
  return leaseDirection === 'duplex' || leaseDirection === frameDirection;
}

function profileFor(bundle: FuryMediaPluginBundle, profileId: string, now: number, maxHealthAgeMs: number): FuryMediaPluginProfile {
  if (!bundle || typeof bundle !== 'object' || bundle.format !== 'furypipe-media-plugin-bundle/v1') fail('profile-not-found', 'validated media plugin bundle is required');
  const profile = bundle.profiles.find((candidate) => candidate.id === profileId);
  if (!profile || profile.family !== 'realtime-voice-provider') fail('profile-not-found', 'realtime voice profile was not found');
  if (profile.lifecycle !== 'registered' || !profile.permissions.includes('voice-realtime')) fail('profile-not-eligible', 'realtime voice profile is not eligible');
  if (profile.health.status !== 'healthy' || !Number.isSafeInteger(profile.health.observedAt) || profile.health.observedAt > now || now - profile.health.observedAt > maxHealthAgeMs) {
    fail('profile-health-not-fresh', 'realtime voice profile health is not fresh');
  }
  if (profile.supportedMediaTypes.length < 1 || !profile.supportedMediaTypes.every((mime) => MIME.test(mime))) fail('profile-not-eligible', 'realtime voice profile media declarations are invalid');
  return profile;
}

function adapterKey(bundleId: string, bundleVersion: string, profileId: string): string {
  return `${bundleId}\0${bundleVersion}\0${profileId}`;
}

export function createFuryRealtimeVoiceAdapterRegistry(adapters: readonly FuryRealtimeVoiceAdapter[]): FuryRealtimeVoiceAdapterRegistry {
  if (!Array.isArray(adapters) || adapters.length > MAX_ADAPTERS) fail('invalid-config', 'realtime voice adapter registry exceeds its bound');
  const byKey = new Map<string, FuryRealtimeVoiceAdapter>();
  for (let index = 0; index < adapters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(adapters, String(index));
    if (!descriptor || !('value' in descriptor)) fail('invalid-config', 'realtime voice adapter registry entry is invalid');
    const adapter = descriptor.value as FuryRealtimeVoiceAdapter;
    const record = plainRecord(adapter, 'realtime voice adapter', 'invalid-config');
    exactKeys(record, ['bundleId','bundleVersion','profileId','sendFrame','interrupt','cancel'], ['bundleId','bundleVersion','profileId','sendFrame','interrupt','cancel'], 'realtime voice adapter', 'invalid-config');
    if (!ID.test(adapter.bundleId) || !ID.test(adapter.bundleVersion) || !ID.test(adapter.profileId) || typeof adapter.sendFrame !== 'function' || typeof adapter.interrupt !== 'function' || typeof adapter.cancel !== 'function') {
      fail('invalid-config', 'realtime voice adapter identity is invalid');
    }
    const key = adapterKey(adapter.bundleId, adapter.bundleVersion, adapter.profileId);
    if (byKey.has(key)) fail('invalid-config', 'realtime voice adapter is duplicated');
    byKey.set(key, Object.freeze({ ...adapter }));
  }
  const registry: FuryRealtimeVoiceAdapterRegistry = Object.freeze({ get: (bundleId: string, bundleVersion: string, profileId: string) => byKey.get(adapterKey(bundleId,bundleVersion,profileId)) });
  GENERATED_ADAPTER_REGISTRIES.add(registry);
  return registry;
}

export function isGeneratedFuryRealtimeVoiceAdapterRegistry(value: unknown): value is FuryRealtimeVoiceAdapterRegistry {
  return typeof value === 'object' && value !== null && GENERATED_ADAPTER_REGISTRIES.has(value);
}

export function isGeneratedFuryRealtimeVoiceCoordinator(value: unknown): value is FuryRealtimeVoiceCoordinator {
  return typeof value === 'object' && value !== null && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryRealtimeVoiceRequest(value: unknown): value is FuryRealtimeVoiceRequest {
  return typeof value === 'object' && value !== null && REQUEST_STATES.has(value);
}

export function isGeneratedFuryRealtimeVoiceLease(value: unknown): value is FuryRealtimeVoiceLease {
  return typeof value === 'object' && value !== null && LEASE_STATES.has(value);
}

export function createFuryRealtimeVoiceCoordinator(options: FuryRealtimeVoiceCoordinatorOptions): FuryRealtimeVoiceCoordinator {
  if (!options || typeof options !== 'object' || !isGeneratedFuryGatewaySessionLease(options.gatewaySession) || !isGeneratedFuryGatewayNodeSession(options.nodeSession) || !isGeneratedFuryGatewayNodeSessionCoordinator(options.nodeSessionCoordinator) || !isGeneratedFuryGatewayNodeRegistry(options.nodeRegistry) || !isGeneratedFuryGatewayNodeDescriptor(options.node) || !isGeneratedFuryRealtimeVoiceAdapterRegistry(options.adapters)) {
    fail('invalid-config', 'realtime voice coordinator requires genuine process-local session and adapter evidence');
  }
  if (!options.gatewaySessionCoordinator || typeof options.gatewaySessionCoordinator.inspectSession !== 'function' || typeof options.gatewaySessionCoordinator.isActiveSession !== 'function') {
    fail('invalid-config', 'realtime voice coordinator requires a gateway session coordinator');
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') fail('invalid-config', 'realtime voice clock must be a function');
  const maxHealthAgeMs = boundedInteger(options.maxHealthAgeMs, DEFAULT_HEALTH_AGE_MS, 1_000, HARD_HEALTH_AGE_MS, 'maxHealthAgeMs');
  const maxLeaseTtlMs = boundedInteger(options.maxLeaseTtlMs, DEFAULT_LEASE_TTL_MS, 1_000, HARD_LEASE_TTL_MS, 'maxLeaseTtlMs');
  const maxActiveLeases = boundedInteger(options.maxActiveLeases, DEFAULT_MAX_ACTIVE_LEASES, 1, HARD_MAX_ACTIVE_LEASES, 'maxActiveLeases');
  const active = new Set<FuryRealtimeVoiceLease>();
  let coordinator: FuryRealtimeVoiceCoordinator;

  const currentAuthority = (expectedCapability?: NonNullable<FuryGatewayNodeSessionObservation['capability']>) => {
    if (!options.gatewaySessionCoordinator.isActiveSession(options.gatewaySession)) fail('gateway-session-not-active', 'gateway session is not active');
    let gatewayObservation;
    try { gatewayObservation = options.gatewaySessionCoordinator.inspectSession(options.gatewaySession); } catch { fail('gateway-session-not-active', 'gateway session is not active'); }
    if (gatewayObservation.status !== 'active') fail('gateway-session-not-active', 'gateway session is not active');
    if (!gatewayObservation.scopes.includes('nodes.manage')) fail('gateway-session-scope-missing', 'gateway session lacks nodes.manage scope');
    let nodeObservation: FuryGatewayNodeSessionObservation;
    try { nodeObservation = options.nodeSessionCoordinator.inspectSession(options.nodeSession); } catch { fail('node-session-not-live', 'node session is not live'); }
    if (nodeObservation.status !== 'live') fail('node-session-not-live', 'node session is not live');
    if (nodeObservation.registrationId !== options.node.registrationId || nodeObservation.deviceId !== options.node.deviceId || nodeObservation.pairingId !== options.node.pairingId) {
      fail('node-session-not-live', 'node session identity no longer matches registered node');
    }
    if (!nodeObservation.capability) fail('capability-not-current', 'node capability advertisement is not current');
    let advertisement;
    try { advertisement = options.nodeRegistry.currentAdvertisement(options.node); } catch { fail('capability-not-current', 'node capability advertisement is not current'); }
    if (!advertisement || !isGeneratedFuryGatewayNodeCapabilityAdvertisement(advertisement) || !advertisement.capabilities.includes('voice.realtime') || advertisement.generation !== nodeObservation.capability.generation || advertisement.capabilitiesDigestSha256 !== nodeObservation.capability.capabilitiesDigestSha256) {
      fail('capability-not-current', 'voice.realtime capability is not current');
    }
    if (expectedCapability && (nodeObservation.capability.generation !== expectedCapability.generation || nodeObservation.capability.capabilitiesDigestSha256 !== expectedCapability.capabilitiesDigestSha256)) {
      fail('lease-stale', 'realtime voice capability generation changed');
    }
    return { gatewayObservation, nodeObservation, advertisement };
  };

  const requestStateFor = (request: FuryRealtimeVoiceRequest): RequestState => {
    if (!isGeneratedFuryRealtimeVoiceRequest(request)) fail('invalid-request', 'realtime voice request must be process-local');
    const state = REQUEST_STATES.get(request)!;
    if (state.coordinator !== coordinator || state.request !== request) fail('invalid-request', 'realtime voice request belongs to another coordinator');
    return state;
  };

  const leaseStateFor = (lease: FuryRealtimeVoiceLease): LeaseState => {
    if (!isGeneratedFuryRealtimeVoiceLease(lease)) fail('invalid-lease', 'realtime voice lease must be process-local');
    const state = LEASE_STATES.get(lease)!;
    if (state.coordinator !== coordinator || state.lease !== lease) fail('invalid-lease', 'realtime voice lease belongs to another coordinator');
    return state;
  };

  const refresh = (state: LeaseState): FuryRealtimeVoiceLeaseStatus => {
    if (state.status !== 'live') return state.status;
    const at = safeNow(now);
    if (at >= state.lease.expiresAt) {
      state.status = 'expired';
      active.delete(state.lease);
      return state.status;
    }
    try { currentAuthority(state.requestState.capability); }
    catch {
      state.status = 'authority-stale';
      active.delete(state.lease);
      return state.status;
    }
    return state.status;
  };

  const exactAdapter = (state: LeaseState): FuryRealtimeVoiceAdapter => {
    const adapter = options.adapters.get(state.lease.bundleId, state.lease.bundleVersion, state.lease.profileId);
    if (!adapter || adapter.bundleId !== state.lease.bundleId || adapter.bundleVersion !== state.lease.bundleVersion || adapter.profileId !== state.lease.profileId) fail('adapter-not-registered', 'exact realtime voice adapter is not registered');
    return adapter;
  };

  const terminalAction = async (lease: FuryRealtimeVoiceLease, action: 'interrupt' | 'cancel' | 'revoke', executionOptions?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceTerminalReceipt> => {
    const state = leaseStateFor(lease);
    if (refresh(state) !== 'live') fail('lease-not-live', 'realtime voice lease is not live');
    const adapter = exactAdapter(state);
    const signal = signalFrom(executionOptions);
    state.status = 'unknown';
    active.delete(lease);
    let raw: unknown;
    try {
      raw = action === 'interrupt'
        ? await adapter.interrupt(Object.freeze({ leaseIdSha256: lease.leaseIdSha256, requestDigestSha256: lease.requestDigestSha256, ...(signal === undefined ? {} : { signal }) }))
        : await adapter.cancel(Object.freeze({ leaseIdSha256: lease.leaseIdSha256, requestDigestSha256: lease.requestDigestSha256, reason: action === 'revoke' ? 'revoked' : 'cancelled', ...(signal === undefined ? {} : { signal }) }));
    } catch {
      fail('adapter-error', 'realtime voice terminal adapter outcome is unknown', true);
    }
    let record: Readonly<Record<string, unknown>>;
    try {
      record = plainRecord(raw, 'realtime voice terminal adapter result', 'adapter-result-invalid');
      exactKeys(record, ['status','providerSessionId'], ['status'], 'realtime voice terminal adapter result', 'adapter-result-invalid');
    } catch {
      fail('adapter-result-invalid', 'realtime voice terminal adapter result is invalid', true);
    }
    if (record.status !== 'acknowledged' && record.status !== 'unknown') fail('adapter-result-invalid', 'realtime voice terminal adapter status is invalid', true);
    if (record.providerSessionId !== undefined && (typeof record.providerSessionId !== 'string' || !ID.test(record.providerSessionId))) fail('adapter-result-invalid', 'realtime voice provider session ID is invalid', true);
    if (record.status === 'unknown') fail('adapter-error', 'realtime voice terminal adapter reported unknown outcome', true);
    const status = action === 'interrupt' ? 'interrupted' : action === 'cancel' ? 'cancelled' : 'revoked';
    state.status = status;
    return Object.freeze({
      format: FURY_REALTIME_VOICE_TERMINAL_RECEIPT_FORMAT,
      leaseIdSha256: lease.leaseIdSha256,
      requestDigestSha256: lease.requestDigestSha256,
      action,
      status,
      ...(record.providerSessionId === undefined ? {} : { providerSessionIdSha256: sha256(record.providerSessionId as string) }),
      providerResult: 'adapter-reported-unverified' as const,
      remoteRollbackAssumed: false as const,
      retrySafe: false as const,
      automaticReplayAllowed: false as const,
      executionAuthority: false as const,
    });
  };

  coordinator = Object.freeze({
    prepare(input: FuryRealtimeVoicePrepareInput): FuryRealtimeVoiceRequest {
      const record = plainRecord(input, 'realtime voice prepare input');
      exactKeys(record, ['bundle','profileId','direction','sourceDigestSha256','sinkDigestSha256','maxBytes','maxFrames','maxDurationMs'], ['bundle','profileId','direction','sourceDigestSha256','sinkDigestSha256','maxBytes','maxFrames','maxDurationMs'], 'realtime voice prepare input');
      const at = safeNow(now);
      const authority = currentAuthority();
      if (typeof input.profileId !== 'string' || !ID.test(input.profileId) || !['input','output','duplex'].includes(input.direction) || !SHA256.test(input.sourceDigestSha256) || !SHA256.test(input.sinkDigestSha256)) fail('invalid-input', 'realtime voice request identity is invalid');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > HARD_MAX_BYTES || !Number.isSafeInteger(input.maxFrames) || input.maxFrames < 1 || input.maxFrames > HARD_MAX_FRAMES || !Number.isSafeInteger(input.maxDurationMs) || input.maxDurationMs < 1 || input.maxDurationMs > HARD_MAX_DURATION_MS) fail('invalid-input', 'realtime voice request budgets are invalid');
      const profile = profileFor(input.bundle, input.profileId, at, maxHealthAgeMs);
      const maxProfileBytes = Math.max(profile.bounds.maxInputBytes, profile.bounds.maxOutputBytes);
      if (input.maxBytes > maxProfileBytes || (profile.bounds.maxDurationMs !== undefined && input.maxDurationMs > profile.bounds.maxDurationMs)) fail('invalid-input', 'realtime voice request exceeds profile bounds');
      const capability = authority.nodeObservation.capability!;
      const body = JSON.stringify({
        bundleId: input.bundle.id,
        bundleVersion: input.bundle.version,
        profileId: profile.id,
        direction: input.direction,
        sourceDigestSha256: input.sourceDigestSha256,
        sinkDigestSha256: input.sinkDigestSha256,
        maxBytes: input.maxBytes,
        maxFrames: input.maxFrames,
        maxDurationMs: input.maxDurationMs,
        gatewaySessionId: options.gatewaySession.sessionId,
        principalId: options.gatewaySession.principalId,
        nodeSessionId: options.nodeSession.sessionId,
        livenessEpoch: options.nodeSession.livenessEpoch,
        registrationId: options.node.registrationId,
        deviceId: options.node.deviceId,
        pairingId: options.node.pairingId,
        capabilityGeneration: capability.generation,
        capabilitiesDigestSha256: capability.capabilitiesDigestSha256,
      });
      const request: FuryRealtimeVoiceRequest = Object.freeze({
        format: FURY_REALTIME_VOICE_REQUEST_FORMAT,
        requestDigestSha256: digest('request', body),
        bundleId: input.bundle.id,
        bundleVersion: input.bundle.version,
        profileId: profile.id,
        direction: input.direction,
        sourceDigestSha256: input.sourceDigestSha256,
        sinkDigestSha256: input.sinkDigestSha256,
        maxBytes: input.maxBytes,
        maxFrames: input.maxFrames,
        maxDurationMs: input.maxDurationMs,
        gatewaySessionIdSha256: sha256(options.gatewaySession.sessionId),
        principalIdSha256: sha256(options.gatewaySession.principalId),
        nodeSessionIdSha256: sha256(options.nodeSession.sessionId),
        livenessEpochSha256: sha256(options.nodeSession.livenessEpoch),
        registrationIdSha256: sha256(options.node.registrationId),
        deviceIdSha256: sha256(options.node.deviceId),
        pairingIdSha256: sha256(options.node.pairingId),
        capabilityGeneration: capability.generation,
        capabilitiesDigestSha256: capability.capabilitiesDigestSha256,
        authority: 'realtime-voice-request-evidence-only' as const,
        executionAuthority: false as const,
      });
      REQUEST_STATES.set(request, { coordinator, request, bundle: input.bundle, profile, capability });
      return request;
    },

    authorize(request: FuryRealtimeVoiceRequest, policy: FuryRealtimeVoicePolicy): FuryRealtimeVoiceLease {
      const state = requestStateFor(request);
      if (active.size >= maxActiveLeases) fail('limit-exceeded', 'realtime voice active lease limit reached');
      const at = safeNow(now);
      const authority = currentAuthority(state.capability);
      profileFor(state.bundle, state.profile.id, at, maxHealthAgeMs);
      const record = plainRecord(policy, 'realtime voice policy', 'execution-not-authorized');
      exactKeys(record, ['format','policyId','allowStream','requestDigestSha256','bundleId','bundleVersion','profileId','direction','sourceDigestSha256','sinkDigestSha256','expiresInMs'], ['format','policyId','allowStream','requestDigestSha256','bundleId','bundleVersion','profileId','direction','sourceDigestSha256','sinkDigestSha256','expiresInMs'], 'realtime voice policy', 'execution-not-authorized');
      if (policy.format !== FURY_REALTIME_VOICE_POLICY_FORMAT || policy.allowStream !== true || !ID.test(policy.policyId) || policy.requestDigestSha256 !== request.requestDigestSha256 || policy.bundleId !== request.bundleId || policy.bundleVersion !== request.bundleVersion || policy.profileId !== request.profileId || policy.direction !== request.direction || policy.sourceDigestSha256 !== request.sourceDigestSha256 || policy.sinkDigestSha256 !== request.sinkDigestSha256 || !Number.isSafeInteger(policy.expiresInMs) || policy.expiresInMs < 1 || policy.expiresInMs > maxLeaseTtlMs) fail('execution-not-authorized', 'realtime voice policy does not authorize exact request');
      const expiresAt = Math.min(
        at + policy.expiresInMs,
        at + request.maxDurationMs,
        options.gatewaySession.expiresAt,
        authority.nodeObservation.liveUntil,
        state.profile.health.observedAt + maxHealthAgeMs,
      );
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= at) fail('execution-not-authorized', 'realtime voice authority expires immediately');
      const lease: FuryRealtimeVoiceLease = Object.freeze({
        format: FURY_REALTIME_VOICE_LEASE_FORMAT,
        leaseIdSha256: digest('lease', randomBytes(32).toString('base64url')),
        policyIdSha256: sha256(policy.policyId),
        requestDigestSha256: request.requestDigestSha256,
        bundleId: request.bundleId,
        bundleVersion: request.bundleVersion,
        profileId: request.profileId,
        direction: request.direction,
        sourceDigestSha256: request.sourceDigestSha256,
        sinkDigestSha256: request.sinkDigestSha256,
        gatewaySessionIdSha256: request.gatewaySessionIdSha256,
        principalIdSha256: request.principalIdSha256,
        nodeSessionIdSha256: request.nodeSessionIdSha256,
        livenessEpochSha256: request.livenessEpochSha256,
        registrationIdSha256: request.registrationIdSha256,
        deviceIdSha256: request.deviceIdSha256,
        pairingIdSha256: request.pairingIdSha256,
        capabilityGeneration: request.capabilityGeneration,
        capabilitiesDigestSha256: request.capabilitiesDigestSha256,
        issuedAt: at,
        expiresAt,
        maxBytes: request.maxBytes,
        maxFrames: request.maxFrames,
        authority: 'realtime-voice-stream-lease' as const,
        executionAuthority: true as const,
        automaticReplayAllowed: false as const,
      });
      const leaseState: LeaseState = { coordinator, requestState: state, lease, status: 'live', sequence: 0, frames: 0, bytes: 0 };
      LEASE_STATES.set(lease, leaseState);
      active.add(lease);
      return lease;
    },

    async sendFrame(lease: FuryRealtimeVoiceLease, frame: FuryRealtimeVoiceFrame, executionOptions?: { readonly signal?: AbortSignal }): Promise<FuryRealtimeVoiceFrameReceipt> {
      const state = leaseStateFor(lease);
      if (refresh(state) !== 'live') fail(state.status === 'expired' ? 'lease-expired' : 'lease-not-live', 'realtime voice lease is not live');
      const record = plainRecord(frame, 'realtime voice frame');
      exactKeys(record, ['format','sequence','direction','mimeType','bytes'], ['format','sequence','direction','mimeType','bytes'], 'realtime voice frame');
      if (frame.format !== FURY_REALTIME_VOICE_FRAME_FORMAT || !Number.isSafeInteger(frame.sequence) || frame.sequence !== state.sequence + 1) fail('frame-order', 'realtime voice frame sequence is not monotonic');
      if (!['input','output'].includes(frame.direction) || !directionAllows(lease.direction, frame.direction)) fail('frame-direction', 'realtime voice frame direction is outside lease scope');
      if (typeof frame.mimeType !== 'string' || !MIME.test(frame.mimeType) || !state.requestState.profile.supportedMediaTypes.includes(frame.mimeType)) fail('media-type-not-supported', 'realtime voice frame MIME is unsupported');
      if (!(frame.bytes instanceof Uint8Array) || frame.bytes.byteLength < 1) fail('invalid-input', 'realtime voice frame bytes are invalid');
      const perFrameLimit = frame.direction === 'input' ? state.requestState.profile.bounds.maxInputBytes : state.requestState.profile.bounds.maxOutputBytes;
      if (frame.bytes.byteLength > perFrameLimit || state.bytes + frame.bytes.byteLength > lease.maxBytes) fail('byte-limit', 'realtime voice frame exceeds byte budget');
      if (state.frames + 1 > lease.maxFrames) fail('frame-limit', 'realtime voice frame budget exhausted');
      currentAuthority(state.requestState.capability);
      const adapter = exactAdapter(state);
      const signal = signalFrom(executionOptions);
      const retained = new Uint8Array(frame.bytes);
      let raw: unknown;
      try {
        raw = await adapter.sendFrame(
          Object.freeze({ direction: frame.direction, mimeType: frame.mimeType, bytes: retained }),
          Object.freeze({ leaseIdSha256: lease.leaseIdSha256, requestDigestSha256: lease.requestDigestSha256, sequence: frame.sequence, direction: frame.direction, maxFrameBytes: perFrameLimit, ...(signal === undefined ? {} : { signal }) }),
        );
      } catch {
        state.status = 'unknown';
        active.delete(lease);
        retained.fill(0);
        fail('adapter-error', 'realtime voice frame outcome is unknown', true);
      }
      retained.fill(0);
      let result: Readonly<Record<string, unknown>>;
      try {
        result = plainRecord(raw, 'realtime voice frame adapter result', 'adapter-result-invalid');
        exactKeys(result, ['status','providerSessionId'], ['status'], 'realtime voice frame adapter result', 'adapter-result-invalid');
      } catch {
        state.status = 'unknown'; active.delete(lease); fail('adapter-result-invalid', 'realtime voice frame adapter result is invalid', true);
      }
      if (!['accepted','rejected','unknown'].includes(result.status as string)) {
        state.status = 'unknown'; active.delete(lease); fail('adapter-result-invalid', 'realtime voice adapter result status is invalid', true);
      }
      if (result.providerSessionId !== undefined && (typeof result.providerSessionId !== 'string' || !ID.test(result.providerSessionId))) {
        state.status = 'unknown'; active.delete(lease); fail('adapter-result-invalid', 'realtime voice provider session ID is invalid', true);
      }
      if (result.status === 'unknown') {
        state.status = 'unknown'; active.delete(lease); fail('adapter-error', 'realtime voice adapter reported unknown frame outcome', true);
      }
      try { currentAuthority(state.requestState.capability); } catch {
        state.status = 'unknown'; active.delete(lease); fail('adapter-error', 'realtime voice authority changed after dispatch', true);
      }
      state.sequence = frame.sequence;
      state.frames += 1;
      state.bytes += frame.bytes.byteLength;
      return Object.freeze({
        format: FURY_REALTIME_VOICE_FRAME_RECEIPT_FORMAT,
        leaseIdSha256: lease.leaseIdSha256,
        requestDigestSha256: lease.requestDigestSha256,
        sequence: frame.sequence,
        direction: frame.direction,
        frameSha256: sha256(frame.bytes),
        byteCount: frame.bytes.byteLength,
        cumulativeBytes: state.bytes,
        cumulativeFrames: state.frames,
        outcome: result.status as 'accepted' | 'rejected',
        ...(result.providerSessionId === undefined ? {} : { providerSessionIdSha256: sha256(result.providerSessionId as string) }),
        providerResult: 'adapter-reported-unverified' as const,
        speakerPlaybackAuthorized: false as const,
        retrySafe: false as const,
        automaticReplayAllowed: false as const,
        executionAuthority: false as const,
      });
    },

    interrupt(lease: FuryRealtimeVoiceLease, executionOptions?: { readonly signal?: AbortSignal }) { return terminalAction(lease, 'interrupt', executionOptions); },
    cancel(lease: FuryRealtimeVoiceLease, executionOptions?: { readonly signal?: AbortSignal }) { return terminalAction(lease, 'cancel', executionOptions); },
    revoke(lease: FuryRealtimeVoiceLease, executionOptions?: { readonly signal?: AbortSignal }) { return terminalAction(lease, 'revoke', executionOptions); },

    inspect(lease: FuryRealtimeVoiceLease): FuryRealtimeVoiceInspection {
      const state = leaseStateFor(lease);
      refresh(state);
      return Object.freeze({
        format: FURY_REALTIME_VOICE_INSPECTION_FORMAT,
        leaseIdSha256: lease.leaseIdSha256,
        requestDigestSha256: lease.requestDigestSha256,
        status: state.status,
        direction: lease.direction,
        sourceDigestSha256: lease.sourceDigestSha256,
        sinkDigestSha256: lease.sinkDigestSha256,
        issuedAt: lease.issuedAt,
        expiresAt: lease.expiresAt,
        frames: state.frames,
        bytes: state.bytes,
        maxFrames: lease.maxFrames,
        maxBytes: lease.maxBytes,
        remoteTerminationVerified: false as const,
        authority: 'realtime-voice-observation-only' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
    },

    activeLeaseCount(): number {
      for (const lease of [...active]) refresh(leaseStateFor(lease));
      return active.size;
    },
  });
  GENERATED_COORDINATORS.add(coordinator);
  return coordinator;
}
