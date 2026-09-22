import { createHash, randomUUID } from 'node:crypto';

import type {
  FuryMediaPluginBundle,
  FuryMediaPluginPermission,
  FuryMediaPluginProfile,
} from './media-plugin-contracts.js';
import {
  FURY_MEDIA_INGESTION_INPUT_FORMAT,
  FURY_MEDIA_INGESTION_SOURCE_FORMAT,
  isGeneratedFuryMediaIngestionCoordinator,
  isGeneratedFuryMediaIngestionHandle,
  type FuryMediaIngestionCoordinator,
  type FuryMediaIngestionHandle,
} from './media-ingestion.js';

export const FURY_VOICE_OPERATION_REQUEST_FORMAT = 'furypipe-voice-operation-request/v1' as const;
export const FURY_VOICE_OPERATION_POLICY_FORMAT = 'furypipe-voice-operation-policy/v1' as const;
export const FURY_VOICE_OPERATION_PERMIT_FORMAT = 'furypipe-voice-operation-permit/v1' as const;
export const FURY_STT_RESULT_FORMAT = 'furypipe-stt-result/v1' as const;
export const FURY_TTS_RESULT_FORMAT = 'furypipe-tts-result/v1' as const;
export const FURY_VOICE_OPERATION_EVIDENCE_FORMAT = 'furypipe-voice-operation-evidence/v1' as const;

export type FuryVoiceOperation = 'stt' | 'tts';

export interface FuryVoiceOperationRequest {
  readonly format: typeof FURY_VOICE_OPERATION_REQUEST_FORMAT;
  readonly operation: FuryVoiceOperation;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly inputDigestSha256: string;
  readonly inputBytes: number;
  readonly inputMimeType: string;
  readonly requestDigestSha256: string;
  readonly authority: 'voice-request-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryVoiceOperationPolicy {
  readonly format: typeof FURY_VOICE_OPERATION_POLICY_FORMAT;
  readonly policyId: string;
  readonly allowOperation: true;
  readonly operation: FuryVoiceOperation;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly requestDigestSha256: string;
  readonly expiresInMs: number;
}

export interface FuryVoiceOperationPermit {
  readonly format: typeof FURY_VOICE_OPERATION_PERMIT_FORMAT;
  readonly permitId: string;
  readonly policyId: string;
  readonly operation: FuryVoiceOperation;
  readonly requestDigestSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly automaticReplayAllowed: false;
}

export interface FurySttPrepareInput {
  readonly bundle: FuryMediaPluginBundle;
  readonly profileId: string;
  readonly mediaCoordinator: FuryMediaIngestionCoordinator;
  readonly mediaHandle: FuryMediaIngestionHandle;
  readonly language?: string;
}

export interface FuryTtsPrepareInput {
  readonly bundle: FuryMediaPluginBundle;
  readonly profileId: string;
  readonly text: string;
  readonly voiceId?: string;
  readonly language?: string;
}

