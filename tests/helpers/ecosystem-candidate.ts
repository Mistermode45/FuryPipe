import { CAPABILITY_CANDIDATE_FORMAT, type RawCapabilityCandidate } from '../../src/ecosystem/types.js';

export function makeCapabilityCandidate(
  overrides: Partial<RawCapabilityCandidate> = {},
): RawCapabilityCandidate {
  return {
    format: CAPABILITY_CANDIDATE_FORMAT,
    name: 'Static Indexer',
    type: 'skill',
    description: 'A metadata-only fixture for the ingestion contract.',
    publisher: 'Fury Example Group',
    authors: ['A. Example'],
    source: {
      kind: 'git',
      url: 'https://github.com/fury-example/static-indexer',
      repositoryUrl: 'https://github.com/fury-example/static-indexer',
      version: '1.2.3',
      commitSha: 'a'.repeat(40),
    },
    provenance: {
      classification: 'VERIFIED_COMMUNITY',
      reviewStatus: 'REVIEWED',
      evidence: [{ kind: 'manual-review', reference: 'audit:fixture-001' }],
    },
    license: {
      status: 'VERIFIED',
      declaredSpdx: 'MIT',
      discoveredSpdx: 'MIT',
      spdx: 'MIT',
      source: 'repository-file',
      evidence: [{ kind: 'repository-file', reference: 'https://github.com/fury-example/static-indexer/blob/main/LICENSE' }],
      evidenceUrl: 'https://github.com/fury-example/static-indexer/blob/main/LICENSE',
      reviewedAt: '2026-09-12T10:00:00Z',
      conflict: false,
    },
    permissions: {
      network: 'none',
      filesystem: 'read',
      subprocess: 'none',
      credentials: 'none',
      externalWrites: [],
      database: 'none',
      browser: 'none',
      provider: 'none',
      cloud: 'none',
    },
    decision: 'REFERENCE_ONLY',
    cost: { model: 'FREE' },
    maintenance: { status: 'ACTIVE', maintainerCount: 2, lastActivityAt: '2026-09-10T12:00:00Z' },
    activity: { stars: 10, downloads: 100, observedAt: '2026-09-12T12:00:00Z' },
    aliases: [],
    relationships: [],
    benchmarks: [],
    ...overrides,
  };
}
