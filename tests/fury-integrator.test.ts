import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FuryIntegratorError, integrateFuryBranches } from '../src/fury-integrator.js';
import { createFuryProofLedger } from '../src/fury-proof.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

/** Repo with base commit and three writer branches: auth, docs (disjoint) and clash (conflicts with auth). */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-integrator-'));
  roots.push(root);
  const dir = join(root, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'auth.ts'), 'export const mode = "old";\n');
  writeFileSync(join(dir, 'README.md'), '# app\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  const branch = (name: string, file: string, content: string) => {
    git(dir, 'checkout', '-q', '-b', name, base);
    writeFileSync(join(dir, file), content);
    git(dir, 'commit', '-q', '-am', name);
    git(dir, 'checkout', '-q', 'main');
  };
  branch('fury/run/auth', 'src/auth.ts', 'export const mode = "secure";\n');
  branch('fury/run/docs', 'README.md', '# app\n\nAuth is secure.\n');
  branch('fury/run/clash', 'src/auth.ts', 'export const mode = "other";\n');
  git(dir, 'checkout', '-q', '--orphan', 'unrelated');
  writeFileSync(join(dir, 'x.txt'), 'x');
  git(dir, 'add', 'x.txt');
  git(dir, 'commit', '-q', '-m', 'unrelated');
  git(dir, 'checkout', '-q', 'main');
  return { root, dir, base };
}

describe('FuryIntegrator (real git)', () => {
  it('merges disjoint writer branches in order with signed receipts', async () => {
    const { root, dir, base } = repo();
    const ledger = createFuryProofLedger();
    const result = await integrateFuryBranches({
      repoRoot: dir, baseSha: base, runId: 'run', integrationRoot: join(root, 'int'), ledger,
      steps: [{ taskId: 'auth', branch: 'fury/run/auth' }, { taskId: 'docs', branch: 'fury/run/docs' }],
      verify: async (wt, step) => ({ outcome: 'pass', evidence: readFileSync(join(wt, 'src', 'auth.ts'), 'utf8'), subject: `test:${step.taskId}` }),
    });
    expect(result.status).toBe('INTEGRATED');
    expect(result.steps.map((s) => s.outcome)).toEqual(['merged', 'merged']);
    expect(readFileSync(join(result.worktree, 'src', 'auth.ts'), 'utf8')).toContain('secure');
    expect(readFileSync(join(result.worktree, 'README.md'), 'utf8')).toContain('Auth is secure');
    const receipts = result.steps.flatMap((s) => s.receipts);
    expect(receipts.map((r) => r.kind)).toEqual(['INTEGRATION_RECEIPT', 'TEST_RECEIPT', 'INTEGRATION_RECEIPT', 'TEST_RECEIPT']);
    expect(receipts.every((r) => ledger.verify(r))).toBe(true);
    const judged = ledger.judge({ requirements: [{ id: 'integrated', level: 'MUST', description: 'auth integrated', evidence: [{ kind: 'INTEGRATION_RECEIPT', subject: 'integration:run:auth' }] }], receipts });
    expect(judged.verdict).toBe('ACCEPT');
    expect(git(dir, 'rev-parse', 'main')).toBe(base); // main untouched
  });

  it('stops on conflict, aborts the merge and never auto-resolves', async () => {
    const { root, dir, base } = repo();
    const result = await integrateFuryBranches({
      repoRoot: dir, baseSha: base, runId: 'run', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(),
      steps: [{ taskId: 'auth', branch: 'fury/run/auth' }, { taskId: 'clash', branch: 'fury/run/clash' }, { taskId: 'docs', branch: 'fury/run/docs' }],
    });
    expect(result.status).toBe('CONFLICT');
    expect(result.steps.map((s) => s.outcome)).toEqual(['merged', 'conflict', 'skipped']);
    expect(result.steps[1]?.conflictFiles).toEqual(['src/auth.ts']);
    expect(result.headSha).toBe(result.steps[0]?.commit);
    expect(git(result.worktree, 'status', '--porcelain')).toBe('');
    expect(() => git(result.worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
  });

  it('resets to the last good commit when verification fails', async () => {
    const { root, dir, base } = repo();
    const result = await integrateFuryBranches({
      repoRoot: dir, baseSha: base, runId: 'run', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(),
      steps: [{ taskId: 'auth', branch: 'fury/run/auth' }, { taskId: 'docs', branch: 'fury/run/docs' }],
      verify: async (_wt, step) => ({ outcome: step.taskId === 'docs' ? 'fail' : 'pass', evidence: 'log', subject: `test:${step.taskId}` }),
    });
    expect(result.status).toBe('VERIFY_FAILED');
    expect(result.headSha).toBe(result.steps[0]?.commit);
    expect(readFileSync(join(result.worktree, 'README.md'), 'utf8')).toBe('# app\n');
  });

  it('rejects branches that do not descend from the base or do not exist', async () => {
    const { root, dir, base } = repo();
    const bad = await integrateFuryBranches({
      repoRoot: dir, baseSha: base, runId: 'run', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(),
      steps: [{ taskId: 'x', branch: 'unrelated' }],
    });
    expect(bad).toMatchObject({ status: 'REJECTED' });
    expect(bad.steps[0]?.reason).toMatch(/descend/u);
    const missing = await integrateFuryBranches({
      repoRoot: dir, baseSha: base, runId: 'run2', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(),
      steps: [{ taskId: 'x', branch: 'fury/run/nope' }],
    });
    expect(missing.steps[0]?.reason).toMatch(/does not exist/u);
    await expect(integrateFuryBranches({ repoRoot: dir, baseSha: base, runId: 'run3', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(), steps: [{ taskId: 'x', branch: '--upload-pack=evil' }] })).rejects.toThrow(FuryIntegratorError);
    await expect(integrateFuryBranches({ repoRoot: dir, baseSha: 'HEAD', runId: 'run3', integrationRoot: join(root, 'int'), ledger: createFuryProofLedger(), steps: [{ taskId: 'x', branch: 'a' }] })).rejects.toThrow(/full commit SHA/u);
  });
});
