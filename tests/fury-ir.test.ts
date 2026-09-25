import { describe, expect, it } from 'vitest';

import { FuryIrError, compileFuryIr, furyIrRequirements, readyFuryIrTasks } from '../src/fury-ir.js';

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'furypipe-ir/v1',
    intent: 'Rework authentication, add tests, review security, update docs.',
    must: ['keep the public login API stable'],
    mustNot: ['store plaintext passwords'],
    capabilities: { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY' },
    privacy: 'local-first',
    budget: { maxCostUsd: 5, maxTokens: 500_000, maxWallTimeMs: 3_600_000, maxAgents: 4, maxRetries: 2, maxCloudCalls: 50, maxToolCalls: 400 },
    successPredicates: [
      { id: 'tests', level: 'MUST', description: 'auth tests pass', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:auth' }] },
      { id: 'docs', level: 'SHOULD', description: 'docs updated', evidence: [{ kind: 'PATCH_RECEIPT', subject: 'patch:docs' }] },
    ],
    humanGates: [],
    tasks: [
      { id: 'plan', role: 'planner', description: 'plan', dependsOn: [], capabilities: ['READ'], writeScopes: [] },
      { id: 'backend', role: 'implementer', description: 'implement', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['src/auth/**'] },
      { id: 'docs', role: 'documenter', description: 'docs', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['docs/**'] },
      { id: 'review', role: 'reviewer', description: 'review', dependsOn: ['backend', 'docs'], capabilities: ['READ'], writeScopes: [] },
    ],
    rollbackPolicy: 'revert-worktree',
    ...overrides,
  };
}

describe('FuryIR compiler', () => {
  it('compiles a valid contract with a deterministic order and digest', () => {
    const one = compileFuryIr(base());
    const two = compileFuryIr(base());
    expect(one.order).toEqual(['plan', 'backend', 'docs', 'review']);
    expect(one.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(two.digest).toBe(one.digest);
    expect(compileFuryIr(base({ intent: 'something else' })).digest).not.toBe(one.digest);
    expect(Object.isFrozen(one)).toBe(true);
  });

  it('maps success predicates to judge requirements and reports ready tasks', () => {
    const ir = compileFuryIr(base());
    expect(furyIrRequirements(ir).map((r) => [r.id, r.level])).toEqual([['req:tests', 'MUST'], ['req:docs', 'SHOULD']]);
    expect(readyFuryIrTasks(ir, new Set()).map((t) => t.id)).toEqual(['plan']);
    expect(readyFuryIrTasks(ir, new Set(['plan'])).map((t) => t.id)).toEqual(['backend', 'docs']);
    expect(readyFuryIrTasks(ir, new Set(['plan', 'backend'])).map((t) => t.id)).toEqual(['docs']);
  });

  it.each([
    ['unknown root key', { extra: 1 }, /unknown key/u],
    ['bad format', { format: 'x' }, /format/u],
    ['no MUST predicate', { successPredicates: [{ id: 'd', level: 'SHOULD', description: 'd', evidence: [{ kind: 'PATCH_RECEIPT', subject: 'p' }] }] }, /MUST success predicate/u],
    ['predicate without evidence', { successPredicates: [{ id: 't', level: 'MUST', description: 'd', evidence: [] }] }, /no evidence/u],
    ['unbounded budget', { budget: { maxCostUsd: Infinity, maxTokens: 1, maxWallTimeMs: 1, maxAgents: 1, maxRetries: 0, maxCloudCalls: 0, maxToolCalls: 0 } }, /budget.maxCostUsd/u],
    ['zero agents', { budget: { maxCostUsd: 1, maxTokens: 1, maxWallTimeMs: 1, maxAgents: 0, maxRetries: 0, maxCloudCalls: 0, maxToolCalls: 0 } }, /maxAgents/u],
    ['local-only with ambient network', { privacy: 'local-only', capabilities: { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'ALLOW', EXTERNAL_ACTION: 'DENY' } }, /local-only/u],
  ])('rejects %s', (_label, overrides, pattern) => {
    expect(() => compileFuryIr(base(overrides as Record<string, unknown>))).toThrow(pattern);
  });

  it('rejects cycles, unknown dependencies and duplicate ids', () => {
    const cyc = base({
      tasks: [
        { id: 'a', role: 'planner', description: 'a', dependsOn: ['b'], capabilities: ['READ'], writeScopes: [] },
        { id: 'b', role: 'planner', description: 'b', dependsOn: ['a'], capabilities: ['READ'], writeScopes: [] },
      ],
    });
    expect(() => compileFuryIr(cyc)).toThrow(/cycle/u);
    expect(() => compileFuryIr(base({ tasks: [{ id: 'a', role: 'planner', description: 'a', dependsOn: ['zz'], capabilities: ['READ'], writeScopes: [] }] }))).toThrow(/unknown task/u);
    expect(() => compileFuryIr(base({ tasks: [
      { id: 'a', role: 'planner', description: 'a', dependsOn: [], capabilities: ['READ'], writeScopes: [] },
      { id: 'a', role: 'planner', description: 'a', dependsOn: [], capabilities: ['READ'], writeScopes: [] },
    ] }))).toThrow(/duplicates/u);
  });

  it('enforces authority: denied capabilities, write scopes and external actions', () => {
    const withTask = (task: Record<string, unknown>, extra: Record<string, unknown> = {}) => base({ tasks: [task], ...extra });
    expect(() => compileFuryIr(withTask({ id: 'n', role: 'researcher', description: 'n', dependsOn: [], capabilities: ['NETWORK'], writeScopes: [] }))).toThrow(/denies/u);
    expect(() => compileFuryIr(withTask({ id: 'w', role: 'implementer', description: 'w', dependsOn: [], capabilities: ['WRITE'], writeScopes: [] }))).toThrow(/no write scope/u);
    expect(() => compileFuryIr(withTask({ id: 'w', role: 'implementer', description: 'w', dependsOn: [], capabilities: ['READ'], writeScopes: ['src/**'] }))).toThrow(/without WRITE/u);
    for (const scope of ['../etc', '/abs', 'src/../../x', 'C:\\x']) {
      expect(() => compileFuryIr(withTask({ id: 'w', role: 'implementer', description: 'w', dependsOn: [], capabilities: ['WRITE'], writeScopes: [scope] }))).toThrow(FuryIrError);
    }
    const external = { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'ASK' };
    const deploy = { id: 'deploy', role: 'integrator', description: 'deploy', dependsOn: [], capabilities: ['EXTERNAL_ACTION'], writeScopes: [] };
    expect(() => compileFuryIr(withTask(deploy, { capabilities: external }))).toThrow(/without a human gate/u);
    expect(compileFuryIr(withTask(deploy, { capabilities: external, humanGates: [{ id: 'approve-deploy', beforeTask: 'deploy', reason: 'external side effect' }] })).humanGates).toHaveLength(1);
  });

  it('rejects control characters and non-plain objects', () => {
    expect(() => compileFuryIr(base({ intent: 'bad\u0000intent' }))).toThrow(/control/u);
    const proto = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(proto, base());
    expect(() => compileFuryIr(proto)).toThrow(/plain object/u);
  });
});
