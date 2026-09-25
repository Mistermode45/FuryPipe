// FuryIntegrator — deterministic integration of writer branches.
//
// Each writer produced a branch in its own worktree. The integrator merges
// them in the declared order into a dedicated integration worktree created
// from the base commit. It never blind-merges:
//   - a branch must descend from the base commit (otherwise the patch was
//     produced against another context and is REJECTED);
//   - a merge conflict aborts that merge, records the conflicted files and
//     stops the sequence (CONFLICT) — nothing is auto-resolved;
//   - an optional verification (tests) runs after each merge; a failure
//     resets the integration branch to the last good commit (VERIFY_FAILED).
// Every step emits a host-signed INTEGRATION_RECEIPT (and TEST_RECEIPT when
// verified) through FuryProof. git runs without a shell and without prompts.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { FuryProofLedger, FuryReceipt } from './fury-proof.js';

export type FuryIntegrationStatus = 'INTEGRATED' | 'CONFLICT' | 'VERIFY_FAILED' | 'REJECTED';

export interface FuryIntegrationStep {
  readonly taskId: string;
  readonly branch: string;
}

export interface FuryIntegrationStepResult {
  readonly taskId: string;
  readonly branch: string;
  readonly outcome: 'merged' | 'conflict' | 'rejected' | 'verify-failed' | 'skipped';
  readonly commit?: string;
  readonly conflictFiles?: readonly string[];
  readonly reason?: string;
  readonly receipts: readonly FuryReceipt[];
}

export interface FuryIntegrationResult {
  readonly status: FuryIntegrationStatus;
  readonly worktree: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly steps: readonly FuryIntegrationStepResult[];
}

export type FuryIntegrationVerifier = (worktree: string, step: FuryIntegrationStep) => Promise<{ readonly outcome: 'pass' | 'fail'; readonly evidence: string; readonly subject: string }>;

export class FuryIntegratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryIntegratorError';
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])[A-Za-z0-9._/-]{1,200}(?<!\/)(?<!\.lock)$/u;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function git(cwd: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'user.name=FuryPipe Integrator', '-c', 'user.email=integrator@furypipe.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd, shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' },
    }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function integrateFuryBranches(input: {
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly runId: string;
  readonly integrationRoot: string;
  readonly steps: readonly FuryIntegrationStep[];
  readonly ledger: FuryProofLedger;
  readonly verify?: FuryIntegrationVerifier;
}): Promise<FuryIntegrationResult> {
  if (!isAbsolute(input.repoRoot) || !isAbsolute(input.integrationRoot)) throw new FuryIntegratorError('repoRoot and integrationRoot must be absolute');
  if (!SHA.test(input.baseSha)) throw new FuryIntegratorError('baseSha must be a full commit SHA');
  if (!ID.test(input.runId)) throw new FuryIntegratorError('runId is invalid');
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 64) throw new FuryIntegratorError('1..64 steps are required');
  const seen = new Set<string>();
  for (const s of input.steps) {
    if (!ID.test(s.taskId) || !BRANCH.test(s.branch)) throw new FuryIntegratorError(`invalid step ${JSON.stringify(s)}`);
    if (seen.has(s.taskId)) throw new FuryIntegratorError(`duplicate step ${s.taskId}`);
    seen.add(s.taskId);
  }

  const branch = `fury-integration/${input.runId}`;
  const worktree = join(input.integrationRoot, `integration-${input.runId}`);
  await mkdir(input.integrationRoot, { recursive: true });
  const added = await git(input.repoRoot, ['worktree', 'add', '-b', branch, worktree, input.baseSha]);
  if (added.code !== 0) throw new FuryIntegratorError(`could not create the integration worktree: ${added.stderr.trim().slice(0, 300)}`);

  const head = async () => (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const receipt = (subject: string, outcome: 'pass' | 'fail', evidence: string, details: Record<string, unknown>) =>
    input.ledger.issue({ kind: 'INTEGRATION_RECEIPT', subject, outcome, producer: 'host:fury-integrator', evidenceDigest: digest(evidence), details });

  const results: FuryIntegrationStepResult[] = [];
  let status: FuryIntegrationStatus = 'INTEGRATED';
  for (const step of input.steps) {
    if (status !== 'INTEGRATED') {
      results.push(Object.freeze({ taskId: step.taskId, branch: step.branch, outcome: 'skipped', reason: `not attempted after ${status}`, receipts: [] }));
      continue;
    }
    const subject = `integration:${input.runId}:${step.taskId}`;
    const exists = await git(input.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${step.branch}`]);
    const ancestor = exists.code === 0 ? await git(input.repoRoot, ['merge-base', '--is-ancestor', input.baseSha, step.branch]) : exists;
    if (exists.code !== 0 || ancestor.code !== 0) {
      const reason = exists.code !== 0 ? 'branch does not exist' : 'branch does not descend from the integration base';
      status = 'REJECTED';
      results.push(Object.freeze({ taskId: step.taskId, branch: step.branch, outcome: 'rejected', reason, receipts: [receipt(subject, 'fail', reason, { reason })] }));
      continue;
    }
    const before = await head();
    const merged = await git(worktree, ['merge', '--no-ff', '--no-edit', '-m', `fury: integrate ${step.taskId} (${step.branch})`, step.branch]);
    if (merged.code !== 0) {
      const unmerged = await git(worktree, ['diff', '--name-only', '--diff-filter=U']);
      const conflictFiles = unmerged.stdout.split('\n').map((l) => l.trim()).filter(Boolean).sort();
      await git(worktree, ['merge', '--abort']);
      status = 'CONFLICT';
      results.push(Object.freeze({
        taskId: step.taskId, branch: step.branch, outcome: 'conflict', conflictFiles: Object.freeze(conflictFiles),
        reason: 'merge conflict; merge aborted, nothing auto-resolved',
        receipts: [receipt(subject, 'fail', merged.stderr + merged.stdout, { conflictFiles })],
      }));
      continue;
    }
    const commit = await head();
    const receipts: FuryReceipt[] = [receipt(subject, 'pass', `${before}..${commit}`, { commit, from: before })];
    if (input.verify) {
      const verdict = await input.verify(worktree, step);
      receipts.push(input.ledger.issue({ kind: 'TEST_RECEIPT', subject: verdict.subject, outcome: verdict.outcome, producer: 'host:fury-integrator-verify', evidenceDigest: digest(verdict.evidence), details: { commit, taskId: step.taskId } }));
      if (verdict.outcome !== 'pass') {
        await git(worktree, ['reset', '--hard', before]);
        status = 'VERIFY_FAILED';
        results.push(Object.freeze({ taskId: step.taskId, branch: step.branch, outcome: 'verify-failed', commit, reason: 'verification failed; integration branch reset to the last good commit', receipts: Object.freeze(receipts) }));
        continue;
      }
    }
    results.push(Object.freeze({ taskId: step.taskId, branch: step.branch, outcome: 'merged', commit, receipts: Object.freeze(receipts) }));
  }
  return Object.freeze({ status, worktree, branch, baseSha: input.baseSha, headSha: await head(), steps: Object.freeze(results) });
}
