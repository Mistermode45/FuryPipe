import { describe, expect, it } from 'vitest';

import { FURY_FLOW_NODE_TYPES, FuryFlowError, compileFuryFlow, dryRunFuryFlow } from '../src/fury-flow.js';

const flow = (overrides: Record<string, unknown> = {}) => ({
  format: 'furypipe-flow/v1', id: 'refund-triage', version: 1, name: 'Refund triage',
  nodes: [
    { id: 'trigger', type: 'TRIGGER', label: 'Webhook', config: { kind: 'webhook' } },
    { id: 'classify', type: 'LLM', label: 'Classify request' },
    { id: 'route', type: 'CONDITION', label: 'Refund?' },
    { id: 'approve', type: 'HUMAN_APPROVAL', label: 'Approve refund' },
    { id: 'pay', type: 'HTTP', label: 'Issue refund', critical: true, config: { sideEffect: true } },
    { id: 'reply', type: 'AGENT', label: 'Draft reply' },
    { id: 'notify', type: 'NOTIFICATION', label: 'Notify ops' },
  ],
  edges: [
    { from: 'trigger', to: 'classify' }, { from: 'classify', to: 'route' },
    { from: 'route', to: 'approve', when: 'refund' }, { from: 'route', to: 'reply', when: 'other' },
    { from: 'approve', to: 'pay' }, { from: 'pay', to: 'notify' }, { from: 'reply', to: 'notify' },
  ],
  ...overrides,
});

describe('FuryFlow', () => {
  it('covers every master-doc node type and classifies zones', () => {
    expect(Object.keys(FURY_FLOW_NODE_TYPES)).toHaveLength(23);
    const f = compileFuryFlow(flow());
    expect(f.zones).toMatchObject({ classify: 'agentic', reply: 'agentic', pay: 'deterministic', approve: 'deterministic' });
    expect(f.stochasticSurface).toEqual({ nodes: 7, agentic: 2, ratio: 0.286, criticalAgentic: 0 });
    expect(f.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(compileFuryFlow(flow({ version: 2 })).digest).not.toBe(f.digest);
  });

  it.each([
    ['critical agentic node', { nodes: flow().nodes.map((n) => (n.id === 'classify' ? { ...n, critical: true } : n)) }, /critical node classify must be deterministic/u],
    ['side effect without approval', { edges: [...flow().edges.filter((e) => e.to !== 'pay'), { from: 'route', to: 'pay', when: 'refund' }] }, /HUMAN_APPROVAL/u],
    ['cycle', { edges: [...flow().edges, { from: 'notify', to: 'classify' }] }, /cycle/u],
    ['two triggers', { nodes: [...flow().nodes, { id: 't2', type: 'TRIGGER', label: 'x', config: { kind: 'manual' } }] }, /exactly one TRIGGER/u],
    ['bad trigger kind', { nodes: flow().nodes.map((n) => (n.id === 'trigger' ? { ...n, config: { kind: 'telepathy' } } : n)) }, /config.kind/u],
    ['condition with one branch', { edges: flow().edges.filter((e) => e.when !== 'other') }, /two labelled/u],
    ['unbounded loop', { nodes: [...flow().nodes, { id: 'loop', type: 'LOOP', label: 'retry' }], edges: [...flow().edges, { from: 'notify', to: 'loop' }] }, /maxIterations/u],
    ['orphan node', { nodes: [...flow().nodes, { id: 'lonely', type: 'CODE', label: 'x' }] }, /not reachable/u],
    ['unknown type', { nodes: [...flow().nodes, { id: 'x', type: 'TELEPORT', label: 'x' }] }, /unknown type/u],
  ])('rejects %s', (_name, overrides, pattern) => {
    expect(() => compileFuryFlow(flow(overrides))).toThrow(pattern);
  });

  it('dry-runs with fixtures, prunes the untaken branch and pauses at the approval gate', () => {
    const f = compileFuryFlow(flow());
    const first = dryRunFuryFlow(f, { fixtures: { trigger: { amount: 12 }, classify: 'refund', route: 'refund', reply: 'n/a' } });
    expect(first.status).toBe('waiting-approval');
    expect(first.checkpoint.waitingApproval).toBe('approve');
    expect(first.trace.map((t) => t.node)).toEqual(['trigger', 'classify', 'route']);
    const resumed = dryRunFuryFlow(f, { fixtures: { reply: 'n/a' }, approvals: ['approve'], resumeFrom: first.checkpoint, handlers: { HTTP: () => ({ refunded: true }) } });
    expect(resumed.status).toBe('completed');
    expect(resumed.checkpoint.outputs.pay).toEqual({ refunded: true });
    expect(resumed.checkpoint.skipped).toContain('reply');
    expect(resumed.trace.map((t) => [t.node, Boolean(t.skipped)])).toEqual([['approve', false], ['pay', false], ['reply', true], ['notify', false]]);
  });

  it('requires fixtures for agentic nodes in test mode and rejects tampered or foreign checkpoints', () => {
    const f = compileFuryFlow(flow());
    expect(() => dryRunFuryFlow(f, { fixtures: { route: 'other' } })).toThrow(/classify has no fixture/u);
    const stopped = dryRunFuryFlow(f, { fixtures: { classify: 'other', route: 'other', reply: 'hi' }, stopAfter: 2 });
    expect(stopped.status).toBe('stopped');
    const tampered = { ...stopped.checkpoint, outputs: { ...stopped.checkpoint.outputs, classify: 'refund' } };
    expect(() => dryRunFuryFlow(f, { fixtures: {}, resumeFrom: tampered })).toThrow(FuryFlowError);
    const other = compileFuryFlow(flow({ version: 3 }));
    expect(() => dryRunFuryFlow(other, { fixtures: {}, resumeFrom: stopped.checkpoint })).toThrow(/another flow version/u);
    const done = dryRunFuryFlow(f, { fixtures: { classify: 'other', route: 'other', reply: 'hi' }, resumeFrom: stopped.checkpoint });
    expect(done.status).toBe('completed');
    expect(done.checkpoint.skipped).toEqual(expect.arrayContaining(['approve', 'pay']));
    // Resuming a finished run is a no-op (no node runs twice); an edited checkpoint is refused.
    const twice = dryRunFuryFlow(f, { fixtures: {}, resumeFrom: done.checkpoint });
    expect(twice.status).toBe('completed');
    expect(twice.trace).toEqual([]);
    expect(() => dryRunFuryFlow(f, { fixtures: {}, resumeFrom: { ...done.checkpoint, completed: done.checkpoint.completed.slice(0, 1) } })).toThrow(FuryFlowError);
  });
});
