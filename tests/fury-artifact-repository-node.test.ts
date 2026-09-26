import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFuryArtifactRepository } from '../src/fury-artifact-repository-node.js';

describe('FuryArtifactRepository', () => {
  it('persists immutable versions across repository restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-artifacts-'));
    try {
      const first = createFuryArtifactRepository({ root, projectId: 'furypipe' });
      await first.create({
        id: 'architecture',
        kind: 'markdown',
        title: 'Architecture',
        content: '# v1',
        mediaType: 'text/markdown',
        metadata: { owner: 'LégendeUrbaine' },
        now: '2026-09-26T17:30:00.000Z',
      });
      await first.appendVersion({
        artifactId: 'architecture',
        content: '# v2',
        mediaType: 'text/markdown',
        metadata: { owner: 'LégendeUrbaine' },
        now: '2026-09-26T17:31:00.000Z',
      });

      const reopened = createFuryArtifactRepository({ root, projectId: 'furypipe' });
      const artifact = await reopened.get('architecture');
      expect(artifact?.versions).toHaveLength(2);
      expect(artifact?.versions[0]?.content).toBe('# v1');
      expect(artifact?.versions[1]?.content).toBe('# v2');
      expect(artifact?.updatedAt).toBe('2026-09-26T17:31:00.000Z');
      expect((await reopened.search('architecture')).map((item) => item.id)).toEqual(['architecture']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes restore only from an exact current plan and writes a new immutable version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-artifacts-restore-'));
    try {
      const artifacts = createFuryArtifactRepository({ root, projectId: 'furypipe' });
      await artifacts.create({
        id: 'spec',
        kind: 'text',
        title: 'Spec',
        content: 'one',
        now: '2026-09-26T17:30:00.000Z',
      });
      await artifacts.appendVersion({
        artifactId: 'spec',
        content: 'two',
        now: '2026-09-26T17:31:00.000Z',
      });

      const plan = await artifacts.planRestore('spec', 1);
      const receipt = await artifacts.executeRestore({
        plan,
        confirm: true,
        now: '2026-09-26T17:32:00.000Z',
      });
      expect(receipt).toMatchObject({
        format: 'furypipe-artifact-restore-receipt/v1',
        artifactId: 'spec',
        sourceVersion: 1,
        previousVersion: 2,
        restoredVersion: 3,
        operatorConfirmed: true,
        writePerformed: true,
        executionAuthorized: false,
      });
      expect(receipt.persistedDigestSha256).toMatch(/^[0-9a-f]{64}$/u);

      const restored = await artifacts.get('spec');
      expect(restored?.versions.map((version) => version.content)).toEqual(['one', 'two', 'one']);
      expect(restored?.versions[2]?.metadata.restoredFromVersion).toBe('1');

      await artifacts.appendVersion({
        artifactId: 'spec',
        content: 'three',
        now: '2026-09-26T17:33:00.000Z',
      });
      await expect(artifacts.executeRestore({
        plan,
        confirm: true,
        now: '2026-09-26T17:34:00.000Z',
      })).rejects.toThrow(/stale or forged/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exports deterministic project evidence without execution authority', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-artifacts-export-'));
    try {
      const artifacts = createFuryArtifactRepository({ root, projectId: 'furypipe' });
      await artifacts.create({
        id: 'report',
        kind: 'json',
        title: 'Report',
        content: '{"ok":true}',
        mediaType: 'application/json',
        now: '2026-09-26T17:30:00.000Z',
      });
      const a = await artifacts.exportProject();
      const b = await artifacts.exportProject();
      expect(a.exportDigestSha256).toBe(b.exportDigestSha256);
      expect(a).toMatchObject({
        format: 'furypipe-artifact-export/v1',
        projectId: 'furypipe',
        executionAuthorized: false,
      });
      expect(a.bytes).toBeGreaterThan(0);
      expect(a.artifacts).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
