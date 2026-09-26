// FuryDispatcher — decides whether and how to spread a FuryIR task across
// runtimes (harness × provider × model).
//
// The dispatcher is pure and deterministic for a given (IR, candidates, mode)
// input: it produces a plan, it does not execute. Invariants:
//   - AUTO may conclude DISPATCH_BENEFIT = LOW and fall back to one agent;
//   - a child assignment never receives more authority than the IR grants
//     (DENY stays DENY, ASK never becomes ALLOW);
//   - LOCAL_ONLY / privacy "local-only" never selects a cloud binding;
//   - two tasks with overlapping write scopes are never scheduled in the
//     same parallel group, and every writer gets its own worktree;
//   - independent review runs on a different harness when one is available;
//   - the agent count and estimated cost stay within the IR budget, or the
//     plan is returned BLOCKED with the reason.
import type { FuryCapability, FuryCapabilityDecision, FuryIrDocument, FuryIrTask, FuryTaskRole } from './fury-ir.js';
import { FURY_CAPABILITIES } from './fury-ir.js';

export const FURY_DISPATCH_PLAN_FORMAT = 'furypipe-dispatch-plan/v1' as const;

export const FURY_DISPATCH_MODES = Object.freeze([
  'OFF', 'SINGLE', 'AUTO', 'MANUAL', 'PIPELINE', 'PARALLEL', 'COUNCIL', 'RACE',
  'REVIEW_CHAIN', 'SPECIALISTS', 'LOCAL_CLOUD_HYBRID', 'LOCAL_ONLY', 'CUSTOM_GRAPH',
] as const);
export type FuryDispatchMode = (typeof FURY_DISPATCH_MODES)[number];

export type FurySkill = 'coding' | 'reasoning' | 'review' | 'browser' | 'docs' | 'research' | 'security';

export interface FuryRuntimeBinding {
  readonly id: string;
  readonly harnessId: string;
  readonly provider: string;
  readonly model: string;
  readonly locality: 'local' | 'cloud';
  readonly available: boolean;
  /** 0..1 per skill, from FuryBench / routing history; missing = unknown (0). */
  readonly scores: Readonly<Partial<Record<FurySkill, number>>>;
  readonly estimatedCostUsdPerTask: number;
  /** Measured median latency per task run, when known (FuryBench / history). */
  readonly latencyMsP50?: number;
}

/** Budget governance profiles (master §28). */
export const FURY_BUDGET_PROFILES = Object.freeze(['FAST', 'BALANCED', 'QUALITY', 'BUDGET', 'LOCAL_FIRST', 'PRIVATE', 'CUSTOM'] as const);
export type FuryBudgetProfile = (typeof FURY_BUDGET_PROFILES)[number];

export interface FuryRankingWeights {
  /** Weight of the skill score (0..1 per binding). */
  readonly quality: number;
  /** Penalty per USD of estimated cost, normalised by the most expensive candidate. */
  readonly cost: number;
  /** Penalty per unit of normalised latency (unknown latency counts as the worst). */
  readonly latency: number;
  /** Bonus for local bindings. */
  readonly local: number;
}

const PROFILE_WEIGHTS: Readonly<Record<Exclude<FuryBudgetProfile, 'CUSTOM'>, FuryRankingWeights>> = Object.freeze({
  QUALITY: { quality: 1, cost: 0, latency: 0, local: 0 },
  BALANCED: { quality: 1, cost: 0.5, latency: 0.25, local: 0 },
  BUDGET: { quality: 0.25, cost: 1, latency: 0, local: 0 },
  FAST: { quality: 0.25, cost: 0, latency: 1, local: 0 },
  LOCAL_FIRST: { quality: 0.5, cost: 0, latency: 0, local: 1 },
  PRIVATE: { quality: 1, cost: 0, latency: 0, local: 0 },
});