export interface FuryVoiceOperationAdapterContext {
  readonly operation: FuryVoiceOperation;
  readonly requestDigestSha256: string;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface FurySttAdapterInput {
  readonly audioBytes: Uint8Array;
  readonly mimeType: string;
  readonly language?: string;
}

export interface FuryTtsAdapterInput {
  readonly text: string;
  readonly voiceId?: string;
  readonly language?: string;
}

export interface FuryVoiceOperationAdapter {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly operation: FuryVoiceOperation;
  execute(
    input: FurySttAdapterInput | FuryTtsAdapterInput,
    context: FuryVoiceOperationAdapterContext,
  ): Promise<unknown>;
}

export interface FuryVoiceOperationAdapterRegistry {
  get(bundleId: string, bundleVersion: string, profileId: string, operation: FuryVoiceOperation): FuryVoiceOperationAdapter | undefined;
}

export interface FuryVoiceOperationEvidence {
  readonly format: typeof FURY_VOICE_OPERATION_EVIDENCE_FORMAT;
  readonly operation: FuryVoiceOperation;
  readonly requestDigestSha256: string;
  readonly policyIdSha256: string;
  readonly permitIdSha256: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly profileId: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly providerRequestIdSha256?: string;
  readonly outcome: 'succeeded';
  readonly providerResult: 'adapter-reported-unverified';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FurySttResult {
  readonly format: typeof FURY_STT_RESULT_FORMAT;
  readonly transcript: string;
  readonly transcriptSha256: string;
  readonly transcriptBytes: number;
  readonly language?: string;
  readonly contentTrust: 'untrusted-transcript';
  readonly instructionAuthority: false;
  readonly promptAdmissionRequired: true;
  readonly speakerPlaybackAuthorized: false;
  readonly evidence: FuryVoiceOperationEvidence;
}

export interface FuryTtsResult {
  readonly format: typeof FURY_TTS_RESULT_FORMAT;
  readonly audioHandle: FuryMediaIngestionHandle;
  readonly audioSha256: string;
  readonly audioBytes: number;
  readonly audioMimeType: string;
  readonly durationMs?: number;
  readonly speakerPlaybackAuthorized: false;
  readonly deviceOperationAuthorized: false;
  readonly evidence: FuryVoiceOperationEvidence;
}

export interface FuryVoiceOperationCoordinatorOptions {
  readonly adapters: FuryVoiceOperationAdapterRegistry;
  readonly mediaCoordinator: FuryMediaIngestionCoordinator;
  readonly now?: () => number;
  readonly maxHealthAgeMs?: number;
  readonly maxPermitTtlMs?: number;
}

export interface FuryVoiceOperationCoordinator {
  prepareStt(input: FurySttPrepareInput): FuryVoiceOperationRequest;
  prepareTts(input: FuryTtsPrepareInput): FuryVoiceOperationRequest;
  authorize(request: FuryVoiceOperationRequest, policy: FuryVoiceOperationPolicy): FuryVoiceOperationPermit;
  execute(
    request: FuryVoiceOperationRequest,
    permit: FuryVoiceOperationPermit,
    options?: { readonly signal?: AbortSignal },
  ): Promise<FurySttResult | FuryTtsResult>;
}

export type FuryVoiceOperationErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'profile-not-found'
  | 'profile-not-eligible'
  | 'profile-health-not-fresh'
  | 'media-input-invalid'
  | 'media-type-not-supported'
  | 'input-limit'
  | 'execution-not-authorized'
  | 'permit-request-mismatch'
  | 'permit-expired'
  | 'permit-already-consumed'
  | 'adapter-not-registered'
  | 'adapter-result-invalid'
  | 'output-limit'
  | 'adapter-error';

export class FuryVoiceOperationError extends Error {
  readonly retrySafe = false;
  constructor(
    readonly code: FuryVoiceOperationErrorCode,
    message: string,
    readonly adapterInvoked: boolean,
    readonly outcome: 'not-started' | 'unknown',
  ) {
    super(message);
    this.name = 'FuryVoiceOperationError';
  }
}

interface RequestState {
  readonly coordinator: FuryVoiceOperationCoordinator;
  readonly request: FuryVoiceOperationRequest;
  readonly bundle: FuryMediaPluginBundle;
  readonly profile: FuryMediaPluginProfile;
  readonly language?: string;
  readonly voiceId?: string;
  readonly mediaCoordinator?: FuryMediaIngestionCoordinator;
  readonly mediaHandle?: FuryMediaIngestionHandle;
  readonly text?: string;
}

interface PermitState {
  readonly request: FuryVoiceOperationRequest;
  consumed: boolean;
}

const REQUEST_STATE = new WeakMap<object, RequestState>();
const PERMIT_STATE = new WeakMap<object, PermitState>();
const GENERATED_RESULTS = new WeakSet<object>();
const GENERATED_ADAPTER_REGISTRIES = new WeakSet<object>();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const LANGUAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const MAX_TEXT_BYTES = 1_048_576;
const DEFAULT_HEALTH_AGE_MS = 60_000;
const HARD_HEALTH_AGE_MS = 5 * 60_000;
const DEFAULT_PERMIT_TTL_MS = 30_000;
const HARD_PERMIT_TTL_MS = 60_000;
const MAX_ADAPTERS = 128;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256').update('furypipe-voice-operation/v1\0').update(label).update('\0').update(value).digest('hex');
}

function fail(code: FuryVoiceOperationErrorCode, message: string, adapterInvoked = false): never {
  throw new FuryVoiceOperationError(code, message, adapterInvoked, adapterInvoked ? 'unknown' : 'not-started');
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-input', `${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('invalid-input', `${label} must use a plain-object prototype`);
  if (Object.getOwnPropertySymbols(value).length !== 0) fail('invalid-input', `${label} must not contain symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('invalid-input', `${label} must contain enumerable data properties only`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[], required: readonly string[], label: string): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(record)) if (!accepted.has(key)) fail('invalid-input', `${label} contains unsupported field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) fail('invalid-input', `${label} is missing required field: ${key}`);
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) fail('invalid-config', `${label} must be between ${min} and ${max}`);
  return resolved;
}

