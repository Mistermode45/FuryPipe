import { describe, expect, it } from 'vitest';
import { evaluateFuryTrust, type StaticEvidenceFile } from '../src/fury-trust.js';
import { CAPABILITY_MANIFEST_FORMAT } from '../src/ecosystem/types.js';
import { createEcosystemIngestionEngine } from '../src/ecosystem/ingestion.js';
import { createFixtureCapabilityImporter, serializeCapabilityManifest } from '../src/ecosystem/importer.js';
import { normalizeCapabilityCandidate } from '../src/ecosystem/normalize.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

const CLEAN_EVIDENCE: readonly StaticEvidenceFile[] = Object.freeze([
  Object.freeze({ path: 'src/main.ts', content: 'export const answer = 42;\n' }),
]);

describe('ecosystem ingestion orchestration', () => {
  it('connects static import, normalization, trust evaluation, registry and trust filtering', () => {
    const candidate = makeCapabilityCandidate({
      name: 'Approved First-Party Fixture',
      provenance: {
        classification: 'FIRST_PARTY',
        reviewStatus: 'REVIEWED',
        evidence: [{ kind: 'manual-review', reference: 'audit:approved-fixture' }],
      },
      categories: ['frontend'],
      capabilities: ['ui-inspection', 'metadata-search'],
      domains: ['web'],
      supportedStages: ['review'],
      supportedPlatforms: ['windows', 'linux'],
      supportedModels: ['model-fixture'],
      supportedLanguages: ['typescript'],
      decision: 'ADOPT',
      integrationMode: 'EXTERNAL_OPT_IN',
      decisionReason: 'Fixture used to exercise the metadata-only ingest path.',
      releaseDate: '2026-09-10T00:00:00Z',
      createdAt: '2026-09-12T12:00:00Z',
      lastAuditedAt: '2026-09-12T13:00:00Z',
    });
    const candidateId = normalizeCapabilityCandidate(candidate).id;
    const engine = createEcosystemIngestionEngine();
    const result = engine.ingest({
      manifest: serializeCapabilityManifest([candidate]),
      staticEvidence: new Map([[candidateId, CLEAN_EVIDENCE]]),
      operatorReviews: new Map([[candidateId, {
        decision: 'APPROVE', reviewerId: 'reviewer-1', reviewedAt: '2026-09-12T13:00:00Z',
      }]]),
    });

    expect(result).toMatchObject({ format: 'furypipe-ingestion-result/v1', registered: 1, duplicates: 0, identityConflicts: 0 });
    expect(result.items[0]?.trustReport.verdict).toBe('TRUSTED');
    expect(result.items[0]?.trustReport.executionAuthorized).toBe(false);
    expect(engine.registry.list({ trustVerdicts: ['TRUSTED'], capabilities: ['ui-inspection'], domains: ['web'] })).toHaveLength(1);
    expect(engine.registry.list({ trustVerdicts: ['UNKNOWN'] })).toHaveLength(0);
  });

  it('rejects bad evidence references before mutating any registry entry', () => {
    const candidate = makeCapabilityCandidate();
    const candidateId = normalizeCapabilityCandidate(candidate).id;
    const engine = createEcosystemIngestionEngine();
    expect(() => engine.ingest({
      manifest: serializeCapabilityManifest([candidate]),
      staticEvidence: new Map([[candidateId, [{ path: '../escape.ts', content: 'text' }]]]),
    })).toThrow(/invalid segment/u);
    expect(engine.registry.size).toBe(0);
  });

  it('keeps the stored trust report unchanged when a conflicting record reuses an immutable identity', () => {
    const initial = makeCapabilityCandidate();
    const candidateId = normalizeCapabilityCandidate(initial).id;
    const engine = createEcosystemIngestionEngine();
    const first = engine.ingest({ manifest: serializeCapabilityManifest([initial]), staticEvidence: new Map([[candidateId, CLEAN_EVIDENCE]]) });
    expect(first.items[0]?.trustReport.verdict).toBe('AUDITED');

    const conflict = makeCapabilityCandidate({
      name: 'Conflicting label for same immutable source',
      provenance: {
        classification: 'FIRST_PARTY',
        reviewStatus: 'REVIEWED',
        evidence: [{ kind: 'manual-review', reference: 'claim:spoofed' }],
      },
    });
    const second = engine.ingest({
      manifest: serializeCapabilityManifest([conflict]),
      staticEvidence: new Map([[candidateId, CLEAN_EVIDENCE]]),
      operatorReviews: new Map([[candidateId, { decision: 'APPROVE', reviewerId: 'reviewer-1', reviewedAt: '2026-09-12T13:00:00Z' }]]),
    });
    expect(second.items[0]?.registrationStatus).toBe('identity-conflict');
    expect(second.items[0]?.trustReport.verdict).toBe('TRUSTED');
    expect(engine.getTrustReport(candidateId)?.verdict).toBe('AUDITED');
    expect(engine.registry.get(candidateId)?.name).toBe('Static Indexer');
  });

  it('provides a fixed in-memory fixture importer without accepting replacement input', () => {
    const importer = createFixtureCapabilityImporter([makeCapabilityCandidate()]);
    expect(importer.import(undefined)).toHaveLength(1);
    expect(() => importer.import({ format: CAPABILITY_MANIFEST_FORMAT, candidates: [] })).toThrow(/does not accept/u);
  });
});
