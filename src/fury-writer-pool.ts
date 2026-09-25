// Writer pool — "1 writer agent = 1 isolated worktree".
//
// Built on the existing coding runtime worktree manager (real `git worktree`
// provider, persisted evidence). A lease binds exactly one writer task to one
// worktree; the pool refuses a second lease for the same task, refuses to
// hand an existing worktree to another writer, and can reap worktrees that no
// longer have a live lease (orphans left by a crashed agent).
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CodingRepository, CodingWorktree, CodingWorktreeManager } from './coding-runtime.js';
import type { FuryDispatchPlan } from './fury-dispatcher.js';

export interface FuryWriterLease {
  readonly taskId: string;
  readonly worktree: CodingWorktree;
}

export interface FuryWriterPool {
  acquire(taskId: string): Promise<FuryWriterLease>;
  release(taskId: string): Promise<CodingWorktree>;
  active(): readonly FuryWriterLease[];
  /** Remove every worktree known to the manager that has no live lease. */
  reapOrphans(): Promise<readonly string[]>;
  /** Acquire leases for every dedicated-worktree assignment of a plan. */
  acquireForPlan(plan: FuryDispatchPlan): Promise<readonly FuryWriterLease[]>;
}

export class FuryWriterPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryWriterPoolError';
  }
}

const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

// `git worktree add/remove` are not safe to run concurrently on one repository:
// a concurrent add can read another worktree's half-written admin directory
// ("fatal: failed to read .git/worktrees/<name>/commondir"). Worktree creation
// and removal are therefore serialized per repository, process-wide; the agents
// themselves still run in parallel.
const repositoryLocks = new Map<string, Promise<unknown>>();
export function withFuryRepositoryLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  let repositoryRoot = resolve(root);
  try {
    repositoryRoot = realpathSync.native(repositoryRoot);
  } catch {
    // keep the resolved path; the git command will report a missing repository
  }
  const previous = repositoryLocks.get(repositoryRoot) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.then(() => undefined, () => undefined);
  repositoryLocks.set(repositoryRoot, settled);
  void settled.then(() => { if (repositoryLocks.get(repositoryRoot) === settled) repositoryLocks.delete(repositoryRoot); });
  return next;
}

export function createFuryWriterPool(options: {
  readonly manager: CodingWorktreeManager;
  readonly repository: CodingRepository;
  readonly baseSha: string;
  readonly writableRoot: string;
  readonly runId: string;
}): FuryWriterPool {
  if (!TASK_ID.test(options.runId)) throw new FuryWriterPoolError('runId is invalid');
  const leases = new Map<string, FuryWriterLease>();
  const pending = new Set<string>();

  const pool: FuryWriterPool = {
    async acquire(taskId) {
      if (!TASK_ID.test(taskId)) throw new FuryWriterPoolError('taskId is invalid');
      if (leases.has(taskId) || pending.has(taskId)) throw new FuryWriterPoolError(`task ${taskId} already holds a writer lease`);
      pending.add(taskId);
      try {
        const worktree = await withFuryRepositoryLock(options.repository.rootPath, () => options.manager.create({
          repository: options.repository,
          owner: `fury-${options.runId}-${taskId}`.slice(0, 120),
          taskDigest: createHash('sha256').update(`${options.runId}\u0000${taskId}`).digest('hex'),
          baseSha: options.baseSha,
          branch: `fury/${options.runId}/${taskId}`,
          writableRoot: options.writableRoot,
        }));
        for (const lease of leases.values()) {
          if (lease.worktree.rootPath === worktree.rootPath) {
            throw new FuryWriterPoolError('worktree is already leased to another writer');
          }
        }
        const lease = Object.freeze({ taskId, worktree });
        leases.set(taskId, lease);
        return lease;
      } finally {
        pending.delete(taskId);
      }
    },

    async release(taskId) {
      const lease = leases.get(taskId);
      if (!lease) throw new FuryWriterPoolError(`task ${taskId} holds no writer lease`);
      const cleaned = await withFuryRepositoryLock(options.repository.rootPath, () => options.manager.cleanup(lease.worktree));
      leases.delete(taskId);
      return cleaned;
    },

    active() {
      return Object.freeze([...leases.values()]);
    },

    async reapOrphans() {
      const live = new Set([...leases.values()].map((l) => l.worktree.worktreeId));
      const reaped: string[] = [];
      for (const worktree of await options.manager.list()) {
        if (live.has(worktree.worktreeId)) continue;
        if (worktree.status !== 'ready' && worktree.status !== 'cleanup-pending') continue;
        try {
          const cleaned = await withFuryRepositoryLock(options.repository.rootPath, () => options.manager.cleanup(worktree));
          if (cleaned.status === 'removed') reaped.push(worktree.worktreeId);
        } catch {
          // Worktrees recovered from another process are evidence only; the
          // manager refuses to clean what it does not own. Report, not force.
        }
      }
      return Object.freeze(reaped);
    },

    async acquireForPlan(plan) {
      if (plan.status !== 'PLANNED') throw new FuryWriterPoolError('only a PLANNED dispatch can acquire worktrees');
      const acquired: FuryWriterLease[] = [];
      try {
        for (const assignment of plan.assignments) {
          if (assignment.worktree === 'dedicated') acquired.push(await pool.acquire(assignment.taskId));
        }
        return Object.freeze(acquired);
      } catch (error) {
        for (const lease of acquired) await pool.release(lease.taskId).catch(() => undefined);
        throw error;
      }
    },
  };
  return Object.freeze(pool);
}
