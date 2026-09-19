import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROVIDER_REGISTRY,
} from '../src/core/provider-fabric.js';
import {
  createProviderRuntimeState,
} from '../src/core/provider-runtime.js';
import {
  createFuryKernelModelBridge,
} from '../src/fury-kernel-model-bridge.js';
import {
  createFuryKernelConversationStore,
} from '../src/fury-kernel.js';
import {
  createProviderTransportRegistry,
  type ProviderTransport,
} from '../src/provider-transport.js';
import type {
  FuryProviderRetryFallbackContinuationPolicy,
} from '../src/provider-retry-fallback-orchestrator.js';

function runtime(now = 1_000, providerIds: readonly string[] = ['openai', 'anthropic']) {
  const state = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  for (const providerId of providerIds) {
    state.observeHealth({
      providerId,
      availability: 'available',
      observedAt: now - 100,
      expiresAt: now + 60_000,
      source: 'kernel-model-bridge-test',
      evidenceKind: 'operator-config',
    });
  }
  return state;
}

function continuation(
  overrides: Partial<FuryProviderRetryFallbackContinuationPolicy> = {},
): FuryProviderRetryFallbackContinuationPolicy {
  return {
    format: 'furypipe-provider-retry-fallback-continuation-policy/v1',
    retryOn: [],
    fallbackOn: [],
    retryHttpStatuses: [],
    fallbackHttpStatuses: [],
    allowCrossProviderFallback: false,
    ...overrides,
  };
}

function transport(
  providerId: 'openai' | 'anthropic' | 'google',
  execute: ProviderTransport['execute'],
): ProviderTransport {
  return {
    providerId,
    protocol: providerId,
    execute,
  };
}

function openAiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    id: 'resp_test',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    }],
  }));
}

function anthropicBytes(text: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    id: 'msg_test',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  }));
}

