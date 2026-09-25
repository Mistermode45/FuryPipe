// FuryMissionControl + FuryReplay.
//
// Mission Control holds the live state of every worker of a dispatched task
// and only allows legal transitions. Every accepted command and observation
// is appended to a FuryReplay log whose entries are SHA-256 hash-chained, so
// a tampered, reordered or truncated-in-the-middle log fails verification.
// Budgets from the FuryIR contract are enforced on the aggregate: when the
// task exceeds one, running workers are stopped and the reason is logged.
// Forking a replay copies the log up to a sequence number and records exactly
// one changed axis (model, runtime, provider, skill or routing policy).
import { createHash } from 'node:crypto';

import type { FuryIrDocument } from './fury-ir.js';
import type { FuryDispatchPlan } from './fury-dispatcher.js';

export const FURY_REPLAY_FORMAT = 'furypipe-replay/v1' as const;

export type FuryWorkerState = 'queued' | 'running' | 'paused' | 'awaiting-approval' | 'completed' | 'failed' | 'stopped' | 'handed-off';
export type FuryMissionAction =
  | 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'REDIRECT' | 'RETRY' | 'CHANGE_MODEL' | 'HANDOFF'
  | 'REQUEST_APPROVAL' | 'APPROVE' | 'DENY' | 'COMPLETE' | 'FAIL';

export interface FuryWorkerBinding {
  readonly bindingId: string;
  readonly harnessId: string;
  readonly provider: string;
  readonly model: string;
  readonly locality: 'local' | 'cloud';
}

export interface FuryWorkerUsage {
  readonly tokens: number;
  readonly costUsd: number;
  readonly wallMs: number;
  readonly toolCalls: number;
  readonly cloudCalls: number;
}

export interface FuryWorker {
  readonly workerId: string;
  readonly taskId: string;
  readonly role: string;
  readonly binding: FuryWorkerBinding;
  readonly state: FuryWorkerState;
  readonly progress: number;
  readonly worktree: 'dedicated' | 'none';
  readonly files: readonly string[];
  readonly tools: readonly string[];
  readonly skills: readonly string[];
  readonly mcp: readonly string[];
  readonly usage: FuryWorkerUsage;
  readonly retries: number;
  readonly tests: { readonly passed: number; readonly failed: number };
  readonly errors: readonly string[];
  readonly receiptIds: readonly string[];
}

export interface FuryReplayEntry {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly workerId?: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}

export interface FuryReplayLog {
  readonly format: typeof FURY_REPLAY_FORMAT;
  readonly replayId: string;
  readonly irDigest: string;
  readonly parent?: { readonly replayId: string; readonly atSeq: number };
  readonly entries: readonly FuryReplayEntry[];
}

export type FuryForkAxis = 'model' | 'runtime' | 'provider' | 'skill' | 'routing';

export class FuryMissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryMissionError';
  }
}

const GENESIS = '0'.repeat(64);
const TERMINAL: ReadonlySet<FuryWorkerState> = new Set(['completed', 'failed', 'stopped', 'handed-off']);