export interface FuryDispatchAssignment {
  readonly taskId: string;
  readonly role: FuryTaskRole;
  readonly bindingIds: readonly string[];
  readonly group: number;
  readonly authority: Readonly<Record<FuryCapability, FuryCapabilityDecision>>;
  readonly worktree: 'dedicated' | 'none';
  readonly selection: 'single' | 'council' | 'race';
}

export interface FuryDispatchPlan {
  readonly format: typeof FURY_DISPATCH_PLAN_FORMAT;
  readonly irDigest: string;
  readonly requestedMode: FuryDispatchMode;
  readonly profile: FuryBudgetProfile;
  readonly mode: FuryDispatchMode;
  readonly status: 'PLANNED' | 'BLOCKED' | 'NO_DISPATCH';
  readonly dispatchBenefit: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly reasons: readonly string[];
  readonly assignments: readonly FuryDispatchAssignment[];
  readonly groups: number;
  readonly agents: number;
  readonly estimatedCostUsd: number;
}

export class FuryDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryDispatchError';
  }
}

const ROLE_SKILL: Readonly<Record<FuryTaskRole, FurySkill>> = Object.freeze({
  planner: 'reasoning', architect: 'reasoning', implementer: 'coding', reviewer: 'review',
  security: 'security', tester: 'coding', browser: 'browser', documenter: 'docs',
  researcher: 'research', integrator: 'coding', judge: 'review',
});

// Roles cheap and low-risk enough to prefer a local model in LOCAL_CLOUD_HYBRID.
const HYBRID_LOCAL_ROLES: ReadonlySet<FuryTaskRole> = new Set(['documenter', 'researcher', 'tester']);

