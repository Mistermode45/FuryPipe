import { describe, expect, it } from 'vitest';

import {
  createFuryGatewayLocalModelRuntime,
} from '../src/gateway-local-model-runtime-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';

describe('local Gateway WebChat model runtime', () => {
  it('is disabled by default and creates no provider bridge', () => {
    const kernel = createFuryKernelConversationStore();
    const runtime = createFuryGatewayLocalModelRuntime({
      kernel,
      env: {},
      now: () => 1_000,
    });

    expect(runtime.config).toEqual({
      format: 'furypipe-gateway-local-model-config/v1',
      enabled: false,
    });
    expect(runtime.bridge).toBeUndefined();
  });

  it('fails closed on partial, unsupported, or credential-less provider configuration', () => {
    const kernel = createFuryKernelConversationStore();

    expect(() => createFuryGatewayLocalModelRuntime({
      kernel,
      env: { FURYPIPE_WEBCHAT_PROVIDER: 'openai' },
    })).toThrow(/FURYPIPE_WEBCHAT_MODEL/u);

    expect(() => createFuryGatewayLocalModelRuntime({
      kernel,
      env: {
        FURYPIPE_WEBCHAT_PROVIDER: 'other',
        FURYPIPE_WEBCHAT_MODEL: 'model',
      },
    })).toThrow(/openai, anthropic, or google/u);

    expect(() => createFuryGatewayLocalModelRuntime({
      kernel,
      env: {
        FURYPIPE_WEBCHAT_PROVIDER: 'openai',
        FURYPIPE_WEBCHAT_MODEL: 'gpt-5.6-sol',
      },
    })).toThrow(/OPENAI_API_KEY/u);
  });

  it('uses an explicit OpenAI credential only inside the governed transport', async () => {
    const now = 2_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const conversationId = kernel.openConversation().conversationId;
    const accepted = kernel.submitUserMessage({
      conversationId,
      messageId: 'local-model-user',
      content: 'Say hello.',
    });

    const seen: {
      authorization?: string;
      url?: string;
      body?: string;
    } = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.url = String(input);
      const headers = new Headers(init?.headers);
      seen.authorization = headers.get('authorization') ?? undefined;
      seen.body = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(JSON.stringify({
        id: 'resp_local',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello from the governed provider.' }],
        }],
        usage: {
          input_tokens: 10,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 0,
          },
          output_tokens: 6,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_local',
        },
      });
    };

    const runtime = createFuryGatewayLocalModelRuntime({
      kernel,
      env: {
        FURYPIPE_WEBCHAT_PROVIDER: 'openai',
        FURYPIPE_WEBCHAT_MODEL: 'gpt-5.6-sol',
        FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS: '2048',
        OPENAI_API_KEY: 'test-secret-key',
      },
      now: () => now,
      fetchImpl,
    });

    expect(runtime.config).toEqual({
      format: 'furypipe-gateway-local-model-config/v1',
      enabled: true,
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      maxOutputTokens: 2048,
      credentialSource: 'OPENAI_API_KEY',
    });
    expect(JSON.stringify(runtime.config)).not.toContain('test-secret-key');
    expect(runtime.bridge).toBeDefined();

    const result = await runtime.bridge!.executeTurn({
      conversationId,
      turnId: accepted.turn.turnId,
    });

    expect(result).toMatchObject({
      status: 'completed',
      provider: {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        verification: 'unverified',
      },
      executionAuthority: false,
    });
    expect(seen.url).toBe('https://api.openai.com/v1/responses');
    expect(seen.authorization).toBe('Bearer test-secret-key');
    expect(seen.body).toContain('"store":false');
    expect(seen.body).toContain('"max_output_tokens":2048');
    expect(kernel.inspectConversation(conversationId).messages.at(-1)?.content)
      .toBe('Hello from the governed provider.');
  });

  it('refreshes operator-config provider evidence for long-lived local WebChat sessions', async () => {
    let now = 1_000;
    const kernel = createFuryKernelConversationStore({ now: () => now });
    const runtime = createFuryGatewayLocalModelRuntime({
      kernel,
      env: {
        FURYPIPE_WEBCHAT_PROVIDER: 'openai',
        FURYPIPE_WEBCHAT_MODEL: 'gpt-5.6-sol',
        OPENAI_API_KEY: 'test-key',
      },
      now: () => now,
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'resp_refresh',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Still governed.' }],
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(runtime.bridge).toBeDefined();

    // Move beyond the original 10-minute operator-config observation.
    now += 11 * 60_000;
    const conversationId = kernel.openConversation().conversationId;
    const accepted = kernel.submitUserMessage({
      conversationId,
      messageId: 'refresh-user',
      content: 'Continue after the previous health window.',
    });

    const result = await runtime.bridge!.executeTurn({
      conversationId,
      turnId: accepted.turn.turnId,
    });

    expect(result).toMatchObject({
      status: 'completed',
      provider: {
        providerId: 'openai',
        model: 'gpt-5.6-sol',
        providerRequestStatus: 'accepted',
      },
      executionAuthority: false,
    });
    expect(kernel.inspectConversation(conversationId).messages.at(-1)?.content)
      .toBe('Still governed.');
  });

  it('rejects malformed output-token limits before any provider execution', () => {
    const kernel = createFuryKernelConversationStore();
    for (const value of ['0', '65537', 'not-a-number']) {
      expect(() => createFuryGatewayLocalModelRuntime({
        kernel,
        env: {
          FURYPIPE_WEBCHAT_PROVIDER: 'openai',
          FURYPIPE_WEBCHAT_MODEL: 'gpt-5.6-sol',
          OPENAI_API_KEY: 'test-key',
          FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS: value,
        },
      })).toThrow(/MAX_OUTPUT_TOKENS/u);
    }
  });
});
