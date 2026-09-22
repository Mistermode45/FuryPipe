import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
  FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
  validateFuryMediaPluginBundle,
  type FuryMediaPluginBundleInput,
} from './media-plugin-contracts.js';
import {
  FURY_MEDIA_INGESTION_INPUT_FORMAT,
  FURY_MEDIA_INGESTION_SOURCE_FORMAT,
  createFuryMediaIngestionCoordinator,
  isGeneratedFuryMediaIngestionHandle,
} from './media-ingestion.js';
import {
  FURY_VOICE_OPERATION_POLICY_FORMAT,
  FuryVoiceOperationError,
  createFuryVoiceOperationAdapterRegistry,
  createFuryVoiceOperationCoordinator,
  isGeneratedFuryVoiceOperationAdapterRegistry,
  isGeneratedFuryVoiceOperationPermit,
  isGeneratedFuryVoiceOperationRequest,
  isGeneratedFuryVoiceOperationResult,
  type FurySttAdapterInput,
  type FuryTtsAdapterInput,
  type FuryVoiceOperationAdapter,
  type FuryVoiceOperationPermit,
  type FuryVoiceOperationPolicy,
  type FuryVoiceOperationRequest,
} from './media-voice-operations.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function wav(dataBytes = 1_000, byteRate = 1_000): Uint8Array {
  const size = 44 + dataBytes;
  const bytes = new Uint8Array(size);
  bytes.set(Buffer.from('RIFF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, size - 8, true);
  bytes.set(Buffer.from('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, byteRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function bundle(overrides: Partial<FuryMediaPluginBundleInput> = {}) {
  const input: FuryMediaPluginBundleInput = {
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
    id: 'voice-lab',
    version: '1.0.0',
    permissions: ['media-read', 'media-write', 'voice-stt', 'voice-tts', 'device-speaker'],
    source: {
      url: 'https://github.com/example/voice-lab',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    },
    profiles: [
      {
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
        id: 'stt-main',
        family: 'stt-provider',
        permissions: ['media-read', 'voice-stt'],
        supportedMediaTypes: ['audio/wav'],
        bounds: { maxInputBytes: 1_048_576, maxOutputBytes: 16_384, maxItems: 1, maxDurationMs: 10_000 },
        health: { status: 'healthy', observedAt: 99_500, authority: 'health-observation-only', executionAuthority: false },
        secretRefs: ['VOICE_API_KEY'],
        lifecycle: 'registered',
        compatibility: ['phase9-v1'],
      },
      {
        format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
        id: 'tts-main',
        family: 'tts-provider',
        permissions: ['media-write', 'voice-tts'],
        supportedMediaTypes: ['audio/wav'],
        bounds: { maxInputBytes: 16_384, maxOutputBytes: 1_048_576, maxItems: 1, maxDurationMs: 2_000 },
        health: { status: 'healthy', observedAt: 99_500, authority: 'health-observation-only', executionAuthority: false },
        secretRefs: ['VOICE_API_KEY'],
        lifecycle: 'registered',
        compatibility: ['phase9-v1'],
      },
    ],
    ...overrides,
  };
  return validateFuryMediaPluginBundle(input);
}

function audioHandle(media = createFuryMediaIngestionCoordinator()) {
  const handle = media.ingestBatch([{
    format: FURY_MEDIA_INGESTION_INPUT_FORMAT,
    itemId: 'audio-1',
    kind: 'audio',
    mimeType: 'audio/wav',
    bytes: wav(),
    source: { format: FURY_MEDIA_INGESTION_SOURCE_FORMAT, origin: 'user-upload' },
  }]).handles[0]!;
  return { media, handle };
}

function adapters(overrides: Partial<Record<'stt' | 'tts', FuryVoiceOperationAdapter['execute']>> = {}) {
  return createFuryVoiceOperationAdapterRegistry([
    {
      bundleId: 'voice-lab', bundleVersion: '1.0.0', profileId: 'stt-main', operation: 'stt',
      execute: overrides.stt ?? (async () => ({ operation: 'stt', transcript: 'bonjour', language: 'fr', providerRequestId: 'stt-req-1' })),
    },
    {
      bundleId: 'voice-lab', bundleVersion: '1.0.0', profileId: 'tts-main', operation: 'tts',
      execute: overrides.tts ?? (async () => ({ operation: 'tts', audioBytes: wav(), mimeType: 'audio/wav', providerRequestId: 'tts-req-1' })),
    },
  ]);
}

function policy(request: FuryVoiceOperationRequest, overrides: Partial<FuryVoiceOperationPolicy> = {}): FuryVoiceOperationPolicy {
  return {
    format: FURY_VOICE_OPERATION_POLICY_FORMAT,
    policyId: 'voice-policy-1',
    allowOperation: true,
    operation: request.operation,
    bundleId: request.bundleId,
    bundleVersion: request.bundleVersion,
    profileId: request.profileId,
    requestDigestSha256: request.requestDigestSha256,
    expiresInMs: 5_000,
    ...overrides,
  };
}

describe('FuryPipe Phase 9 governed STT/TTS operations — core', () => {
  it('requires generated adapter registries and rejects copied registry lookalikes', () => {
      const registry = adapters();
      expect(isGeneratedFuryVoiceOperationAdapterRegistry(registry)).toBe(true);
      const media = createFuryMediaIngestionCoordinator();
      expect(() => createFuryVoiceOperationCoordinator({ adapters: { ...registry }, mediaCoordinator: media, now: () => 100_000 })).toThrow(/adapter registry/u);
    });
  
  it('prepares process-local STT requests bound to exact governed media evidence', () => {
      const { media, handle } = audioHandle();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareStt({ bundle: bundle(), profileId: 'stt-main', mediaCoordinator: media, mediaHandle: handle, language: 'fr' });
      expect(isGeneratedFuryVoiceOperationRequest(request)).toBe(true);
      expect(isGeneratedFuryVoiceOperationRequest({ ...request })).toBe(false);
      expect(request).toMatchObject({ operation: 'stt', inputDigestSha256: handle.evidence.mediaSha256, inputMimeType: 'audio/wav', authority: 'voice-request-evidence-only', executionAuthority: false });
    });
  
  it('prepares TTS separately from speaker playback authority', () => {
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'Bonjour', voiceId: 'voice-1', language: 'fr' });
      expect(request).toMatchObject({ operation: 'tts', inputMimeType: 'text/plain', inputDigestSha256: sha256('Bonjour'), executionAuthority: false });
      expect('play' in coordinator).toBe(false);
      expect('speaker' in coordinator).toBe(false);
    });
  
  it('rejects voice profiles that mix speaker authority into a TTS provider profile', () => {
      const base = bundle();
      const input: FuryMediaPluginBundleInput = {
        format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
        id: base.id,
        version: base.version,
        permissions: ['media-write', 'voice-tts', 'device-speaker'],
        source: base.source,
        profiles: [{
          format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
          id: 'tts-main', family: 'tts-provider', permissions: ['media-write', 'voice-tts', 'device-speaker'], supportedMediaTypes: ['audio/wav'],
          bounds: { maxInputBytes: 1024, maxOutputBytes: 4096, maxItems: 1 },
          health: { status: 'healthy', observedAt: 99_500, authority: 'health-observation-only', executionAuthority: false }, secretRefs: [], lifecycle: 'registered', compatibility: [],
        }],
      };
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      expect(() => coordinator.prepareTts({ bundle: validateFuryMediaPluginBundle(input), profileId: 'tts-main', text: 'test' })).toThrowError(expect.objectContaining({ code: 'profile-not-eligible' }));
    });
  
  it('rejects copied media handles and non-audio STT inputs before authorization', () => {
      const { media, handle } = audioHandle();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      expect(() => coordinator.prepareStt({ bundle: bundle(), profileId: 'stt-main', mediaCoordinator: media, mediaHandle: { ...handle }, language: 'fr' })).toThrowError(expect.objectContaining({ code: 'media-input-invalid' }));
    });
  
  it('issues short-lived process-local permits only for the exact policy-bound request', () => {
      const { media, handle } = audioHandle();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareStt({ bundle: bundle(), profileId: 'stt-main', mediaCoordinator: media, mediaHandle: handle });
      const permit = coordinator.authorize(request, policy(request));
      expect(isGeneratedFuryVoiceOperationPermit(permit)).toBe(true);
      expect(isGeneratedFuryVoiceOperationPermit({ ...permit })).toBe(false);
      expect(permit).toMatchObject({ operation: 'stt', requestDigestSha256: request.requestDigestSha256, automaticReplayAllowed: false });
    });
});
