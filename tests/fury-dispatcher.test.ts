import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCodingWorktreeManager, createNodeGitWorktreeProvider, discoverCodingRepository } from '../src/coding-runtime.js';
import { FuryDispatchError, assertFuryAuthorityWithin, planFuryDispatch, type FuryRuntimeBinding } from '../src/fury-dispatcher.js';
import { compileFuryIr } from '../src/fury-ir.js';
import { createFuryWriterPool } from '../src/fury-writer-pool.js';

const caps = { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY' } as const;
const budget = { maxCostUsd: 10, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxAgents: 4, maxRetries: 2, maxCloudCalls: 100, maxToolCalls: 1000 };
const predicates = [{ id: 'tests', level: 'MUST', description: 'tests pass', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:all' }] }];

function ir(tasks: unknown[], overrides: Record<string, unknown> = {}) {
  return compileFuryIr({
    format: 'furypipe-ir/v1', intent: 'Refactor auth, add tests, review security, update docs, check UI.', must: [], mustNot: [],
    capabilities: caps, privacy: 'cloud-allowed', budget, successPredicates: predicates, humanGates: [], tasks, rollbackPolicy: 'revert-worktree', ...overrides,
  });
}

const t = (id: string, role: string, dependsOn: string[] = [], writeScopes: string[] = []) => ({
  id, role, description: id, dependsOn, capabilities: writeScopes.length ? ['READ', 'WRITE'] : ['READ'], writeScopes,
});

const authIr = () => ir([
  t('plan', 'planner'),
  t('backend', 'implementer', ['plan'], ['src/auth/**']),
  t('tests', 'tester', ['plan'], ['tests/auth/**']),
  t('docs', 'documenter', ['plan'], ['docs/**']),
  t('ui', 'browser', ['backend']),
  t('review', 'reviewer', ['backend', 'tests']),
  t('security', 'security', ['backend']),
]);

const bindings: FuryRuntimeBinding[] = [
  { id: 'cc-cloud', harnessId: 'claude-code', provider: 'anthropic', model: 'cloud-a', locality: 'cloud', available: true, scores: { coding: 0.9, reasoning: 0.9, review: 0.8, security: 0.8, docs: 0.7 }, estimatedCostUsdPerTask: 0.5 },
  { id: 'codex-cloud', harnessId: 'codex', provider: 'openai', model: 'cloud-b', locality: 'cloud', available: true, scores: { coding: 0.85, review: 0.85, security: 0.7 }, estimatedCostUsdPerTask: 0.4 },
  { id: 'gemini-browser', harnessId: 'gemini-cli', provider: 'google', model: 'cloud-c', locality: 'cloud', available: true, scores: { browser: 0.9 }, estimatedCostUsdPerTask: 0.3 },
  { id: 'native-local', harnessId: 'furypipe-native', provider: 'ollama', model: 'qwen-local', locality: 'local', available: true, scores: { docs: 0.6, research: 0.5, coding: 0.4 }, estimatedCostUsdPerTask: 0 },
  { id: 'offline', harnessId: 'opencode', provider: 'ollama', model: 'x', locality: 'local', available: false, scores: { coding: 1 }, estimatedCostUsdPerTask: 0 },
];

describe('FuryDispatcher planning', () => {
  it('AUTO picks specialists for a wide, diverse task and routes independent review to another harness', () => {
    const plan = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'AUTO' });
    expect(plan).toMatchObject({ status: 'PLANNED', mode: 'SPECIALISTS', dispatchBenefit: 'HIGH' });
    const by = Object.fromEntries(plan.assignments.map((a) => [a.taskId, a]));
    expect(by.backend?.bindingIds).toEqual(['cc-cloud']);
    expect(by.review?.bindingIds).toEqual(['codex-cloud']);
    expect(by.ui?.bindingIds).toEqual(['gemini-browser']);
    expect(plan.assignments.some((a) => a.bindingIds.includes('offline'))).toBe(false);
    // Writers get dedicated worktrees; readers do not.
    expect(by.backend?.worktree).toBe('dedicated');
    expect(by.review?.worktree).toBe('none');
    // backend/tests/docs share a level (disjoint scopes) after plan.
    expect(new Set([by.backend?.group, by.tests?.group, by.docs?.group]).size).toBe(1);
    expect(plan.agents).toBeLessThanOrEqual(4);
  });

  it('AUTO concludes DISPATCH_BENEFIT=LOW for a single task and uses one agent', () => {
    const plan = planFuryDispatch({ ir: ir([t('only', 'implementer', [], ['src/**'])]), candidates: bindings, mode: 'AUTO' });
    expect(plan).toMatchObject({ mode: 'SINGLE', dispatchBenefit: 'LOW', agents: 1 });
    expect(plan.reasons.join(' ')).toContain('DISPATCH_BENEFIT=LOW');
  });

  it('never schedules overlapping writers in the same group', () => {
    const plan = planFuryDispatch({ ir: ir([t('a', 'implementer', [], ['src/**']), t('b', 'implementer', [], ['src/auth/**']), t('c', 'documenter', [], ['docs/**'])]), candidates: bindings, mode: 'PARALLEL' });
    const g = Object.fromEntries(plan.assignments.map((a) => [a.taskId, a.group]));
    expect(g.a).not.toBe(g.b);
    expect(g.c).toBe(g.a);
  });

  it('LOCAL_ONLY and local-only privacy never select a cloud binding, and block when no local runtime exists', () => {
    const plan = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'LOCAL_ONLY' });
    expect(plan.status).toBe('PLANNED');
    expect(plan.assignments.every((a) => a.bindingIds.every((id) => id === 'native-local'))).toBe(true);
    const privateIr = ir([t('p', 'implementer', [], ['src/**'])], { privacy: 'local-only' });
    expect(planFuryDispatch({ ir: privateIr, candidates: bindings, mode: 'SPECIALISTS' }).assignments[0]?.bindingIds).toEqual(['native-local']);
    expect(planFuryDispatch({ ir: privateIr, candidates: bindings.filter((b) => b.locality === 'cloud'), mode: 'AUTO' })).toMatchObject({ status: 'BLOCKED' });
  });

  it('LOCAL_CLOUD_HYBRID sends docs/tests/research to local and implementation to cloud', () => {
    const plan = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'LOCAL_CLOUD_HYBRID' });
    const by = Object.fromEntries(plan.assignments.map((a) => [a.taskId, a.bindingIds[0]]));
    expect(by.docs).toBe('native-local');
    expect(by.tests).toBe('native-local');
    expect(by.backend).toBe('cc-cloud');
  });

  it('COUNCIL and RACE fan a task out to several bindings within the agent budget', () => {
    const council = planFuryDispatch({ ir: ir([t('solve', 'implementer', [], ['src/**'])]), candidates: bindings, mode: 'COUNCIL', width: 3 });
    expect(council.assignments[0]).toMatchObject({ selection: 'council' });
    expect(council.assignments[0]?.bindingIds).toHaveLength(3);
    const tight = ir([t('solve', 'implementer', [], ['src/**'])], { budget: { ...budget, maxAgents: 2 } });
    expect(planFuryDispatch({ ir: tight, candidates: bindings, mode: 'RACE', width: 3 })).toMatchObject({ status: 'BLOCKED' });
  });

  it('MANUAL requires a binding per task inside the privacy boundary', () => {
    const one = ir([t('x', 'implementer', [], ['src/**'])]);
    expect(planFuryDispatch({ ir: one, candidates: bindings, mode: 'MANUAL', manual: { x: 'codex-cloud' } }).assignments[0]?.bindingIds).toEqual(['codex-cloud']);
    expect(() => planFuryDispatch({ ir: one, candidates: bindings, mode: 'MANUAL', manual: {} })).toThrow(FuryDispatchError);
    expect(() => planFuryDispatch({ ir: one, candidates: bindings, mode: 'MANUAL', manual: { x: 'offline' } })).toThrow(/unavailable/u);
  });

  it('blocks plans that exceed the cost budget and returns NO_DISPATCH when OFF', () => {
    const cheap = ir([t('a', 'implementer', [], ['src/**']), t('b', 'reviewer', ['a'])], { budget: { ...budget, maxCostUsd: 0.1 } });
    expect(planFuryDispatch({ ir: cheap, candidates: bindings, mode: 'SPECIALISTS' })).toMatchObject({ status: 'BLOCKED' });
    expect(planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'OFF' })).toMatchObject({ status: 'NO_DISPATCH', assignments: [] });
  });

  it('keeps child authority within the parent contract', () => {
    const plan = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'SPECIALISTS' });
    const review = plan.assignments.find((a) => a.taskId === 'review')!;
    expect(review.authority).toMatchObject({ READ: 'ALLOW', WRITE: 'DENY', NETWORK: 'DENY' });
    expect(() => assertFuryAuthorityWithin(caps, { ...caps, NETWORK: 'ASK' })).toThrow(/escalates NETWORK/u);
    expect(() => assertFuryAuthorityWithin(caps, { ...caps, EXECUTE: 'ALLOW' })).toThrow(/escalates EXECUTE/u);
  });

  it('is deterministic', () => {
    const a = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'AUTO' });
    const b = planFuryDispatch({ ir: authIr(), candidates: [...bindings].reverse(), mode: 'AUTO' });
    expect(b.assignments).toEqual(a.assignments);
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

