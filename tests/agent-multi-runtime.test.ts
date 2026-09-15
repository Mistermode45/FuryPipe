import { describe, expect, it } from 'vitest';
import { runAgent, type AgentRuntimeRequest } from '../src/agent-runtime.js';

function baseExecutors(): AgentRuntimeRequest['executors'] {
  return {
    research: async () => ({ evidence: ['research'], consumedTokens: 1 }),
    plan: async () => ({ evidence: ['plan'], consumedTokens: 10 }),
    implement: async () => ({ evidence: ['implement'], consumedTokens: 10 }),
    review: async () => ({ evidence: ['review'], consumedTokens: 10 }),
    verify: async () => ({ evidence: ['verify'], consumedTokens: 10 }),
  };
}

describe('Agent multi-subagent runtime', () => {
  it('runs subagents concurrently with a hard concurrency bound and deterministic result order', async () => {
    let active = 0;
    let peak = 0;
    const delays: Record<string, number> = { a: 15, b: 2, c: 8 };
    const completed: string[] = [];

    const result = await runAgent({
      objective: 'Research three independent evidence tracks.',
      runId: 'multi-agent-order',
      maxSubagentConcurrency: 2,
      executors: {
        ...baseExecutors(),
        research: async (context) => {
          const batch = await context.invokeSubagents(['a', 'b', 'c']);
          expect(batch.map((item) => item.id)).toEqual(['a', 'b', 'c']);
          expect(batch.map((item) => item.evidence[0])).toEqual(['evidence-a', 'evidence-b', 'evidence-c']);
          return { evidence: ['batch-reviewed'], consumedTokens: 1 };
        },
      },
      subagents: ['a', 'b', 'c'].map((id) => ({
        id,
        stages: ['research'] as const,
        execute: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, delays[id]));
          active -= 1;
          completed.push(id);
          return { evidence: [`evidence-${id}`], consumedTokens: 3 };
        },
      })),
    });

    expect(result.status).toBe('completed');
    expect(peak).toBe(2);
    expect(completed[0]).toBe('b');
    expect(result.contextUsedTokens).toBe(50);
  });

  it('counts parallel subagent tokens against the parent context budget', async () => {
    const result = await runAgent({
      objective: 'Keep the multi-agent run inside its budget.',
      contextBudgetTokens: 256,
      maxSubagentConcurrency: 3,
      executors: {
        ...baseExecutors(),
        research: async (context) => {
          await context.invokeSubagents(['a', 'b', 'c']);
          return { evidence: ['batch'], consumedTokens: 1 };
        },
      },
      subagents: ['a', 'b', 'c'].map((id) => ({
        id,
        stages: ['research'] as const,
        execute: async () => ({ evidence: [`evidence-${id}`], consumedTokens: 100 }),
      })),
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'CONTEXT_BUDGET_EXCEEDED', stage: 'research' },
    });
  });

  it('classifies blocked subagents as SUBAGENT_BLOCKED instead of generic stage failure', async () => {
    const result = await runAgent({
      objective: 'Reject a subagent requiring ambient network.',
      executors: {
        ...baseExecutors(),
        research: async (context) => {
          await context.invokeSubagents(['network-agent']);
          return { evidence: ['never'], consumedTokens: 1 };
        },
      },
      subagents: [{
        id: 'network-agent',
        stages: ['research'],
        network: 'required',
        execute: async () => ({ evidence: ['never'], consumedTokens: 1 }),
      }],
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'SUBAGENT_BLOCKED',
        stage: 'research',
        reason: expect.stringContaining('network access is disabled'),
      },
    });
  });

  it('rejects duplicate/oversized batches and invalid concurrency configuration', async () => {
    const duplicate = await runAgent({
      objective: 'Reject duplicate agent IDs.',
      executors: {
        ...baseExecutors(),
        research: async (context) => {
          await context.invokeSubagents(['a', 'a']);
          return { evidence: ['never'], consumedTokens: 1 };
        },
      },
      subagents: [{
        id: 'a',
        stages: ['research'],
        execute: async () => ({ evidence: ['a'], consumedTokens: 1 }),
      }],
    });
    expect(duplicate.failure?.code).toBe('SUBAGENT_BLOCKED');

    const invalidConcurrency = await runAgent({
      objective: 'Reject unbounded concurrency.',
      maxSubagentConcurrency: 9,
      executors: baseExecutors(),
    });
    expect(invalidConcurrency).toMatchObject({
      status: 'failed',
      failure: { code: 'INVALID_REQUEST', reason: expect.stringContaining('maxSubagentConcurrency') },
    });
  });

  it('keeps scoped-write permission confined to implement even in a batch', async () => {
    const seen: Array<{ id: string; permission: string; paths: readonly string[] }> = [];
    const result = await runAgent({
      objective: 'Apply two approved implementation tracks.',
      allowWrites: true,
      allowedWritePaths: ['src/approved-a.ts', 'src/approved-b.ts'],
      maxSubagentConcurrency: 2,
      executors: {
        ...baseExecutors(),
        implement: async (context) => {
          const batch = await context.invokeSubagents(['impl-a', 'impl-b']);
          expect(batch).toHaveLength(2);
          return { evidence: ['implementation-reviewed'], consumedTokens: 1 };
        },
      },
      subagents: ['impl-a', 'impl-b'].map((id) => ({
        id,
        stages: ['implement'] as const,
        permission: 'scoped-write' as const,
        execute: async (context) => {
          seen.push({ id, permission: context.permission, paths: context.allowedWritePaths });
          return { evidence: [`${id}-evidence`], consumedTokens: 2 };
        },
      })),
    });

    expect(result.status).toBe('completed');
    expect(seen).toHaveLength(2);
    expect(seen.every((item) => item.permission === 'scoped-write')).toBe(true);
    expect(seen.every((item) => item.paths.length === 2)).toBe(true);
  });
});
