import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCodingWorktreeManager, createNodeGitWorktreeProvider, discoverCodingRepository } from '../src/coding-runtime.js';
import { createFuryWriterPool, withFuryRepositoryLock } from '../src/fury-writer-pool.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('Writer pool under concurrency', () => {
  // Stress guard. Concurrent `git worktree add` on one repository can fail inside git
  // ("failed to read .git/worktrees/<other>/commondir"; 3 of 90 raw parallel adds
  // failed on a Linux runner). The race is too rare to reproduce deterministically
  // here, so the lock itself is proven by the next test.
  it('creates many worktrees at once without git lock races', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-pool-'));
    roots.push(root);
    const repoRoot = join(root, 'repo');
    mkdirSync(repoRoot);
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot, env });
    writeFileSync(join(repoRoot, 'a.txt'), 'a\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot, env });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repoRoot, env });
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const repository = await discoverCodingRepository(repoRoot);
    const manager = createCodingWorktreeManager({ provider: createNodeGitWorktreeProvider() });
    for (let round = 0; round < 4; round += 1) {
      mkdirSync(join(root, `wt${round}`));
      const pool = createFuryWriterPool({ manager, repository, baseSha, writableRoot: join(root, `wt${round}`), runId: `r${round}` });
      const leases = await Promise.all(Array.from({ length: 8 }, (_, i) => pool.acquire(`t${i}`)));
      expect(new Set(leases.map((l) => l.worktree.rootPath)).size).toBe(8);
      await Promise.all(leases.map((l) => pool.release(l.taskId)));
    }
  }, 180_000);

  it('runs locked sections for one repository strictly one at a time and survives failures', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const task = (i: number, fail = false) => withFuryRepositoryLock('/tmp/same-repo', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(i);
      active -= 1;
      if (fail) throw new Error('boom');
      return i;
    });
    const results = await Promise.allSettled([task(1), task(2, true), task(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