describe('Writer pool (real git worktrees)', () => {
  it('gives each writer its own worktree, refuses double leases and reaps orphans', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-writers-'));
    roots.push(root);
    const repoDir = join(root, 'repo');
    const wtRoot = join(root, 'worktrees');
    mkdirSync(repoDir);
    mkdirSync(wtRoot);
    git(repoDir, 'init', '-q');
    writeFileSync(join(repoDir, 'README.md'), 'x\n');
    git(repoDir, 'add', '.');
    git(repoDir, 'commit', '-q', '-m', 'init');
    const baseSha = git(repoDir, 'rev-parse', 'HEAD');
    const repository = await discoverCodingRepository(repoDir);
    const manager = createCodingWorktreeManager({ provider: createNodeGitWorktreeProvider() });
    const pool = createFuryWriterPool({ manager, repository, baseSha, writableRoot: wtRoot, runId: 'run1' });

    const plan = planFuryDispatch({ ir: authIr(), candidates: bindings, mode: 'SPECIALISTS' });
    const leases = await pool.acquireForPlan(plan);
    expect(leases.map((l) => l.taskId).sort()).toEqual(['backend', 'docs', 'tests']);
    expect(new Set(leases.map((l) => l.worktree.rootPath)).size).toBe(3);
    for (const lease of leases) expect(existsSync(join(lease.worktree.rootPath, 'README.md'))).toBe(true);
    expect(git(repoDir, 'branch', '--list', 'fury/run1/*').split('\n')).toHaveLength(3);
    await expect(pool.acquire('backend')).rejects.toThrow(/already holds/u);

    // A writer that crashed: its worktree exists in the manager but no lease.
    const orphan = await manager.create({ repository, owner: 'crashed', taskDigest: 'a'.repeat(64), baseSha, writableRoot: wtRoot });
    expect(await pool.reapOrphans()).toEqual([orphan.worktreeId]);
    expect(existsSync(orphan.rootPath)).toBe(false);

    for (const lease of leases) expect((await pool.release(lease.taskId)).status).toBe('removed');
    expect(pool.active()).toEqual([]);
    await expect(pool.release('backend')).rejects.toThrow(/no writer lease/u);
  }, 60_000);
});