function exactOptionalId(value: unknown, label: string, matcher: RegExp = ID): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !matcher.test(value)) fail('invalid-input', `${label} is invalid`);
  return value;
}

function profileFor(bundle: FuryMediaPluginBundle, profileId: string, operation: FuryVoiceOperation): FuryMediaPluginProfile {
  if (!bundle || bundle.authority !== 'plugin-contract-only' || bundle.executionAuthority !== false || bundle.automaticExecutionAllowed !== false) {
    fail('profile-not-eligible', 'validated media plugin bundle observation is required');
  }
  if (!ID.test(profileId)) fail('invalid-input', 'profileId is invalid');
  const profile = bundle.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) fail('profile-not-found', 'voice profile is not present in the selected bundle');
  if (profile.bundleId !== bundle.id || profile.bundleVersion !== bundle.version) fail('profile-not-eligible', 'profile bundle binding is invalid');
  if (profile.lifecycle !== 'registered' || profile.authority !== 'profile-observation-only' || profile.executionAuthority !== false || profile.selectionAuthority !== false) {
    fail('profile-not-eligible', 'voice profile lifecycle is not eligible');
  }
  const expectedFamily = operation === 'stt' ? 'stt-provider' : 'tts-provider';
  if (profile.family !== expectedFamily) fail('profile-not-eligible', 'voice profile family does not match the operation');
  const required: readonly FuryMediaPluginPermission[] = operation === 'stt'
    ? ['media-read', 'voice-stt']
    : ['media-write', 'voice-tts'];
  const allowed = new Set(required);
  if (!required.every((permission) => profile.permissions.includes(permission)) || profile.permissions.some((permission) => !allowed.has(permission))) {
    fail('profile-not-eligible', 'voice profile permissions are not least-privilege for this operation');
  }
  if (profile.bounds.maxItems < 1) fail('profile-not-eligible', 'voice profile item bound is invalid');
  return profile;
}

function safeNow(source: () => number): number {
  let now: number;
  try { now = source(); } catch { fail('invalid-input', 'voice operation clock failed'); }
  if (!Number.isSafeInteger(now) || now < 0) fail('invalid-input', 'voice operation clock is invalid');
  return now;
}

function requestDigest(value: Readonly<Record<string, unknown>>): string {
  return digest('request', JSON.stringify(value));
}

export function isGeneratedFuryVoiceOperationRequest(value: unknown): value is FuryVoiceOperationRequest {
  return typeof value === 'object' && value !== null && REQUEST_STATE.has(value);
}

export function isGeneratedFuryVoiceOperationPermit(value: unknown): value is FuryVoiceOperationPermit {
  return typeof value === 'object' && value !== null && PERMIT_STATE.has(value);
}

export function isGeneratedFuryVoiceOperationResult(value: unknown): value is FurySttResult | FuryTtsResult {
  return typeof value === 'object' && value !== null && GENERATED_RESULTS.has(value);
}

