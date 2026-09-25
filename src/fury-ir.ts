// FuryIR — universal task representation ("LLVM for agents").
//
// A FuryIR document is the Executable Intent Contract every downstream stage
// (planner, dispatcher, harness adapters, judge) consumes. It is strict: any
// unknown key, cycle, unbounded budget or task that asks for more authority
// than the contract grants is rejected. Turning free-form human text into a
// FuryIR document is harness/model work; this module only guarantees that
// whatever is produced is well-formed, bounded and authority-consistent.
import { digestMcpDirectJson } from './mcp-direct-json.js';
import type { FuryReceiptKind, FuryRequirement } from './fury-proof.js';
import { FURY_RECEIPT_KINDS } from './fury-proof.js';

export const FURY_IR_FORMAT = 'furypipe-ir/v1' as const;

export const FURY_CAPABILITIES = Object.freeze([
  'READ',
  'WRITE',
  'EXECUTE',
  'NETWORK',
  'EXTERNAL_ACTION',
] as const);
export type FuryCapability = (typeof FURY_CAPABILITIES)[number];
export type FuryCapabilityDecision = 'ALLOW' | 'ASK' | 'DENY';
export type FuryPrivacy = 'local-only' | 'local-first' | 'cloud-allowed';
export type FuryRollbackPolicy = 'none' | 'revert-worktree' | 'manual';

export const FURY_TASK_ROLES = Object.freeze([
  'planner',
  'architect',
  'implementer',
  'reviewer',
  'security',
  'tester',
  'browser',
  'documenter',
  'researcher',
  'integrator',
  'judge',
] as const);
export type FuryTaskRole = (typeof FURY_TASK_ROLES)[number];

export interface FuryBudget {
  readonly maxCostUsd: number;
  readonly maxTokens: number;
  readonly maxWallTimeMs: number;
  readonly maxAgents: number;
  readonly maxRetries: number;
  readonly maxCloudCalls: number;
  readonly maxToolCalls: number;
}

export interface FuryEvidenceNeed {
  readonly kind: FuryReceiptKind;
  readonly subject: string;
}

export interface FurySuccessPredicate {
  readonly id: string;
  readonly level: 'MUST' | 'SHOULD';
  readonly description: string;
  readonly evidence: readonly FuryEvidenceNeed[];
}

export interface FuryIrTask {
  readonly id: string;
  readonly role: FuryTaskRole;
  readonly description: string;
  readonly dependsOn: readonly string[];
  readonly capabilities: readonly FuryCapability[];
  /** Files/areas the task may write; empty means read-only. */
  readonly writeScopes: readonly string[];
}

export interface FuryHumanGate {
  readonly id: string;
  readonly beforeTask: string;
  readonly reason: string;
}

export interface FuryIrInput {
  readonly format: typeof FURY_IR_FORMAT;
  readonly intent: string;
  readonly must: readonly string[];
  readonly mustNot: readonly string[];
  readonly capabilities: Readonly<Record<FuryCapability, FuryCapabilityDecision>>;
  readonly privacy: FuryPrivacy;
  readonly budget: FuryBudget;
  readonly successPredicates: readonly FurySuccessPredicate[];
  readonly humanGates: readonly FuryHumanGate[];
  readonly tasks: readonly FuryIrTask[];
  readonly rollbackPolicy: FuryRollbackPolicy;
  readonly deadline?: number;
}

export interface FuryIrDocument extends FuryIrInput {
  readonly digest: string;
  /** Deterministic topological order of task ids. */
  readonly order: readonly string[];
}

