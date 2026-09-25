// FuryRun — the end-to-end loop over a planned task:
//   writers (dedicated worktrees, by dispatch group)
//   → FuryIntegrator (ordered merges, conflict stop, verification)
//   → readers (review / security / browser) on the integrated result
//   → FuryJudge over every receipt (+ impact requirements from FuryGraph)
//   → sealed proof bundle, with Mission Control + FuryReplay throughout.
// External-action tasks are never executed here: the run stops at their
// human gate. The harness execution itself is injected (runFuryHarnessTask
// in production, fakes in tests), so the loop is testable without any
// real agent or paid call.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { CodingRepository, CodingWorktreeManager } from './coding-runtime.js';
import { compileFuryContextCapsule, type FuryContextCandidate, type FuryContextCapsule } from './fury-context-compiler.js';
import type { FuryDispatchAssignment, FuryDispatchPlan } from './fury-dispatcher.js';
import { furyImpactDelta, furyImpactRequirements, type FuryGraph } from './fury-graph.js';
import { integrateFuryBranches, type FuryIntegrationResult, type FuryIntegrationVerifier } from './fury-integrator.js';
import { furyIrRequirements, type FuryIrDocument } from './fury-ir.js';
import { createFuryMissionControl, type FuryMissionControl, type FuryReplayLog, type FuryWorkerBinding } from './fury-mission-control.js';
import { sealFuryProofBundle, type FuryJudgement, type FuryProofBundle, type FuryProofLedger, type FuryReceipt } from './fury-proof.js';
import { createFuryWriterPool } from './fury-writer-pool.js';

export type FuryTaskExecutor = (input: {
  readonly assignment: FuryDispatchAssignment;
  readonly binding: FuryWorkerBinding;
  readonly worktree: string;
  readonly capsule: FuryContextCapsule;
}) => Promise<{ readonly ok: boolean; readonly receipts: readonly FuryReceipt[]; readonly usage?: { readonly tokens?: number; readonly costUsd?: number; readonly wallMs?: number; readonly cloudCalls?: number; readonly toolCalls?: number }; readonly error?: string }>;

export interface FuryRunResult {
  readonly status: 'COMPLETED' | 'AWAITING_APPROVAL' | 'FAILED';
  readonly judgement: FuryJudgement;
  readonly bundle: FuryProofBundle;
  readonly integration?: FuryIntegrationResult;
  readonly replay: FuryReplayLog;
  readonly pendingGates: readonly string[];
}

const WRITER_ROLES = new Set(['implementer', 'tester', 'documenter', 'architect']);
const HOST_ROLES = new Set(['integrator', 'judge']);

