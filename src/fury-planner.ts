// FuryPlanner — deterministic requirements → FuryIR task DAG.
//
// This planner is rule-based, not a model. It turns an intent, hard
// constraints and the files expected to change into workstreams with
// ownership (write scopes), checks, gates, success predicates and budgets,
// then compiles the result as FuryIR (so every invariant of the contract is
// enforced). With a FuryGraph, workstreams whose scopes are coupled are
// merged so that no two writers work on a strongly coupled cluster in
// parallel (master §47.4). A model-driven planner can later propose plans;
// they must still pass through compileFuryIr.
import type { FuryGraph } from './fury-graph.js';
import { furyScopeCoupling } from './fury-graph.js';
import type { FuryBudget, FuryCapability, FuryCapabilityDecision, FuryIrDocument, FuryPrivacy } from './fury-ir.js';
import { compileFuryIr } from './fury-ir.js';

export interface FuryPlannerInput {
  readonly runId: string;
  readonly intent: string;
  readonly must?: readonly string[];
  readonly mustNot?: readonly string[];
  readonly plannedFiles: readonly string[];
  readonly privacy?: FuryPrivacy;
  readonly capabilities?: Partial<Record<FuryCapability, FuryCapabilityDecision>>;
  readonly budget?: Partial<FuryBudget>;
  readonly graph?: FuryGraph;
  readonly checks?: {
    readonly tests?: boolean;
    readonly security?: 'auto' | 'always' | 'never';
    readonly docs?: 'auto' | 'always' | 'never';
    readonly browser?: boolean;
  };
  readonly externalActions?: readonly { readonly id: string; readonly description: string }[];
}

export interface FuryPlan {
  readonly ir: FuryIrDocument;
  readonly workstreams: readonly { readonly id: string; readonly scopes: readonly string[]; readonly files: readonly string[] }[];
  readonly notes: readonly string[];
}

export class FuryPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryPlannerError';
  }
}

const SECURITY_HINT = /\b(auth\w*|security|secur\w*|crypto\w*|password|passwd|token|secret|permission|oauth|session|login|csrf|xss|injection|sandbox)\b/iu;
const DOCS_HINT = /\b(doc|docs|documentation|readme|guide|changelog)\b/iu;
const FILE = /^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._@/-]{1,512}$/u;

const DEFAULT_BUDGET: FuryBudget = Object.freeze({
  maxCostUsd: 10, maxTokens: 2_000_000, maxWallTimeMs: 2 * 60 * 60 * 1000, maxAgents: 4,
  maxRetries: 2, maxCloudCalls: 200, maxToolCalls: 2_000,
});

const isDoc = (f: string) => /^docs\//u.test(f) || /\.(md|mdx|rst|adoc|txt)$/iu.test(f);
const isTest = (f: string) => /(^|\/)(tests?|__tests__)\//u.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/u.test(f);

function areaOf(file: string): string {
  const parts = file.split('/');
  if (parts.length <= 1) return '.';
  if (parts.length === 2) return parts[0]!;
  return `${parts[0]}/${parts[1]}`;
}

function slug(value: string): string {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  return s || 'root';
}

