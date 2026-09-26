import { describe, expect, it } from 'vitest';

import { CAPABILITY_TYPES } from '../src/ecosystem/types.js';
import { normalizeCapabilityCandidate } from '../src/ecosystem/normalize.js';
import { projectUniversalCapability } from '../src/universal-capability.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

describe('universal capability descriptor', () => {
  it('covers the 2026 universal provider/runtime capability taxonomy without duplicate type identifiers', () => {
    expect(new Set(CAPABILITY_TYPES).size).toBe(CAPABILITY_TYPES.length);
    expect(CAPABILITY_TYPES).toEqual(expect.arrayContaining([
      'model',
      'provider',
      'skill',
      'skill-pack',
      'instruction',
      'plugin',
      'mcp',
      'connector',
      'tool',
      'agent',
      'workflow',
      'automation',
      'memory-provider',
      'search-provider',
      'browser-provider',
      'image-provider',
      'video-provider',
      'audio-provider',
      'voice-provider',
      'embedding-provider',
      'reranker',
      'code-runtime',
      'sandbox',
    ]));
  });

  it('projects existing validated candidates instead of creating a second registry schema', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      type: 'image-provider',
      decision: 'ADOPT',
      categories: ['media', 'image'],
      capabilities: ['text-to-image', 'image-edit'],
      supportedStages: ['create'],
      supportedPlatforms: ['linux', 'windows'],
      supportedModels: ['image-model-a'],
      supportedLanguages: ['en', 'fr'],
      source: {
        kind: 'git',
        url: 'https://github.com/fury-example/image-provider',
        repositoryUrl: 'https://github.com/fury-example/image-provider',
        version: '2.0.0',
        commitSha: 'b'.repeat(40),
        contentSha256: 'c'.repeat(64),
      },
      health: { status: 'HEALTHY', observedAt: '2026-09-26T00:00:00Z' },
      extensions: {
        requirements: ['gpu-optional'],
        dependencies: ['provider-runtime'],
        telemetryPolicy: 'LOCAL_ONLY',
        configurationSchema: { type: 'object', additionalProperties: false },
        documentation: ['https://docs.example.test/image-provider'],
      },
    }));

    const projected = projectUniversalCapability(candidate);
    expect(projected).toMatchObject({
      format: 'furypipe-universal-capability/v1',
      id: candidate.id,
      kind: 'image-provider',
      category: 'image',
      provider: 'Fury Example Group',
      requirements: ['gpu-optional'],
      dependencies: ['provider-runtime'],
      riskLevel: 'LOW',
      status: 'AVAILABLE',
      installSource: 'https://github.com/fury-example/image-provider',
      updateSource: 'https://github.com/fury-example/image-provider',
      checksum: 'c'.repeat(64),
      telemetryPolicy: 'LOCAL_ONLY',
      costModel: 'FREE',
      executionAuthorized: false,
    });
    expect(projected.compatibility).toEqual({
      platforms: ['linux', 'windows'],
      models: ['image-model-a'],
      languages: ['en', 'fr'],
      stages: ['create'],
    });
    expect(projected.configurationSchema).toEqual({ type: 'object', additionalProperties: false });
    expect(projected.documentation).toEqual(['https://docs.example.test/image-provider']);
  });

  it('keeps missing product metadata explicit instead of fabricating it', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate());
    const projected = projectUniversalCapability(candidate);
    expect(projected.requirements).toEqual([]);
    expect(projected.dependencies).toEqual([]);
    expect(projected.configurationSchema).toBeNull();
    expect(projected.checksum).toBeNull();
    expect(projected.telemetryPolicy).toBe('UNKNOWN');
    expect(projected.status).toBe('REFERENCE_ONLY');
    expect(projected.executionAuthorized).toBe(false);
  });

  it('derives a bounded risk surface from declared permissions without authorizing execution', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      decision: 'ADOPT',
      permissions: {
        network: 'restricted',
        filesystem: 'write',
        subprocess: 'restricted',
        credentials: 'none',
        externalWrites: [],
        database: 'none',
        browser: 'read',
        provider: 'invoke',
        cloud: 'none',
      },
    }));
    expect(projectUniversalCapability(candidate)).toMatchObject({
      riskLevel: 'MEDIUM',
      executionAuthorized: false,
    });
  });
});
