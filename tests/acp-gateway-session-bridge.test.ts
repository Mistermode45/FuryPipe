import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as acp from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FURY_GATEWAY_CONVERSATION_RESULT_FORMAT,
  createFuryGatewayConversationAdapter,
  type FuryGatewayConversationAdapter,
} from '../src/gateway-conversation-adapter-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';
import {
  createFuryAcpV1Server,
  isGeneratedFuryAcpV1SessionSnapshot,
  type FuryAcpV1SessionSnapshot,
} from '../src/acp-v1-server-node.js';
import {
  createFuryAcpGatewaySessionBridge,
  FuryAcpGatewaySessionBridgeError,
} from '../src/acp-gateway-session-bridge-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function recoveryRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'furypipe-acp-gateway-bridge-'),
  );
  tempDirs.push(dir);
  return dir;
}

function gatewayHarness(
  scopes: readonly FuryGatewayScope[],
  recovery = createRecoveryStore(recoveryRoot(), {
    namespace: 'acp_bridge',
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
  }),
) {
  let now = 100_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => now,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:user-1',
    kind: 'human',
    issuer: 'local',
    subject: 'user-1-local-account',
    authenticationMethod: 'local-owner',
  });
  const sessions = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-acp-test',
    now: () => now,
  });
  const gatewaySession = sessions.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  const kernel = createFuryKernelConversationStore({
    now: () => now,
  });
  const conversationAdapter = createFuryGatewayConversationAdapter({
    kernel,
  });
  return {
    recovery,
    principalRegistry,
    principal,
    sessions,
    gatewaySession,
    kernel,
    conversationAdapter,
    get now() { return now; },
    set now(value: number) { now = value; },
  };
}

