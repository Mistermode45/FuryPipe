import { describe, expect, it } from 'vitest';

import { createFuryArtifactStore } from '../src/fury-artifacts.js';

describe('FuryArtifacts', () => {
  it('keeps immutable version history and deterministic content hashes', () => {
    const store = createFuryArtifactStore();
    const first = store.create({
      id: 'design-report',
      kind: 'markdown',
      title: 'Design report',
      projectId: 'furypipe',
      content: '# v1',
      now: '2026-09-26T16:00:00Z',
      metadata: { author: 'LégendeUrbaine' },
    });
    const second = store.appendVersion({
      artifactId: first.id,
      content: '# v2',
      now: '2026-09-26T16:01:00Z',
    });

    expect(first.versions).toHaveLength(1);
    expect(second.versions).toHaveLength(2);
    expect(second.versions[0]?.content).toBe('# v1');
    expect(second.versions[1]?.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('searches bounded latest artifact content and metadata', () => {
    const store = createFuryArtifactStore();
    store.create({
      id: 'release-notes',
      kind: 'markdown',
      title: 'Release notes',
      projectId: 'furypipe',
      content: 'plugin runtime isolation',
      now: '2026-09-26T16:00:00Z',
      metadata: { track: 'P2' },
    });

    expect(store.search('isolation').map((artifact) => artifact.id)).toEqual(['release-notes']);
    expect(store.search('p2').map((artifact) => artifact.id)).toEqual(['release-notes']);
    expect(store.search('isolation', 'other')).toEqual([]);
  });

  it('plans restore without silently authorizing writes or execution', () => {
    const store = createFuryArtifactStore();
    store.create({
      id: 'spec',
      kind: 'text',
      title: 'Spec',
      projectId: 'furypipe',
      content: 'one',
      now: '2026-09-26T16:00:00Z',
    });
    store.appendVersion({
      artifactId: 'spec',
      content: 'two',
      now: '2026-09-26T16:01:00Z',
    });

    expect(store.planRestore('spec', 1)).toMatchObject({
      format: 'furypipe-artifact-restore-plan/v1',
      sourceVersion: 1,
      currentVersion: 2,
      plannedVersion: 3,
      requiresApproval: true,
      writeAuthorized: false,
      executionAuthorized: false,
    });
    expect(store.get('spec')?.versions).toHaveLength(2);
  });
});