export class FuryIrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryIrError';
  }
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/u;
const SCOPE = /^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._@/*-]{1,256}$/u;
const MAX_TASKS = 64;
const MAX_LIST = 64;

const BUDGET_LIMITS: Readonly<Record<keyof FuryBudget, number>> = Object.freeze({
  maxCostUsd: 10_000,
  maxTokens: 100_000_000,
  maxWallTimeMs: 7 * 24 * 60 * 60 * 1000,
  maxAgents: 64,
  maxRetries: 20,
  maxCloudCalls: 100_000,
  maxToolCalls: 100_000,
});

function fail(message: string): never {
  throw new FuryIrError(message);
}

function record(value: unknown, label: string, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label} must be a plain object`);
  const own = Object.keys(value);
  for (const key of own) if (!keys.includes(key)) fail(`${label} has unknown key ${JSON.stringify(key)}`);
  for (const key of required) if (!own.includes(key)) fail(`${label} is missing ${key}`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) fail(`${label} must be non-empty text of at most ${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${label} contains control characters`);
  return value;
}

function list<T>(value: unknown, label: string, max: number, each: (item: unknown, index: number) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array of at most ${max} items`);
  return Object.freeze(value.map(each));
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} must match ${ID.source}`);
  return value;
}

function capability(value: unknown, label: string): FuryCapability {
  if (typeof value !== 'string' || !(FURY_CAPABILITIES as readonly string[]).includes(value)) fail(`${label} is not a known capability`);
  return value as FuryCapability;
}

function uniq(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
}

/** Validate, normalise and seal a FuryIR document. Throws FuryIrError on any defect. */
export function compileFuryIr(input: unknown): FuryIrDocument {
  const root = record(input, 'FuryIR', [
    'format', 'intent', 'must', 'mustNot', 'capabilities', 'privacy', 'budget',
    'successPredicates', 'humanGates', 'tasks', 'rollbackPolicy', 'deadline',
  ], [
    'format', 'intent', 'must', 'mustNot', 'capabilities', 'privacy', 'budget',
    'successPredicates', 'humanGates', 'tasks', 'rollbackPolicy',
  ]);
  if (root.format !== FURY_IR_FORMAT) fail('FuryIR format is unsupported');
  const intent = text(root.intent, 'intent', 8_192);
  const must = list(root.must, 'must', MAX_LIST, (v, i) => text(v, `must[${i}]`, 1_024));
  const mustNot = list(root.mustNot, 'mustNot', MAX_LIST, (v, i) => text(v, `mustNot[${i}]`, 1_024));

  const capsRecord = record(root.capabilities, 'capabilities', FURY_CAPABILITIES);
  const capabilities = Object.freeze(Object.fromEntries(FURY_CAPABILITIES.map((cap) => {
    const decision = capsRecord[cap];
    if (decision !== 'ALLOW' && decision !== 'ASK' && decision !== 'DENY') fail(`capabilities.${cap} must be ALLOW, ASK or DENY`);
    return [cap, decision];
  })) as Record<FuryCapability, FuryCapabilityDecision>);

  const privacy = root.privacy;
  if (privacy !== 'local-only' && privacy !== 'local-first' && privacy !== 'cloud-allowed') fail('privacy is unsupported');
  if (privacy === 'local-only' && capabilities.NETWORK === 'ALLOW') {
    // Local-only still permits loopback inference, but ambient network must
    // at least require a human decision.
    fail('privacy local-only cannot ALLOW ambient NETWORK; use ASK or DENY');
  }

  const budgetRecord = record(root.budget, 'budget', Object.keys(BUDGET_LIMITS));
  const budget = Object.freeze(Object.fromEntries(Object.entries(BUDGET_LIMITS).map(([key, max]) => {
    const value = budgetRecord[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(`budget.${key} must be a finite number between 0 and ${max}`);
    if (key !== 'maxCostUsd' && !Number.isSafeInteger(value)) fail(`budget.${key} must be an integer`);
    return [key, value];
  })) as unknown as FuryBudget);
  if (budget.maxAgents < 1) fail('budget.maxAgents must be at least 1');

  const successPredicates = list(root.successPredicates, 'successPredicates', MAX_LIST, (v, i) => {
    const p = record(v, `successPredicates[${i}]`, ['id', 'level', 'description', 'evidence']);
    if (p.level !== 'MUST' && p.level !== 'SHOULD') fail(`successPredicates[${i}].level must be MUST or SHOULD`);
    const evidence = list(p.evidence, `successPredicates[${i}].evidence`, 16, (e, j) => {
      const need = record(e, `successPredicates[${i}].evidence[${j}]`, ['kind', 'subject']);
      if (typeof need.kind !== 'string' || !(FURY_RECEIPT_KINDS as readonly string[]).includes(need.kind)) fail('evidence kind is unsupported');
      if (typeof need.subject !== 'string' || !SUBJECT.test(need.subject)) fail('evidence subject is invalid');
      return Object.freeze({ kind: need.kind as FuryReceiptKind, subject: need.subject });
    });
    if (evidence.length === 0) fail(`successPredicates[${i}] declares no evidence`);
    return Object.freeze({ id: id(p.id, `successPredicates[${i}].id`), level: p.level, description: text(p.description, 'predicate description', 1_024), evidence });
  });
  uniq(successPredicates.map((p) => p.id), 'successPredicates ids');
  if (!successPredicates.some((p) => p.level === 'MUST')) fail('at least one MUST success predicate is required');

  const tasks = list(root.tasks, 'tasks', MAX_TASKS, (v, i) => {
    const t = record(v, `tasks[${i}]`, ['id', 'role', 'description', 'dependsOn', 'capabilities', 'writeScopes']);
    if (typeof t.role !== 'string' || !(FURY_TASK_ROLES as readonly string[]).includes(t.role)) fail(`tasks[${i}].role is unsupported`);
    const caps = list(t.capabilities, `tasks[${i}].capabilities`, FURY_CAPABILITIES.length, (c) => capability(c, `tasks[${i}].capabilities`));
    uniq(caps, `tasks[${i}].capabilities`);
    for (const cap of caps) {
      if (capabilities[cap] === 'DENY') fail(`task ${String(t.id)} requests ${cap}, which the contract denies`);
    }
    const writeScopes = list(t.writeScopes, `tasks[${i}].writeScopes`, 32, (s) => {
      if (typeof s !== 'string' || !SCOPE.test(s)) fail(`tasks[${i}].writeScopes entry is not a safe relative scope`);
      return s;
    });
    if (writeScopes.length > 0 && !caps.includes('WRITE')) fail(`task ${String(t.id)} declares write scopes without WRITE`);
    if (caps.includes('WRITE') && writeScopes.length === 0) fail(`task ${String(t.id)} has WRITE but no write scope`);
    return Object.freeze({
      id: id(t.id, `tasks[${i}].id`),
      role: t.role as FuryTaskRole,
      description: text(t.description, `tasks[${i}].description`, 2_048),
      dependsOn: list(t.dependsOn, `tasks[${i}].dependsOn`, MAX_TASKS, (d) => id(d, 'dependsOn')),
      capabilities: caps,
      writeScopes,
    });
  });
  if (tasks.length === 0) fail('at least one task is required');
  const taskIds = tasks.map((t) => t.id);
  uniq(taskIds, 'task ids');
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!taskIds.includes(dep)) fail(`task ${t.id} depends on unknown task ${dep}`);
      if (dep === t.id) fail(`task ${t.id} depends on itself`);
    }
  }
  if (tasks.length > budget.maxAgents && budget.maxAgents < 1) fail('budget cannot run any task');

  // Kahn topological sort with lexical tie-break for determinism.
  const indegree = new Map(tasks.map((t) => [t.id, t.dependsOn.length]));
  const order: string[] = [];
  const ready = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id).sort();
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const t of tasks) {
      if (t.dependsOn.includes(next)) {
        const left = indegree.get(t.id)! - 1;
        indegree.set(t.id, left);
        if (left === 0) {
          ready.push(t.id);
          ready.sort();
        }
      }
    }
  }
  if (order.length !== tasks.length) fail('task graph contains a cycle');

  const humanGates = list(root.humanGates, 'humanGates', MAX_LIST, (v, i) => {
    const g = record(v, `humanGates[${i}]`, ['id', 'beforeTask', 'reason']);
    const before = id(g.beforeTask, `humanGates[${i}].beforeTask`);
    if (!taskIds.includes(before)) fail(`human gate ${String(g.id)} references unknown task ${before}`);
    return Object.freeze({ id: id(g.id, `humanGates[${i}].id`), beforeTask: before, reason: text(g.reason, 'gate reason', 512) });
  });
  uniq(humanGates.map((g) => g.id), 'human gate ids');
  // Any task that performs an external side effect must sit behind a gate
  // unless the contract ALLOWs external actions outright.
  for (const t of tasks) {
    if (t.capabilities.includes('EXTERNAL_ACTION') && capabilities.EXTERNAL_ACTION !== 'ALLOW' && !humanGates.some((g) => g.beforeTask === t.id)) {
      fail(`task ${t.id} performs EXTERNAL_ACTION without a human gate`);
    }
  }

  const rollbackPolicy = root.rollbackPolicy;
  if (rollbackPolicy !== 'none' && rollbackPolicy !== 'revert-worktree' && rollbackPolicy !== 'manual') fail('rollbackPolicy is unsupported');
  let deadline: number | undefined;
  if (root.deadline !== undefined) {
    if (typeof root.deadline !== 'number' || !Number.isSafeInteger(root.deadline) || root.deadline <= 0) fail('deadline must be a positive epoch millisecond integer');
    deadline = root.deadline;
  }

  const body: FuryIrInput = {
    format: FURY_IR_FORMAT,
    intent,
    must,
    mustNot,
    capabilities,
    privacy,
    budget,
    successPredicates,
    humanGates,
    tasks,
    rollbackPolicy,
    ...(deadline === undefined ? {} : { deadline }),
  };
  const digest = digestMcpDirectJson(body, { maxBytes: 2 * 1024 * 1024, label: 'FuryIR' });
  return Object.freeze({ ...body, digest, order: Object.freeze(order) });
}

/** Success predicates as FuryJudge requirements. */
export function furyIrRequirements(ir: FuryIrDocument): readonly FuryRequirement[] {
  return Object.freeze(ir.successPredicates.map((p) => Object.freeze({
    id: `req:${p.id}`,
    level: p.level,
    description: p.description,
    evidence: p.evidence,
  })));
}

/** Tasks whose dependencies are all in `done`, in topological order. */
export function readyFuryIrTasks(ir: FuryIrDocument, done: ReadonlySet<string>): readonly FuryIrTask[] {
  const byId = new Map(ir.tasks.map((t) => [t.id, t]));
  return Object.freeze(ir.order
    .map((taskId) => byId.get(taskId)!)
    .filter((t) => !done.has(t.id) && t.dependsOn.every((d) => done.has(d))));
}