const TRANSITIONS: Readonly<Record<FuryMissionAction, { readonly from: readonly FuryWorkerState[]; readonly to: FuryWorkerState | null }>> = Object.freeze({
  START: { from: ['queued'], to: 'running' },
  PAUSE: { from: ['running'], to: 'paused' },
  RESUME: { from: ['paused'], to: 'running' },
  STOP: { from: ['queued', 'running', 'paused', 'awaiting-approval'], to: 'stopped' },
  REDIRECT: { from: ['running', 'paused'], to: null },
  RETRY: { from: ['failed', 'stopped'], to: 'queued' },
  CHANGE_MODEL: { from: ['queued', 'paused', 'failed', 'stopped'], to: null },
  HANDOFF: { from: ['running', 'paused', 'failed'], to: 'handed-off' },
  REQUEST_APPROVAL: { from: ['running'], to: 'awaiting-approval' },
  APPROVE: { from: ['awaiting-approval'], to: 'running' },
  DENY: { from: ['awaiting-approval'], to: 'failed' },
  COMPLETE: { from: ['running'], to: 'completed' },
  FAIL: { from: ['running', 'awaiting-approval'], to: 'failed' },
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function entryHash(e: Omit<FuryReplayEntry, 'hash'>): string {
  return createHash('sha256').update(canonical({ seq: e.seq, at: e.at, type: e.type, workerId: e.workerId ?? null, data: e.data, prevHash: e.prevHash })).digest('hex');
}

/** Verify a replay log's hash chain and sequence. */
export function verifyFuryReplay(log: FuryReplayLog): { readonly ok: boolean; readonly brokenAt?: number } {
  let prev = GENESIS;
  for (let i = 0; i < log.entries.length; i += 1) {
    const e = log.entries[i]!;
    if (e.seq !== i + 1 || e.prevHash !== prev || entryHash(e) !== e.hash) return { ok: false, brokenAt: i + 1 };
    prev = e.hash;
  }
  return { ok: true };
}

const ZERO_USAGE: FuryWorkerUsage = Object.freeze({ tokens: 0, costUsd: 0, wallMs: 0, toolCalls: 0, cloudCalls: 0 });

export interface FuryMissionControl {
  readonly replayId: string;
  workers(): readonly FuryWorker[];
  worker(workerId: string): FuryWorker;
  act(workerId: string, action: FuryMissionAction, data?: Readonly<Record<string, unknown>>): FuryWorker;
  report(workerId: string, observation: {
    readonly progress?: number;
    readonly usage?: Partial<FuryWorkerUsage>;
    readonly files?: readonly string[];
    readonly tools?: readonly string[];
    readonly skills?: readonly string[];
    readonly mcp?: readonly string[];
    readonly tests?: { readonly passed: number; readonly failed: number };
    readonly error?: string;
    readonly receiptId?: string;
  }): FuryWorker;
  totals(): FuryWorkerUsage & { readonly running: number; readonly workers: number };
  replay(): FuryReplayLog;
  timeline(filter?: { readonly workerId?: string; readonly type?: string }): readonly FuryReplayEntry[];
}

export function createFuryMissionControl(input: {
  readonly ir: FuryIrDocument;
  readonly plan: FuryDispatchPlan;
  readonly bindings: readonly FuryWorkerBinding[];
  readonly replayId: string;
  readonly now?: () => number;
  /** Validate a CHANGE_MODEL / HANDOFF target against privacy and availability. */
  readonly validateBinding?: (binding: FuryWorkerBinding) => void;
}): FuryMissionControl {
  const { ir, plan } = input;
  if (plan.irDigest !== ir.digest) throw new FuryMissionError('dispatch plan does not belong to this contract');
  if (plan.status !== 'PLANNED') throw new FuryMissionError('only a PLANNED dispatch can be run');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.replayId)) throw new FuryMissionError('replayId is invalid');
  const now = input.now ?? Date.now;
  const byId = new Map(input.bindings.map((b) => [b.bindingId, b]));
  const privacyCheck = (b: FuryWorkerBinding) => {
    if ((ir.privacy === 'local-only' || plan.profile === 'PRIVATE') && b.locality !== 'local') throw new FuryMissionError(`binding ${b.bindingId} violates the local-only privacy boundary`);
    input.validateBinding?.(b);
  };

  const entries: FuryReplayEntry[] = [];
  const append = (type: string, data: Readonly<Record<string, unknown>>, workerId?: string) => {
    const base = { seq: entries.length + 1, at: now(), type, ...(workerId ? { workerId } : {}), data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, prevHash: entries.at(-1)?.hash ?? GENESIS };
    entries.push(Object.freeze({ ...base, hash: entryHash(base) }));
  };

  const workers = new Map<string, FuryWorker>();
  append('TASK', { irDigest: ir.digest, intent: ir.intent, must: ir.must, mustNot: ir.mustNot, predicates: ir.successPredicates.map((p) => p.id), budget: ir.budget });
  append('DISPATCH', { mode: plan.mode, requestedMode: plan.requestedMode, profile: plan.profile, benefit: plan.dispatchBenefit, reasons: plan.reasons, agents: plan.agents });
  for (const a of plan.assignments) {
    for (const [i, bindingId] of a.bindingIds.entries()) {
      const binding = byId.get(bindingId);
      if (!binding) throw new FuryMissionError(`binding ${bindingId} is unknown`);
      privacyCheck(binding);
      const workerId = a.bindingIds.length > 1 ? `${a.taskId}#${i + 1}` : a.taskId;
      workers.set(workerId, Object.freeze({
        workerId, taskId: a.taskId, role: a.role, binding, state: 'queued', progress: 0, worktree: a.worktree,
        files: [], tools: [], skills: [], mcp: [], usage: ZERO_USAGE, retries: 0, tests: { passed: 0, failed: 0 }, errors: [], receiptIds: [],
      }));
      append('ROUTING', { taskId: a.taskId, bindingId, harnessId: binding.harnessId, provider: binding.provider, model: binding.model, locality: binding.locality, group: a.group, authority: a.authority }, workerId);
    }
  }

  const get = (workerId: string) => {
    const w = workers.get(workerId);
    if (!w) throw new FuryMissionError(`worker ${workerId} is unknown`);
    return w;
  };
  const set = (w: FuryWorker) => {
    workers.set(w.workerId, Object.freeze(w));
    return workers.get(w.workerId)!;
  };
  const totals = () => {
    const all = [...workers.values()];
    const sum = (k: keyof FuryWorkerUsage) => all.reduce((n, w) => n + w.usage[k], 0);
    return Object.freeze({
      tokens: sum('tokens'), costUsd: Math.round(sum('costUsd') * 1e6) / 1e6, wallMs: sum('wallMs'), toolCalls: sum('toolCalls'), cloudCalls: sum('cloudCalls'),
      running: all.filter((w) => w.state === 'running').length, workers: all.length,
    });
  };
  const enforceBudget = () => {
    const t = totals();
    const exceeded = [
      t.tokens > ir.budget.maxTokens && 'maxTokens',
      t.costUsd > ir.budget.maxCostUsd && 'maxCostUsd',
      t.toolCalls > ir.budget.maxToolCalls && 'maxToolCalls',
      t.cloudCalls > ir.budget.maxCloudCalls && 'maxCloudCalls',
    ].filter(Boolean) as string[];
    if (exceeded.length === 0) return;
    for (const w of workers.values()) {
      if (!TERMINAL.has(w.state)) {
        set({ ...w, state: 'stopped', errors: [...w.errors, `budget exceeded: ${exceeded.join(', ')}`] });
        append('BUDGET_STOP', { exceeded }, w.workerId);
      }
    }
  };

  const api: FuryMissionControl = {
    replayId: input.replayId,
    workers: () => Object.freeze([...workers.values()]),
    worker: get,
    act(workerId, action, data = {}) {
      const w = get(workerId);
      const rule = TRANSITIONS[action];
      if (!rule) throw new FuryMissionError(`unknown action ${String(action)}`);
      if (!rule.from.includes(w.state)) throw new FuryMissionError(`${action} is not allowed from ${w.state}`);
      let next: FuryWorker = rule.to ? { ...w, state: rule.to } : { ...w };
      const logData: Record<string, unknown> = { from: w.state, to: next.state };
      if (action === 'START') {
        const running = [...workers.values()].filter((x) => x.state === 'running').length;
        if (running >= ir.budget.maxAgents) throw new FuryMissionError(`START would exceed maxAgents ${ir.budget.maxAgents}`);
      }
      if (action === 'RESUME' || action === 'APPROVE') {
        const running = [...workers.values()].filter((x) => x.state === 'running').length;
        if (running >= ir.budget.maxAgents) throw new FuryMissionError(`${action} would exceed maxAgents ${ir.budget.maxAgents}`);
      }
      if (action === 'RETRY') {
        if (w.retries >= ir.budget.maxRetries) throw new FuryMissionError(`retry budget ${ir.budget.maxRetries} exhausted`);
        next = { ...next, retries: w.retries + 1, progress: 0 };
      }
      if (action === 'REDIRECT') {
        const instruction = data.instruction;
        if (typeof instruction !== 'string' || instruction.trim().length === 0 || instruction.length > 4_096) throw new FuryMissionError('REDIRECT needs a bounded instruction');
        logData.instruction = instruction;
      }
      if (action === 'DENY' || action === 'FAIL' || action === 'STOP') {
        const reason = typeof data.reason === 'string' ? data.reason.slice(0, 512) : action.toLowerCase();
        logData.reason = reason;
        if (action !== 'STOP') next = { ...next, errors: [...w.errors, reason] };
      }
      if (action === 'CHANGE_MODEL' || action === 'HANDOFF') {
        const target = byId.get(String(data.bindingId));
        if (!target) throw new FuryMissionError(`${action} target binding is unknown`);
        privacyCheck(target);
        logData.fromBinding = w.binding.bindingId;
        logData.toBinding = target.bindingId;
        if (action === 'CHANGE_MODEL') next = { ...next, binding: target };
        else {
          const newId = `${w.taskId}@${target.bindingId}`.slice(0, 200);
          if (workers.has(newId)) throw new FuryMissionError('handoff target worker already exists');
          set({ ...w, workerId: newId, binding: target, state: 'queued', progress: w.progress, errors: [], retries: 0, usage: ZERO_USAGE, receiptIds: [] });
          append('HANDOFF_RECEIVED', { fromWorker: w.workerId, capsule: { files: w.files, receiptIds: w.receiptIds, progress: w.progress } }, newId);
        }
      }
      const saved = set(next);
      append(`ACTION:${action}`, logData, workerId);
      return saved;
    },
    report(workerId, o) {
      const w = get(workerId);
      if (w.state !== 'running' && w.state !== 'awaiting-approval') throw new FuryMissionError(`cannot report on a ${w.state} worker`);
      const bound = (list: readonly string[] | undefined, prev: readonly string[]) => (list ? [...new Set([...prev, ...list.map((x) => String(x).slice(0, 512))])].slice(0, 2_000) : prev);
      const add = (k: keyof FuryWorkerUsage) => {
        const v = o.usage?.[k];
        if (v === undefined) return w.usage[k];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new FuryMissionError(`usage.${k} must be a non-negative number`);
        return w.usage[k] + v;
      };
      if (o.progress !== undefined && (typeof o.progress !== 'number' || o.progress < 0 || o.progress > 1)) throw new FuryMissionError('progress must be 0..1');
      const next = set({
        ...w,
        progress: o.progress ?? w.progress,
        usage: { tokens: add('tokens'), costUsd: add('costUsd'), wallMs: add('wallMs'), toolCalls: add('toolCalls'), cloudCalls: add('cloudCalls') },
        files: bound(o.files, w.files), tools: bound(o.tools, w.tools), skills: bound(o.skills, w.skills), mcp: bound(o.mcp, w.mcp),
        tests: o.tests ? { passed: w.tests.passed + Math.max(0, Math.floor(o.tests.passed)), failed: w.tests.failed + Math.max(0, Math.floor(o.tests.failed)) } : w.tests,
        errors: o.error ? [...w.errors, o.error.slice(0, 512)] : w.errors,
        receiptIds: o.receiptId ? [...w.receiptIds, o.receiptId.slice(0, 128)] : w.receiptIds,
      });
      append('OBSERVATION', { ...o }, workerId);
      enforceBudget();
      return workers.get(next.workerId)!;
    },
    totals,
    replay: () => Object.freeze({ format: FURY_REPLAY_FORMAT, replayId: input.replayId, irDigest: ir.digest, entries: Object.freeze([...entries]) }),
    timeline: (filter = {}) => Object.freeze(entries.filter((e) => (!filter.workerId || e.workerId === filter.workerId) && (!filter.type || e.type === filter.type || e.type.startsWith(`${filter.type}:`)))),
  };
  return Object.freeze(api);
}

