import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCodingWorktreeManager, createNodeGitWorktreeProvider, discoverCodingRepository } from '../src/coding-runtime.js';
import { planFuryDispatch, type FuryRuntimeBinding } from '../src/fury-dispatcher.js';
import { verifyFuryReplay, type FuryWorkerBinding } from '../src/fury-mission-control.js';
import { planFuryTask } from '../src/fury-planner.js';
import { createFuryProofLedger } from '../src/fury-proof.js';
import { runFuryTask, type FuryTaskExecutor } from '../src/fury-run.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-run-'));
  roots.push(root);
  const repoRoot = join(root, 'repo');
  mkdirSync(join(repoRoot, 'src', 'auth'), { recursive: true });
  mkdirSync(join(repoRoot, 'src', 'ui'), { recursive: true });
  git(repoRoot, 'init', '-q', '-b', 'main');
  writeFileSync(join(repoRoot, 'src', 'auth', 'login.ts'), 'export const secure = false;\n');
  writeFileSync(join(repoRoot, 'src', 'ui', 'form.ts'), 'export const label = "Login";\n');
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '-q', '-m', 'base');
  const baseSha = git(repoRoot, 'rev-parse', 'HEAD');
  mkdirSync(join(root, 'wt'));
  const plan = planFuryTask({ runId: 'r1', intent: 'Harden login and relabel the form.', plannedFiles: ['src/auth/login.ts', 'src/ui/form.ts'], checks: { security: 'never', docs: 'never' } });
  const workerBindings: FuryWorkerBinding[] = [
    { bindingId: 'cc', harnessId: 'claude-code', provider: 'anthropic', model: 'a', locality: 'cloud' },
    { bindingId: 'codex', harnessId: 'codex', provider: 'openai', model: 'b', locality: 'cloud' },
  ];
  const candidates: FuryRuntimeBinding[] = workerBindings.map((b) => ({ id: b.bindingId, harnessId: b.harnessId, provider: b.provider, model: b.model, locality: b.locality, available: true, scores: b.bindingId === 'cc' ? { coding: 0.9 } : { review: 0.9, coding: 0.5 }, estimatedCostUsdPerTask: 0.1 }));
  const dispatch = planFuryDispatch({ ir: plan.ir, candidates, mode: 'SPECIALISTS' });
  return {
    root, repoRoot, baseSha, plan, dispatch, workerBindings,
    repository: await discoverCodingRepository(repoRoot),
    manager: createCodingWorktreeManager({ provider: createNodeGitWorktreeProvider() }),
  };
}

describe('FuryRun end to end (fake harness, real git)', () => {
  it('runs writers in isolated worktrees, integrates, reviews and is ACCEPTED only with receipts', async () => {
    const s = await setup();
    const ledger = createFuryProofLedger();
    const seenWorktrees = new Map<string, string>();
    const execute: FuryTaskExecutor = async ({ assignment, binding, worktree, capsule }) => {
      seenWorktrees.set(assignment.taskId, worktree);
      expect(capsule.entries[0]?.source).toBe('ir:intent');
      if (assignment.taskId === 'impl-src-auth') writeFileSync(join(worktree, 'src', 'auth', 'login.ts'), 'export const secure = true;\n');
      if (assignment.taskId === 'impl-src-ui') writeFileSync(join(worktree, 'src', 'ui', 'form.ts'), 'export const label = "Sign in";\n');
      if (assignment.taskId === 'tests') { mkdirSync(join(worktree, 'tests'), { recursive: true }); writeFileSync(join(worktree, 'tests', 'login.test.ts'), '// test\n'); }
      const receipts = [];
      if (assignment.role === 'reviewer') {
        expect(readFileSync(join(worktree, 'src', 'auth', 'login.ts'), 'utf8')).toContain('true'); // reviews the integrated result
        receipts.push(ledger.issue({ kind: 'AGENT_RECEIPT', subject: 'review:r1', outcome: 'pass', producer: `host:review:${binding.harnessId}`, evidenceDigest: 'a'.repeat(64) }));
      }
      return { ok: true, receipts, usage: { tokens: 100, costUsd: 0.01 } };
    };
    const result = await runFuryTask({
      runId: 'r1', ir: s.plan.ir, plan: s.dispatch, bindings: s.workerBindings, repository: s.repository, repoRoot: s.repoRoot, baseSha: s.baseSha,
      manager: s.manager, writableRoot: join(s.root, 'wt'), integrationRoot: join(s.root, 'int'), ledger, execute,
      verify: async (_wt, step) => ({ outcome: 'pass', evidence: `ok ${step.taskId}`, subject: 'test:r1' }),
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.judgement.verdict).toBe('ACCEPT');
    expect(result.integration?.status).toBe('INTEGRATED');
    expect(new Set([seenWorktrees.get('impl-src-auth'), seenWorktrees.get('impl-src-ui'), seenWorktrees.get('tests')]).size).toBe(3);
    expect(result.bundle.filesModified).toEqual(['src/auth/login.ts', 'src/ui/form.ts', 'tests/login.test.ts']);
    expect(verifyFuryReplay(result.replay).ok).toBe(true);
    expect(git(s.repoRoot, 'rev-parse', 'main')).toBe(s.baseSha);
  }, 120_000);

  it('is UNPROVEN when the reviewer only claims success, and FAILED when a writer fails', async () => {
    const s = await setup();
    const ledger = createFuryProofLedger();
    const noReceipt: FuryTaskExecutor = async ({ assignment, worktree }) => {
      if (assignment.taskId === 'impl-src-auth') writeFileSync(join(worktree, 'src', 'auth', 'login.ts'), 'export const secure = true;\n');
      return { ok: true, receipts: [] };
    };
    const unproven = await runFuryTask({ runId: 'r1', ir: s.plan.ir, plan: s.dispatch, bindings: s.workerBindings, repository: s.repository, repoRoot: s.repoRoot, baseSha: s.baseSha, manager: s.manager, writableRoot: join(s.root, 'wt'), integrationRoot: join(s.root, 'int'), ledger, execute: noReceipt, verify: async () => ({ outcome: 'pass', evidence: 'x', subject: 'test:r1' }) });
    expect(unproven.status).toBe('COMPLETED');
    expect(unproven.judgement.verdict).toBe('UNPROVEN');
    expect(unproven.judgement.requirements.find((r) => r.id === 'req:review')?.status).toBe('MISSING');

    const s2 = await setup();
    const failing: FuryTaskExecutor = async ({ assignment }) => ({ ok: assignment.taskId !== 'impl-src-ui', receipts: [], ...(assignment.taskId === 'impl-src-ui' ? { error: 'compile error' } : {}) });
    const failed = await runFuryTask({ runId: 'r2', ir: s2.plan.ir, plan: s2.dispatch, bindings: s2.workerBindings, repository: s2.repository, repoRoot: s2.repoRoot, baseSha: s2.baseSha, manager: s2.manager, writableRoot: join(s2.root, 'wt'), integrationRoot: join(s2.root, 'int'), ledger: createFuryProofLedger(), execute: failing });
    expect(failed.status).toBe('FAILED');
    expect(failed.integration).toBeUndefined();
    expect(failed.bundle.uncertainty.join(' ')).toContain('impl-src-ui: compile error');
  }, 120_000);
});