describe('FuryPipe ACP Gateway session bridge', () => {
  it('binds session/new to bounded Kernel state and revalidates every prompt', async () => {
    const harness = gatewayHarness(['conversations.write']);
    let promptCalls = 0;
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
      now: () => harness.now,
    });
    const server = createFuryAcpV1Server({
      now: () => harness.now,
      sessionHooks: bridge.sessionHooks,
      promptHandler: async (context) => {
        promptCalls += 1;
        await context.emitText('accepted after current Gateway admission');
        return { stopReason: 'end_turn' };
      },
    });

    const result = await acp.client({ name: 'bridge-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        const session = await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace/project',
          mcpServers: [],
        });
        const response = await agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'hello' }],
        });
        return { session, response };
      },
    );

    expect(result.response.stopReason).toBe('end_turn');
    expect(promptCalls).toBe(1);
    expect(bridge.activeBindingCount()).toBe(1);
    expect(harness.kernel.activeConversationCount()).toBe(1);

    const snapshot = server.inspectSession(result.session.sessionId);
    expect(isGeneratedFuryAcpV1SessionSnapshot(snapshot)).toBe(true);
    const binding = bridge.inspectBinding(snapshot);
    expect(binding).toMatchObject({
      authority: 'session-mapping-only',
      executionAuthority: false,
    });
    expect(binding?.conversationId).toMatch(/^fkc_[A-Za-z0-9_-]{24}$/u);

    const admission = bridge.revalidatePrompt(snapshot);
    expect(admission).toMatchObject({
      outcome: 'eligible',
      authority: 'gateway-admission-only',
      executionAuthority: false,
      conversationId: binding?.conversationId,
    });
    expect(admission.decisionIdSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects copied Gateway session evidence before a binding can exist', () => {
    const harness = gatewayHarness(['conversations.write']);

    expect(() => createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: { ...harness.gatewaySession },
      conversationAdapter: harness.conversationAdapter,
    })).toThrowError(FuryAcpGatewaySessionBridgeError);
  });

  it('fails session/new closed when current Gateway scope is insufficient', async () => {
    const harness = gatewayHarness(['conversations.inspect']);
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
    });
    const server = createFuryAcpV1Server({
      sessionHooks: bridge.sessionHooks,
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    await acp.client({ name: 'scope-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        await expect(agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        })).rejects.toMatchObject({
          code: -32020,
          data: { code: 'gateway-admission-denied' },
        });
      },
    );

    expect(server.sessionCount()).toBe(0);
    expect(bridge.activeBindingCount()).toBe(0);
    expect(harness.kernel.activeConversationCount()).toBe(0);
  });

  it('revocation after binding blocks the next prompt before the handler runs', async () => {
    const harness = gatewayHarness(['conversations.write']);
    let promptCalls = 0;
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
    });
    const server = createFuryAcpV1Server({
      sessionHooks: bridge.sessionHooks,
      promptHandler: async () => {
        promptCalls += 1;
        return { stopReason: 'end_turn' };
      },
    });

    await acp.client({ name: 'revoke-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        const session = await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        });
        expect(harness.sessions.revokeSession(
          harness.gatewaySession.sessionId,
        )).toBe(true);

        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'must not execute' }],
        })).rejects.toMatchObject({
          code: -32020,
          data: { code: 'gateway-admission-denied' },
        });
      },
    );

    expect(promptCalls).toBe(0);
  });

  it('durable evidence contains digests only and cannot reactivate a mapping after restart', async () => {
    const harness = gatewayHarness(['conversations.write']);
    const knownConversationId = 'fkc_AAAAAAAAAAAAAAAAAAAAAAAA';
    const fakeAdapter: FuryGatewayConversationAdapter = {
      dispatch(commandName) {
        if (commandName === 'conversation.open') {
          return {
            format: FURY_GATEWAY_CONVERSATION_RESULT_FORMAT,
            commandName,
            status: 'ok',
            result: { conversationId: knownConversationId },
            authority: 'conversation-state',
            executionAuthority: false,
          };
        }
        return {
          format: FURY_GATEWAY_CONVERSATION_RESULT_FORMAT,
          commandName,
          status: 'ok',
          result: { status: 'closed', executionAuthority: false },
          authority: 'conversation-state',
          executionAuthority: false,
        };
      },
    };

    const first = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: fakeAdapter,
    });
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    let sessionId = '';
    await acp.client({ name: 'evidence-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        sessionId = (await agent.request(acp.methods.agent.session.new, {
          cwd: '/very/private/workspace',
          mcpServers: [],
        })).sessionId;
      },
    );
    const snapshot = server.inspectSession(sessionId);
    const binding = await first.bind(snapshot);
    expect(binding.conversationId).toBe(knownConversationId);

    const handles = await harness.recovery.list!({
      metadata: {
        system: 'acp-gateway-session-bridge',
        kind: 'binding',
      },
      limit: 10,
    });
    expect(handles).toHaveLength(1);
    const raw = Buffer.from(
      await harness.recovery.get(handles[0]!),
    ).toString('utf8');
    const metadata = JSON.stringify(handles[0]!.metadata);

    for (const secretValue of [
      sessionId,
      harness.gatewaySession.sessionId,
      harness.principal.principalId,
      knownConversationId,
      '/very/private/workspace',
    ]) {
      expect(raw).not.toContain(secretValue);
      expect(metadata).not.toContain(secretValue);
    }

    const durable = await first.listEvidence();
    expect(durable).toHaveLength(1);
    expect(durable[0]).toMatchObject({
      state: 'bound',
      authority: 'evidence-only',
      executionAuthority: false,
    });

    const restarted = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: fakeAdapter,
    });
    expect(await restarted.listEvidence()).toEqual(durable);
    expect(restarted.activeBindingCount()).toBe(0);
    expect(() => restarted.revalidatePrompt(snapshot)).toThrowError(
      /not bound/u,
    );
  });

  it('concurrent bind attempts converge on one Kernel conversation and one durable record', async () => {
    const harness = gatewayHarness(['conversations.write']);
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
    });
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    let sessionId = '';
    await acp.client({ name: 'race-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        sessionId = (await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        })).sessionId;
      },
    );
    const snapshot = server.inspectSession(sessionId);
    const [left, right] = await Promise.all([
      bridge.bind(snapshot),
      bridge.bind(snapshot),
    ]);

    expect(left).toEqual(right);
    expect(harness.kernel.activeConversationCount()).toBe(1);
    expect(bridge.activeBindingCount()).toBe(1);
    expect(await bridge.listEvidence()).toHaveLength(1);
  });

  it('keeps cancellation authority-reducing even if Gateway authority is revoked mid-prompt', async () => {
    const harness = gatewayHarness(['conversations.write']);
    const started = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
    });
    const server = createFuryAcpV1Server({
      sessionHooks: bridge.sessionHooks,
      promptHandler: async (context) => {
        observedSignal = context.signal;
        started.resolve();
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
            return;
          }
          context.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
        return { stopReason: 'cancelled' };
      },
    });

    const stopReason = await acp.client({ name: 'cancel-bridge-client' })
      .connectWith(server.app, async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        const session = await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        });
        const pending = agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'long work' }],
        });
        await started.promise;
        harness.sessions.revokeSession(harness.gatewaySession.sessionId);
        await agent.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        });
        return (await pending).stopReason;
      });

    expect(stopReason).toBe('cancelled');
    expect(observedSignal?.aborted).toBe(true);
  });

  it('rejects copied ACP session snapshots at the bridge boundary', async () => {
    const harness = gatewayHarness(['conversations.write']);
    const bridge = createFuryAcpGatewaySessionBridge({
      recovery: harness.recovery,
      gatewaySessionCoordinator: harness.sessions,
      gatewaySession: harness.gatewaySession,
      conversationAdapter: harness.conversationAdapter,
    });
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    let sessionId = '';
    await acp.client({ name: 'copy-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        sessionId = (await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        })).sessionId;
      },
    );
    const snapshot: FuryAcpV1SessionSnapshot =
      server.inspectSession(sessionId);
    expect(() => bridge.inspectBinding({ ...snapshot })).toThrowError(
      /ACP session evidence is invalid/u,
    );
  });
});
