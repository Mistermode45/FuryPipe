import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
  FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
  inspectFuryMediaPluginBundle,
  validateFuryMediaPluginBundle,
  type FuryMediaPluginBundleInput,
} from '../src/media-plugin-contracts.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bundle(overrides: Partial<FuryMediaPluginBundleInput> = {}): FuryMediaPluginBundleInput {
  return {
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT,
    id: 'speech-lab',
    version: '1.2.3',
    permissions: ['media-read', 'voice-stt', 'voice-tts', 'device-speaker'],
    source: {
      url: 'https://github.com/example/speech-lab',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    },
    profiles: [{
      format: FURY_MEDIA_PLUGIN_PROFILE_FORMAT,
      id: 'stt-default',
      bundleId: 'speech-lab',
      bundleVersion: '1.2.3',
      family: 'stt-provider',
      permissions: ['media-read', 'voice-stt'],
      supportedMediaTypes: ['audio/wav', 'audio/mpeg'],
      bounds: {
        maxInputBytes: 8 * 1024 * 1024,
        maxOutputBytes: 256 * 1024,
        maxItems: 1,
        maxDurationMs: 300_000,
      },
      health: {
        status: 'healthy',
        observedAt: 100_000,
        detailDigestSha256: digest('healthy-observation'),
        authority: 'health-observation-only',
        executionAuthority: false,
      },
      secretRefs: ['SPEECH_API_KEY'],
      lifecycle: 'registered',
      compatibility: ['phase9-v1', 'audio-v1'],
    }],
    ...overrides,
  };
}

describe('FuryPipe Phase 9 media/voice plugin contracts', () => {
  it('validates least-privilege plugin/profile contracts without execution authority', () => {
    const validated = validateFuryMediaPluginBundle(bundle());
    expect(validated.authority).toBe('plugin-contract-only');
    expect(validated.executionAuthority).toBe(false);
    expect(validated.automaticExecutionAllowed).toBe(false);
    expect(validated.permissions).toEqual(['device-speaker', 'media-read', 'voice-stt', 'voice-tts']);
    expect(validated.profiles[0]).toMatchObject({
      id: 'stt-default',
      family: 'stt-provider',
      authority: 'profile-observation-only',
      executionAuthority: false,
      selectionAuthority: false,
      permissions: ['media-read', 'voice-stt'],
    });
  });

  it('requires profile permissions to remain a strict subset of bundle declarations', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{ ...input.profiles[0]!, permissions: ['voice-realtime'] }],
    })).toThrow(/subset of bundle permissions/u);
  });

  it('supports the Phase 9 device/media permission vocabulary explicitly', () => {
    const validated = validateFuryMediaPluginBundle({
      ...bundle(),
      permissions: [
        'device-discovery', 'device-notify', 'device-camera', 'device-microphone',
        'device-speaker', 'media-read', 'media-write', 'voice-stt', 'voice-tts',
        'voice-realtime',
      ],
      profiles: [],
    });
    expect(validated.permissions).toHaveLength(10);
    expect(validated.permissions).toContain('device-camera');
    expect(validated.permissions).toContain('voice-realtime');
  });

  it('rejects implicit or invented permissions', () => {
    expect(() => validateFuryMediaPluginBundle({
      ...bundle(),
      permissions: ['network' as 'media-read'],
    })).toThrow(/invalid or duplicate/u);
  });

  it('requires pinned immutable provenance for GitHub-backed plugin sources', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      source: { url: input.source.url, licenseStatus: 'VERIFIED' },
    })).toThrow(/pinned commitSha/u);
  });

  it('rejects credential-bearing or plaintext provenance URLs', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      source: { ...input.source, url: 'https://user:secret@example.test/provider' },
    })).toThrow(/credential-free HTTPS/u);
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      source: { ...input.source, url: 'http://example.test/provider' },
    })).toThrow(/credential-free HTTPS/u);
  });

  it('keeps secret references names-only and rejects credential values as refs', () => {
    const input = bundle();
    expect(validateFuryMediaPluginBundle(input).profiles[0]?.secretRefs).toEqual(['SPEECH_API_KEY']);
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{ ...input.profiles[0]!, secretRefs: ['sk-live-secret-value'] }],
    })).toThrow(/secret refs/u);
  });

  it('keeps health evidence observation-only', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{
        ...input.profiles[0]!,
        health: { ...input.profiles[0]!.health, executionAuthority: true as false },
      }],
    })).toThrow(/observation-only/u);
  });

  it('enforces code-level byte, item and duration bounds', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{
        ...input.profiles[0]!,
        bounds: { ...input.profiles[0]!.bounds, maxInputBytes: 65 * 1024 * 1024 },
      }],
    })).toThrow(/maxInputBytes/u);
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{
        ...input.profiles[0]!,
        bounds: { ...input.profiles[0]!.bounds, maxItems: 129 },
      }],
    })).toThrow(/maxItems/u);
  });

  it('rejects duplicate media types, permissions, secret refs and profile IDs', () => {
    const input = bundle();
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      permissions: ['media-read', 'media-read'],
    })).toThrow(/invalid or duplicate/u);
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [{ ...input.profiles[0]!, supportedMediaTypes: ['audio/wav', 'audio/wav'] }],
    })).toThrow(/invalid or duplicate/u);
    expect(() => validateFuryMediaPluginBundle({
      ...input,
      profiles: [input.profiles[0]!, { ...input.profiles[0]! }],
    })).toThrow(/identity or lifecycle/u);
  });

  it('rejects MIME wildcards and extension-like media declarations', () => {
    const input = bundle();
    for (const media of ['audio/*', '.wav', 'wav']) {
      expect(() => validateFuryMediaPluginBundle({
        ...input,
        profiles: [{ ...input.profiles[0]!, supportedMediaTypes: [media] }],
      })).toThrow(/supported media types/u);
    }
  });

  it('accepts disabled profiles but never turns lifecycle or health into authorization', () => {
    const input = bundle();
    const validated = validateFuryMediaPluginBundle({
      ...input,
      profiles: [{
        ...input.profiles[0]!,
        lifecycle: 'disabled',
        health: { ...input.profiles[0]!.health, status: 'healthy' },
      }],
    });
    expect(validated.profiles[0]).toMatchObject({
      lifecycle: 'disabled',
      executionAuthority: false,
      selectionAuthority: false,
    });
  });

  it('produces bounded metadata-only inspection evidence without source URL or secret values', () => {
    const validated = validateFuryMediaPluginBundle(bundle());
    const inspection = inspectFuryMediaPluginBundle(validated);
    expect(inspection.authority).toBe('inspection-only');
    expect(inspection.executionAuthority).toBe(false);
    expect(inspection.sourceDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(inspection.profiles[0]?.secretRefs).toEqual(['SPEECH_API_KEY']);
    const encoded = JSON.stringify(inspection);
    expect(encoded).not.toContain('github.com');
    expect(encoded).not.toContain('healthy-observation');
    expect(encoded).not.toContain('sk-live');
  });

  it('rejects schema drift and accessor-backed fields', () => {
    expect(() => validateFuryMediaPluginBundle({
      ...bundle(),
      automaticExecutionAllowed: true,
    } as FuryMediaPluginBundleInput)).toThrow(/unsupported field/u);

    const input = bundle() as unknown as Record<string, unknown>;
    Object.defineProperty(input, 'id', { enumerable: true, get: () => 'speech-lab' });
    expect(() => validateFuryMediaPluginBundle(input as unknown as FuryMediaPluginBundleInput)).toThrow(/data properties only/u);
  });
});