function gitCommitAll(cwd: string, message: string): Promise<boolean> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const git = (args: string[]) => new Promise<number>((resolve) => execFile('git', ['-c', 'user.name=FuryPipe Worker', '-c', 'user.email=worker@furypipe.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, shell: false, windowsHide: true }, (e) => resolve(e ? 1 : 0)));
  return git(['add', '-A']).then(async (a) => a === 0 && (await git(['commit', '-q', '--allow-empty', '-m', message])) === 0);
}

export async function runFuryTask(input: {
  readonly runId: string;
  readonly ir: FuryIrDocument;
  readonly plan: FuryDispatchPlan;
  readonly bindings: readonly FuryWorkerBinding[];
  readonly repository: CodingRepository;
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly manager: CodingWorktreeManager;
  readonly writableRoot: string;
  readonly integrationRoot: string;
  readonly ledger: FuryProofLedger;
  readonly execute: FuryTaskExecutor;
  readonly contextFor?: (taskId: string) => readonly FuryContextCandidate[];
  readonly verify?: FuryIntegrationVerifier;
  readonly graph?: FuryGraph;
  readonly approvedGates?: readonly string[];
  readonly now?: () => number;
  /** Receives the live Mission Control (Studio polls it and can STOP workers). */
  readonly onMission?: (mission: FuryMissionControl) => void;
}): Promise<FuryRunResult> {
  const { ir, plan, ledger } = input;
  const mc = createFuryMissionControl({ ir, plan, bindings: input.bindings, replayId: input.runId, ...(input.now ? { now: input.now } : {}) });
  input.onMission?.(mc);
  const pool = createFuryWriterPool({ manager: input.manager, repository: input.repository, baseSha: input.baseSha, writableRoot: input.writableRoot, runId: input.runId });
  const byTask = new Map(ir.tasks.map((t) => [t.id, t]));
  const bindingOf = new Map(input.bindings.map((b) => [b.bindingId, b]));
  const receipts: FuryReceipt[] = [];
  const commands: string[] = [];
  const failures: string[] = [];
  const gates = new Set(input.approvedGates ?? []);
  const pendingGates = ir.humanGates.filter((g) => !gates.has(g.id)).map((g) => g.id);
  const blockedTasks = new Set(ir.humanGates.filter((g) => !gates.has(g.id)).map((g) => g.beforeTask));

  const runAssignment = async (a: FuryDispatchAssignment, worktree: string) => {
    const workerId = a.bindingIds.length > 1 ? `${a.taskId}#1` : a.taskId;
    const binding = bindingOf.get(a.bindingIds[0]!)!;
    const capsule = compileFuryContextCapsule({ ir, taskId: a.taskId, candidates: input.contextFor?.(a.taskId) ?? [], budgetBytes: 256 * 1024 });
    if (mc.worker(workerId).state !== 'queued') {
      failures.push(`${a.taskId}: ${mc.worker(workerId).state} before start`);
      return false;
    }
    mc.act(workerId, 'START');
    commands.push(`${binding.harnessId}:${a.taskId}`);
    const out = await input.execute({ assignment: a, binding, worktree, capsule }).catch((error: unknown) => ({ ok: false, receipts: [] as FuryReceipt[], error: error instanceof Error ? error.message : 'executor failed' }));
    receipts.push(...out.receipts);
    // The operator (or the budget) may have stopped the worker meanwhile:
    // keep its receipts as evidence but do not complete it.
    if (mc.worker(workerId).state !== 'running') {
      failures.push(`${a.taskId}: stopped (${mc.worker(workerId).state})`);
      return false;
    }
    mc.report(workerId, { ...(('usage' in out && out.usage) ? { usage: out.usage } : {}), ...(out.receipts.length ? { receiptId: out.receipts[0]!.receiptId } : {}), ...(out.error ? { error: out.error } : {}) });
    if (mc.worker(workerId).state !== 'running') {
      failures.push(`${a.taskId}: stopped by budget`);
      return false;
    }
    mc.act(workerId, out.ok ? 'COMPLETE' : 'FAIL', out.ok ? {} : { reason: out.error ?? 'task failed' });
    if (!out.ok) failures.push(`${a.taskId}: ${out.error ?? 'failed'}`);
    return out.ok;
  };

  // 1. Writers by dispatch group, each in its own worktree.
  const writers = plan.assignments.filter((a) => WRITER_ROLES.has(a.role) && !blockedTasks.has(a.taskId));
  const groups = [...new Set(writers.map((a) => a.group))].sort((x, y) => x - y);
  const branches: { taskId: string; branch: string }[] = [];
  for (const g of groups) {
    const inGroup = writers.filter((a) => a.group === g);
    const results = await Promise.all(inGroup.map(async (a) => {
      const lease = await pool.acquire(a.taskId);
      const ok = await runAssignment(a, lease.worktree.rootPath);
      if (ok && (await gitCommitAll(lease.worktree.rootPath, `fury(${input.runId}): ${a.taskId}`))) branches.push({ taskId: a.taskId, branch: lease.worktree.branch! });
      return ok;
    }));
    if (results.some((ok) => !ok)) break;
  }

  // 2. Integrate in plan order.
  let integration: FuryIntegrationResult | undefined;
  const ordered = ir.order.flatMap((id) => branches.filter((b) => b.taskId === id));
  if (failures.length === 0 && ordered.length > 0) {
    integration = await integrateFuryBranches({ repoRoot: input.repoRoot, baseSha: input.baseSha, runId: input.runId, integrationRoot: input.integrationRoot, steps: ordered, ledger, ...(input.verify ? { verify: input.verify } : {}) });
    receipts.push(...integration.steps.flatMap((s) => s.receipts));
    if (integration.status !== 'INTEGRATED') failures.push(`integration ${integration.status}`);
  }

  // 3. Readers on the integrated result (or the base when nothing was written).
  if (failures.length === 0) {
    const readers = plan.assignments.filter((a) => !WRITER_ROLES.has(a.role) && !HOST_ROLES.has(a.role) && a.role !== 'planner' && !blockedTasks.has(a.taskId));
    const readRoot = integration?.worktree ?? input.repoRoot;
    for (const a of readers) {
      if (!(await runAssignment(a, readRoot))) break;
    }
  }
  for (const lease of pool.active()) await pool.release(lease.taskId).catch(() => undefined);

  // 4. Judge: contract predicates + tests around the actual blast radius.
  const requirements = [...furyIrRequirements(ir)];
  const changed = integration ? await changedSince(integration.worktree, input.baseSha) : [];
  if (input.graph && changed.length) {
    const planned = ir.tasks.flatMap((t) => t.writeScopes).map((s) => s.replace(/\/?\*+$/u, ''));
    const delta = furyImpactDelta(input.graph, { plannedFiles: changed.filter((f) => planned.some((p) => f === p || f.startsWith(`${p}/`))), actualChangedFiles: changed, executedTests: receipts.filter((r) => r.kind === 'TEST_RECEIPT' && r.outcome === 'pass').map((r) => r.subject.replace(/^test:/u, '')) });
    requirements.push(...furyImpactRequirements(delta));
  }
  const judgement = ledger.judge({ requirements, receipts });
  const bundle = sealFuryProofBundle({
    taskId: input.runId, judgement, receipts, commandsExecuted: commands, filesModified: changed,
    uncertainty: [...failures, ...(pendingGates.length ? [`awaiting human gates: ${pendingGates.join(', ')}`] : [])],
    outputDigest: createHash('sha256').update(integration?.headSha ?? input.baseSha).digest('hex'),
  });
  const status = failures.length ? 'FAILED' : pendingGates.length ? 'AWAITING_APPROVAL' : 'COMPLETED';
  return Object.freeze({ status, judgement, bundle, ...(integration ? { integration } : {}), replay: mc.replay(), pendingGates: Object.freeze(pendingGates) });
}

function changedSince(cwd: string, base: string): Promise<string[]> {
  return new Promise((resolve) => execFile('git', ['diff', '--name-only', `${base}..HEAD`], { cwd, shell: false, windowsHide: true }, (e, out) => resolve(e ? [] : String(out).split('\n').map((l) => l.trim()).filter(Boolean).sort())));
}
