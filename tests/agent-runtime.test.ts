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
    expect(result.contextUsedTokens).toBe(45);
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

    handoff = false;
    const resumed = await runAgent(request, paused.snapshot);
    expect(resumed.status).toBe('completed');
    expect(resumed.completedStages).toEqual(['research', 'plan', 'implement', 'review', 'verify']);
    expect((await memory.list('agent-handoff'))).toHaveLength(6);
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
    expect(seenPrompts).toEqual(['## Task\nPreserve exact IDs and verify the result.']);
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
        resultDigest: 'afrun_opaque-result', status: 'completed' as const,
      };
      await firstStore.append(record);
      const reopened = createRecoveryAgentMemoryStore(createRecoveryStore(root, { namespace: 'agent' }));
      expect(await reopened.list('persistent-run')).toEqual([record]);
      const store = createRecoveryStore(root, { namespace: 'agent' });
      const handles = await store.list?.({ metadata: { source: 'agent-runtime' } });
      expect(handles).toHaveLength(1);
      expect(new TextDecoder().decode(await store.get(handles![0]!))).not.toContain('objective');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
