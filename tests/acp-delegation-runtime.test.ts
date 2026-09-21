import { describe, expect, it } from 'vitest';

import { createCodingSandbox } from '../src/coding-runtime.js';
import {
  createFuryAcpExternalAgentRegistry,
  createFuryAcpExternalClientRuntime,
} from '../src/acp-external-client-runtime-node.js';
import {
  FURY_ACP_DELEGATION_POLICY_FORMAT,
  FuryAcpDelegationError,
  createFuryAcpDelegationGate,
  createFuryAcpDelegationRuntime,
  prepareFuryAcpDelegationRequest,
} from '../src/acp-delegation-runtime-node.js';

type FixtureMode = 'normal' | 'tool' | 'disconnect' | 'oversize';

function agentScript(mode: FixtureMode): string {
  return [
    "const acp = await import('@agentclientprotocol/sdk');",
    "const { Readable, Writable } = await import('node:stream');",
    "const app = acp.agent({ name: 'delegation-fixture-agent' })",
    "  .onRequest(acp.methods.agent.initialize, () => ({",
    "    protocolVersion: acp.PROTOCOL_VERSION,",
    "    agentCapabilities: { loadSession: false, promptCapabilities: {} },",
    "    authMethods: [],",
    "    agentInfo: { name: 'delegation-fixture-agent', version: '1.0.0' },",
    "  }))",
    "  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'delegation-session' }))",
    "  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {",
    ...(mode === 'tool'
      ? [
          "    await ctx.client.notify(acp.methods.client.session.update, {",
          "      sessionId: ctx.params.sessionId,",
          "      update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'fixture tool' },",
          "    });",
        ]
      : []),
    ...(mode === 'disconnect'
      ? [
          "    setTimeout(() => process.exit(0), 5);",
          "    await new Promise(() => {});",
        ]
      : [
          "    await ctx.client.notify(acp.methods.client.session.update, {",
          "      sessionId: ctx.params.sessionId,",
          "      update: {",
          "        sessionUpdate: 'agent_message_chunk',",
          "        content: { type: 'text', text: " + (mode === 'oversize' ? "'x'.repeat(4096)" : "'delegated result'") + " },",
          "      },",
          "    });",
          "    return { stopReason: 'end_turn' };",
        ]),
    "  });",
    "const connection = app.connect(acp.ndJsonStream(",
    "  Writable.toWeb(process.stdout),",
    "  Readable.toWeb(process.stdin),",
    "));",
    "await connection.closed;",
  ].join('\n');
}

async function openFixture(mode: FixtureMode = 'normal') {
  const sandbox = await createCodingSandbox({
    policyId: 'acp-delegation-test',
    rootPath: process.cwd(),
    readRoots: ['.'],
    writeRoots: ['.'],
    allowedCommands: ['node'],
    maxOutputBytes: 1024 * 1024,
    maxProcesses: 2,
    maxTimeoutMs: 15_000,
  });
  const registry = createFuryAcpExternalAgentRegistry([{
    agentId: 'fixture',
    command: 'node',
    args: ['--input-type=module', '-e', agentScript(mode)],
    cwd: '.',
    expectedAgentName: 'delegation-fixture-agent',
    startupTimeoutMs: 10_000,
  }]);
  const descriptor = registry.resolve('fixture');
  if (!descriptor) throw new Error('fixture descriptor missing');
  const external = createFuryAcpExternalClientRuntime({
    registry,
    sandbox,
  });
  const session = await external.openSession(descriptor);
  return { external, session };
}

function requestFor(
  session: Awaited<ReturnType<typeof openFixture>>['session'],
  overrides: Partial<{
    principalId: string;
    task: string;
    capabilities: readonly ('prompt:text' | 'observe:agent-text' | 'observe:tool-calls')[];
    budget: {
      maxWallTimeMs: number;
      maxMessages: number;
      maxToolCalls: number;
      maxBytesIn: number;
      maxBytesOut: number;
    };
  }> = {},
) {
  return prepareFuryAcpDelegationRequest({
    session,
    principalId: overrides.principalId ?? 'principal:test',
    task: overrides.task ?? 'perform the bounded fixture task',
    capabilities: overrides.capabilities ?? ['prompt:text', 'observe:agent-text'],
    budget: overrides.budget ?? {
      maxWallTimeMs: 5_000,
      maxMessages: 8,
      maxToolCalls: 0,
      maxBytesIn: 4_096,
      maxBytesOut: 64 * 1024,
    },
  });
}

