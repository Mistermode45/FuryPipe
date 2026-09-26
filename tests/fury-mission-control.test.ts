import { describe, expect, it } from 'vitest';

import { planFuryDispatch, type FuryRuntimeBinding } from '../src/fury-dispatcher.js';
import { compileFuryIr } from '../src/fury-ir.js';
import {
  FuryMissionError,
  createFuryMissionControl,
  explainFuryReplay,
  forkFuryReplay,
  furyReplayHead,
  verifyFuryReplay,
  type FuryWorkerBinding,
} from '../src/fury-mission-control.js';

const caps = { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY' } as const;

function setup(overrides: { privacy?: string; budget?: Record<string, number> } = {}) {
  const ir = compileFuryIr({
    format: 'furypipe-ir/v1', intent: 'Fix the login bug and add a test.', must: [], mustNot: [], capabilities: caps,
    privacy: overrides.privacy ?? 'cloud-allowed',
    budget: { maxCostUsd: 1, maxTokens: 10_000, maxWallTimeMs: 600_000, maxAgents: 2, maxRetries: 1, maxCloudCalls: 10, maxToolCalls: 100, ...overrides.budget },
    successPredicates: [{ id: 'tests', level: 'MUST', description: 'tests pass', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:login' }] }],
    humanGates: [],
    tasks: [
      { id: 'fix', role: 'implementer', description: 'fix', dependsOn: [], capabilities: ['READ', 'WRITE'], writeScopes: ['src/**'] },
      { id: 'review', role: 'reviewer', description: 'review', dependsOn: ['fix'], capabilities: ['READ'], writeScopes: [] },
    ],
    rollbackPolicy: 'revert-worktree',
  });
  const local: FuryWorkerBinding = { bindingId: 'local-qwen', harnessId: 'furypipe-native', provider: 'ollama', model: 'qwen', locality: 'local' };
  const cloudA: FuryWorkerBinding = { bindingId: 'cc', harnessId: 'claude-code', provider: 'anthropic', model: 'a', locality: 'cloud' };
  const cloudB: FuryWorkerBinding = { bindingId: 'codex', harnessId: 'codex', provider: 'openai', model: 'b', locality: 'cloud' };
  const bindings = [local, cloudA, cloudB];
  const candidates: FuryRuntimeBinding[] = bindings.map((b) => ({ id: b.bindingId, harnessId: b.harnessId, provider: b.provider, model: b.model, locality: b.locality, available: true, scores: { coding: b.bindingId === 'cc' ? 0.9 : 0.5, review: b.bindingId === 'codex' ? 0.9 : 0.5 }, estimatedCostUsdPerTask: 0.1 }));
  const plan = planFuryDispatch({ ir, candidates, mode: 'SPECIALISTS' });
  let t = 1_000;
  const mc = createFuryMissionControl({ ir, plan, bindings, replayId: 'run-1', now: () => (t += 10) });
  return { ir, plan, mc, bindings };
}

describe('FuryMissionControl', () => {
  it('creates one worker per assignment and logs task, dispatch and routing', () => {
    const { mc } = setup();
    expect(mc.workers().map((w) => [w.workerId, w.binding.bindingId, w.state])).toEqual([['fix', 'cc', 'queued'], ['review', 'codex', 'queued']]);
    expect(mc.timeline().map((e) => e.type)).toEqual(['TASK', 'DISPATCH', 'ROUTING', 'ROUTING']);
    expect(verifyFuryReplay(mc.replay()).ok).toBe(true);
  });

  it('allows only legal transitions', () => {
    const { mc } = setup();
    expect(() => mc.act('fix', 'PAUSE')).toThrow(/not allowed from queued/u);
    mc.act('fix', 'START');
    mc.act('fix', 'PAUSE');
    expect(() => mc.act('fix', 'COMPLETE')).toThrow(FuryMissionError);
    mc.act('fix', 'RESUME');
    mc.act('fix', 'REQUEST_APPROVAL');
    expect(mc.act('fix', 'APPROVE').state).toBe('running');
    expect(mc.act('fix', 'COMPLETE').state).toBe('completed');
    expect(() => mc.act('fix', 'START')).toThrow(FuryMissionError);
    expect(() => mc.act('nope', 'START')).toThrow(/unknown/u);
  });

  it('enforces maxAgents, retry budget and aggregate budgets', () => {
    const { mc } = setup({ budget: { maxAgents: 1 } });
    mc.act('fix', 'START');
    expect(() => mc.act('review', 'START')).toThrow(/maxAgents/u);
    mc.act('fix', 'FAIL', { reason: 'tests failed' });
    expect(mc.act('fix', 'RETRY').retries).toBe(1);
    mc.act('fix', 'START');
    mc.act('fix', 'FAIL');
    expect(() => mc.act('fix', 'RETRY')).toThrow(/retry budget/u);

    const second = setup();
    second.mc.act('fix', 'START');
    second.mc.act('review', 'START');
    second.mc.report('fix', { usage: { tokens: 6_000, costUsd: 0.2 } });
    second.mc.report('review', { usage: { tokens: 5_000 } });
    expect(second.mc.workers().every((w) => w.state === 'stopped')).toBe(true);
    expect(second.mc.timeline({ type: 'BUDGET_STOP' })).toHaveLength(2);
    expect(() => second.mc.report('fix', { usage: { tokens: -1 } })).toThrow(FuryMissionError);
  });

  it('CHANGE_MODEL and HANDOFF respect the privacy boundary and record the capsule', () => {
    const { mc } = setup();
    mc.act('fix', 'START');
    mc.report('fix', { files: ['src/auth/login.ts'], receiptId: 'rcpt_1', progress: 0.4 });
    mc.act('fix', 'HANDOFF', { bindingId: 'local-qwen' });
    const received = mc.workers().find((w) => w.workerId === 'fix@local-qwen')!;
    expect(received).toMatchObject({ state: 'queued', progress: 0.4, files: ['src/auth/login.ts'] });
    expect(mc.worker('fix').state).toBe('handed-off');
    expect(mc.timeline({ type: 'HANDOFF_RECEIVED' })[0]?.data).toMatchObject({ fromWorker: 'fix', capsule: { receiptIds: ['rcpt_1'] } });

    const priv = setup({ privacy: 'local-only' });
    expect(priv.plan.status).toBe('PLANNED');
    expect(() => priv.mc.act('fix', 'CHANGE_MODEL', { bindingId: 'cc' })).toThrow(/local-only/u);
  });

  it('detects any tampering with the replay log', () => {
    const { mc } = setup();
    mc.act('fix', 'START');
    mc.report('fix', { error: 'pnpm test exited 1' });
    const log = mc.replay();
    expect(verifyFuryReplay(log).ok).toBe(true);
    const edited = { ...log, entries: log.entries.map((e, i) => (i === 3 ? { ...e, data: { ...e.data, model: 'swapped' } } : e)) };
    expect(verifyFuryReplay(edited)).toEqual({ ok: false, brokenAt: 4 });
    const dropped = { ...log, entries: log.entries.filter((_, i) => i !== 2) };
    expect(verifyFuryReplay(dropped).ok).toBe(false);
    // A truncated tail still chains; only the recorded head exposes it.
    const head = furyReplayHead(log);
    const truncated = { ...log, entries: log.entries.slice(0, -1) };
    expect(verifyFuryReplay(truncated).ok).toBe(true);
    expect(verifyFuryReplay(truncated, head)).toMatchObject({ ok: false, truncated: true });
    expect(verifyFuryReplay(log, head)).toEqual({ ok: true });
    expect(explainFuryReplay(log, 'fix')).toMatchObject({ routing: { harnessId: 'claude-code' }, actions: ['START'], failedCommands: ['pnpm test exited 1'] });
  });

  it('forks a replay at a checkpoint changing exactly one axis', () => {
    const { mc } = setup();
    mc.act('fix', 'START');
    const parent = mc.replay();
    const child = forkFuryReplay(parent, { atSeq: 3, replayId: 'run-1-codex', axis: 'runtime', from: 'claude-code', to: 'codex', now: () => 5 });
    expect(verifyFuryReplay(child).ok).toBe(true);
    expect(child.entries.map((e) => e.type)).toEqual(['TASK', 'DISPATCH', 'ROUTING', 'FORK']);
    expect(child.parent).toEqual({ replayId: 'run-1', atSeq: 3 });
    expect(child.entries[2]?.hash).toBe(parent.entries[2]?.hash);
    expect(() => forkFuryReplay(parent, { atSeq: 3, replayId: 'x', axis: 'model', from: 'a', to: 'a' })).toThrow(/change/u);
    expect(() => forkFuryReplay(parent, { atSeq: 99, replayId: 'x', axis: 'model', from: 'a', to: 'b' })).toThrow(/outside/u);
    const corrupt = { ...parent, entries: parent.entries.map((e, i) => (i === 0 ? { ...e, at: 0 } : e)) };
    expect(() => forkFuryReplay(corrupt, { atSeq: 1, replayId: 'x', axis: 'model', from: 'a', to: 'b' })).toThrow(/corrupt/u);
  });
});