function score(binding: FuryRuntimeBinding, skill: FurySkill): number {
  const value = binding.scores[skill];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function rank(bindings: readonly FuryRuntimeBinding[], skill: FurySkill, w: FuryRankingWeights): FuryRuntimeBinding[] {
  const maxCost = Math.max(1e-9, ...bindings.map((b) => b.estimatedCostUsdPerTask));
  const known = bindings.map((b) => b.latencyMsP50).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const maxLatency = Math.max(1e-9, ...known);
  const value = (b: FuryRuntimeBinding) => {
    const latency = typeof b.latencyMsP50 === 'number' && Number.isFinite(b.latencyMsP50) && b.latencyMsP50 >= 0 ? b.latencyMsP50 / maxLatency : 1;
    return w.quality * score(b, skill) - w.cost * (b.estimatedCostUsdPerTask / maxCost) - w.latency * latency + w.local * (b.locality === 'local' ? 1 : 0);
  };
  return [...bindings].sort((a, b) =>
    value(b) - value(a)
    || score(b, skill) - score(a, skill)
    || a.estimatedCostUsdPerTask - b.estimatedCostUsdPerTask
    || (a.locality === b.locality ? 0 : a.locality === 'local' ? -1 : 1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const norm = (s: string) => s.replace(/\*+$/u, '').replace(/\/+$/u, '');
  return a.some((x) => b.some((y) => {
    const p = norm(x);
    const q = norm(y);
    return p === '' || q === '' || p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`);
  }));
}

/** Assign DAG levels, then split any level whose writers overlap. */
export type FuryScopeCoupling = (scopeA: readonly string[], scopeB: readonly string[]) => number;

function groupTasks(ir: FuryIrDocument, sequential: boolean, coupled?: (a: readonly string[], b: readonly string[]) => boolean): Map<string, number> {
  const byId = new Map(ir.tasks.map((t) => [t.id, t]));
  const group = new Map<string, number>();
  if (sequential) {
    ir.order.forEach((taskId, index) => group.set(taskId, index));
    return group;
  }
  for (const taskId of ir.order) {
    const task = byId.get(taskId)!;
    let level = task.dependsOn.reduce((max, dep) => Math.max(max, group.get(dep)! + 1), 0);
    // Push later while an already-placed writer in that group overlaps.
    for (;;) {
      const clash = [...group].some(([other, g]) => {
        if (g !== level) return false;
        const a = byId.get(other)!.writeScopes;
        if (a.length === 0 || task.writeScopes.length === 0) return false;
        return overlaps(a, task.writeScopes) || (coupled?.(a, task.writeScopes) ?? false);
      });
      if (!clash) break;
      level += 1;
    }
    group.set(taskId, level);
  }
  return group;
}

function childAuthority(ir: FuryIrDocument, task: FuryIrTask): Record<FuryCapability, FuryCapabilityDecision> {
  const out = {} as Record<FuryCapability, FuryCapabilityDecision>;
  for (const cap of FURY_CAPABILITIES) {
    const parent = ir.capabilities[cap];
    // A task only receives capabilities it declared, never above the parent.
    out[cap] = task.capabilities.includes(cap) ? parent : 'DENY';
  }
  return out;
}

/** Enforce child ≤ parent on an externally supplied assignment authority. */
export function assertFuryAuthorityWithin(
  parent: Readonly<Record<FuryCapability, FuryCapabilityDecision>>,
  child: Readonly<Record<FuryCapability, FuryCapabilityDecision>>,
): void {
  const rankOf = (d: FuryCapabilityDecision) => (d === 'DENY' ? 0 : d === 'ASK' ? 1 : 2);
  for (const cap of FURY_CAPABILITIES) {
    if (rankOf(child[cap]) > rankOf(parent[cap])) throw new FuryDispatchError(`child authority escalates ${cap} from ${parent[cap]} to ${child[cap]}`);
  }
}

export function planFuryDispatch(input: {
  readonly ir: FuryIrDocument;
  readonly candidates: readonly FuryRuntimeBinding[];
  readonly mode: FuryDispatchMode;
  /** MANUAL / CUSTOM_GRAPH: task id or role → binding id. */
  readonly manual?: Readonly<Record<string, string>>;
  /** COUNCIL / RACE width (default 2, max 4). */
  readonly width?: number;
  /** Graph-aware dispatch: dependency edges between two write scopes (e.g. furyScopeCoupling). */
  readonly coupling?: FuryScopeCoupling;
  /** Writers whose scopes share at least this many edges never run in parallel (default 1). */
  readonly couplingThreshold?: number;
  /** Budget governance profile (default QUALITY). PRIVATE implies local-only. */
  readonly profile?: FuryBudgetProfile;
  /** Required with profile CUSTOM. */
  readonly weights?: FuryRankingWeights;
}): FuryDispatchPlan {
  const { ir } = input;
  if (!(FURY_DISPATCH_MODES as readonly string[]).includes(input.mode)) throw new FuryDispatchError('dispatch mode is unsupported');
  if (!Array.isArray(input.candidates) || input.candidates.length > 256) throw new FuryDispatchError('candidates must be an array of at most 256 bindings');
  const ids = new Set<string>();
  for (const c of input.candidates) {
    if (ids.has(c.id)) throw new FuryDispatchError(`duplicate binding id ${c.id}`);
    ids.add(c.id);
    if (c.locality !== 'local' && c.locality !== 'cloud') throw new FuryDispatchError(`binding ${c.id} has an invalid locality`);
    if (!Number.isFinite(c.estimatedCostUsdPerTask) || c.estimatedCostUsdPerTask < 0) throw new FuryDispatchError(`binding ${c.id} has an invalid cost estimate`);
  }
  const reasons: string[] = [];
  const profile = input.profile ?? 'QUALITY';
  if (!(FURY_BUDGET_PROFILES as readonly string[]).includes(profile)) throw new FuryDispatchError('budget profile is unsupported');
  if (profile === 'CUSTOM') {
    const w = input.weights;
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10;
    if (!w || !ok(w.quality) || !ok(w.cost) || !ok(w.latency) || !ok(w.local)) throw new FuryDispatchError('CUSTOM profile requires weights quality, cost, latency, local in 0..10');
  }
  const weights: FuryRankingWeights = profile === 'CUSTOM'
    ? Object.freeze({ quality: input.weights!.quality, cost: input.weights!.cost, latency: input.weights!.latency, local: input.weights!.local })
    : PROFILE_WEIGHTS[profile];
  const localOnly = input.mode === 'LOCAL_ONLY' || ir.privacy === 'local-only' || profile === 'PRIVATE';
  let pool = input.candidates.filter((c) => c.available);
  if (localOnly) {
    const before = pool.length;
    pool = pool.filter((c) => c.locality === 'local');
    if (before !== pool.length) reasons.push(profile === 'PRIVATE' ? 'PRIVATE profile: cloud bindings excluded' : 'privacy boundary: cloud bindings excluded');
  }
  const base = {
    format: FURY_DISPATCH_PLAN_FORMAT,
    irDigest: ir.digest,
    requestedMode: input.mode,
    profile,
  } as const;
  const blocked = (reason: string): FuryDispatchPlan => Object.freeze({
    ...base, mode: input.mode, status: 'BLOCKED', dispatchBenefit: 'LOW',
    reasons: Object.freeze([...reasons, reason]), assignments: Object.freeze([]), groups: 0, agents: 0, estimatedCostUsd: 0,
  });

  if (input.mode === 'OFF') {
    return Object.freeze({ ...base, mode: 'OFF', status: 'NO_DISPATCH', dispatchBenefit: 'LOW', reasons: Object.freeze(['dispatch disabled by operator']), assignments: Object.freeze([]), groups: 0, agents: 0, estimatedCostUsd: 0 });
  }
  if (pool.length === 0) return blocked(localOnly ? 'no available local binding satisfies the privacy boundary' : 'no available runtime binding');

  const threshold = Math.max(1, Math.floor(input.couplingThreshold ?? 1));
  const coupledReasons = new Set<string>();
  const coupled = input.coupling
    ? (a: readonly string[], b: readonly string[]) => {
        const edges = input.coupling!(a, b);
        if (edges >= threshold) coupledReasons.add(`graph coupling ${edges} edge(s) between ${a.join(',')} and ${b.join(',')}: writers serialized`);
        return edges >= threshold;
      }
    : undefined;
  // Dispatch benefit: parallelisable width and role diversity.
  const levels = groupTasks(ir, false, coupled);
  const widest = Math.max(...[...levels.values()].reduce((m, g) => m.set(g, (m.get(g) ?? 0) + 1), new Map<number, number>()).values());
  const roles = new Set(ir.tasks.map((t) => ROLE_SKILL[t.role]));
  const benefit: FuryDispatchPlan['dispatchBenefit'] = ir.tasks.length <= 1 || (widest <= 1 && roles.size <= 1)
    ? 'LOW'
    : widest >= 3 || roles.size >= 3 ? 'HIGH' : 'MEDIUM';

  let mode: FuryDispatchMode = input.mode;
  if (mode === 'AUTO') {
    if (benefit === 'LOW' || pool.length === 1) {
      mode = 'SINGLE';
      reasons.push(benefit === 'LOW' ? 'DISPATCH_BENEFIT=LOW: one agent is enough' : 'only one runtime available');
    } else {
      mode = 'SPECIALISTS';
      reasons.push(`DISPATCH_BENEFIT=${benefit}: ${widest} parallel task(s), ${roles.size} skill class(es)`);
    }
  }
  if (mode === 'LOCAL_ONLY') mode = 'SPECIALISTS';

  const sequential = mode === 'SINGLE' || mode === 'PIPELINE';
  const groups = groupTasks(ir, sequential, coupled);
  reasons.push(...[...coupledReasons].sort());
  const width = Math.min(Math.max(input.width ?? 2, 2), 4);
  const singleBest = rank(pool, 'coding', weights)[0]!;

  const pick = (task: FuryIrTask, implementerHarness?: string): string[] => {
    const skill = ROLE_SKILL[task.role];
    switch (mode) {
      case 'SINGLE':
      case 'PIPELINE':
        return [singleBest.id];
      case 'MANUAL':
      case 'CUSTOM_GRAPH': {
        const chosen = input.manual?.[task.id] ?? input.manual?.[task.role];
        if (!chosen) throw new FuryDispatchError(`manual dispatch has no binding for task ${task.id}`);
        const binding = pool.find((c) => c.id === chosen);
        if (!binding) throw new FuryDispatchError(`manual binding ${chosen} is unavailable or outside the privacy boundary`);
        return [binding.id];
      }
      case 'COUNCIL':
      case 'RACE':
        return rank(pool, skill, weights).slice(0, width).map((c) => c.id);
      case 'LOCAL_CLOUD_HYBRID': {
        const local = pool.filter((c) => c.locality === 'local');
        const cloud = pool.filter((c) => c.locality === 'cloud');
        const side = HYBRID_LOCAL_ROLES.has(task.role) ? (local.length ? local : cloud) : (cloud.length ? cloud : local);
        return [rank(side, skill, weights)[0]!.id];
      }
      case 'REVIEW_CHAIN':
      case 'SPECIALISTS':
      case 'PARALLEL':
      default: {
        let ranked = rank(pool, skill, weights);
        if ((task.role === 'reviewer' || task.role === 'security' || task.role === 'judge') && implementerHarness) {
          const independent = ranked.filter((c) => c.harnessId !== implementerHarness);
          if (independent.length > 0) ranked = independent;
          else reasons.push(`no independent harness for ${task.id}; review runs on the implementer harness`);
        }
        return [ranked[0]!.id];
      }
    }
  };

  const assignments: FuryDispatchAssignment[] = [];
  let implementerHarness: string | undefined;
  for (const taskId of ir.order) {
    const task = ir.tasks.find((t) => t.id === taskId)!;
    const bindingIds = pick(task, implementerHarness);
    if (task.role === 'implementer' && implementerHarness === undefined) {
      implementerHarness = pool.find((c) => c.id === bindingIds[0])!.harnessId;
    }
    const authority = childAuthority(ir, task);
    assertFuryAuthorityWithin(ir.capabilities, authority);
    assignments.push(Object.freeze({
      taskId,
      role: task.role,
      bindingIds: Object.freeze(bindingIds),
      group: groups.get(taskId)!,
      authority: Object.freeze(authority),
      worktree: task.writeScopes.length > 0 ? 'dedicated' as const : 'none' as const,
      selection: mode === 'COUNCIL' ? 'council' as const : mode === 'RACE' ? 'race' as const : 'single' as const,
    }));
  }

  // Concurrency = largest group's total bindings (SINGLE/PIPELINE reuse one agent).
  const perGroup = new Map<number, number>();
  for (const a of assignments) perGroup.set(a.group, (perGroup.get(a.group) ?? 0) + a.bindingIds.length);
  const agents = sequential ? 1 : Math.max(...perGroup.values());
  const estimatedCostUsd = Math.round(assignments.reduce((sum, a) => sum + a.bindingIds.reduce((s, id) => s + pool.find((c) => c.id === id)!.estimatedCostUsdPerTask, 0), 0) * 10_000) / 10_000;
  if (agents > ir.budget.maxAgents) return blocked(`plan needs ${agents} concurrent agents; budget allows ${ir.budget.maxAgents}`);
  if (estimatedCostUsd > ir.budget.maxCostUsd) return blocked(`estimated cost ${estimatedCostUsd} USD exceeds budget ${ir.budget.maxCostUsd} USD`);
  const cloudCalls = assignments.reduce((n, a) => n + a.bindingIds.filter((id) => pool.find((c) => c.id === id)!.locality === 'cloud').length, 0);
  if (cloudCalls > ir.budget.maxCloudCalls) return blocked(`plan needs ${cloudCalls} cloud task runs; budget allows ${ir.budget.maxCloudCalls}`);

  return Object.freeze({
    ...base,
    mode,
    status: 'PLANNED',
    dispatchBenefit: benefit,
    reasons: Object.freeze(reasons),
    assignments: Object.freeze(assignments),
    groups: new Set(assignments.map((a) => a.group)).size,
    agents,
    estimatedCostUsd,
  });
}
