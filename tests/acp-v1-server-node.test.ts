import { describe, expect, it } from 'vitest';

import * as acp from '@agentclientprotocol/sdk';

import {
  FURY_ACP_V1_PROTOCOL_VERSION,
  FURY_ACP_V1_SERVER_FORMAT,
  createFuryAcpV1Server,
} from '../src/acp-v1-server-node.js';

describe('FuryPipe ACP v1 server foundation', () => {
  it('negotiates ACP v1, creates a bounded session, and projects text updates', async () => {
    const prompts: unknown[] = [];
    const updates: acp.SessionNotification[] = [];
    const server = createFuryAcpV1Server({
      promptHandler: async (context) => {
        prompts.push(context.prompt);
        await context.emitText('bounded response');
        return { stopReason: 'end_turn' };
      },
    });

    const result = await acp
      .client({ name: 'furypipe-acp-test-client' })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        updates.push(ctx.params);
      })
      .connectWith(server.app, async (agent) => {
        const initialized = await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
          clientInfo: { name: 'test-client', version: '1.0.0' },
        });
        const session = await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace/project',
          additionalDirectories: ['/workspace/shared'],
          mcpServers: [],
        });
        const response = await agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [
            { type: 'text', text: 'hello FuryPipe' },
            {
              type: 'resource_link',
              name: 'README',
              uri: 'file:///workspace/project/README.md',
              mimeType: 'text/markdown',
            },
          ],
        });
        return { initialized, session, response };
      });

    expect(FURY_ACP_V1_SERVER_FORMAT).toBe('furypipe-acp-v1-server/v1');
    expect(FURY_ACP_V1_PROTOCOL_VERSION).toBe(1);
    expect(result.initialized.protocolVersion).toBe(1);
    expect(result.initialized.agentCapabilities).toEqual({
      loadSession: false,
      promptCapabilities: {},
      sessionCapabilities: {
        additionalDirectories: {},
      },
    });
    expect(result.initialized.authMethods).toEqual([]);
    expect(result.response.stopReason).toBe('end_turn');
    expect(server.sessionCount()).toBe(1);

    const snapshot = server.inspectSession(result.session.sessionId);
    expect(snapshot).toMatchObject({
      cwd: '/workspace/project',
      additionalDirectories: ['/workspace/shared'],
      promptActive: false,
      authority: 'protocol-session-only',
      executionAuthority: false,
    });

    expect(prompts).toEqual([
      {
        format: 'furypipe-acp-v1-prompt/v1',
        sessionId: result.session.sessionId,
        cwd: '/workspace/project',
        additionalDirectories: ['/workspace/shared'],
        parts: [
          {
            type: 'text',
            text: 'hello FuryPipe',
            authority: 'untrusted-content',
          },
          {
            type: 'resource_link',
            name: 'README',
            uri: 'file:///workspace/project/README.md',
            mimeType: 'text/markdown',
            authority: 'untrusted-content',
          },
        ],
        executionAuthority: false,
      },
    ]);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.sessionId).toBe(result.session.sessionId);
    expect(updates[0]?.update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'bounded response' },
    });
  });

  it('returns stable protocol v1 even when a newer version is requested', async () => {
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });
    const response = await acp.client({ name: 'version-client' }).connectWith(
      server.app,
      (agent) => agent.request(acp.methods.agent.initialize, {
        protocolVersion: 2,
        clientCapabilities: {},
      }),
    );
    expect(response.protocolVersion).toBe(1);
  });

  it('refuses MCP attachment and non-absolute session roots in Gate 8.1', async () => {
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    await acp.client({ name: 'session-guard-client' }).connectWith(
      server.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        await expect(agent.request(acp.methods.agent.session.new, {
          cwd: 'relative/project',
          mcpServers: [],
        })).rejects.toMatchObject({ code: -32602 });

        await expect(agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [{
            name: 'not-yet-governed',
            command: 'node',
            args: ['server.js'],
            env: [],
          }],
        })).rejects.toMatchObject({ code: -32602 });
      },
    );
  });

  it('rejects unsupported prompt content before invoking the prompt handler', async () => {
    let calls = 0;
    const server = createFuryAcpV1Server({
      promptHandler: async () => {
        calls += 1;
        return { stopReason: 'end_turn' };
      },
    });

    await acp.client({ name: 'content-guard-client' }).connectWith(
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

        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{
            type: 'image',
            data: 'AA==',
            mimeType: 'image/png',
          }],
        })).rejects.toMatchObject({ code: -32602 });
      },
    );

    expect(calls).toBe(0);
  });

  it('cancels an active prompt cooperatively without treating cancellation as rollback', async () => {
    let observedSignal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();
    const server = createFuryAcpV1Server({
      promptHandler: async (context) => {
        observedSignal = context.signal;
        started.resolve();
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
            return;
          }
          context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { stopReason: 'cancelled' };
      },
    });

    const stopReason = await acp.client({ name: 'cancel-client' }).connectWith(
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
        const pending = agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'long task' }],
        });
        await started.promise;
        await agent.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        });
        return (await pending).stopReason;
      },
    );

    expect(stopReason).toBe('cancelled');
    expect(observedSignal?.aborted).toBe(true);
  });

  it('enforces session and prompt budgets fail-closed', async () => {
    const server = createFuryAcpV1Server({
      maxSessions: 1,
      maxPromptBlocks: 1,
      maxPromptBytes: 16,
      maxUpdateBytes: 8,
      maxUpdatesPerPrompt: 1,
      promptHandler: async (context) => {
        await context.emitText('12345678');
        await context.emitText('x');
        return { stopReason: 'end_turn' };
      },
    });

    await acp.client({ name: 'budget-client' }).connectWith(
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

        await expect(agent.request(acp.methods.agent.session.new, {
          cwd: '/other',
          mcpServers: [],
        })).rejects.toMatchObject({ code: -32010 });

        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        })).rejects.toMatchObject({ code: -32602 });

        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '12345678901234567' }],
        })).rejects.toMatchObject({ code: -32602 });

        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'ok' }],
        })).rejects.toMatchObject({ code: -32012 });
      },
    );
  });

  it('does not allow a session identifier from another server instance', async () => {
    const left = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });
    const right = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });

    const leftSessionId = await acp.client({ name: 'left-client' }).connectWith(
      left.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        return (await agent.request(acp.methods.agent.session.new, {
          cwd: '/left',
          mcpServers: [],
        })).sessionId;
      },
    );

    await acp.client({ name: 'right-client' }).connectWith(
      right.app,
      async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        await expect(agent.request(acp.methods.agent.session.prompt, {
          sessionId: leftSessionId,
          prompt: [{ type: 'text', text: 'cross-connection attempt' }],
        })).rejects.toMatchObject({ code: -32602 });
      },
    );
  });
});