export function isGeneratedFuryVoiceOperationAdapterRegistry(value: unknown): value is FuryVoiceOperationAdapterRegistry {
  return typeof value === 'object' && value !== null && GENERATED_ADAPTER_REGISTRIES.has(value);
}

export function createFuryVoiceOperationAdapterRegistry(adapters: readonly FuryVoiceOperationAdapter[]): FuryVoiceOperationAdapterRegistry {
  if (!Array.isArray(adapters) || adapters.length > MAX_ADAPTERS) throw new TypeError(`voice adapter registry must contain at most ${MAX_ADAPTERS} entries`);
  const byKey = new Map<string, FuryVoiceOperationAdapter>();
  for (const raw of adapters) {
    const record = plainRecord(raw, 'voice operation adapter');
    exactKeys(record, ['bundleId', 'bundleVersion', 'profileId', 'operation', 'execute'], ['bundleId', 'bundleVersion', 'profileId', 'operation', 'execute'], 'voice operation adapter');
    if (!ID.test(raw.bundleId) || !ID.test(raw.profileId) || typeof raw.bundleVersion !== 'string' || raw.bundleVersion.length < 1 || raw.bundleVersion.length > 64 || !['stt', 'tts'].includes(raw.operation) || typeof raw.execute !== 'function') {
      throw new TypeError('voice operation adapter registration is invalid');
    }
    const key = `${raw.bundleId}\0${raw.bundleVersion}\0${raw.profileId}\0${raw.operation}`;
    if (byKey.has(key)) throw new TypeError('voice operation adapter registration is duplicated');
    byKey.set(key, Object.freeze({
      bundleId: raw.bundleId,
      bundleVersion: raw.bundleVersion,
      profileId: raw.profileId,
      operation: raw.operation,
      execute: raw.execute,
    }));
  }
  const registry: FuryVoiceOperationAdapterRegistry = Object.freeze({
    get(bundleId: string, bundleVersion: string, profileId: string, operation: FuryVoiceOperation) {
      return byKey.get(`${bundleId}\0${bundleVersion}\0${profileId}\0${operation}`);
    },
  });
  GENERATED_ADAPTER_REGISTRIES.add(registry);
  return registry;
}