describe('Budget governance profiles (master §28)', () => {
  const one = () => ir([t('solve', 'implementer', [], ['src/**'])]);
  const pool: FuryRuntimeBinding[] = [
    { id: 'premium', harnessId: 'claude-code', provider: 'anthropic', model: 'p', locality: 'cloud', available: true, scores: { coding: 0.95 }, estimatedCostUsdPerTask: 2, latencyMsP50: 9_000 },
    { id: 'cheap', harnessId: 'codex', provider: 'openai', model: 'c', locality: 'cloud', available: true, scores: { coding: 0.7 }, estimatedCostUsdPerTask: 0.1, latencyMsP50: 4_000 },
    { id: 'fast-local', harnessId: 'furypipe-native', provider: 'ollama', model: 'l', locality: 'local', available: true, scores: { coding: 0.5 }, estimatedCostUsdPerTask: 0, latencyMsP50: 1_000 },
  ];
  const pick = (profile: string, extra: Record<string, unknown> = {}) =>
    planFuryDispatch({ ir: one(), candidates: pool, mode: 'SINGLE', profile: profile as never, ...extra }).assignments[0]?.bindingIds[0];

  it('changes the selection deterministically per profile', () => {
    expect(pick('QUALITY')).toBe('premium');
    expect(pick('BUDGET')).toBe('fast-local');
    expect(pick('FAST')).toBe('fast-local');
    expect(pick('LOCAL_FIRST')).toBe('fast-local');
    expect(pick('BALANCED')).toBe('cheap');
    expect(pick('CUSTOM', { weights: { quality: 1, cost: 0, latency: 0, local: 0 } })).toBe('premium');
  });

  it('PRIVATE excludes cloud runtimes and CUSTOM requires bounded weights', () => {
    const plan = planFuryDispatch({ ir: one(), candidates: pool, mode: 'AUTO', profile: 'PRIVATE' });
    expect(plan.assignments[0]?.bindingIds).toEqual(['fast-local']);
    expect(plan.reasons.join(' ')).toContain('PRIVATE profile');
    expect(() => planFuryDispatch({ ir: one(), candidates: pool, mode: 'SINGLE', profile: 'CUSTOM' })).toThrow(/weights/u);
    expect(() => planFuryDispatch({ ir: one(), candidates: pool, mode: 'SINGLE', profile: 'CUSTOM', weights: { quality: -1, cost: 0, latency: 0, local: 0 } })).toThrow(/weights/u);
    expect(() => planFuryDispatch({ ir: one(), candidates: pool, mode: 'SINGLE', profile: 'NOPE' as never })).toThrow(/profile/u);
  });
});
