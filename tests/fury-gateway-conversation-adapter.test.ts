import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
  createFuryGatewayConversationAdapter,
} from '../src/gateway-conversation-adapter-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';

describe('Fury Gateway conversation adapter', () => {
  it('declares only narrow conversation scopes and no plugin capabilities', () => {
    expect(FURY_GATEWAY_CONVERSATION_COMMAND_NAMES).toEqual([
      'conversation.open',
      'conversation.inspect',
      'conversation.message.submit',
      'conversation.cancel',
      'conversation.close',
    ]);

    for (const definition of FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS) {
      expect(definition.allowedRoles).toEqual(['operator']);
      expect(definition.requiredPluginPermissions).toEqual([]);
      expect(definition.requiresFreshApproval).toBe(false);
      expect(definition.requiredScopes.every((scope) =>
        scope === 'conversations.inspect' || scope === 'conversations.write',
      )).toBe(true);
      expect(definition.requiredScopes).not.toContain('capability.provider-inference');
      expect(definition.requiredScopes).not.toContain('capability.process');
      expect(definition.requiredScopes).not.toContain('capability.network');
      expect(definition.requiredScopes).not.toContain('capability.repository-write');
    }
  });

  it('opens, submits, inspects, cancels and closes conversation state without execution authority', () => {
    let now = 1000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const adapter = createFuryGatewayConversationAdapter({ kernel });

    const opened = adapter.dispatch('conversation.open', {});
    expect(opened).toMatchObject({
      format: 'furypipe-gateway-conversation-result/v1',
      commandName: 'conversation.open',
      status: 'ok',
      authority: 'conversation-state',
      executionAuthority: false,
    });
    const openedSnapshot = opened.result as { conversationId: string };
    expect(openedSnapshot.conversationId).toMatch(/^fkc_[A-Za-z0-9_-]{24}$/u);

    now = 1100;
    const submitted = adapter.dispatch('conversation.message.submit', {
      conversationId: openedSnapshot.conversationId,
      messageId: 'user-1',
      content: 'hello',
    });
    expect(submitted).toMatchObject({
      status: 'ok',
      executionAuthority: false,
      result: {
        status: 'accepted',
        executionAuthority: false,
      },
    });
    const turnId = (submitted.result as { turn: { turnId: string } }).turn.turnId;

    const inspected = adapter.dispatch('conversation.inspect', {
      conversationId: openedSnapshot.conversationId,
      messageOffset: 0,
      messageLimit: 1,
      turnOffset: 0,
      turnLimit: 1,
    });
    expect(inspected).toMatchObject({
      status: 'ok',
      result: {
        conversationId: openedSnapshot.conversationId,
        activeTurnId: turnId,
        executionAuthority: false,
        page: {
          messageOffset: 0,
          messageLimit: 1,
          totalMessages: 1,
          turnOffset: 0,
          turnLimit: 1,
          totalTurns: 1,
        },
      },
    });

    now = 1200;
    const cancelled = adapter.dispatch('conversation.cancel', {
      conversationId: openedSnapshot.conversationId,
      turnId,
    });
    expect(cancelled).toMatchObject({
      status: 'ok',
      result: {
        status: 'cancelled',
        executionAuthority: false,
      },
    });

    now = 1300;
    const closed = adapter.dispatch('conversation.close', {
      conversationId: openedSnapshot.conversationId,
    });
    expect(closed).toMatchObject({
      status: 'ok',
      result: {
        status: 'closed',
        closedAt: 1300,
        executionAuthority: false,
      },
    });
    expect(kernel.activeConversationCount()).toBe(0);
  });

  it('returns bounded typed rejections for invalid schemas and Kernel state errors', () => {
    const kernel = createFuryKernelConversationStore();
    const adapter = createFuryGatewayConversationAdapter({ kernel });

    expect(adapter.dispatch('conversation.open', {
      conversationId: 'caller-owned-id',
    })).toEqual({
      format: 'furypipe-gateway-conversation-result/v1',
      commandName: 'conversation.open',
      status: 'rejected',
      error: { code: 'invalid-message' },
      authority: 'conversation-state',
      executionAuthority: false,
    });

    expect(adapter.dispatch('conversation.inspect', {
      conversationId: 'not-a-kernel-id',
    })).toMatchObject({
      status: 'rejected',
      error: { code: 'invalid-conversation' },
      executionAuthority: false,
    });
  });

  it('paginates inspection instead of returning an unbounded transcript', () => {
    const kernel = createFuryKernelConversationStore();
    const adapter = createFuryGatewayConversationAdapter({ kernel });
    const opened = adapter.dispatch('conversation.open', {});
    const id = (opened.result as { conversationId: string }).conversationId;

    for (let index = 0; index < 3; index += 1) {
      const submitted = adapter.dispatch('conversation.message.submit', {
        conversationId: id,
        messageId: `user-${index}`,
        content: `message-${index}`,
      });
      const turnId = (submitted.result as { turn: { turnId: string } }).turn.turnId;
      adapter.dispatch('conversation.cancel', { conversationId: id, turnId });
    }

    const inspected = adapter.dispatch('conversation.inspect', {
      conversationId: id,
      messageOffset: 0,
      messageLimit: 2,
      turnOffset: 0,
      turnLimit: 2,
    });
    const result = inspected.result as {
      messages: readonly unknown[];
      turns: readonly unknown[];
      page: {
        nextMessageOffset?: number;
        nextTurnOffset?: number;
        totalMessages: number;
        totalTurns: number;
      };
    };
    expect(result.messages).toHaveLength(2);
    expect(result.turns).toHaveLength(2);
    expect(result.page).toMatchObject({
      nextMessageOffset: 2,
      nextTurnOffset: 2,
      totalMessages: 3,
      totalTurns: 3,
    });
  });

  it('fails closed when a serialized inspection exceeds the adapter result bound', () => {
    const kernel = createFuryKernelConversationStore({
      maxMessageBytes: 2048,
      maxConversationBytes: 4096,
    });
    const adapter = createFuryGatewayConversationAdapter({
      kernel,
      maxResultBytes: 1024,
    });
    const opened = adapter.dispatch('conversation.open', {});
    const id = (opened.result as { conversationId: string }).conversationId;

    const submitted = adapter.dispatch('conversation.message.submit', {
      conversationId: id,
      messageId: 'large-message',
      content: 'x'.repeat(1800),
    });
    expect(submitted).toMatchObject({
      status: 'ok',
      result: {
        status: 'accepted',
        executionAuthority: false,
      },
    });

    const inspected = adapter.dispatch('conversation.inspect', {
      conversationId: id,
      messageLimit: 1,
      turnLimit: 1,
    });
    expect(inspected).toMatchObject({
      status: 'rejected',
      error: { code: 'result-too-large' },
      executionAuthority: false,
    });
  });

  it('rejects unsupported command names and invalid adapter configuration', () => {
    const kernel = createFuryKernelConversationStore();
    const adapter = createFuryGatewayConversationAdapter({ kernel });

    expect(() => adapter.dispatch(
      'provider.execute' as never,
      {},
    )).toThrow(/unsupported/u);

    expect(() => createFuryGatewayConversationAdapter({
      kernel,
      maxResultBytes: 100,
    })).toThrow(/maxResultBytes/u);
  });
});