export function createFuryVoiceOperationCoordinator(options: FuryVoiceOperationCoordinatorOptions): FuryVoiceOperationCoordinator {
  if (!options || typeof options !== 'object' || !isGeneratedFuryVoiceOperationAdapterRegistry(options.adapters) || !isGeneratedFuryMediaIngestionCoordinator(options.mediaCoordinator)) {
    throw new TypeError('voice operation coordinator requires adapter registry and generated media ingestion coordinator');
  }
  const nowSource = options.now ?? Date.now;
  if (typeof nowSource !== 'function') throw new TypeError('voice operation coordinator clock must be a function');
  const maxHealthAgeMs = boundedInteger(options.maxHealthAgeMs, DEFAULT_HEALTH_AGE_MS, 1, HARD_HEALTH_AGE_MS, 'maxHealthAgeMs');
  const maxPermitTtlMs = boundedInteger(options.maxPermitTtlMs, DEFAULT_PERMIT_TTL_MS, 1, HARD_PERMIT_TTL_MS, 'maxPermitTtlMs');

  let coordinator: FuryVoiceOperationCoordinator;

  const prepare = (operation: FuryVoiceOperation, state: Omit<RequestState, 'coordinator' | 'request'>, inputDigestSha256: string, inputBytes: number, inputMimeType: string): FuryVoiceOperationRequest => {
    const profile = state.profile;
    const payload = Object.freeze({ operation, bundleId: state.bundle.id, bundleVersion: state.bundle.version, profileId: profile.id, inputDigestSha256, inputBytes, inputMimeType });
    const request: FuryVoiceOperationRequest = Object.freeze({
      format: FURY_VOICE_OPERATION_REQUEST_FORMAT,
      ...payload,
      requestDigestSha256: requestDigest(payload),
      authority: 'voice-request-evidence-only',
      executionAuthority: false,
    });
    REQUEST_STATE.set(request, { coordinator, request, ...state });
    return request;
  };

  const consume = (request: FuryVoiceOperationRequest, permit: FuryVoiceOperationPermit, now: number): RequestState => {
    const state = REQUEST_STATE.get(request);
    if (!state || state.coordinator !== coordinator || state.request !== request || !isGeneratedFuryVoiceOperationPermit(permit)) fail('execution-not-authorized', 'generated voice request and permit are required');
    const permitState = PERMIT_STATE.get(permit)!;
    if (
      permitState.request !== request
      || permit.requestDigestSha256 !== request.requestDigestSha256
      || permit.operation !== request.operation
      || permit.bundleId !== request.bundleId
      || permit.bundleVersion !== request.bundleVersion
      || permit.profileId !== request.profileId
    ) fail('permit-request-mismatch', 'voice permit does not match exact request');
    if (now >= permit.expiresAt) fail('permit-expired', 'voice permit expired');
    if (permitState.consumed) fail('permit-already-consumed', 'voice permit was already consumed');
    permitState.consumed = true;
    return state;
  };

  coordinator = Object.freeze({
    prepareStt(input: FurySttPrepareInput): FuryVoiceOperationRequest {
      const record = plainRecord(input, 'STT prepare input');
      exactKeys(record, ['bundle', 'profileId', 'mediaCoordinator', 'mediaHandle', 'language'], ['bundle', 'profileId', 'mediaCoordinator', 'mediaHandle'], 'STT prepare input');
      if (!isGeneratedFuryMediaIngestionCoordinator(input.mediaCoordinator) || !isGeneratedFuryMediaIngestionHandle(input.mediaHandle)) fail('media-input-invalid', 'STT requires process-local media evidence');
      if (input.mediaCoordinator !== options.mediaCoordinator) fail('media-input-invalid', 'STT media handle must belong to the configured media coordinator');
      const profile = profileFor(input.bundle, input.profileId, 'stt');
      const language = exactOptionalId(input.language, 'language', LANGUAGE);
      let evidence;
      try { evidence = input.mediaCoordinator.inspect(input.mediaHandle); } catch { fail('media-input-invalid', 'STT media handle is unavailable'); }
      if (evidence.kind !== 'audio') fail('media-input-invalid', 'STT requires audio media');
      if (!profile.supportedMediaTypes.includes(evidence.mimeType)) fail('media-type-not-supported', 'STT profile does not support input MIME');
      if (evidence.byteCount > profile.bounds.maxInputBytes || (profile.bounds.maxDurationMs !== undefined && evidence.durationMs !== undefined && evidence.durationMs > profile.bounds.maxDurationMs)) {
        fail('input-limit', 'STT input exceeds profile bounds');
      }
      return prepare('stt', { bundle: input.bundle, profile, mediaCoordinator: input.mediaCoordinator, mediaHandle: input.mediaHandle, ...(language === undefined ? {} : { language }) }, evidence.mediaSha256, evidence.byteCount, evidence.mimeType);
    },

    prepareTts(input: FuryTtsPrepareInput): FuryVoiceOperationRequest {
      const record = plainRecord(input, 'TTS prepare input');
      exactKeys(record, ['bundle', 'profileId', 'text', 'voiceId', 'language'], ['bundle', 'profileId', 'text'], 'TTS prepare input');
      const profile = profileFor(input.bundle, input.profileId, 'tts');
      if (typeof input.text !== 'string' || input.text.length < 1 || input.text.includes('\0')) fail('invalid-input', 'TTS text must be non-empty text without NUL');
      const bytes = new TextEncoder().encode(input.text).byteLength;
      if (bytes > Math.min(MAX_TEXT_BYTES, profile.bounds.maxInputBytes)) fail('input-limit', 'TTS text exceeds profile input bound');
      const voiceId = exactOptionalId(input.voiceId, 'voiceId');
      const language = exactOptionalId(input.language, 'language', LANGUAGE);
      return prepare('tts', { bundle: input.bundle, profile, text: input.text, ...(voiceId === undefined ? {} : { voiceId }), ...(language === undefined ? {} : { language }) }, sha256(input.text), bytes, 'text/plain');
    },

    authorize(request: FuryVoiceOperationRequest, policy: FuryVoiceOperationPolicy): FuryVoiceOperationPermit {
      const requestState = REQUEST_STATE.get(request);
      if (!requestState || requestState.coordinator !== coordinator || requestState.request !== request) fail('execution-not-authorized', 'process-local voice request is required');
      const record = plainRecord(policy, 'voice operation policy');
      exactKeys(record, ['format', 'policyId', 'allowOperation', 'operation', 'bundleId', 'bundleVersion', 'profileId', 'requestDigestSha256', 'expiresInMs'], ['format', 'policyId', 'allowOperation', 'operation', 'bundleId', 'bundleVersion', 'profileId', 'requestDigestSha256', 'expiresInMs'], 'voice operation policy');
      if (
        policy.format !== FURY_VOICE_OPERATION_POLICY_FORMAT
        || policy.allowOperation !== true
        || !ID.test(policy.policyId)
        || policy.operation !== request.operation
        || policy.bundleId !== request.bundleId
        || policy.bundleVersion !== request.bundleVersion
        || policy.profileId !== request.profileId
        || policy.requestDigestSha256 !== request.requestDigestSha256
        || !Number.isSafeInteger(policy.expiresInMs)
        || policy.expiresInMs < 1
        || policy.expiresInMs > maxPermitTtlMs
      ) fail('execution-not-authorized', 'voice operation policy does not authorize exact request');
      const now = safeNow(nowSource);
      const profile = requestState.profile;
      if (profile.health.status !== 'healthy' || !Number.isSafeInteger(profile.health.observedAt) || profile.health.observedAt < 0 || profile.health.observedAt > now) {
        fail('profile-not-eligible', 'voice profile health does not report healthy eligibility');
      }
      const healthExpiresAt = profile.health.observedAt + maxHealthAgeMs;
      if (!Number.isSafeInteger(healthExpiresAt) || now >= healthExpiresAt) fail('profile-health-not-fresh', 'voice profile health is stale');
      const expiresAt = Math.min(now + policy.expiresInMs, healthExpiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail('execution-not-authorized', 'voice permit lifetime is invalid');
      const permit: FuryVoiceOperationPermit = Object.freeze({
        format: FURY_VOICE_OPERATION_PERMIT_FORMAT,
        permitId: `fpvoice_${randomUUID()}`,
        policyId: policy.policyId,
        operation: request.operation,
        requestDigestSha256: request.requestDigestSha256,
        bundleId: request.bundleId,
        bundleVersion: request.bundleVersion,
        profileId: request.profileId,
        issuedAt: now,
        expiresAt,
        automaticReplayAllowed: false,
      });
      PERMIT_STATE.set(permit, { request, consumed: false });
      return permit;
    },

    async execute(request: FuryVoiceOperationRequest, permit: FuryVoiceOperationPermit, executionOptions?: { readonly signal?: AbortSignal }): Promise<FurySttResult | FuryTtsResult> {
      const requestState = REQUEST_STATE.get(request);
      if (!requestState || requestState.coordinator !== coordinator || requestState.request !== request) fail('execution-not-authorized', 'process-local voice request is required');
      let signal: AbortSignal | undefined;
      if (executionOptions !== undefined) {
        const record = plainRecord(executionOptions, 'voice execution options');
        exactKeys(record, ['signal'], [], 'voice execution options');
        if (executionOptions.signal !== undefined) {
          if (typeof executionOptions.signal !== 'object' || executionOptions.signal === null || typeof executionOptions.signal.aborted !== 'boolean' || typeof executionOptions.signal.addEventListener !== 'function') fail('invalid-input', 'AbortSignal is invalid');
          signal = executionOptions.signal;
        }
      }
      let adapter: FuryVoiceOperationAdapter | undefined;
      try {
        adapter = options.adapters.get(request.bundleId, request.bundleVersion, request.profileId, request.operation);
      } catch {
        fail('adapter-not-registered', 'voice adapter registry lookup failed');
      }
      if (!adapter || adapter.bundleId !== request.bundleId || adapter.bundleVersion !== request.bundleVersion || adapter.profileId !== request.profileId || adapter.operation !== request.operation || typeof adapter.execute !== 'function') {
        fail('adapter-not-registered', 'exact voice adapter is not registered');
      }

      let sttAudioBytes: Uint8Array | undefined;
      if (request.operation === 'stt') {
        try {
          const current = requestState.mediaCoordinator!.inspect(requestState.mediaHandle!);
          if (current.mediaSha256 !== request.inputDigestSha256 || current.mimeType !== request.inputMimeType || current.byteCount !== request.inputBytes) {
            fail('media-input-invalid', 'STT media evidence changed before dispatch');
          }
          sttAudioBytes = requestState.mediaCoordinator!.readBytes(requestState.mediaHandle!);
        } catch (error) {
          if (error instanceof FuryVoiceOperationError) throw error;
          fail('media-input-invalid', 'STT media became unavailable before dispatch');
        }
      }

      const now = safeNow(nowSource);
      const state = consume(request, permit, now);
      const context: FuryVoiceOperationAdapterContext = Object.freeze({ operation: request.operation, requestDigestSha256: request.requestDigestSha256, maxOutputBytes: state.profile.bounds.maxOutputBytes, ...(signal === undefined ? {} : { signal }) });
      let raw: unknown;
      try {
        if (request.operation === 'stt') {
          const audioBytes = sttAudioBytes!;
          try {
            raw = await adapter.execute(Object.freeze({ audioBytes, mimeType: request.inputMimeType, ...(state.language === undefined ? {} : { language: state.language }) }), context);
          } finally {
            audioBytes.fill(0);
          }
        } else {
          raw = await adapter.execute(Object.freeze({ text: state.text!, ...(state.voiceId === undefined ? {} : { voiceId: state.voiceId }), ...(state.language === undefined ? {} : { language: state.language }) }), context);
        }
      } catch (error) {
        if (error instanceof FuryVoiceOperationError && error.adapterInvoked) throw error;
        fail('adapter-error', 'voice adapter failed after dispatch began', true);
      }
      let finishedAt: number | undefined;
      try {
        const candidate = nowSource();
        if (Number.isSafeInteger(candidate) && candidate >= now) finishedAt = candidate;
      } catch {
        // Successful adapter completion remains reportable without freshness claims.
      }
      const evidenceBase = (providerRequestId: string | undefined): FuryVoiceOperationEvidence => Object.freeze({
        format: FURY_VOICE_OPERATION_EVIDENCE_FORMAT,
        operation: request.operation,
        requestDigestSha256: request.requestDigestSha256,
        policyIdSha256: sha256(permit.policyId),
        permitIdSha256: sha256(permit.permitId),
        bundleId: request.bundleId,
        bundleVersion: request.bundleVersion,
        profileId: request.profileId,
        startedAt: now,
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(providerRequestId === undefined ? {} : { providerRequestIdSha256: sha256(providerRequestId) }),
        outcome: 'succeeded' as const,
        providerResult: 'adapter-reported-unverified' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
      let resultRecord: Readonly<Record<string, unknown>>;
      try {
        resultRecord = plainRecord(raw, 'voice adapter result');
      } catch {
        fail('adapter-result-invalid', 'voice adapter result must be plain bounded data', true);
      }
      if (request.operation === 'stt') {
        try {
          exactKeys(resultRecord, ['operation', 'transcript', 'language', 'providerRequestId'], ['operation', 'transcript'], 'STT adapter result');
        } catch {
          fail('adapter-result-invalid', 'STT adapter result schema is invalid', true);
        }
        if (resultRecord.operation !== 'stt' || typeof resultRecord.transcript !== 'string' || resultRecord.transcript.includes('\0')) fail('adapter-result-invalid', 'STT adapter result is invalid', true);
        const transcript = resultRecord.transcript;
        const transcriptBytes = new TextEncoder().encode(transcript).byteLength;
        if (transcriptBytes > Math.min(MAX_TEXT_BYTES, state.profile.bounds.maxOutputBytes)) fail('output-limit', 'STT transcript exceeds output bound', true);
        let language: string | undefined;
        let providerRequestId: string | undefined;
        try {
          language = exactOptionalId(resultRecord.language, 'STT language', LANGUAGE);
          providerRequestId = exactOptionalId(resultRecord.providerRequestId, 'providerRequestId');
        } catch {
          fail('adapter-result-invalid', 'STT adapter metadata is invalid', true);
        }
        const result: FurySttResult = Object.freeze({
          format: FURY_STT_RESULT_FORMAT,
          transcript,
          transcriptSha256: sha256(transcript),
          transcriptBytes,
          ...(language === undefined ? {} : { language }),
          contentTrust: 'untrusted-transcript',
          instructionAuthority: false,
          promptAdmissionRequired: true,
          speakerPlaybackAuthorized: false,
          evidence: evidenceBase(providerRequestId),
        });
        GENERATED_RESULTS.add(result);
        return result;
      }
      try {
        exactKeys(resultRecord, ['operation', 'audioBytes', 'mimeType', 'providerRequestId'], ['operation', 'audioBytes', 'mimeType'], 'TTS adapter result');
      } catch {
        fail('adapter-result-invalid', 'TTS adapter result schema is invalid', true);
      }
      if (resultRecord.operation !== 'tts' || !(resultRecord.audioBytes instanceof Uint8Array) || typeof resultRecord.mimeType !== 'string' || !MIME.test(resultRecord.mimeType)) fail('adapter-result-invalid', 'TTS adapter result is invalid', true);
      const outputBytes = resultRecord.audioBytes as Uint8Array;
      const mimeType = resultRecord.mimeType as string;
      if (outputBytes.byteLength < 1 || outputBytes.byteLength > state.profile.bounds.maxOutputBytes) fail('output-limit', 'TTS audio exceeds output bound', true);
      if (!state.profile.supportedMediaTypes.includes(mimeType)) fail('media-type-not-supported', 'TTS profile does not declare returned MIME', true);
      let providerRequestId: string | undefined;
      try {
        providerRequestId = exactOptionalId(resultRecord.providerRequestId, 'providerRequestId');
      } catch {
        fail('adapter-result-invalid', 'TTS adapter metadata is invalid', true);
      }
      let audioHandle: FuryMediaIngestionHandle;
      try {
        audioHandle = options.mediaCoordinator.ingestBatch([{
          format: FURY_MEDIA_INGESTION_INPUT_FORMAT,
          itemId: `tts-${request.requestDigestSha256.slice(0, 48)}`,
          kind: 'audio',
          mimeType,
          bytes: new Uint8Array(outputBytes),
          source: Object.freeze({
            format: FURY_MEDIA_INGESTION_SOURCE_FORMAT,
            origin: 'provider-output' as const,
            referenceDigestSha256: request.requestDigestSha256,
          }),
        }]).handles[0]!;
      } catch {
        fail('adapter-result-invalid', 'TTS audio failed governed media ingestion', true);
      }
      if (state.profile.bounds.maxDurationMs !== undefined && audioHandle.evidence.durationMs !== undefined && audioHandle.evidence.durationMs > state.profile.bounds.maxDurationMs) {
        options.mediaCoordinator.release(audioHandle);
        fail('output-limit', 'TTS audio duration exceeds profile bound', true);
      }
      const result: FuryTtsResult = Object.freeze({
        format: FURY_TTS_RESULT_FORMAT,
        audioHandle,
        audioSha256: audioHandle.evidence.mediaSha256,
        audioBytes: audioHandle.evidence.byteCount,
        audioMimeType: audioHandle.evidence.mimeType,
        ...(audioHandle.evidence.durationMs === undefined ? {} : { durationMs: audioHandle.evidence.durationMs }),
        speakerPlaybackAuthorized: false,
        deviceOperationAuthorized: false,
        evidence: evidenceBase(providerRequestId),
      });
      GENERATED_RESULTS.add(result);
      return result;
    },
  });
  return coordinator;
}
