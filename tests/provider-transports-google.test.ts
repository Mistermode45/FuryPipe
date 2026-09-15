import { describe, expect, it, vi } from 'vitest';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../src/provider-execution-internal.js';
import { createGoogleProviderTransport } from '../src/provider-transports/google.js';
import { makeRequest } from './helpers/provider-executor.js';

const request = makeRequest({ providerId: 'google', model: 'gemini-3.8-flash', task: 'EXACT_GEMINI_PROMPT' });
const context = {
  requestDigest: request.requestDigest,
  providerId: request.providerId,
  model: request.model,
  workloadId: request.workloadId,
  maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
} as const;

describe('Google Gemini production Interactions transport', () => {
  it('uses stable Interactions v1, API-key header, exact input, and current usage fields', async () => {
    let endpoint = '';
    let sentHeaders: Headers | undefined;
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      endpoint = String(input);
      sentHeaders = new Headers(init?.headers);
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'interaction-object-id-not-request-id',
        status: 'completed',
        usage: { total_input_tokens: 22, total_cached_tokens: 6, total_output_tokens: 9 },
      }), { status: 200 });
    });
    const transport = createGoogleProviderTransport({
      getCredential: () => 'google-test-key',
      fetchImpl,
      maxOutputTokens: 4096,
    });

    const result = await transport.execute(request, context);
    expect(endpoint).toBe('https://generativelanguage.googleapis.com/v1/interactions');
    expect(sentHeaders?.get('x-goog-api-key')).toBe('google-test-key');
    expect(sentHeaders?.has('authorization')).toBe(false);
    expect(sentBody).toEqual({
      model: request.model,
      input: request.prompt,
      store: false,
      generation_config: { max_output_tokens: 4096 },
    });
    expect(sentBody).not.toHaveProperty('system_instruction');
    expect(sentBody).not.toHaveProperty('tools');
    expect(result).toMatchObject({
      providerId: 'google',
      model: request.model,
      httpStatus: 200,
      networkStatus: 'executed',
      providerRequestStatus: 'accepted',
      usage: { inputTokens: 16, outputTokens: 9, cacheReadTokens: 6 },
    });
    expect(result).not.toHaveProperty('providerRequestId');
    expect(result).not.toHaveProperty('finishReason');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not treat interaction object IDs as HTTP request IDs and keeps cache metadata absent when missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: 'interaction-id',
      status: 'completed',
      usage: { total_input_tokens: 12, total_output_tokens: 4 },
    }), { status: 200 }));
    const result = await createGoogleProviderTransport({ getCredential: () => 'google-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ usage: { outputTokens: 4 } });
    expect(result.usage).not.toHaveProperty('inputTokens');
    expect(result.usage).not.toHaveProperty('cacheReadTokens');
    expect(result).not.toHaveProperty('providerRequestId');
  });

  it('reports HTTP 429 retry delay but makes exactly one request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('rate-limited', {
      status: 429,
      headers: { 'retry-after': '1' },
    }));
    const result = await createGoogleProviderTransport({ getCredential: () => 'google-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ httpStatus: 429, providerRequestStatus: 'rejected', retryAfterMs: 1_000 });
    expect(result).not.toHaveProperty('responseBytes');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps current Interactions HTTP failures distinct and never applies legacy generateContent shape', async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{}', { status: 500 });
    });
    const result = await createGoogleProviderTransport({ getCredential: () => 'google-test-key', fetchImpl })
      .execute(request, context);
    expect(result).toMatchObject({ httpStatus: 500, providerRequestStatus: 'rejected' });
    expect(sentBody).not.toHaveProperty('contents');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