/**
 * Fork a verified replay at `atSeq`, changing exactly one axis. The child
 * keeps the parent's entries up to atSeq (re-chained) plus a FORK entry, so
 * FuryReplay can compare two futures from the same checkpoint.
 */
export function forkFuryReplay(parent: FuryReplayLog, input: {
  readonly atSeq: number;
  readonly replayId: string;
  readonly axis: FuryForkAxis;
  readonly from: string;
  readonly to: string;
  readonly now?: () => number;
}): FuryReplayLog {
  const check = verifyFuryReplay(parent);
  if (!check.ok) throw new FuryMissionError(`parent replay is corrupt at entry ${check.brokenAt}`);
  if (!Number.isSafeInteger(input.atSeq) || input.atSeq < 1 || input.atSeq > parent.entries.length) throw new FuryMissionError('atSeq is outside the parent log');
  if (!['model', 'runtime', 'provider', 'skill', 'routing'].includes(input.axis)) throw new FuryMissionError('fork axis is unsupported');
  if (input.from === input.to) throw new FuryMissionError('a fork must change the axis value');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.replayId) || input.replayId === parent.replayId) throw new FuryMissionError('fork replayId is invalid');
  const kept = parent.entries.slice(0, input.atSeq);
  const base = { seq: kept.length + 1, at: (input.now ?? Date.now)(), type: 'FORK', data: { parentReplayId: parent.replayId, atSeq: input.atSeq, parentHash: kept.at(-1)!.hash, axis: input.axis, from: input.from, to: input.to }, prevHash: kept.at(-1)!.hash };
  return Object.freeze({
    format: FURY_REPLAY_FORMAT,
    replayId: input.replayId,
    irDigest: parent.irDigest,
    parent: Object.freeze({ replayId: parent.replayId, atSeq: input.atSeq }),
    entries: Object.freeze([...kept, Object.freeze({ ...base, hash: entryHash(base) })]),
  });
}

/** Answer "why" questions from a replay (master §25). */
export function explainFuryReplay(log: FuryReplayLog, workerId: string): { readonly routing?: Readonly<Record<string, unknown>>; readonly dispatchReasons: readonly string[]; readonly actions: readonly string[]; readonly failedCommands: readonly string[] } {
  const dispatch = log.entries.find((e) => e.type === 'DISPATCH');
  const routing = log.entries.find((e) => e.type === 'ROUTING' && e.workerId === workerId);
  const mine = log.entries.filter((e) => e.workerId === workerId);
  return Object.freeze({
    ...(routing ? { routing: routing.data } : {}),
    dispatchReasons: Object.freeze(Array.isArray(dispatch?.data.reasons) ? (dispatch!.data.reasons as unknown[]).map(String) : []),
    actions: Object.freeze(mine.filter((e) => e.type.startsWith('ACTION:')).map((e) => e.type.slice(7))),
    failedCommands: Object.freeze(mine.flatMap((e) => (typeof e.data.error === 'string' ? [e.data.error] : []))),
  });
}
