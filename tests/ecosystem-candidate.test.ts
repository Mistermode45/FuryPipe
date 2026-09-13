import { describe, expect, it } from 'vitest';
import { createStaticCapabilityImporter, serializeCapabilityManifest } from '../src/ecosystem/importer.js';
import {
  CAPABILITY_ID_PREFIX,
  MAX_CANDIDATE_JSON_BYTES,
  normalizeCapabilityCandidate,
  parseCapabilityCandidateJson,
  serializeCapabilityCandidate,
} from '../src/ecosystem/normalize.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

describe('ecosystem candidate contract', () => {
  it('derives a stable, normalized source identity and pin status', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: {
        kind: 'git',
        url: 'https://GitHub.com/Fury-Example/Static-Indexer.git/',
        repositoryUrl: 'https://github.com/FURY-EXAMPLE/STATIC-INDEXER.git',
        commitSha: 'A'.repeat(40),
      },
      authors: ['Z. Example', 'A. Example'],
    }));

    expect(candidate.canonicalUrl).toBe('https://github.com/fury-example/static-indexer');
    expect(candidate.id).toBe(`${CAPABILITY_ID_PREFIX}https://github.com/fury-example/static-indexer#commit%3A${'a'.repeat(40)}`);
    expect(candidate.source.commitSha).toBe('a'.repeat(40));
    expect(candidate.source.pinStatus).toBe('PINNED');
    expect(candidate.schemaVersion).toBe(1);
    expect(candidate.identity.revisionKey).toBe(`commit:${'a'.repeat(40)}`);
    expect(candidate.authors).toEqual(['A. Example', 'Z. Example']);
    expect(candidate.license.evidenceUrl).toContain('/LICENSE');
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.permissions)).toBe(true);
  });

  it('bounds and validates untrusted fields before producing a candidate', () => {
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'git', url: 'https://user:password@example.com/project' },
    }))).toThrow(/credentials/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'git', url: 'https://example.com/project', mutableRef: 'main' },
    }))).not.toThrow();
    expect(normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'git', url: 'https://example.com/project', mutableRef: 'main' },
    })).source.pinStatus).toBe('MUTABLE_SOURCE');
    expect(() => normalizeCapabilityCandidate({ ...makeCapabilityCandidate(), format: 'furypipe-capability/v99' })).toThrow(/version/u);
    expect(() => normalizeCapabilityCandidate({ ...makeCapabilityCandidate(), unexpected: 'value' })).toThrow(/unsupported field/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      description: `contains ghp_${'A'.repeat(32)} and must not be stored`,
    }))).toThrow(/credential-like/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({ description: '\ud800' }))).toThrow(/malformed Unicode/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      extensions: { 'vendor:secret-token': 'must reject' },
    }))).toThrow(/forbidden/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'git', url: 'https://example.com/project', commitSha: 'deadbeef' },
    }))).toThrow(/40- or 64-character/u);
  });

  it('serializes canonically and round-trips through the versioned static importer', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      aliases: [{ kind: 'package', value: 'npm:@fury/static-indexer' }],
      benchmarks: [{
        id: 'cold-start', metric: 'startup-time', value: 12.5, unit: 'ms', measuredAt: '2026-09-12T10:00:00Z',
      }],
      roi: { estimatedCostUsd: 0, estimatedSavingsUsd: 2.5, confidence: 'LOW', sampleSize: 3, benchmarkId: 'cold-start' },
      extensions: { 'vendor:quality': { grade: 'experimental', score: 0.4 } },
    }));
    const serialized = serializeCapabilityCandidate(candidate);
    const parsed = parseCapabilityCandidateJson(serialized);
    expect(serializeCapabilityCandidate(parsed)).toBe(serialized);

    const manifest = serializeCapabilityManifest([candidate]);
    expect(createStaticCapabilityImporter().import(manifest)).toEqual([candidate]);
    expect(() => createStaticCapabilityImporter().import(manifest.replace('furypipe-capability-manifest/v1', 'furypipe-capability-manifest/v2')))
      .toThrow(/version/u);
  });

  it('normalizes lifecycle, compatibility, license evidence and future benchmark/ROI fields', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      categories: ['automation', 'developer-tools'],
      capabilities: ['catalog-search', 'agent-skill'],
      domains: ['web', 'minecraft'],
      supportedStages: ['review', 'implement'],
      supportedPlatforms: ['linux', 'windows'],
      supportedModels: ['model-z', 'model-a'],
      supportedLanguages: ['typescript', 'french'],
      integrationMode: 'MCP',
      decisionReason: 'Metadata candidate; runtime adapter remains separate.',
      releaseDate: '2026-09-10T00:00:00Z',
      createdAt: '2026-09-11T12:00:00Z',
      lastAuditedAt: '2026-09-12T12:00:00Z',
      benchmarks: [{
        id: 'furybench-1',
        model: 'model-a',
        task: 'metadata-search',
        baselineScore: 0.6,
        withCapabilityScore: 0.7,
        tokenDelta: -120,
        latencyDelta: 5,
        costDelta: -0.01,
        regressions: ['none observed in fixture'],
      }],
      roi: { confidence: 'LOW', qualityGain: 0.1, tokenDelta: -120, timeDelta: -2, costDelta: -0.01, userEffortDelta: 0 },
    }));
    expect(candidate).toMatchObject({
      schemaVersion: 1,
      licenseStatus: 'VERIFIED',
      costModel: 'FREE',
      integrationMode: 'MCP',
      releaseDate: '2026-09-10T00:00:00.000Z',
      supportedStages: ['implement', 'review'],
      supportedPlatforms: ['linux', 'windows'],
      supportedModels: ['model-a', 'model-z'],
      supportedLanguages: ['french', 'typescript'],
      security: { staticReviewStatus: 'UNKNOWN', advisoryIds: [] },
      health: { status: 'UNKNOWN' },
    });
    expect(candidate.benchmarks[0]).toMatchObject({ tokenDelta: -120, baselineScore: 0.6, withCapabilityScore: 0.7 });
    expect(candidate.roi).toMatchObject({ qualityGain: 0.1, userEffortDelta: 0 });

    expect(normalizeCapabilityCandidate(makeCapabilityCandidate({ releaseDate: '2026-09-10' })).releaseDate)
      .toBe('2026-09-10T00:00:00.000Z');
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({ releaseDate: '2026-02-30' })))
      .toThrow(/calendar date/u);
  });

  it('does not silently verify conflicting or unsupported license evidence', () => {
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      license: {
        status: 'VERIFIED',
        declaredSpdx: 'MIT',
        discoveredSpdx: 'Apache-2.0',
        source: 'repository-file',
        evidence: [{ kind: 'repository-file', reference: 'https://github.com/fury-example/static-indexer/blob/main/LICENSE' }],
        reviewedAt: '2026-09-12T10:00:00Z',
        conflict: true,
      },
    }))).toThrow(/without a conflict/u);
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      license: { status: 'VERIFIED', discoveredSpdx: 'MIT', source: 'unknown', reviewedAt: '2026-09-12T10:00:00Z' },
    }))).toThrow(/evidence source/u);
  });

  it('rejects over-limit JSON before parsing and unknown manifest fields', () => {
    expect(() => parseCapabilityCandidateJson(' '.repeat(MAX_CANDIDATE_JSON_BYTES + 1))).toThrow(/byte limit/u);
    expect(() => createStaticCapabilityImporter().import({
      format: 'furypipe-capability-manifest/v1',
      candidates: [],
      source: 'not in v1',
    })).toThrow(/unsupported field/u);
  });

  it('keeps internal sources in a separate, namespaced identity space', () => {
    const internal = normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'internal', url: 'furypipe://local/catalog/static-indexer', contentSha256: 'b'.repeat(64) },
    }));
    expect(internal.canonicalUrl).toBe('furypipe://local/catalog/static-indexer');
    expect(internal.source.pinStatus).toBe('PINNED');
    expect(() => normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'internal', url: 'furypipe://remote/catalog/item' },
    }))).toThrow(/furypipe/u);
  });

  it('changes the immutable candidate ID when the pinned commit changes', () => {
    const first = normalizeCapabilityCandidate(makeCapabilityCandidate());
    const second = normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { ...makeCapabilityCandidate().source, commitSha: 'b'.repeat(40) },
    }));
    expect(first.id).not.toBe(second.id);
    expect(first.canonicalUrl).toBe(second.canonicalUrl);
  });

  it('classifies latest/main references as mutable rather than immutable pins', () => {
    expect(normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: { kind: 'git', url: 'https://github.com/fury-example/static-indexer/tree/main', repositoryUrl: 'https://github.com/fury-example/static-indexer' },
    })).source.pinStatus).toBe('MUTABLE_SOURCE');
    expect(normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: {
        kind: 'package',
        url: 'https://registry.example/packages/static-indexer',
        package: { ecosystem: 'npm', name: '@fury/static-indexer', version: 'latest' },
      },
    })).source.pinStatus).toBe('MUTABLE_SOURCE');
  });

  it('preserves case-sensitive evidence paths and includes a non-default port in source identity', () => {
    const candidate = normalizeCapabilityCandidate(makeCapabilityCandidate({
      source: {
        kind: 'git',
        url: 'https://github.com:8443/Fury-Example/Static-Indexer.git',
        repositoryUrl: 'https://github.com:8443/Fury-Example/Static-Indexer.git',
        commitSha: 'c'.repeat(40),
      },
      license: {
        status: 'VERIFIED',
        declaredSpdx: 'MIT',
        discoveredSpdx: 'MIT',
        source: 'repository-file',
        evidence: [{ kind: 'repository-file', reference: 'https://github.com/fury-example/static-indexer/blob/main/License' }],
        reviewedAt: '2026-09-12T10:00:00Z',
        conflict: false,
      },
    }));
    expect(candidate.canonicalUrl).toBe('https://github.com:8443/fury-example/static-indexer');
    expect(candidate.license.evidence[0]?.reference).toContain('/blob/main/License');
    expect(candidate.license.evidence[0]?.reference).not.toContain('/blob/main/license');
  });
});