export function planFuryTask(input: FuryPlannerInput): FuryPlan {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.runId)) throw new FuryPlannerError('runId is invalid');
  if (!Array.isArray(input.plannedFiles) || input.plannedFiles.length > 2_000) throw new FuryPlannerError('plannedFiles must be an array of at most 2000 paths');
  const files = [...new Set(input.plannedFiles.map((f) => f.replaceAll('\\', '/')))].sort();
  for (const f of files) if (!FILE.test(f)) throw new FuryPlannerError(`planned file ${JSON.stringify(f)} is not a safe relative path`);
  const notes: string[] = [];
  const checks = { tests: true, security: 'auto', docs: 'auto', browser: false, ...input.checks } as const;

  // 1. Workstreams by area; docs and tests have dedicated owners.
  const code = files.filter((f) => !isDoc(f) && !isTest(f));
  const docsFiles = files.filter(isDoc);
  const areas = new Map<string, string[]>();
  for (const f of code) {
    const a = areaOf(f);
    areas.set(a, [...(areas.get(a) ?? []), f]);
  }
  // 2. Merge coupled areas (union-find) when a graph is available.
  const ids = [...areas.keys()].sort();
  const parent = new Map(ids.map((a) => [a, a]));
  const find = (a: string): string => (parent.get(a) === a ? a : find(parent.get(a)!));
  if (input.graph) {
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]!;
      const b = ids[j]!;
      const edges = furyScopeCoupling(input.graph, [a === '.' ? '' : a], [b === '.' ? '' : b]);
      if (edges > 0 && find(a) !== find(b)) {
        parent.set(find(b), find(a));
        notes.push(`merged workstreams ${a} and ${b}: ${edges} dependency edge(s) in FuryGraph`);
      }
    }
  } else if (ids.length > 1) {
    notes.push('no FuryGraph: workstreams split by directory only; coupling not checked');
  }
  const groups = new Map<string, string[]>();
  for (const a of ids) groups.set(find(a), [...(groups.get(find(a)) ?? []), a]);
  const workstreams = [...groups.values()].map((members) => {
    const scopes = members.map((a) => (a === '.' ? '' : `${a}/**`)).filter(Boolean);
    const rootFiles = members.includes('.') ? (areas.get('.') ?? []) : [];
    return Object.freeze({
      id: `impl-${slug(members[0]!)}`,
      scopes: Object.freeze([...scopes, ...rootFiles].sort()),
      files: Object.freeze(members.flatMap((a) => areas.get(a) ?? []).sort()),
    });
  });
  const wsIds = new Set<string>();
  for (const w of workstreams) {
    if (wsIds.has(w.id)) throw new FuryPlannerError(`workstream id collision ${w.id}`);
    wsIds.add(w.id);
  }

  const capabilities: Record<FuryCapability, FuryCapabilityDecision> = {
    READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: input.privacy === 'local-only' ? 'DENY' : 'ASK',
    EXTERNAL_ACTION: input.externalActions?.length ? 'ASK' : 'DENY', ...input.capabilities,
  };
  // WRITE denied: nobody may write, so the plan becomes a read-only review of the planned files.
  const readOnly = capabilities.WRITE === 'DENY';
  if (readOnly) {
    workstreams.length = 0;
    notes.push('WRITE denied: read-only review plan (no writer, test or docs tasks)');
  }
  const wantTests = checks.tests && !readOnly;

  // 3. Tasks.
  type Task = { id: string; role: string; description: string; dependsOn: string[]; capabilities: FuryCapability[]; writeScopes: string[] };
  const tasks: Task[] = [{ id: 'plan', role: 'planner', description: `Plan: ${input.intent.slice(0, 200)}`, dependsOn: [], capabilities: ['READ'], writeScopes: [] }];
  for (const w of workstreams) {
    tasks.push({ id: w.id, role: 'implementer', description: `Implement changes in ${w.scopes.join(', ')}`, dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: [...w.scopes] });
  }
  const impl = workstreams.map((w) => w.id);
  const exec: FuryCapability[] = capabilities.EXECUTE === 'DENY' ? [] : ['EXECUTE'];
  if (wantTests) tasks.push({ id: 'tests', role: 'tester', description: 'Add or update tests and run them', dependsOn: ['plan'], capabilities: ['READ', 'WRITE', ...exec], writeScopes: ['tests/**'] });
  const securityWanted = checks.security === 'always' || (checks.security === 'auto' && (SECURITY_HINT.test(input.intent) || files.some((f) => SECURITY_HINT.test(f))));
  const docsWanted = !readOnly && (checks.docs === 'always' || (checks.docs === 'auto' && (docsFiles.length > 0 || DOCS_HINT.test(input.intent))));
  if (docsWanted) tasks.push({ id: 'docs', role: 'documenter', description: 'Update documentation', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['docs/**', ...docsFiles.filter((f) => !f.startsWith('docs/'))].sort() });
  const afterImpl = impl.length ? impl : ['plan'];
  tasks.push({ id: 'review', role: 'reviewer', description: 'Independent code review', dependsOn: [...afterImpl, ...(wantTests ? ['tests'] : [])], capabilities: ['READ'], writeScopes: [] });
  if (securityWanted) tasks.push({ id: 'security', role: 'security', description: 'Security review of the change', dependsOn: afterImpl, capabilities: ['READ'], writeScopes: [] });
  if (checks.browser) tasks.push({ id: 'browser', role: 'browser', description: 'Browser/UX verification', dependsOn: afterImpl, capabilities: ['READ', ...exec], writeScopes: [] });
  const beforeIntegrate = tasks.filter((t) => t.id !== 'plan').map((t) => t.id);
  tasks.push({ id: 'integrate', role: 'integrator', description: 'Integrate writer branches in order', dependsOn: beforeIntegrate, capabilities: ['READ', ...exec], writeScopes: [] });
  const gates: { id: string; beforeTask: string; reason: string }[] = [];
  for (const action of input.externalActions ?? []) {
    const id = `ext-${slug(action.id)}`;
    tasks.push({ id, role: 'integrator', description: action.description.slice(0, 500), dependsOn: ['integrate'], capabilities: ['READ', 'EXTERNAL_ACTION'], writeScopes: [] });
    gates.push({ id: `approve-${slug(action.id)}`, beforeTask: id, reason: 'external side effect requires human approval' });
  }
  tasks.push({ id: 'judge', role: 'judge', description: 'FuryJudge verification against success predicates', dependsOn: tasks.filter((t) => t.id !== 'plan').map((t) => t.id), capabilities: ['READ'], writeScopes: [] });

  // 4. Success predicates with evidence contracts.
  const predicates: { id: string; level: 'MUST' | 'SHOULD'; description: string; evidence: { kind: string; subject: string }[] }[] = [];
  if (wantTests) predicates.push({ id: 'tests', level: 'MUST', description: 'tests pass after integration', evidence: [{ kind: 'TEST_RECEIPT', subject: `test:${input.runId}` }] });
  predicates.push({ id: 'review', level: 'MUST', description: 'independent review accepted', evidence: [{ kind: 'AGENT_RECEIPT', subject: `review:${input.runId}` }] });
  for (const w of workstreams) predicates.push({ id: `integrated-${w.id}`, level: 'MUST', description: `${w.id} integrated without conflict`, evidence: [{ kind: 'INTEGRATION_RECEIPT', subject: `integration:${input.runId}:${w.id}` }] });
  if (securityWanted) predicates.push({ id: 'security', level: 'MUST', description: 'security review found no blocking issue', evidence: [{ kind: 'AGENT_RECEIPT', subject: `security:${input.runId}` }] });
  if (docsWanted) predicates.push({ id: 'docs', level: 'SHOULD', description: 'documentation updated', evidence: [{ kind: 'PATCH_RECEIPT', subject: `patch:${input.runId}:docs` }] });
  if (checks.browser) predicates.push({ id: 'browser', level: 'MUST', description: 'browser checks pass', evidence: [{ kind: 'BROWSER_RECEIPT', subject: `browser:${input.runId}` }] });

  // 5. Budget: parallel writers + reviewers, capped by the requested budget.
  // Readers (review, security, browser) can run side by side after the writers.
  const widest = Math.max(1, workstreams.length + (wantTests ? 1 : 0) + (docsWanted ? 1 : 0), 1 + (securityWanted ? 1 : 0) + (checks.browser ? 1 : 0));
  const budget: FuryBudget = { ...DEFAULT_BUDGET, maxAgents: Math.min(DEFAULT_BUDGET.maxAgents, widest), ...input.budget };
  if (workstreams.length === 0) notes.push('no code files planned: review-only plan');

  const ir = compileFuryIr({
    format: 'furypipe-ir/v1',
    intent: input.intent,
    must: [...(input.must ?? [])],
    mustNot: [...(input.mustNot ?? [])],
    capabilities,
    privacy: input.privacy ?? 'local-first',
    budget,
    successPredicates: predicates,
    humanGates: gates,
    tasks,
    rollbackPolicy: 'revert-worktree',
  });
  return Object.freeze({ ir, workstreams: Object.freeze(workstreams), notes: Object.freeze(notes) });
}
