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

describe('FuryPipe Phase 9 governed STT/TTS operations — execution', () => {
  it('treats malformed or oversized STT adapter output as unknown after invocation', async () => {
      const { media, handle } = audioHandle();
      for (const execute of [
        async () => ({ operation: 'stt', transcript: 'x'.repeat(20_000) }),
        async () => ({ operation: 'stt', transcript: 42 }),
      ]) {
        const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters({ stt: execute }), mediaCoordinator: media, now: () => 100_000 });
        const request = coordinator.prepareStt({ bundle: bundle(), profileId: 'stt-main', mediaCoordinator: media, mediaHandle: handle });
        await expect(coordinator.execute(request, coordinator.authorize(request, policy(request)))).rejects.toMatchObject({ adapterInvoked: true, outcome: 'unknown' });
      }
    });
  
  it('synthesizes TTS into governed media without authorizing speaker playback', async () => {
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'Bonjour', voiceId: 'voice-1' });
      const result = await coordinator.execute(request, coordinator.authorize(request, policy(request)));
      expect(result.format).toBe('furypipe-tts-result/v1');
      if (result.format !== 'furypipe-tts-result/v1') throw new Error('expected TTS');
      expect(result).toMatchObject({ audioMimeType: 'audio/wav', speakerPlaybackAuthorized: false, deviceOperationAuthorized: false });
      expect(isGeneratedFuryMediaIngestionHandle(result.audioHandle)).toBe(true);
      expect(media.inspect(result.audioHandle).sourceOrigin).toBe('provider-output');
      expect(media.inspect(result.audioHandle).mediaSha256).toBe(result.audioSha256);
    });
  
  it('rejects undeclared TTS MIME types after adapter invocation', async () => {
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters({ tts: async () => ({ operation: 'tts', audioBytes: wav(), mimeType: 'audio/mpeg' }) }), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'Bonjour' });
      await expect(coordinator.execute(request, coordinator.authorize(request, policy(request)))).rejects.toMatchObject({ code: 'media-type-not-supported', adapterInvoked: true, outcome: 'unknown' });
    });
  
  it('rejects malformed TTS audio through governed media ingestion', async () => {
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters({ tts: async () => ({ operation: 'tts', audioBytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' }) }), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'Bonjour' });
      await expect(coordinator.execute(request, coordinator.authorize(request, policy(request)))).rejects.toMatchObject({ code: 'adapter-result-invalid', adapterInvoked: true, outcome: 'unknown' });
    });
  
  it('enforces TTS profile duration bounds and releases rejected generated media', async () => {
      const media = createFuryMediaIngestionCoordinator();
      const before = media.activeItemCount();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters({ tts: async () => ({ operation: 'tts', audioBytes: wav(3_000, 1_000), mimeType: 'audio/wav' }) }), mediaCoordinator: media, now: () => 100_000 });
      const request = coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'Bonjour' });
      await expect(coordinator.execute(request, coordinator.authorize(request, policy(request)))).rejects.toMatchObject({ code: 'output-limit', adapterInvoked: true });
      expect(media.activeItemCount()).toBe(before);
    });
  
  it('bounds TTS input bytes before any adapter can run', () => {
      const media = createFuryMediaIngestionCoordinator();
      const coordinator = createFuryVoiceOperationCoordinator({ adapters: adapters(), mediaCoordinator: media, now: () => 100_000 });
      expect(() => coordinator.prepareTts({ bundle: bundle(), profileId: 'tts-main', text: 'x'.repeat(20_000) })).toThrowError(expect.objectContaining({ code: 'input-limit', adapterInvoked: false }));
    });
});
