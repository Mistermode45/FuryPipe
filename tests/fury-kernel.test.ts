import { describe, expect, it } from 'vitest';

import {
  createFuryKernelConversationStore,
  FuryKernelConversationError,
} from '../src/fury-kernel.js';

const FIXED_CONVERSATION_ID = 'fkc_ABCDEFGHIJKLMNOPQRSTUVWX';

describe('Fury Kernel conversation foundation', () => {
  it('opens bounded ephemeral conversation state without execution authority', () => {
    const kernel = createFuryKernelConversationStore({ now: () => 1000 });
    const conversation = kernel.openConversation({
      conversationId: FIXED_CONVERSATION_ID,
    });

    expect(conversation).toEqual({
      format: 'furypipe-kernel-conversation/v1',
      conversationId: FIXED_CONVERSATION_ID,
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
      turns: [],
      authority: 'conversation-state',
      executionAuthority: false,
    });
    expect(Object.isFrozen(conversation)).toBe(true);
    expect(Object.isFrozen(conversation.messages)).toBe(true);
    expect(Object.isFrozen(conversation.turns)).toBe(true);
    expect(kernel.activeConversationCount()).toBe(1);
    expect(kernel.inFlightTurnCount()).toBe(0);
  });

  it('accepts one user turn and completes it only through the trusted Kernel API', () => {
    let now = 1000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    now = 1100;
    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'user-1',
      content: 'Hello FuryPipe',
    });

    expect(accepted.status).toBe('accepted');
    expect(accepted.executionAuthority).toBe(false);
    expect(accepted.turn.requestMessageId).toBe('user-1');
    expect(accepted.turn.status).toBe('accepted');
    expect(accepted.turn.executionAuthority).toBe(false);
    expect(kernel.inFlightTurnCount()).toBe(1);

    now = 1200;
    const completed = kernel.completeTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
      messageId: 'assistant-1',
      content: 'Hello from the Kernel facade.',
    });

    expect(completed.status).toBe('completed');
    expect(completed.executionAuthority).toBe(false);
    expect(completed.turn).toMatchObject({
      requestMessageId: 'user-1',
      responseMessageId: 'assistant-1',
      status: 'completed',
      createdAt: 1100,
      completedAt: 1200,
      executionAuthority: false,
    });
    expect(kernel.inFlightTurnCount()).toBe(0);

    const snapshot = kernel.inspectConversation(FIXED_CONVERSATION_ID);
    expect(snapshot.messages).toEqual([
      {
        format: 'furypipe-kernel-message/v1',
        messageId: 'user-1',
        role: 'user',
        content: 'Hello FuryPipe',
        createdAt: 1100,
      },
      {
        format: 'furypipe-kernel-message/v1',
        messageId: 'assistant-1',
        role: 'assistant',
        content: 'Hello from the Kernel facade.',
        createdAt: 1200,
      },
    ]);
    expect(snapshot.activeTurnId).toBeUndefined();
  });

  it('rejects duplicate user and assistant message IDs as replay', () => {
    const kernel = createFuryKernelConversationStore();
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'stable-message-id',
      content: 'first',
    });

    expect(() => kernel.completeTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
      messageId: 'stable-message-id',
      content: 'must fail',
    })).toThrowError(expect.objectContaining({
      code: 'message-replay',
    }));

    kernel.cancelTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
    });

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'stable-message-id',
      content: 'replay',
    })).toThrowError(expect.objectContaining({
      code: 'message-replay',
    }));
  });

  it('allows cancellation exactly once and rejects completion after cancellation', () => {
    let now = 50;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'cancel-me',
      content: 'cancel this turn',
    });

    now = 75;
    const cancelled = kernel.cancelTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
    });

    expect(cancelled.turn).toMatchObject({
      status: 'cancelled',
      completedAt: 75,
      executionAuthority: false,
    });
    expect(kernel.inFlightTurnCount()).toBe(0);

    expect(() => kernel.cancelTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
    })).toThrowError(expect.objectContaining({ code: 'turn-terminal' }));

    expect(() => kernel.completeTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
      messageId: 'late-answer',
      content: 'too late',
    })).toThrowError(expect.objectContaining({ code: 'turn-terminal' }));
  });

  it('permits only one in-flight turn per conversation', () => {
    const kernel = createFuryKernelConversationStore();
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'first-turn',
      content: 'first',
    });

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'second-turn',
      content: 'second',
    })).toThrowError(expect.objectContaining({
      code: 'turn-in-flight',
    }));
  });

  it('enforces global in-flight turn capacity across conversations', () => {
    const kernel = createFuryKernelConversationStore({
      maxConversations: 2,
      maxInFlightTurns: 1,
    });
    const secondId = 'fkc_ZYXWVUTSRQPONMLKJIHGFEDC';
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });
    kernel.openConversation({ conversationId: secondId });

    kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'first',
      content: 'first',
    });

    expect(() => kernel.submitUserMessage({
      conversationId: secondId,
      messageId: 'second',
      content: 'second',
    })).toThrowError(expect.objectContaining({
      code: 'in-flight-limit',
    }));
  });

  it('reserves message capacity for the assistant response', () => {
    const kernel = createFuryKernelConversationStore({
      maxMessagesPerConversation: 2,
      maxTurnsPerConversation: 2,
    });
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'request-1',
      content: 'one',
    });
    kernel.completeTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
      messageId: 'response-1',
      content: 'two',
    });

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'request-2',
      content: 'three',
    })).toThrowError(expect.objectContaining({
      code: 'message-limit',
    }));
  });

  it('enforces per-message and total conversation byte limits without truncation', () => {
    const kernel = createFuryKernelConversationStore({
      maxMessageBytes: 5,
      maxConversationBytes: 8,
    });
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'too-big',
      content: '123456',
    })).toThrowError(expect.objectContaining({ code: 'byte-limit' }));

    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'fits',
      content: '12345',
    });

    expect(() => kernel.completeTurn({
      conversationId: FIXED_CONVERSATION_ID,
      turnId: accepted.turn.turnId,
      messageId: 'would-overflow',
      content: '1234',
    })).toThrowError(expect.objectContaining({ code: 'byte-limit' }));

    expect(kernel.inFlightTurnCount()).toBe(1);
    expect(kernel.inspectConversation(FIXED_CONVERSATION_ID).messages)
      .toHaveLength(1);
  });

  it('fails closed on unsafe clocks and invalid configuration', () => {
    expect(() => createFuryKernelConversationStore({
      maxConversations: 0,
    })).toThrowError(expect.objectContaining({
      code: 'invalid-config',
    }));

    const kernel = createFuryKernelConversationStore({
      now: () => Number.NaN,
    });
    expect(() => kernel.openConversation({
      conversationId: FIXED_CONVERSATION_ID,
    })).toThrowError(expect.objectContaining({
      code: 'invalid-config',
    }));
  });

  it('rejects malformed identifiers, empty/NUL messages and browser-style system injection shapes', () => {
    const kernel = createFuryKernelConversationStore();
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'bad id',
      content: 'hello',
    })).toThrowError(FuryKernelConversationError);

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'blank',
      content: '   ',
    })).toThrowError(expect.objectContaining({ code: 'invalid-message' }));

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'nul',
      content: 'hello\0world',
    })).toThrowError(expect.objectContaining({ code: 'invalid-message' }));

    expect(() => kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'system-attempt',
      content: 'normal content',
      role: 'system',
    } as never)).toThrowError(expect.objectContaining({ code: 'invalid-message' }));
  });

  it('returns immutable snapshots rather than mutable internal state', () => {
    const kernel = createFuryKernelConversationStore();
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });
    const accepted = kernel.submitUserMessage({
      conversationId: FIXED_CONVERSATION_ID,
      messageId: 'immutable',
      content: 'hello',
    });

    const snapshot = kernel.inspectConversation(FIXED_CONVERSATION_ID);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.messages)).toBe(true);
    expect(Object.isFrozen(snapshot.messages[0])).toBe(true);
    expect(Object.isFrozen(snapshot.turns)).toBe(true);
    expect(Object.isFrozen(snapshot.turns[0])).toBe(true);

    expect(() => {
      (snapshot.messages[0] as { content: string }).content = 'mutated';
    }).toThrow();
    expect(() => {
      (snapshot.turns[0] as { status: string }).status = 'completed';
    }).toThrow();

    expect(kernel.inspectConversation(FIXED_CONVERSATION_ID).messages[0]?.content).toBe('hello');
    expect(kernel.inspectConversation(FIXED_CONVERSATION_ID).turns[0]?.turnId)
      .toBe(accepted.turn.turnId);
  });

  it('enforces conversation capacity', () => {
    const kernel = createFuryKernelConversationStore({ maxConversations: 1 });
    kernel.openConversation({ conversationId: FIXED_CONVERSATION_ID });

    expect(() => kernel.openConversation({
      conversationId: 'fkc_ZYXWVUTSRQPONMLKJIHGFEDC',
    })).toThrowError(expect.objectContaining({
      code: 'conversation-limit',
    }));
  });
});
