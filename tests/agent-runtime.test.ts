import { describe, expect, it } from 'vitest';
import {
  createRecoveryAgentMemoryStore,
  createInMemoryAgentMemoryStore,
  runAgent,
  type AgentRuntimeRequest,
} from '../src/agent-runtime.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoveryStore } from '../src/core/recovery-store.js';

function stageExecutors(seen: string[], consumedTokens = 10): AgentRuntimeRequest['executors'] {
  return {
    research: async (context) => {
      seen.push(context.stage);
      return { evidence: ['research-evidence'], consumedTokens };
    },
    plan: async (context) => {
      seen.push(context.stage);
      return { evidence: ['plan-evidence'], consumedTokens };
    },
    implement: async (context) => {
      seen.push(`${context.stage}:${context.permission}`);
      return { evidence: ['implementation-evidence'], consumedTokens };
    },
    review: async (context) => {
      seen.push(context.stage);
      return { evidence: ['review-evidence'], consumedTokens };
    },
    verify: async (context) => {
      seen.push(context.stage);
      return { evidence: ['verification-evidence'], consumedTokens };
    },
  };
}

describe('FuryPipe Agent runtime', () => {
  it('fails closed when bounded in-memory records or execution claims reach capacity', async () => {
    const recordMemory = createInMemoryAgentMemoryStore();
    const record = (runId: string) => ({
      format: 'furypipe-agent-memory-record/v1' as const,
      runId,
      stage: 'research' as const,
      resultDigest: 'opaque-digest',
      status: 'completed' as const,
      consumedTokens: 1,
    });
    for (let index = 0; index < 10_000; index += 1) await recordMemory.append(record(`bounded-${index}`));
    await expect(recordMemory.append(record('bounded-overflow'))).rejects.toThrow(/record limit/);

    const claimMemory = createInMemoryAgentMemoryStore();
    for (let index = 0; index < 10_000; index += 1) {
      expect(await claimMemory.claimExecution!(`bounded-${index}`, 'start')).toBe(true);
    }
    await expect(claimMemory.claimExecution!('bounded-overflow', 'start')).rejects.toThrow(/claim limit/);
  });

  it('does not expose mutable in-memory history records', async () => {
    const memory = createInMemoryAgentMemoryStore();
    await memory.append({
      format: 'furypipe-agent-memory-record/v1',
      runId: 'immutable-history',
      stage: 'research',
      resultDigest: 'opaque-digest',
      status: 'handoff_required',
      consumedTokens: 3,
    });
    const listed = await memory.list('immutable-history');
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(() => {
      (listed[0] as { consumedTokens: number }).consumedTokens = 999;
    }).toThrow();
    expect((await memory.list('immutable-history'))[0]?.consumedTokens).toBe(3);
  });

  it('fails closed when a custom memory adapter returns a non-boolean execution claim', async () => {
    const result = await runAgent({
      objective: 'Reject malformed claim adapters.',
      runId: 'malformed-claim-adapter',
      executors: stageExecutors([]),
      memory: {
        async append() {},
        async list() { return []; },
        async claimExecution() { return 'yes' as unknown as boolean; },
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'MEMORY_FAILED',
        reason: 'agent execution claim could not be recorded',
      },
    });
  });

  it('executes the real stage callbacks in order with read-only defaults', async () => {
    const seen: string[] = [];
    let skillCalled = false;
    let mcpCalled = false;
    let subagentCalled = false;
    const result = await runAgent({
      objective: 'Inspect the provider routing safely.',
      runId: 'agent-read-only',
      executors: {
        ...stageExecutors(seen),
        research: async (context) => {
          seen.push(context.stage);
          expect(context.permission).toBe('read');
          expect(context.allowedWritePaths).toEqual([]);
          expect(context.network).toBe('disabled');
          expect(context.secrets).toBe('never_requested');
          await context.invokeSkill('repo-reader');
          expect(await context.invokeMcp('local-inspection', 'list')).toEqual({ ok: true });
          expect(await context.invokeSubagent('research-helper')).toMatchObject({ evidence: ['subagent-evidence'] });
          return { evidence: ['research-evidence'], consumedTokens: 10 };
        },
      },
      skills: [{
        id: 'repo-reader', version: '1.0.0', stages: ['research'],
        health: async () => ({ status: 'healthy' }),
        execute: async (context) => {
          skillCalled = true;
          expect(context.permission).toBe('read');
          expect(context.network).toBe('disabled');
          return { evidence: ['skill-evidence'], consumedTokens: 1 };
        },
      }],
      mcpServers: [{
        id: 'local-inspection', allowedMethods: ['list'],
        execute: async (method, params, context) => {
          mcpCalled = true;
          expect(method).toBe('list');
          expect(params).toBeUndefined();
          expect(context.network).toBe('disabled');
          return { ok: true };
        },
      }],
      subagents: [{
        id: 'research-helper', stages: ['research'],
        execute: async (context) => {
          subagentCalled = true;
          expect(context.permission).toBe('read');
          expect(context.allowedWritePaths).toEqual([]);
          return { evidence: ['subagent-evidence'], consumedTokens: 2 };
        },
      }],
    });

    expect(result.status).toBe('completed');
    expect(result.completedStages).toEqual(['research', 'plan', 'implement', 'review', 'verify']);
    expect(result.skillHealth).toEqual({ 'repo-reader': 'healthy' });
    expect(skillCalled).toBe(true);
    expect(mcpCalled).toBe(true);
    expect(subagentCalled).toBe(true);
    expect(result.capabilityExecutions).toEqual([
      expect.objectContaining({
        format: 'furypipe-agent-capability-execution/v1',
        kind: 'skill',
        id: 'repo-reader',
        stage: 'research',
        invocation: 'manual',
        status: 'executed',
        consumedTokens: 1,
      }),
      expect.objectContaining({
        format: 'furypipe-agent-capability-execution/v1',
        kind: 'mcp',
        id: 'local-inspection',
        stage: 'research',
        invocation: 'manual',
        status: 'executed',
        method: 'list',
      }),
      expect.objectContaining({
        format: 'furypipe-agent-capability-execution/v1',
        kind: 'subagent',
        id: 'research-helper',
        stage: 'research',
        invocation: 'manual',
        status: 'executed',
        consumedTokens: 2,
      }),
    ]);
    expect(JSON.stringify(result.capabilityExecutions)).not.toContain('skill-evidence');
    expect(JSON.stringify(result.capabilityExecutions)).not.toContain('subagent-evidence');
    expect(result.contextUsedTokens).toBe(53);
  });

  it('automatically executes capability-selected skills once before the stage executor', async () => {
    const executions: string[] = [];
    const result = await runAgent({
      objective: 'Build the selected capability workflow.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          expect(context.autoSkillExecutions).toEqual([{
            id: 'research-skill',
            evidence: ['auto-research-evidence'],
            consumedTokens: 2,
          }]);
          const repeated = await context.invokeSkill('research-skill');
          expect(repeated).toMatchObject({ evidence: ['auto-research-evidence'], consumedTokens: 2 });
          return { evidence: ['research-stage-evidence'], consumedTokens: 3 };
        },
      },
      skills: [{
        id: 'research-skill',
        version: '1.0.0',
        stages: ['research'],
        health: async () => ({ status: 'healthy' }),
        execute: async () => {
          executions.push('research-skill');
          return { evidence: ['auto-research-evidence'], consumedTokens: 2 };
        },
      }],
      autoInvokeSkillsByStage: {
        research: ['research-skill'],
      },
    });

    expect(result.status).toBe('completed');
    expect(executions).toEqual(['research-skill']);
    expect(result.skillHealth).toEqual({ 'research-skill': 'healthy' });
    expect(result.capabilityExecutions).toEqual([
      expect.objectContaining({
        kind: 'skill',
        id: 'research-skill',
        stage: 'research',
        invocation: 'automatic',
        status: 'executed',
        consumedTokens: 2,
      }),
    ]);
    // The executor's repeated invokeSkill() reused the stage cache; a planned
    // skill is therefore proven exactly once, not double-counted.
    expect(result.capabilityExecutions).toHaveLength(1);
    expect(result.contextUsedTokens).toBe(45);
  });

  it('automatically executes planned MCP calls once and reuses identical calls within the stage', async () => {
    let calls = 0;
    const result = await runAgent({
      objective: 'Use the selected MCP context once.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          expect(context.autoMcpExecutions).toEqual([{
            serverId: 'local-research',
            method: 'search',
            params: { q: 'furypipe' },
            result: { hits: 3 },
          }]);
          const repeated = await context.invokeMcp('local-research', 'search', { q: 'furypipe' });
          expect(repeated).toEqual({ hits: 3 });
          return { evidence: ['mcp-stage-evidence'], consumedTokens: 2 };
        },
      },
      mcpServers: [{
        id: 'local-research',
        allowedMethods: ['search'],
        execute: async () => {
          calls += 1;
          return { hits: 3 };
        },
      }],
      autoInvokeMcpByStage: {
        research: [{ serverId: 'local-research', method: 'search', params: { q: 'furypipe' } }],
      },
    });

    expect(result.status).toBe('completed');
    expect(calls).toBe(1);
    expect(result.capabilityExecutions).toEqual([
      expect.objectContaining({
        kind: 'mcp',
        id: 'local-research',
        stage: 'research',
        invocation: 'automatic',
        status: 'executed',
        method: 'search',
      }),
    ]);
  });

  it('does not claim a registered skill was executed when no stage invokes it', async () => {
    const result = await runAgent({
      objective: 'Keep unused capabilities observationally distinct.',
      executors: stageExecutors([]),
      skills: [{
        id: 'registered-only',
        version: '1.0.0',
        stages: ['research'],
        execute: async () => ({ evidence: ['must-not-run'], consumedTokens: 1 }),
      }],
    });
    expect(result.status).toBe('completed');
    expect(result.capabilityExecutions).toEqual([]);
    expect(result.skillHealth).toEqual({});
  });

  it('shares an in-flight identical MCP call instead of executing concurrent effects twice', async () => {
    let calls = 0;
    const result = await runAgent({
      objective: 'Coalesce concurrent MCP calls.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          const values = await Promise.all([
            context.invokeMcp('local-research', 'write', { id: 'same' }),
            context.invokeMcp('local-research', 'write', { id: 'same' }),
          ]);
          expect(values).toEqual([{ ok: true }, { ok: true }]);
          return { evidence: ['coalesced'], consumedTokens: 1 };
        },
      },
      mcpServers: [{
        id: 'local-research',
        allowedMethods: ['write'],
        execute: async () => {
          calls += 1;
          await Promise.resolve();
          return { ok: true };
        },
      }],
    });

    expect(result.status).toBe('completed');
    expect(calls).toBe(1);
  });

  it('rejects invalid or duplicate automatic MCP schedules before execution', async () => {
    const duplicate = { serverId: 'local', method: 'read', params: { id: 1 } };
    const result = await runAgent({
      objective: 'Reject duplicate MCP calls.',
      executors: stageExecutors([]),
      autoInvokeMcpByStage: {
        research: [duplicate, duplicate],
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'INVALID_REQUEST' },
    });
  });

  it('fails closed when an automatically planned MCP call is unavailable or not allowed', async () => {
    const missing = await runAgent({
      objective: 'Missing MCP.',
      executors: stageExecutors([]),
      autoInvokeMcpByStage: {
        research: [{ serverId: 'missing', method: 'search' }],
      },
    });
    expect(missing).toMatchObject({
      status: 'failed',
      failure: { code: 'MCP_BLOCKED', stage: 'research' },
    });

    const disallowed = await runAgent({
      objective: 'Disallowed MCP method.',
      executors: stageExecutors([]),
      mcpServers: [{
        id: 'mcp',
        allowedMethods: ['read'],
        execute: async () => ({ ok: true }),
      }],
      autoInvokeMcpByStage: {
        research: [{ serverId: 'mcp', method: 'delete' }],
      },
    });
    expect(disallowed).toMatchObject({
      status: 'failed',
      failure: { code: 'MCP_BLOCKED', stage: 'research' },
    });
  });

  it('rejects invalid automatic skill schedules before execution', async () => {
    const result = await runAgent({
      objective: 'Reject bad routing metadata.',
      executors: stageExecutors([]),
      autoInvokeSkillsByStage: {
        research: ['same', 'same'],
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'INVALID_REQUEST' },
    });
  });

  it('keeps implementation read-only unless scoped write is explicitly enabled', async () => {
    const readSeen: string[] = [];
    const readOnly = await runAgent({ objective: 'Review only.', executors: stageExecutors(readSeen) });
    expect(readOnly.status).toBe('completed');
    expect(readSeen).toContain('implement:read');

    const writeSeen: string[] = [];
    const scoped = await runAgent({
      objective: 'Apply the approved patch.',
      allowWrites: true,
      allowedWritePaths: ['src/approved.ts'],
      executors: {
        ...stageExecutors(writeSeen),
        implement: async (context) => {
          writeSeen.push(`${context.stage}:${context.permission}`);
          expect(context.allowedWritePaths).toEqual(['src/approved.ts']);
          return { evidence: ['scoped-write-evidence'], consumedTokens: 10 };
        },
      },
    });
    expect(scoped.status).toBe('completed');
    expect(writeSeen).toContain('implement:scoped-write');
  });

  it('blocks a run when the context budget is exceeded or evidence is missing', async () => {
    const seen: string[] = [];
    const overBudget = await runAgent({
      objective: 'Bound this run.', contextBudgetTokens: 256,
      executors: stageExecutors(seen, 100),
    });
    expect(overBudget.status).toBe('failed');
    expect(overBudget.failure).toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED', stage: 'implement' });
    expect(seen).toEqual(['research', 'plan', 'implement:read']);

    const noEvidence = await runAgent({
      objective: 'Require evidence.',
      executors: { ...stageExecutors([]), research: async () => ({ evidence: [], consumedTokens: 1 }) },
    });
    expect(noEvidence.status).toBe('failed');
    expect(noEvidence.failure).toMatchObject({ code: 'MISSING_EVIDENCE', stage: 'research' });
  });

  it('creates a handoff snapshot and resumes from the pending stage', async () => {
    let handoff = true;
    const seen: string[] = [];
    const memory = createInMemoryAgentMemoryStore();
    const request: AgentRuntimeRequest = {
      objective: 'Resume a verified workflow.',
      runId: 'agent-handoff',
      memory,
      executors: {
        ...stageExecutors(seen),
        research: async (context) => {
          seen.push(context.stage);
          if (handoff) return { status: 'handoff_required', evidence: ['handoff-evidence'], consumedTokens: 2 };
          return { evidence: ['research-evidence'], consumedTokens: 2 };
        },
      },
    };
    const paused = await runAgent(request);
    expect(paused.status).toBe('handoff_required');
    expect(paused.snapshot).toMatchObject({ nextStageIndex: 0, completedStages: [] });
    expect(JSON.stringify(paused.snapshot)).not.toContain('Resume a verified workflow.');

    const forged = {
      ...paused.snapshot!,
      nextStageIndex: 4,
      completedStages: ['research', 'plan', 'implement', 'review'] as const,
      contextUsedTokens: 0,
    };
    expect(await runAgent(request, forged)).toMatchObject({
      status: 'failed',
      failure: { code: 'INVALID_SNAPSHOT' },
    });
    expect(seen).toEqual(['research']);

    handoff = false;
    const resumed = await runAgent(request, paused.snapshot);
    expect(resumed.status).toBe('completed');
    expect(resumed.completedStages).toEqual(['research', 'plan', 'implement', 'review', 'verify']);
    expect((await memory.list('agent-handoff'))).toHaveLength(6);
  });

  it('allows only one concurrent resume of the same handoff snapshot', async () => {
    const seen: string[] = [];
    let handoff = true;
    const memory = createInMemoryAgentMemoryStore();
    const request: AgentRuntimeRequest = {
      objective: 'Do not duplicate resumed effects.',
      runId: 'agent-duplicate-resume',
      memory,
      executors: {
        ...stageExecutors(seen),
        research: async (context) => {
          seen.push(context.stage);
          if (handoff) {
            handoff = false;
            return { status: 'handoff_required', evidence: ['handoff'], consumedTokens: 1 };
          }
          return { evidence: ['research'], consumedTokens: 1 };
        },
      },
    };

    const paused = await runAgent(request);
    const results = await Promise.all([
      runAgent(request, paused.snapshot),
      runAgent(request, paused.snapshot),
    ]);

    expect(results.filter((result) => result.status === 'completed')).toHaveLength(1);
    expect(results.filter((result) => result.failure?.code === 'INVALID_SNAPSHOT')).toHaveLength(1);
    expect(seen.filter((stage) => stage === 'research')).toHaveLength(2);
    expect(seen.filter((stage) => stage === 'verify')).toHaveLength(1);
  });

  it('denies unapproved MCP methods, network skills and unhealthy skills', async () => {
    const blockedMcp = await runAgent({
      objective: 'Deny an unapproved MCP call.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          await context.invokeMcp('mcp', 'delete');
          return { evidence: ['never-reached'], consumedTokens: 1 };
        },
      },
      mcpServers: [{ id: 'mcp', allowedMethods: ['list'], execute: async () => ({}) }],
    });
    expect(blockedMcp).toMatchObject({ status: 'failed', failure: { code: 'MCP_BLOCKED', stage: 'research' } });

    const blockedSkill = await runAgent({
      objective: 'Deny a network skill.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          await context.invokeSkill('network-skill');
          return { evidence: ['never-reached'], consumedTokens: 1 };
        },
      },
      skills: [{ id: 'network-skill', version: '1.0.0', stages: ['research'], network: 'required', execute: async () => ({ evidence: ['x'], consumedTokens: 1 }) }],
    });
    expect(blockedSkill.failure?.code).toBe('SKILL_BLOCKED');

    const unhealthySkill = await runAgent({
      objective: 'Deny an unhealthy skill.',
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          await context.invokeSkill('broken-skill');
          return { evidence: ['never-reached'], consumedTokens: 1 };
        },
      },
      skills: [{ id: 'broken-skill', version: '1.0.0', stages: ['research'], health: async () => ({ status: 'unhealthy' }), execute: async () => ({ evidence: ['x'], consumedTokens: 1 }) }],
    });
    expect(unhealthySkill.failure?.code).toBe('SKILL_BLOCKED');
  });

  it('bounds capability execution receipts before invoking an unreceipted callback', async () => {
    let calls = 0;
    const result = await runAgent({
      objective: 'Bound capability execution evidence.',
      contextBudgetTokens: 16_000,
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          for (let i = 0; i < 513; i++) {
            await context.invokeSubagent('bounded-helper');
          }
          return { evidence: ['unreachable'], consumedTokens: 1 };
        },
      },
      subagents: [{
        id: 'bounded-helper',
        stages: ['research'],
        execute: async () => {
          calls += 1;
          return { evidence: ['bounded-helper-evidence'], consumedTokens: 1 };
        },
      }],
    });

    expect(result.status).toBe('failed');
    expect(result.capabilityExecutions).toHaveLength(512);
    expect(calls).toBe(512);
    expect(result.failure?.reason).toMatch(/capability execution receipt limit exceeded/);
  });

  it('compiles FuryPrompt once for stage callbacks and binds its digest to resume', async () => {
    const seenPrompts: string[] = [];
    const request: AgentRuntimeRequest = {
      objective: 'Run the approved workflow.',
      runId: 'agent-furyprompt',
      furyPrompt: { sections: { task: 'Preserve exact IDs and verify the result.' }, level: 'ENGINEERING' },
      executors: {
        ...stageExecutors([]),
        research: async (context) => {
          seenPrompts.push(context.prompt);
          return { status: 'handoff_required', evidence: ['handoff'], consumedTokens: 1 };
        },
      },
    };
    const paused = await runAgent(request);

    expect(paused.status).toBe('handoff_required');
    expect(seenPrompts).toEqual(['## Task\n"Preserve exact IDs and verify the result."']);
    expect(paused.snapshot?.furyPromptDigest).toMatch(/^fp_[a-f0-9]{64}$/);
    expect(JSON.stringify(paused.snapshot)).not.toContain('Preserve exact IDs');
    expect((await runAgent({ ...request, furyPrompt: { sections: { task: 'Changed prompt.' }, level: 'ENGINEERING' } }, paused.snapshot)).failure?.code).toBe('INVALID_SNAPSHOT');
  });

  it('persists only opaque memory records in Recovery and reopens them from a fresh store instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-agent-memory-'));
    try {
      const firstStore = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const record = {
        format: 'furypipe-agent-memory-record/v1' as const,
        runId: 'persistent-run', stage: 'research' as const,
        resultDigest: 'afrun_opaque-result', status: 'completed' as const, consumedTokens: 4,
      };
      await firstStore.append(record);
      const reopened = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      expect(await reopened.list('persistent-run')).toEqual([record]);
      const store = createRecoveryStore(root, { namespace: 'agent' });
      const handles = await store.list?.({ metadata: { source: 'agent-runtime' } });
      expect(handles).toHaveLength(1);
      expect(handles?.[0]?.metadata?.sequence).toBe(0);
      expect(new TextDecoder().decode(await store.get(handles![0]!))).not.toContain('objective');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('assigns unique Recovery history sequences across concurrent adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-agent-history-race-'));
    try {
      const firstMemory = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const secondMemory = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const base = {
        format: 'furypipe-agent-memory-record/v1' as const,
        runId: 'cross-adapter-history',
        stage: 'research' as const,
        status: 'completed' as const,
        consumedTokens: 1,
      };

      await Promise.all([
        firstMemory.append({ ...base, resultDigest: 'opaque-a' }),
        secondMemory.append({ ...base, resultDigest: 'opaque-b' }),
      ]);

      const reopened = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const records = await reopened.list('cross-adapter-history');
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.resultDigest))).toEqual(new Set(['opaque-a', 'opaque-b']));

      const raw = createRecoveryStore(root, { namespace: 'agent' });
      const handles = await raw.list?.({
        metadata: {
          source: 'agent-runtime',
          contentType: 'application/vnd.furypipe.agent-memory-record+json',
          runId: 'cross-adapter-history',
        },
      });
      expect(handles?.map((handle) => handle.metadata?.sequence).sort()).toEqual([0, 1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('atomically allows only one start across independent Recovery memory adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-agent-claim-'));
    try {
      const firstMemory = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const secondMemory = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      const seen: string[] = [];
      const request: AgentRuntimeRequest = {
        objective: 'Do not duplicate a cross-adapter start.',
        runId: 'cross-adapter-start',
        executors: stageExecutors(seen, 1),
      };

      const results = await Promise.all([
        runAgent({ ...request, memory: firstMemory }),
        runAgent({ ...request, memory: secondMemory }),
      ]);

      expect(results.filter((result) => result.status === 'completed')).toHaveLength(1);
      expect(results.filter((result) => result.failure?.code === 'INVALID_REQUEST')).toHaveLength(1);
      expect(seen).toHaveLength(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
