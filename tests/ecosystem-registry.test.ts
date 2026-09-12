import { describe, expect, it } from 'vitest';
import { deduplicateCapabilities } from '../src/ecosystem/deduplicate.js';
import { createCapabilityRegistry } from '../src/ecosystem/registry.js';
import { evaluateFuryTrust } from '../src/fury-trust.js';
import { makeCapabilityCandidate } from './helpers/ecosystem-candidate.js';

describe('ecosystem deduplication and registry', () => {
  it('recognizes canonical repository duplicates without merging conflicting metadata', () => {
    const first = makeCapabilityCandidate();
    const second = makeCapabilityCandidate({
      name: 'A newer label',
      source: { ...first.source },
    });
    const matches = deduplicateCapabilities([first, second]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      relation: 'same-canonical-source',
      confidence: 'EXACT',
      autoMergeAllowed: false,
    });

    const exact = deduplicateCapabilities([first, first]);
    expect(exact[0]).toMatchObject({ relation: 'same-canonical-source', confidence: 'EXACT', autoMergeAllowed: true });

    const registry = createCapabilityRegistry([first]);
    expect(registry.register(second).status).toBe('identity-conflict');
    expect(registry.size).toBe(1);
    expect(registry.get(registry.list()[0]!.canonicalUrl)?.name).toBe('Static Indexer');
  });

  it('detects identical content, shared package coordinates and declared fork/rename relations', () => {
    const first = makeCapabilityCandidate({
      source: {
        kind: 'package',
        url: 'https://registry.example/packages/static-indexer',
        repositoryUrl: 'https://github.com/fury-example/static-indexer',
        package: { ecosystem: 'npm', name: '@fury/static-indexer', version: '1.2.3' },
        contentSha256: 'c'.repeat(64),
      },
    });
    const sameArtifact = makeCapabilityCandidate({
      source: {
        kind: 'package',
        url: 'https://registry.example/packages/static-indexer-mirror',
        repositoryUrl: 'https://code.example/fury/static-indexer-mirror',
        package: { ecosystem: 'npm', name: '@fury/static-indexer', version: '1.2.3' },
        contentSha256: 'c'.repeat(64),
      },
    });
    const samePackageOnly = makeCapabilityCandidate({
      source: {
        kind: 'package',
        url: 'https://registry.example/packages/static-indexer-alt',
        repositoryUrl: 'https://code.example/fury/static-indexer-alt',
        package: { ecosystem: 'npm', name: '@fury/static-indexer', version: '1.2.3' },
        contentSha256: '9'.repeat(64),
      },
    });
    const fork = makeCapabilityCandidate({
      name: 'Static Indexer Fork',
      source: {
        kind: 'git',
        url: 'https://github.com/community/static-indexer',
        repositoryUrl: 'https://github.com/community/static-indexer',
        commitSha: 'd'.repeat(40),
      },
      relationships: [{ kind: 'fork-of', targetUrl: 'https://github.com/fury-example/static-indexer' }],
    });
    const renamed = makeCapabilityCandidate({
      name: 'New Indexer Name',
      source: {
        kind: 'git',
        url: 'https://github.com/fury-example/new-indexer',
        repositoryUrl: 'https://github.com/fury-example/new-indexer',
        commitSha: 'e'.repeat(40),
      },
      relationships: [{ kind: 'renamed-from', targetUrl: 'https://github.com/fury-example/static-indexer' }],
    });

    const matches = deduplicateCapabilities([first, sameArtifact, samePackageOnly, fork, renamed]);
    expect(matches.map((match) => match.relation)).toEqual(expect.arrayContaining([
      'same-content-digest',
      'same-package',
      'fork-of',
      'renamed-from',
    ]));
    expect(matches.filter((match) => match.relation === 'fork-of' || match.relation === 'renamed-from')
      .every((match) => !match.autoMergeAllowed)).toBe(true);
  });

  it('links marketplace records to repository records without automatically merging them', () => {
    const repository = makeCapabilityCandidate();
    const marketplaceEntry = makeCapabilityCandidate({
      name: 'Marketplace Listing',
      source: {
        kind: 'marketplace',
        url: 'https://marketplace.example/listings/static-indexer',
        commitSha: 'b'.repeat(40),
      },
      aliases: [{ kind: 'repository', value: 'https://github.com/fury-example/static-indexer' }],
    });
    expect(deduplicateCapabilities([repository, marketplaceEntry])).toMatchObject([{
      relation: 'marketplace-repository',
      confidence: 'HIGH',
      autoMergeAllowed: false,
    }]);
  });

  it('keeps semantic similarity advisory and returns deterministic filtered order', () => {
    const sameName = makeCapabilityCandidate({
      source: {
        kind: 'git',
        url: 'https://code.example/fury/static-indexer-next',
        repositoryUrl: 'https://code.example/fury/static-indexer-next',
        commitSha: 'f'.repeat(40),
      },
    });
    expect(deduplicateCapabilities([makeCapabilityCandidate(), sameName])[0]).toMatchObject({
      relation: 'possible-semantic-match',
      confidence: 'POSSIBLE',
      autoMergeAllowed: false,
    });

    const registry = createCapabilityRegistry([
      makeCapabilityCandidate({
        name: 'Static Indexer Zulu',
        categories: ['automation'],
        capabilities: ['metadata-search', 'catalog'],
        domains: ['developer-tools'],
      }),
      sameName,
      makeCapabilityCandidate({
        name: 'Browser Agent',
        type: 'agent',
        source: {
          kind: 'git',
          url: 'https://github.com/fury-example/browser-agent',
          repositoryUrl: 'https://github.com/fury-example/browser-agent',
          commitSha: '1'.repeat(40),
        },
      }),
    ]);
    expect(registry.list({ types: ['agent'] }).map((candidate) => candidate.name)).toEqual(['Browser Agent']);
    expect(registry.list({ query: 'static indexer' }).length).toBe(2);
    expect(registry.list({ permissions: { filesystem: 'read' } })).toHaveLength(3);
    expect(registry.list({ categories: ['automation'], capabilities: ['catalog'], domains: ['developer-tools'] })).toHaveLength(1);
    expect(registry.list({ excludePermissions: { network: 'arbitrary', subprocess: 'arbitrary' } })).toHaveLength(3);
    expect(() => registry.list({ query: '(' })).not.toThrow();
    expect(() => registry.list({ query: 'x'.repeat(257) })).toThrow(/text limit/u);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it('rejects copied or caller-forged trust reports from registry storage', () => {
    const candidate = makeCapabilityCandidate();
    const registry = createCapabilityRegistry([candidate]);
    const report = evaluateFuryTrust(candidate, [{ path: 'src/index.ts', content: 'export const value = 1;' }]);

    expect(() => registry.recordTrustReport({ ...report })).toThrow(/not generated by the in-process FuryTrust policy/u);
    expect(registry.getTrustReport(report.candidateId)).toBeUndefined();
    registry.recordTrustReport(report);
    expect(registry.getTrustReport(report.candidateId)).toEqual(report);
  });
});
