import { describe, expect, it } from 'vitest';

import * as acp from '@agentclientprotocol/sdk';

import {
  FURY_ACP_V1_DISPLAY_UPDATE_FORMAT,
  FuryAcpV1UpdateProjectionError,
  projectFuryAcpV1DisplayUpdate,
} from '../src/acp-v1-update-projection-node.js';
import { createFuryAcpV1Server } from '../src/acp-v1-server-node.js';

describe('FuryPipe ACP v1 display update projection', () => {
  it('projects assistant text as display-only ACP content', () => {
    const projected = projectFuryAcpV1DisplayUpdate(
      { type: 'message', text: 'hello' },
      { messageId: 'fam_message_1' },
    );

    expect(projected).toMatchObject({
      format: FURY_ACP_V1_DISPLAY_UPDATE_FORMAT,
      payloadBytes: 5,
      authority: 'display-only',
      executionAuthority: false,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'fam_message_1',
        content: { type: 'text', text: 'hello' },
      },
    });
  });

  it('projects a complete bounded stable ACP plan', () => {
    const projected = projectFuryAcpV1DisplayUpdate({
      type: 'plan',
      entries: [
        { content: 'Inspect', priority: 'high', status: 'completed' },
        { content: 'Verify', priority: 'medium', status: 'in_progress' },
      ],
    });

    expect(projected.update).toEqual({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect', priority: 'high', status: 'completed' },
        { content: 'Verify', priority: 'medium', status: 'in_progress' },
      ],
    });
    expect(projected.executionAuthority).toBe(false);
  });

  it('projects tool-call display state without raw input, raw output, locations, terminal or diff content', () => {
    const created = projectFuryAcpV1DisplayUpdate({
      type: 'tool_call',
      toolCallId: 'tool_1',
      title: 'Run verification',
      toolKind: 'execute',
      status: 'in_progress',
      contentText: 'Verification started',
    });
    const updated = projectFuryAcpV1DisplayUpdate({
      type: 'tool_call_update',
      toolCallId: 'tool_1',
      status: 'completed',
      contentText: 'Verification completed',
    });

    expect(created.update).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool_1',
      title: 'Run verification',
      kind: 'execute',
      status: 'in_progress',
    });
    expect(updated.update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool_1',
      status: 'completed',
    });

    const serialized = JSON.stringify([created, updated]);
    for (const forbidden of [
      'rawInput',
      'rawOutput',
      'locations',
      'terminalId',
      'oldText',
      'newText',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects unsupported authority-bearing or raw fields fail-closed', () => {
    for (const value of [
      {
        type: 'message',
        text: 'hello',
        executionAuthority: true,
      },
      {
        type: 'tool_call',
        toolCallId: 'tool_1',
        title: 'Unsafe',
        rawInput: { command: 'rm' },
      },
      {
        type: 'tool_call_update',
        toolCallId: 'tool_1',
        rawOutput: 'secret',
      },
      {
        type: 'tool_call_update',
        toolCallId: 'tool_1',
        locations: [{ path: '/secret' }],
      },
      {
        type: 'tool_call_update',
        toolCallId: 'tool_1',
        _meta: { privileged: true },
      },
    ]) {
      expect(() => projectFuryAcpV1DisplayUpdate(value)).toThrowError(
        FuryAcpV1UpdateProjectionError,
      );
    }
  });

  it('rejects accessor-backed or non-plain projection objects', () => {
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'type', {
      enumerable: true,
      get: () => 'message',
    });
    Object.defineProperty(accessor, 'text', {
      enumerable: true,
      value: 'hidden',
    });

    expect(() => projectFuryAcpV1DisplayUpdate(accessor)).toThrowError(
      FuryAcpV1UpdateProjectionError,
    );
    expect(() => projectFuryAcpV1DisplayUpdate(
      new (class {
        type = 'message';
        text = 'prototype-backed';
      })(),
    )).toThrowError(FuryAcpV1UpdateProjectionError);
  });

  it('enforces plan, payload and wire bounds', () => {
    expect(() => projectFuryAcpV1DisplayUpdate(
      {
        type: 'plan',
        entries: [
          { content: 'one', priority: 'low', status: 'pending' },
          { content: 'two', priority: 'low', status: 'pending' },
        ],
      },
      { maxPlanEntries: 1 },
    )).toThrowError(FuryAcpV1UpdateProjectionError);

    expect(() => projectFuryAcpV1DisplayUpdate(
      { type: 'message', text: 'hello' },
      { maxPayloadBytes: 4 },
    )).toThrowError(FuryAcpV1UpdateProjectionError);

    expect(() => projectFuryAcpV1DisplayUpdate(
      { type: 'message', text: 'hello' },
      { maxWireBytes: 16 },
    )).toThrowError(FuryAcpV1UpdateProjectionError);
  });

  it('emits message, plan and tool display updates through the governed prompt budget', async () => {
    const updates: unknown[] = [];
    const server = createFuryAcpV1Server({
      promptHandler: async (context) => {
        await context.emitUpdate({
          type: 'plan',
          entries: [
            { content: 'Inspect', priority: 'high', status: 'completed' },
            { content: 'Verify', priority: 'medium', status: 'in_progress' },
          ],
        });
        await context.emitUpdate({
          type: 'tool_call',
          toolCallId: 'tool_1',
          title: 'Verify',
          toolKind: 'execute',
          status: 'in_progress',
        });
        await context.emitUpdate({
          type: 'tool_call_update',
          toolCallId: 'tool_1',
          status: 'completed',
          contentText: 'PASS',
        });
        await context.emitText('done');
        return { stopReason: 'end_turn' };
      },
    });

    const response = await acp.client({ name: 'projection-client' })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        updates.push(ctx.params);
      })
      .connectWith(server.app, async (agent) => {
        await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        const session = await agent.request(acp.methods.agent.session.new, {
          cwd: '/workspace',
          mcpServers: [],
        });
        return agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'verify' }],
        });
      });

    expect(response.stopReason).toBe('end_turn');
    expect(updates).toHaveLength(4);
    expect(updates.map((entry) => (
      entry as { update: { sessionUpdate: string } }
    ).update.sessionUpdate)).toEqual([
      'plan',
      'tool_call',
      'tool_call_update',
      'agent_message_chunk',
    ]);

    const serialized = JSON.stringify(updates);
    expect(serialized).not.toContain('executionAuthority');
    expect(serialized).not.toContain('rawInput');
    expect(serialized).not.toContain('rawOutput');
  });
});