function policyFor(
  request: ReturnType<typeof requestFor>,
  overrides: Partial<{
    principalId: string;
    agentId: string;
    allowedCapabilities: readonly ('prompt:text' | 'observe:agent-text' | 'observe:tool-calls')[];
    maxBudget: {
      maxWallTimeMs: number;
      maxMessages: number;
      maxToolCalls: number;
      maxBytesIn: number;
      maxBytesOut: number;
    };
    expiresInMs: number;
  }> = {},
) {
  return {
    format: FURY_ACP_DELEGATION_POLICY_FORMAT,
    policyId: 'delegation-policy-test',
    allowDelegation: true,
    principalId: overrides.principalId ?? 'principal:test',
    agentId: overrides.agentId ?? request.agentId,
    allowedCapabilities: overrides.allowedCapabilities ?? request.capabilities,
    maxBudget: overrides.maxBudget ?? request.budget,
    expiresInMs: overrides.expiresInMs ?? 5_000,
  } as const;
}

describe('FuryPipe ACP Gate 8.8 governed delegation permits', () => {
  it('binds exact task/session/root/capability/budget and accepts only independently verified output', async () => {
    const { external, session } = await openFixture();
    try {
      const request = requestFor(session);
      const permit = createFuryAcpDelegationGate().authorize(
        request,
        policyFor(request),
      );
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult(input) {
          return input.outputText === 'delegated result' ? 'verified' : 'rejected';
        },
      });
      const result = await runtime.execute(request, permit);

      expect(result.outputText).toBe('delegated result');
      expect(result.receipt).toMatchObject({
        requestSha256: request.requestSha256,
        agentIdentitySha256: request.agentIdentitySha256,
        workspaceRootSha256: request.workspaceRootSha256,
        taskSha256: request.taskSha256,
        capabilitiesSha256: request.capabilitiesSha256,
        budgetSha256: request.budgetSha256,
        outcome: 'completed',
        stopReason: 'end_turn',
        verificationStatus: 'verified',
        accepted: true,
        automaticReplayAllowed: false,
        executionAuthority: false,
        delegationAuthority: false,
      });
      expect(result.receipt.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.receipt.permitIdSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(result.receipt)).not.toContain('delegated result');
      await expect(runtime.execute(request, permit)).rejects.toMatchObject({
        code: 'permit-consumed',
      });
    } finally {
      await external.closeSession(session);
    }
  });

  it('rejects copied permits and mismatched request/permit pairs', async () => {
    const { external, session } = await openFixture();
    try {
      const first = requestFor(session, { task: 'first exact task' });
      const second = requestFor(session, { task: 'second exact task' });
      const gate = createFuryAcpDelegationGate();
      const permit = gate.authorize(first, policyFor(first));
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult: () => 'verified',
      });

      await expect(
        runtime.execute(first, { ...permit }),
      ).rejects.toMatchObject({ code: 'permit-invalid' });
      await expect(
        runtime.execute(second, permit),
      ).rejects.toMatchObject({ code: 'permit-mismatch' });
    } finally {
      await external.closeSession(session);
    }
  });

  it('denies principal, agent, capability, and budget policy mismatches', async () => {
    const { external, session } = await openFixture();
    try {
      const request = requestFor(session);
      const gate = createFuryAcpDelegationGate();

      expect(() => gate.authorize(
        request,
        policyFor(request, { principalId: 'principal:other' }),
      )).toThrowError(FuryAcpDelegationError);

      expect(() => gate.authorize(
        request,
        policyFor(request, { agentId: 'other-agent' }),
      )).toThrowError(FuryAcpDelegationError);

      const withTools = requestFor(session, {
        capabilities: ['prompt:text', 'observe:agent-text', 'observe:tool-calls'],
        budget: {
          maxWallTimeMs: 5_000,
          maxMessages: 8,
          maxToolCalls: 1,
          maxBytesIn: 4_096,
          maxBytesOut: 64 * 1024,
        },
      });
      expect(() => gate.authorize(
        withTools,
        policyFor(withTools, {
          allowedCapabilities: ['prompt:text', 'observe:agent-text'],
          maxBudget: withTools.budget,
        }),
      )).toThrowError(FuryAcpDelegationError);

      expect(() => gate.authorize(
        request,
        policyFor(request, {
          maxBudget: {
            ...request.budget,
            maxBytesOut: request.budget.maxBytesOut - 1,
          },
        }),
      )).toThrowError(FuryAcpDelegationError);
    } finally {
      await external.closeSession(session);
    }
  });

  it('expires permits and consumes expired authority', async () => {
    const { external, session } = await openFixture();
    try {
      let now = 1_000;
      const request = requestFor(session);
      const gate = createFuryAcpDelegationGate({ now: () => now });
      const permit = gate.authorize(
        request,
        policyFor(request, { expiresInMs: 10 }),
      );
      now = 1_010;
      const runtime = createFuryAcpDelegationRuntime({
        now: () => now,
        verifyResult: () => 'verified',
      });
      await expect(runtime.execute(request, permit)).rejects.toMatchObject({
        code: 'permit-expired',
      });
      await expect(runtime.execute(request, permit)).rejects.toMatchObject({
        code: 'permit-consumed',
      });
    } finally {
      await external.closeSession(session);
    }
  });

  it('keeps completed external output advisory when independent verification rejects it', async () => {
    const { external, session } = await openFixture();
    try {
      const request = requestFor(session);
      const permit = createFuryAcpDelegationGate().authorize(
        request,
        policyFor(request),
      );
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult: () => 'rejected',
      });
      const result = await runtime.execute(request, permit);
      expect(result.receipt).toMatchObject({
        outcome: 'completed',
        verificationStatus: 'rejected',
        accepted: false,
        automaticReplayAllowed: false,
      });
    } finally {
      await external.closeSession(session);
    }
  });

  it('marks unpermitted external tool activity unknown and never auto-replays', async () => {
    const { external, session } = await openFixture('tool');
    try {
      const request = requestFor(session, {
        capabilities: ['prompt:text', 'observe:agent-text'],
        budget: {
          maxWallTimeMs: 5_000,
          maxMessages: 8,
          maxToolCalls: 0,
          maxBytesIn: 4_096,
          maxBytesOut: 64 * 1024,
        },
      });
      const permit = createFuryAcpDelegationGate().authorize(
        request,
        policyFor(request),
      );
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult: () => {
          throw new Error('verifier must not run for unknown outcome');
        },
      });
      const result = await runtime.execute(request, permit);
      expect(result.receipt).toMatchObject({
        outcome: 'unknown',
        errorCode: 'capability-violation',
        verificationStatus: 'not-run',
        accepted: false,
        automaticReplayAllowed: false,
      });
    } finally {
      await external.closeSession(session);
    }
  });

  it('keeps returned plaintext within maxBytesOut when one update exceeds the budget', async () => {
    const { external, session } = await openFixture('oversize');
    try {
      const request = requestFor(session, {
        budget: {
          maxWallTimeMs: 5_000,
          maxMessages: 8,
          maxToolCalls: 0,
          maxBytesIn: 4_096,
          maxBytesOut: 64,
        },
      });
      const permit = createFuryAcpDelegationGate().authorize(
        request,
        policyFor(request),
      );
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult: () => {
          throw new Error('verifier must not run after output limit');
        },
      });
      const result = await runtime.execute(request, permit);
      expect(result.outputText).toBe('');
      expect(Buffer.byteLength(result.outputText, 'utf8')).toBeLessThanOrEqual(
        request.budget.maxBytesOut,
      );
      expect(result.receipt).toMatchObject({
        outcome: 'unknown',
        errorCode: 'output-limit',
        verificationStatus: 'not-run',
        accepted: false,
        automaticReplayAllowed: false,
      });
    } finally {
      await external.closeSession(session);
    }
  });

  it('marks transport loss after prompt invocation unknown', async () => {
    const { external, session } = await openFixture('disconnect');
    try {
      const request = requestFor(session);
      const permit = createFuryAcpDelegationGate().authorize(
        request,
        policyFor(request),
      );
      const runtime = createFuryAcpDelegationRuntime({
        verifyResult: () => 'verified',
      });
      const result = await runtime.execute(request, permit);
      expect(result.receipt).toMatchObject({
        outcome: 'unknown',
        errorCode: 'transport-unknown',
        verificationStatus: 'not-run',
        accepted: false,
        automaticReplayAllowed: false,
      });
    } finally {
      try {
        await external.closeSession(session);
      } catch {
        // The fixture intentionally terminated its process.
      }
    }
  });

  it('rejects new delegation requests from a closed external session', async () => {
    const { external, session } = await openFixture();
    await external.closeSession(session);
    expect(() => requestFor(session)).toThrowError(FuryAcpDelegationError);
  });
});
