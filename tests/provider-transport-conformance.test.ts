import { describe, expect, it, vi } from 'vitest';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import { createOpenAIProviderTransport } from '../src/provider-transports/openai.js';
import { createAnthropicProviderTransport } from '../src/provider-transports/anthropic.js';
import { createGoogleProviderTransport } from '../src/provider-transports/google.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 10_000;

async function executeOpenAI(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'openai', model: 'gpt-5.6-sol', task: 'CONFORMANCE_OPENAI' });
  const runtime = makeRuntime({ providerId: 'openai' });
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  const transport = createOpenAIProviderTransport({
    getCredential: () => 'offline-openai-key',
    fetchImpl,
    maxOutputTokens: 321,
  });
  const executor = createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([transport]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, result: await executor.execute(request, permit) };
}

async function executeAnthropic(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'anthropic', model: 'claude-opus-5', task: 'CONFORMANCE_ANTHROPIC' });
  const runtime = makeRuntime({ providerId: 'anthropic' });
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  const transport = createAnthropicProviderTransport({
    getCredential: () => 'offline-anthropic-key',
    fetchImpl,
    maxOutputTokens: 321,
  });
  const executor = createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([transport]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, result: await executor.execute(request, permit) };
}

async function executeGoogle(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'google', model: 'gemini-3.8-flash', task: 'CONFORMANCE_GOOGLE' });
  const runtime = makeRuntime({ providerId: 'google' });
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  const transport = createGoogleProviderTransport({
    getCredential: () => 'offline-google-key',
    fetchImpl,
    maxOutputTokens: 321,
  });
  const executor = createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([transport]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, result: await executor.execute(request, permit) };
}

function jsonBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe('production provider transport offline conformance', () => {
  it('OpenAI preserves exact request identity and the Responses API contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(header(init, 'authorization')).toBe('Bearer offline-openai-key');
      expect(jsonBody(init)).toEqual({
        model: 'gpt-5.6-sol',
        input: expect.any(String),
        store: false,
        max_output_tokens: 321,
      });
      return new Response(JSON.stringify({
        usage: {
          input_tokens: 9,
          input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
          output_tokens: 4,
        },
      }), { status: 200, headers: { 'x-request-id': 'openai-conformance-request' } });
    });

    const { request, result } = await executeOpenAI(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(jsonBody(fetchImpl.mock.calls[0]![1]).input).toBe(request.prompt);
    expect(result).toMatchObject({
      providerId: 'openai',
      model: request.model,
      requestDigest: request.requestDigest,
      httpStatus: 200,
      providerRequestId: 'openai-conformance-request',
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'accepted', evidence: 'transport-reported' },
      usage: { inputTokens: 6, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 },
    });
  });

  it('Anthropic preserves exact request identity and the Messages API contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(header(init, 'authorization')).toBe('Bearer offline-anthropic-key');
      expect(header(init, 'anthropic-version')).toBe('2023-06-01');
      expect(jsonBody(init)).toEqual({
        model: 'claude-opus-5',
        max_tokens: 321,
        messages: [{ role: 'user', content: expect.any(String) }],
      });
      return new Response(JSON.stringify({
        usage: {
          input_tokens: 7,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 5,
        },
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'request-id': 'anthropic-conformance-request' } });
    });

    const { request, result } = await executeAnthropic(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = jsonBody(fetchImpl.mock.calls[0]![1]);
    expect((body.messages as Array<{ content: string }>)[0]!.content).toBe(request.prompt);
    expect(result).toMatchObject({
      providerId: 'anthropic',
      model: request.model,
      requestDigest: request.requestDigest,
      httpStatus: 200,
      providerRequestId: 'anthropic-conformance-request',
      finishReason: 'end_turn',
      usage: { inputTokens: 7, cacheWriteTokens: 2, cacheReadTokens: 3, outputTokens: 5 },
    });
  });

  it('Google preserves exact request identity and the stable Interactions API contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1/interactions');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(header(init, 'x-goog-api-key')).toBe('offline-google-key');
      expect(jsonBody(init)).toEqual({
        model: 'gemini-3.8-flash',
        input: expect.any(String),
        store: false,
        generation_config: { max_output_tokens: 321 },
      });
      return new Response(JSON.stringify({
        usage: {
          total_input_tokens: 11,
          total_cached_tokens: 4,
          total_output_tokens: 6,
        },
      }), { status: 200 });
    });

    const { request, result } = await executeGoogle(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(jsonBody(fetchImpl.mock.calls[0]![1]).input).toBe(request.prompt);
    expect(result).toMatchObject({
      providerId: 'google',
      model: request.model,
      requestDigest: request.requestDigest,
      httpStatus: 200,
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'accepted', evidence: 'transport-reported' },
      usage: { inputTokens: 7, cacheReadTokens: 4, outputTokens: 6 },
    });
    expect(result.providerRequestId).toBeUndefined();
  });

  it.each([
    ['openai', executeOpenAI],
    ['anthropic', executeAnthropic],
    ['google', executeGoogle],
  ] as const)('%s executes exactly one HTTP request and does not retry a rejection', async (_provider, execute) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', {
      status: 503,
      headers: { 'retry-after': '2' },
    }));

    const { result } = await execute(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      httpStatus: 503,
      retryAfterMs: 2_000,
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'rejected', evidence: 'transport-reported' },
    });
    expect(result.responseBytes).toBeUndefined();
  });

  it.each([
    ['openai', executeOpenAI],
    ['anthropic', executeAnthropic],
    ['google', executeGoogle],
  ] as const)('%s sanitizes transport failures and does not issue a second request', async (_provider, execute) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('credential=OFFLINE_SECRET_SENTINEL');
    });

    await expect(execute(fetchImpl)).rejects.toMatchObject({
      code: 'transport-error',
      transportInvoked: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ['openai', executeOpenAI],
    ['anthropic', executeAnthropic],
    ['google', executeGoogle],
  ] as const)('%s keeps malformed successful JSON HTTP-accepted without inventing usage', async (_provider, execute) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{not-json', { status: 200 }));

    const { result } = await execute(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.network).toEqual({ status: 'executed', evidence: 'transport-reported' });
    expect(result.providerRequest).toEqual({ status: 'accepted', evidence: 'transport-reported' });
    expect(result.usage).toBeUndefined();
  });
});
