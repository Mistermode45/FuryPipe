import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { planFuryDispatch } from '../src/fury-dispatcher.js';
import { loadFuryGraph } from '../src/fury-graph.js';
import { furyIrRequirements } from '../src/fury-ir.js';
import { FuryPlannerError, planFuryTask } from '../src/fury-planner.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function fixtureGraph() {
  const dir = mkdtempSync(join(tmpdir(), 'furypipe-planner-'));
  dirs.push(dir);
  cpSync(join(__dirname, 'fixtures', 'graphify-0.9.67'), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'graphify-out', 'manifest.json'), 'utf8')) as Record<string, { mtime: number }>;
  for (const [f, m] of Object.entries(manifest)) utimesSync(join(dir, f), m.mtime - 10, m.mtime - 10);
  return (await loadFuryGraph(dir)).graph;
}

describe('FuryPlanner', () => {
  it('plans workstreams, checks, integration and judge for the auth example', () => {
    const plan = planFuryTask({
      runId: 'r1',
      intent: 'Rework authentication, add tests, check security and update the docs.',
      must: ['keep the login API stable'],
      plannedFiles: ['src/auth/login.ts', 'src/auth/session.ts', 'src/ui/login-form.ts', 'docs/auth.md'],
    });
    const ids = plan.ir.tasks.map((t) => t.id);
    expect(ids).toEqual(['plan', 'impl-src-auth', 'impl-src-ui', 'tests', 'docs', 'review', 'security', 'integrate', 'judge']);
    expect(plan.ir.tasks.find((t) => t.id === 'impl-src-auth')?.writeScopes).toEqual(['src/auth/**']);
    expect(plan.ir.order[0]).toBe('plan');
    expect(plan.ir.order.at(-1)).toBe('judge');
    expect(furyIrRequirements(plan.ir).filter((r) => r.level === 'MUST').map((r) => r.id)).toEqual([
      'req:tests', 'req:review', 'req:integrated-impl-src-auth', 'req:integrated-impl-src-ui', 'req:security',
    ]);
    expect(plan.notes.join(' ')).toContain('coupling not checked');
    const dispatch = planFuryDispatch({ ir: plan.ir, candidates: [{ id: 'a', harnessId: 'claude-code', provider: 'p', model: 'm', locality: 'cloud', available: true, scores: { coding: 1 }, estimatedCostUsdPerTask: 0.1 }], mode: 'AUTO' });
    expect(dispatch.status).toBe('PLANNED');
  });

  it('merges coupled workstreams using FuryGraph so no two writers share a coupled cluster', async () => {
    const graph = await fixtureGraph();
    const plan = planFuryTask({ runId: 'r2', intent: 'Harden login and the login form.', plannedFiles: ['src/auth/login.ts', 'src/ui/login-form.ts'], graph });
    const impls = plan.ir.tasks.filter((t) => t.role === 'implementer');
    expect(impls).toHaveLength(1);
    expect(impls[0]?.writeScopes).toEqual(['src/auth/**', 'src/ui/**']);
    expect(plan.notes.join(' ')).toMatch(/merged workstreams src\/auth and src\/ui/u);
  });

  it('adds a human gate before every external action and omits security when not relevant', () => {
    const plan = planFuryTask({
      runId: 'r3', intent: 'Refresh the landing copy and publish the preview.', plannedFiles: ['site/index.html'],
      externalActions: [{ id: 'publish preview', description: 'Publish the preview site' }], checks: { tests: false },
    });
    expect(plan.ir.humanGates).toEqual([{ id: 'approve-publish-preview', beforeTask: 'ext-publish-preview', reason: 'external side effect requires human approval' }]);
    expect(plan.ir.tasks.some((t) => t.id === 'security')).toBe(false);
    expect(plan.ir.capabilities.EXTERNAL_ACTION).toBe('ASK');
  });

  it('respects local-only privacy, caps agents and rejects unsafe input', () => {
    const plan = planFuryTask({ runId: 'r4', intent: 'Tidy utils.', plannedFiles: ['src/utils/a.ts'], privacy: 'local-only', checks: { security: 'never', docs: 'never' } });
    expect(plan.ir.capabilities.NETWORK).toBe('DENY');
    expect(plan.ir.budget.maxAgents).toBe(2);
    expect(() => planFuryTask({ runId: 'r5', intent: 'x', plannedFiles: ['../etc/passwd'] })).toThrow(FuryPlannerError);
    expect(() => planFuryTask({ runId: 'BAD ID', intent: 'x', plannedFiles: [] })).toThrow(FuryPlannerError);
    expect(planFuryTask({ runId: 'r6', intent: 'Review only.', plannedFiles: [] }).notes).toContain('no code files planned: review-only plan');
  });
  it('plans a read-only review when WRITE is denied, with room for parallel reviewers', () => {
    const plan = planFuryTask({ runId: 'ro', intent: 'Review the auth token handling', plannedFiles: ['src/auth/token.ts'], capabilities: { WRITE: 'DENY', EXECUTE: 'DENY' } });
    expect(plan.ir.tasks.filter((t) => t.writeScopes.length)).toEqual([]);
    expect(plan.ir.tasks.map((t) => t.id)).toEqual(expect.arrayContaining(['plan', 'review', 'security', 'judge']));
    expect(plan.ir.successPredicates.map((p) => p.id)).not.toContain('tests');
    expect(plan.ir.budget.maxAgents).toBeGreaterThanOrEqual(2);
    expect(plan.notes.join(' ')).toMatch(/read-only review plan/u);
  });
});
