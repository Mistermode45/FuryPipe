import { describe, expect, it, vi } from 'vitest';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../src/provider-execution-internal.js';
import { ANTHROPIC_API_VERSION, createAnthropicProviderTransport } from '../src/provider-transports/anthropic.js';
import { makeRequest } from './helpers/provider-executor.js';

const request = makeRequest({
  providerId: 'anthropic',
  model: 'claude-opus-5',
  task: 'EXACT_ANTHROPIC_PROMPT',
});
const context = {
  requestDigest: request.requestDigest,
  providerId: request.providerId,
  model: request.model,
  workloadId: request.workloadId,
  maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
} as const;

describe('Anthropic production Messages transport', () => {
  it('sends the exact Messages shape, bearer auth, required version, and maps cache usage', async () => {
    let endpoint = '';
    let sentHeaders: Headers | undefined;
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      endpoint = String(input);
      sentHeaders = new Headers(init?.headers);
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'msg-not-a-request-id',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 4,
          output_tokens: 8,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 2,
        },
      }), { status: 200, headers: { 'request-id': 'req-anthropic-123' } });
    });
    const transport = createAnthropicProviderTransport({
      getCredential: () => 'anthropic-test-key',
      fetchImpl,
      maxOutputTokens: 8192,
    });

    const result = await transport.execute(request, context);
    expect(endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(sentHeaders?.get('authorization')).toBe('Bearer anthropic-test-key');
    expect(sentHeaders?.get('anthropic-version')).toBe(ANTHROPIC_API_VERSION);
    expect(sentHeaders?.get('content-type')).toBe('application/json');
    expect(sentBody).toEqual({
      model: request.model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: request.prompt }],
    });
    expect(sentBody).not.toHaveProperty('system');
    expect(sentBody).not.toHaveProperty('tools');
    expect(result).toMatchObject({
      providerId: 'anthropic',
      model: request.model,
      httpStatus: 200,
      providerRequestStatus: 'accepted',
      providerRequestId: 'req-anthropic-123',
      usage: { inputTokens: 4, outputTokens: 8, cacheWriteTokens: 3, cacheReadTokens: 2 },
      finishReason: 'end_turn',
    });
    expect(result.providerRequestId).not.toBe('msg-not-a-request-id');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('requires explicit max tokens and reports Retry-After without automatic retry', async () => {
    expect(() => createAnthropicProviderTransport({ getCredential: () => 'x' } as never))
      .toThrow(/maxOutputTokens/u);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 429,
      headers: { 'retry-after': '4', 'request-id': 'req-anthropic-limit' },
    }));
    const result = await createAnthropicProviderTransport({
      getCredential: () => 'anthropic-test-key', fetchImpl, maxOutputTokens: 1024,
    }).execute(request, context);
    expect(result).toMatchObject({
      httpStatus: 429,
      providerRequestStatus: 'rejected',
      retryAfterMs: 4_000,
      providerRequestId: 'req-anthropic-limit',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('leaves absent usage and stop reason absent on an otherwise accepted response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const result = await createAnthropicProviderTransport({
      getCredential: () => 'anthropic-test-key', fetchImpl, maxOutputTokens: 1024,
    }).execute(request, context);
    expect(result).toMatchObject({ httpStatus: 200, providerRequestStatus: 'accepted' });
    expect(result).not.toHaveProperty('usage');
    expect(result).not.toHaveProperty('finishReason');
  });

  it('keeps HTTP 5xx distinct from fetch/socket failure', async () => {
    const httpFetch = vi.fn<typeof fetch>(async () => new Response('{}', { status: 529 }));
    const http = await createAnthropicProviderTransport({
      getCredential: () => 'anthropic-test-key', fetchImpl: httpFetch, maxOutputTokens: 1024,
    }).execute(request, context);
    expect(http).toMatchObject({ httpStatus: 529, providerRequestStatus: 'rejected' });

    const networkFetch = vi.fn<typeof fetch>(async () => { throw new Error('socket key=anthropic-test-key'); });
    await expect(createAnthropicProviderTransport({
      getCredential: () => 'anthropic-test-key', fetchImpl: networkFetch, maxOutputTokens: 1024,
    }).execute(request, context)).rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(networkFetch).toHaveBeenCalledOnce();
  });
});