describe('Fury Kernel governed model bridge', () => {
  it('executes one host-allowlisted provider route and completes the Kernel turn', async () => {
    const now = 1_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const conversationId = kernel.openConversation().conversationId;
    const accepted = kernel.submitUserMessage({
      conversationId,
      messageId: 'user-1',
      content: 'Explain the architecture briefly.',
    });
    let capturedPrompt = '';

    const bridge = createFuryKernelModelBridge({
      kernel,
      providerRuntime: runtime(now, ['openai']),
      transports: createProviderTransportRegistry([
        transport('openai', async (request) => {
          capturedPrompt = request.prompt;
          return {
            providerId: 'openai',
            model: request.model,
            networkStatus: 'executed',
            providerRequestStatus: 'accepted',
            httpStatus: 200,
            responseBytes: openAiBytes('The architecture is layered.'),
          };
        }),
      ]),
      routes: [{
        providerId: 'openai',
        model: 'gpt-5.6',
        allowProviderRequest: true,
        permitTtlMs: 5_000,
      }],
      continuationPolicy: continuation(),
      now: () => now,
    });

    const result = await bridge.executeTurn({
      conversationId,
      turnId: accepted.turn.turnId,
    });

    expect(result).toMatchObject({
      format: 'furypipe-kernel-model-bridge-result/v1',
      conversationId,
      turnId: accepted.turn.turnId,
      status: 'completed',
      provider: {
        providerId: 'openai',
        model: 'gpt-5.6',
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        verification: 'unverified',
      },
      attempts: {
        planned: 1,
        processed: 1,
        transportInvocations: 1,
        outcome: 'SUCCEEDED',
      },
      executionAuthority: false,
    });
    expect(result.assistantMessageId).toMatch(/^assistant-[0-9a-f-]{36}$/u);
    expect(capturedPrompt).toContain('Explain the architecture briefly.');
    expect(capturedPrompt).toContain('Do not claim that a tool');

    const snapshot = kernel.inspectConversation(conversationId);
    expect(snapshot.activeTurnId).toBeUndefined();
    expect(snapshot.turns[0]).toMatchObject({
      status: 'completed',
      responseMessageId: result.assistantMessageId,
    });
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'The architecture is layered.',
    });
  });

  it('rebuilds fallback attempts from the same model-neutral BASE prompt', async () => {
    const now = 2_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const conversationId = kernel.openConversation().conversationId;

    const first = kernel.submitUserMessage({
      conversationId,
      messageId: 'first-user',
      content: 'First turn',
    });
    kernel.completeTurn({
      conversationId,
      turnId: first.turn.turnId,
      messageId: 'first-assistant',
      content: 'First answer',
    });

    const second = kernel.submitUserMessage({
      conversationId,
      messageId: 'second-user',
      content: 'Continue from that context.',
    });

    const prompts: string[] = [];
    const bridge = createFuryKernelModelBridge({
      kernel,
      providerRuntime: runtime(now),
      transports: createProviderTransportRegistry([
        transport('openai', async (request) => {
          prompts.push(request.prompt);
          return {
            providerId: 'openai',
            model: request.model,
            networkStatus: 'executed',
            providerRequestStatus: 'rejected',
            httpStatus: 503,
          };
        }),
        transport('anthropic', async (request) => {
          prompts.push(request.prompt);
          return {
            providerId: 'anthropic',
            model: request.model,
            networkStatus: 'executed',
            providerRequestStatus: 'accepted',
            httpStatus: 200,
            responseBytes: anthropicBytes('Fallback answer'),
          };
        }),
      ]),
      routes: [
        {
          providerId: 'openai',
          model: 'gpt-5.6',
          allowProviderRequest: true,
          permitTtlMs: 5_000,
        },
        {
          providerId: 'anthropic',
          model: 'claude-opus-5',
          allowProviderRequest: true,
          permitTtlMs: 5_000,
        },
      ],
      continuationPolicy: continuation({
        fallbackHttpStatuses: [503],
        allowCrossProviderFallback: true,
      }),
      now: () => now,
    });

    const result = await bridge.executeTurn({
      conversationId,
      turnId: second.turn.turnId,
    });

    expect(result).toMatchObject({
      status: 'completed',
      provider: {
        providerId: 'anthropic',
        model: 'claude-opus-5',
        verification: 'unverified',
      },
      attempts: {
        planned: 2,
        processed: 2,
        transportInvocations: 2,
        outcome: 'SUCCEEDED',
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).toContain('Continue from that context.');
    expect(prompts[0]).toContain('First turn');
    expect(prompts[0]).toContain('First answer');
    expect(kernel.inspectConversation(conversationId).messages.at(-1)?.content)
      .toBe('Fallback answer');
  });

  it('terminalizes unsupported provider content instead of treating a tool call as chat text', async () => {
    const now = 3_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const conversationId = kernel.openConversation().conversationId;
    const accepted = kernel.submitUserMessage({
      conversationId,
      messageId: 'tool-attempt-user',
      content: 'Do something',
    });

    const bridge = createFuryKernelModelBridge({
      kernel,
      providerRuntime: runtime(now, ['openai']),
      transports: createProviderTransportRegistry([
        transport('openai', async (request) => ({
          providerId: 'openai',
          model: request.model,
          networkStatus: 'executed',
          providerRequestStatus: 'accepted',
          httpStatus: 200,
          responseBytes: new TextEncoder().encode(JSON.stringify({
            output: [{
              type: 'function_call',
              name: 'shell',
              arguments: '{}',
            }],
          })),
        })),
      ]),
      routes: [{
        providerId: 'openai',
        model: 'gpt-5.6',
        allowProviderRequest: true,
        permitTtlMs: 5_000,
      }],
      continuationPolicy: continuation(),
      now: () => now,
    });

    const result = await bridge.executeTurn({
      conversationId,
      turnId: accepted.turn.turnId,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'provider-response-unsupported-response-content',
      attempts: { outcome: 'SUCCEEDED', transportInvocations: 1 },
      executionAuthority: false,
    });
    expect(kernel.inspectConversation(conversationId).turns[0]).toMatchObject({
      status: 'failed',
      failureCode: 'provider-response-unsupported-response-content',
    });
    expect(kernel.inspectConversation(conversationId).messages).toHaveLength(1);
  });

  it('aborts an active provider execution and terminalizes the turn as cancelled', async () => {
    const now = 4_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const conversationId = kernel.openConversation().conversationId;
    const accepted = kernel.submitUserMessage({
      conversationId,
      messageId: 'cancel-user',
      content: 'Long request',
    });

    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const bridge = createFuryKernelModelBridge({
      kernel,
      providerRuntime: runtime(now, ['openai']),
      transports: createProviderTransportRegistry([
        transport('openai', async (request, context) => {
          markStarted();
          await new Promise<never>((_resolve, reject) => {
            if (context.signal?.aborted) {
              reject(new Error('aborted'));
              return;
            }
            context.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
          return {
            providerId: 'openai',
            model: request.model,
            networkStatus: 'executed',
            providerRequestStatus: 'accepted',
            httpStatus: 200,
          };
        }),
      ]),
      routes: [{
        providerId: 'openai',
        model: 'gpt-5.6',
        allowProviderRequest: true,
        permitTtlMs: 5_000,
      }],
      continuationPolicy: continuation(),
      now: () => now,
    });

    const running = bridge.executeTurn({
      conversationId,
      turnId: accepted.turn.turnId,
    });
    await started;
    expect(bridge.activeExecutionCount()).toBe(1);
    expect(bridge.cancelTurn(conversationId, accepted.turn.turnId)).toBe(true);

    const result = await running;
    expect(result).toMatchObject({
      status: 'cancelled',
      attempts: { outcome: 'CANCELLED' },
      executionAuthority: false,
    });
    expect(bridge.activeExecutionCount()).toBe(0);
    expect(kernel.inspectConversation(conversationId).turns[0]?.status).toBe('cancelled');
    expect(kernel.inFlightTurnCount()).toBe(0);
  });

  it('fails closed when prior transcript exceeds the bridge context bound', async () => {
    const now = 5_000;
    const kernel = createFuryKernelConversationStore({
      now: () => now,
      maxMessageBytes: 4096,
      maxConversationBytes: 16_384,
    });
    const conversationId = kernel.openConversation().conversationId;
    const first = kernel.submitUserMessage({
      conversationId,
      messageId: 'large-first',
      content: 'x'.repeat(1400),
    });
    kernel.completeTurn({
      conversationId,
      turnId: first.turn.turnId,
      messageId: 'large-answer',
      content: 'y'.repeat(1400),
    });
    const second = kernel.submitUserMessage({
      conversationId,
      messageId: 'large-second',
      content: 'continue',
    });

    let invoked = false;
    const bridge = createFuryKernelModelBridge({
      kernel,
      providerRuntime: runtime(now, ['openai']),
      transports: createProviderTransportRegistry([
        transport('openai', async (request) => {
          invoked = true;
          return {
            providerId: 'openai',
            model: request.model,
            networkStatus: 'executed',
            providerRequestStatus: 'accepted',
            responseBytes: openAiBytes('must not execute'),
          };
        }),
      ]),
      routes: [{
        providerId: 'openai',
        model: 'gpt-5.6',
        allowProviderRequest: true,
        permitTtlMs: 5_000,
      }],
      continuationPolicy: continuation(),
      maxTranscriptBytes: 1024,
      now: () => now,
    });

    const result = await bridge.executeTurn({
      conversationId,
      turnId: second.turn.turnId,
    });
    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'conversation-context-too-large',
      attempts: { transportInvocations: 0 },
    });
    expect(invoked).toBe(false);
    expect(kernel.inspectConversation(conversationId).turns.at(-1)).toMatchObject({
      status: 'failed',
      failureCode: 'conversation-context-too-large',
    });
  });
});
