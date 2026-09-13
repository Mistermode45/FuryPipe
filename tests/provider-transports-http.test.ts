import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../src/provider-execution-internal.js';
import { createOpenAIProviderTransport } from '../src/provider-transports/openai.js';
import { parseProviderReset, parseRetryAfter } from '../src/provider-transports/http-runtime.js';
import { makeRequest } from './helpers/provider-executor.js';

const context = (request: ReturnType<typeof makeRequest>, signal?: AbortSignal) => ({
  requestDigest: request.requestDigest,
  providerId: request.providerId,
  model: request.model,
  workloadId: request.workloadId,
  maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
  ...(signal === undefined ? {} : { signal }),
});

const transportOptions = (fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) => ({
  getCredential: () => 'test-auth-sentinel',
  fetchImpl,
  ...overrides,
});

describe('production provider HTTP runtime', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts exactly 1 MiB and rejects a chunked body one byte above the limit', async () => {
    const request = makeRequest();
    const exactFetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES)));
    const exact = await createOpenAIProviderTransport(transportOptions(exactFetch))
      .execute(request, context(request)) as { responseBytes: Uint8Array };
    expect(exact.responseBytes.byteLength).toBe(MAX_PROVIDER_RESPONSE_BYTES);

    let canceled = false;
    let requestSignal: AbortSignal | undefined;
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES + 1)); },
      cancel() { canceled = true; },
    });
    const oversizedFetch = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Response(oversizedStream, { headers: { 'content-length': '1' } });
    });
    const oversized = createOpenAIProviderTransport(transportOptions(oversizedFetch));
    await expect(oversized.execute(request, context(request))).rejects.toMatchObject({
      code: 'response-too-large', transportInvoked: true,
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(canceled).toBe(true);
  });

  it('aborts early when Content-Length exceeds the limit, without reading the stream', async () => {
    const request = makeRequest();
    let read = false;
    let canceled = false;
    let requestSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull() { read = true; },
      cancel() { canceled = true; },
    }, { highWaterMark: 0 });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Response(body, { headers: { 'content-length': String(MAX_PROVIDER_RESPONSE_BYTES + 1) } });
    });

    await expect(createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request)))
      .rejects.toMatchObject({ code: 'response-too-large', transportInvoked: true });
    expect(requestSignal?.aborted).toBe(true);
    expect(read).toBe(false);
    expect(canceled).toBe(true);
  });

  it('times out a stalled fetch, aborts it, and exposes no original network error', async () => {
    const request = makeRequest();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new Error('secret=test-auth-sentinel')));
    }));
    vi.useFakeTimers();
    const execution = createOpenAIProviderTransport(transportOptions(fetchImpl, { timeoutMs: 5 }))
      .execute(request, context(request));
    const assertion = expect(execution).rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not invoke fetch for an already-cancelled host signal', async () => {
    const request = makeRequest();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(createOpenAIProviderTransport(transportOptions(fetchImpl))
      .execute(request, context(request, controller.signal)))
      .rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts an in-flight fetch on host cancellation and clears its timer/listener', async () => {
    const request = makeRequest();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new Error('private cancellation detail')));
    }));
    vi.useFakeTimers();
    const execution = createOpenAIProviderTransport(transportOptions(fetchImpl, { timeoutMs: 10_000 }))
      .execute(request, context(request, controller.signal));
    const assertion = expect(execution).rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledOnce();
    controller.abort();
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the timeout after successful completion', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    vi.useFakeTimers();
    await createOpenAIProviderTransport(transportOptions(fetchImpl, { timeoutMs: 1_000 }))
      .execute(request, context(request));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the host abort listener after completion', async () => {
    const request = makeRequest();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    await createOpenAIProviderTransport(transportOptions(fetchImpl))
      .execute(request, context(request, controller.signal));
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls[0]?.[0]).toBe('abort');
  });

  it('parses bounded Retry-After seconds, HTTP dates, and OpenAI duration syntax', () => {
    expect(parseRetryAfter('3', () => 1_000)).toBe(3_000);
    expect(parseRetryAfter(new Date(4_500).toUTCString(), () => 1_000)).toBe(3_000);
    expect(parseRetryAfter('999999999', () => 1_000)).toBeUndefined();
    expect(parseRetryAfter('invalid', () => 1_000)).toBeUndefined();
    expect(parseProviderReset('6m0s')).toBe(360_000);
    expect(parseProviderReset('250ms')).toBe(250);
    expect(parseProviderReset('6mgarbage')).toBeUndefined();
    expect(parseProviderReset('999999h')).toBeUndefined();
  });

  it('never returns rejected HTTP error bodies or leaks a credential through safe failures', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: 'test-auth-sentinel' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ));
    const result = await createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request));
    expect(result).toMatchObject({ httpStatus: 401, providerRequestStatus: 'rejected' });
    expect(result).not.toHaveProperty('responseBytes');
    expect(JSON.stringify(result)).not.toContain('test-auth-sentinel');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 404, 409, 429, 500, 503])('reports HTTP %i as rejected without retrying or returning its error body', async (status) => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('private provider error', { status }));
    const result = await createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request));
    expect(result).toMatchObject({
      httpStatus: status,
      networkStatus: 'executed',
      providerRequestStatus: 'rejected',
    });
    expect(result).not.toHaveProperty('responseBytes');
    expect(JSON.stringify(result)).not.toContain('private provider error');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('handles an empty successful HTTP body without inventing parsed fields', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const result = await createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request));
    expect(result).toMatchObject({ httpStatus: 200, providerRequestStatus: 'accepted' });
    expect(result).toHaveProperty('responseBytes');
    expect(result.responseBytes).toHaveLength(0);
    expect(result).not.toHaveProperty('usage');
    expect(result).not.toHaveProperty('providerRequestId');
  });

  it('rejects an AbortError as a sanitized transport failure', async () => {
    const request = makeRequest();
    const error = new Error('private abort reason');
    error.name = 'AbortError';
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw error; });
    await expect(createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request)))
      .rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails closed if a successful provider body echoes the credential', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ output: 'test-auth-sentinel' }), { status: 200 },
    ));
    const transport = createOpenAIProviderTransport(transportOptions(fetchImpl));
    await expect(transport.execute(request, context(request)))
      .rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('detects a credential echoed with JSON Unicode escapes before returning raw bytes', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      '{"output":"test-auth\\u002dsentinel"}', { status: 200 },
    ));
    await expect(createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request)))
      .rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('omits a provider request ID header that contains the credential', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 200,
      headers: { 'x-request-id': 'req-test-auth-sentinel-leak' },
    }));
    const result = await createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request));
    expect(result).not.toHaveProperty('providerRequestId');
    expect(JSON.stringify(result)).not.toContain('test-auth-sentinel');
  });

  it('keeps hostile model text in JSON and never lets it alter the fixed official endpoint', async () => {
    const model = 'model/../../https://attacker.invalid/path';
    let endpoint = '';
    let sentModel: unknown;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      endpoint = String(input);
      sentModel = (JSON.parse(String(init?.body)) as Record<string, unknown>).model;
      return new Response('{}', { status: 200 });
    });
    const fakeRequest = { ...makeRequest(), model } as ReturnType<typeof makeRequest>;
    const fakeContext = { ...context(fakeRequest), model };
    await createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(fakeRequest, fakeContext);
    expect(endpoint).toBe('https://api.openai.com/v1/responses');
    expect(sentModel).toBe(model);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sanitizes DNS/socket errors rather than misreporting them as HTTP rejection', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('DNS secret=test-auth-sentinel'); });
    await expect(createOpenAIProviderTransport(transportOptions(fetchImpl)).execute(request, context(request)))
      .rejects.toMatchObject({ message: 'Provider HTTP transport request failed.' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
