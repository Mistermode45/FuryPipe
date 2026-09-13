import { describe, expect, it, vi } from 'vitest';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../src/provider-execution-internal.js';
import { createOpenAIProviderTransport } from '../src/provider-transports/openai.js';
import { makeRequest } from './helpers/provider-executor.js';

const request = makeRequest({ task: 'EXACT_OPENAI_PROMPT' });
const context = {
  requestDigest: request.requestDigest,
  providerId: request.providerId,
  model: request.model,
  workloadId: request.workloadId,
  maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
} as const;

describe('OpenAI production Responses transport', () => {
  it('sends one exact Responses request and normalizes the documented response fields', async () => {
    let sentBody: Record<string, unknown> | undefined;
    let endpoint = '';
    let sentHeaders: Headers | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      endpoint = String(input);
      sentHeaders = new Headers(init?.headers);
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp-not-a-request-id',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: {
          input_tokens: 20,
          input_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 },
          output_tokens: 7,
        },
      }), { status: 200, headers: { 'x-request-id': 'req-openai-123' } });
    });
    const transport = createOpenAIProviderTransport({
      getCredential: () => 'openai-test-key',
      fetchImpl,
      maxOutputTokens: 4096,
    });

    const result = await transport.execute(request, context);
    expect(endpoint).toBe('https://api.openai.com/v1/responses');
    expect(sentHeaders?.get('authorization')).toBe('Bearer openai-test-key');
    expect(sentHeaders?.get('content-type')).toBe('application/json');
    expect(sentBody).toEqual({
      model: request.model,
      input: request.prompt,
      store: false,
      max_output_tokens: 4096,
    });
    expect(sentBody).not.toHaveProperty('instructions');
    expect(sentBody).not.toHaveProperty('tools');
    expect(result).toMatchObject({
      providerId: 'openai',
      model: request.model,
      networkStatus: 'executed',
      providerRequestStatus: 'accepted',
      httpStatus: 200,
      providerRequestId: 'req-openai-123',
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 5, cacheWriteTokens: 3 },
      finishReason: 'max_output_tokens',
    });
    expect(result.providerRequestId).not.toBe('resp-not-a-request-id');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports 429 and documented retry information once, without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { message: 'private provider details' } }),
      { status: 429, headers: { 'retry-after': '2', 'x-request-id': 'req-rate-limit' } },
    ));
    const transport = createOpenAIProviderTransport({ getCredential: () => 'openai-test-key', fetchImpl });
    const result = await transport.execute(request, context);

    expect(result).toMatchObject({
      httpStatus: 429,
      providerRequestStatus: 'rejected',
      retryAfterMs: 2_000,
      providerRequestId: 'req-rate-limit',
    });
    expect(result).not.toHaveProperty('responseBytes');
    expect(JSON.stringify(result)).not.toContain('private provider details');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('uses documented OpenAI reset durations only for 429 when Retry-After is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 429,
      headers: {
        'x-ratelimit-reset-requests': '1s',
        'x-ratelimit-reset-tokens': '6m0s',
        'x-ratelimit-reset-project-tokens': '7m0s',
      },
    }));
    const result = await createOpenAIProviderTransport({ getCredential: () => 'openai-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ httpStatus: 429, retryAfterMs: 420_000 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps malformed successful JSON bounded and does not invent usage or request IDs', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{malformed', { status: 200 }));
    const result = await createOpenAIProviderTransport({ getCredential: () => 'openai-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ httpStatus: 200, providerRequestStatus: 'accepted', networkStatus: 'executed' });
    expect(result).not.toHaveProperty('usage');
    expect(result).not.toHaveProperty('providerRequestId');
    expect([...result.responseBytes as Uint8Array]).toEqual([...new TextEncoder().encode('{malformed')]);
  });

  it('preserves HTTP 5xx as rejection and never retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('provider failure', { status: 503 }));
    const result = await createOpenAIProviderTransport({ getCredential: () => 'openai-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ httpStatus: 503, providerRequestStatus: 'rejected', networkStatus: 'executed' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects invalid timeout, output bound, and unsafe credentials before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createOpenAIProviderTransport({ getCredential: () => 'x', fetchImpl, timeoutMs: Infinity }))
      .toThrow(/timeout/u);
    expect(() => createOpenAIProviderTransport({ getCredential: () => 'x', fetchImpl, maxOutputTokens: 0 }))
      .toThrow(/maxOutputTokens/u);
    await expect(createOpenAIProviderTransport({ getCredential: () => ' bad\r\nkey', fetchImpl })
      .execute(request, context)).rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
