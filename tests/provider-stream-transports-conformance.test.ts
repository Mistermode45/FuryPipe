import { describe, expect, it, vi } from 'vitest';

import { createGovernedProviderStreamExecutor } from '../src/governed-provider-stream-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderStreamTransportRegistry } from '../src/provider-stream-transport.js';
import { createOpenAIProviderStreamTransport } from '../src/provider-stream-transports/openai.js';
import { createAnthropicProviderStreamTransport } from '../src/provider-stream-transports/anthropic.js';
import { createGoogleProviderStreamTransport } from '../src/provider-stream-transports/google.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;

function sse(frames: readonly { event: string; data: unknown }[]): Response {
  const body = frames.map((frame) =>
    'event: ' + frame.event + '\n' +
    'data: ' + (frame.data === '[DONE]' ? '[DONE]' : JSON.stringify(frame.data)) + '\n\n'
  ).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of source) output.push(value);
  return output;
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function body(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

async function executeOpenAI(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'openai', model: 'gpt-5.6-sol', task: 'STREAM_OPENAI' });
  const runtime = makeRuntime({ providerId: 'openai' });
  const permit = createProviderExecutionGate({ providerRuntime: runtime, now: () => at })
    .authorize(request, makePolicy(request));
  const executor = createGovernedProviderStreamExecutor({
    transports: createProviderStreamTransportRegistry([
      createOpenAIProviderStreamTransport({
        getCredential: () => 'offline-openai-stream-key',
        fetchImpl,
        maxOutputTokens: 321,
      }),
    ]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, session: await executor.open(request, permit) };
}

async function executeAnthropic(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'anthropic', model: 'claude-opus-5', task: 'STREAM_ANTHROPIC' });
  const runtime = makeRuntime({ providerId: 'anthropic' });
  const permit = createProviderExecutionGate({ providerRuntime: runtime, now: () => at })
    .authorize(request, makePolicy(request));
  const executor = createGovernedProviderStreamExecutor({
    transports: createProviderStreamTransportRegistry([
      createAnthropicProviderStreamTransport({
        getCredential: () => 'offline-anthropic-stream-key',
        fetchImpl,
        maxOutputTokens: 321,
      }),
    ]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, session: await executor.open(request, permit) };
}

async function executeGoogle(fetchImpl: typeof fetch) {
  const request = makeRequest({ providerId: 'google', model: 'gemini-3.8-flash', task: 'STREAM_GOOGLE' });
  const runtime = makeRuntime({ providerId: 'google' });
  const permit = createProviderExecutionGate({ providerRuntime: runtime, now: () => at })
    .authorize(request, makePolicy(request));
  const executor = createGovernedProviderStreamExecutor({
    transports: createProviderStreamTransportRegistry([
      createGoogleProviderStreamTransport({
        getCredential: () => 'offline-google-stream-key',
        fetchImpl,
        maxOutputTokens: 321,
      }),
    ]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, session: await executor.open(request, permit) };
}

describe('production provider SSE stream conformance', () => {
  it('OpenAI uses exact Responses streaming shape and never exposes reasoning text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(header(init, 'authorization')).toBe('Bearer offline-openai-stream-key');
      expect(header(init, 'accept')).toBe('text/event-stream');
      expect(body(init)).toEqual({
        model: 'gpt-5.6-sol',
        input: expect.any(String),
        store: false,
        stream: true,
        max_output_tokens: 321,
      });
      return sse([
        {
          event: 'response.reasoning_text.delta',
          data: { type: 'response.reasoning_text.delta', delta: 'PRIVATE_REASONING_SENTINEL' },
        },
        {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', delta: 'Public answer' },
        },
        {
          event: 'response.completed',
          data: {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 10,
                input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
                output_tokens: 4,
              },
            },
          },
        },
      ]);
    });

    const { request, session } = await executeOpenAI(fetchImpl);
    expect(body(fetchImpl.mock.calls[0]![1]).input).toBe(request.prompt);
    const output = await collect(session.events);
    expect(output.filter((event) => event.kind === 'text-delta').map((event) => event.text))
      .toEqual(['Public answer']);
    expect(JSON.stringify(output)).not.toContain('PRIVATE_REASONING_SENTINEL');
    expect(output.at(-1)).toMatchObject({
      kind: 'terminal',
      terminalStatus: 'completed',
      usage: { inputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('Anthropic exposes text_delta but keeps thinking, signatures and tool JSON opaque', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      expect(header(init, 'authorization')).toBe('Bearer offline-anthropic-stream-key');
      expect(header(init, 'anthropic-version')).toBe('2023-06-01');
      expect(body(init)).toEqual({
        model: 'claude-opus-5',
        max_tokens: 321,
        messages: [{ role: 'user', content: expect.any(String) }],
        stream: true,
      });
      return sse([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: { usage: { input_tokens: 8, cache_creation_input_tokens: 1, cache_read_input_tokens: 2 } },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'PRIVATE_THINKING_SENTINEL' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'PRIVATE_SIGNATURE_SENTINEL' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"secret":"PRIVATE_TOOL_SENTINEL"}' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'text_delta', text: 'Visible Claude answer' },
          },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]);
    });

    const { request, session } = await executeAnthropic(fetchImpl);
    const sent = body(fetchImpl.mock.calls[0]![1]);
    expect((sent.messages as Array<{ content: string }>)[0]!.content).toBe(request.prompt);
    const output = await collect(session.events);
    expect(output.filter((event) => event.kind === 'text-delta').map((event) => event.text))
      .toEqual(['Visible Claude answer']);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('PRIVATE_THINKING_SENTINEL');
    expect(serialized).not.toContain('PRIVATE_SIGNATURE_SENTINEL');
    expect(serialized).not.toContain('PRIVATE_TOOL_SENTINEL');
    expect(output.at(-1)).toMatchObject({
      kind: 'terminal',
      terminalStatus: 'completed',
      finishReason: 'end_turn',
    });
  });

  it('Gemini exposes text only from model_output steps and suppresses thought/function payloads', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1/interactions');
      expect(header(init, 'x-goog-api-key')).toBe('offline-google-stream-key');
      expect(header(init, 'authorization')).toBeNull();
      expect(body(init)).toEqual({
        model: 'gemini-3.8-flash',
        input: expect.any(String),
        store: false,
        stream: true,
        generation_config: { max_output_tokens: 321 },
      });
      return sse([
        {
          event: 'step.start',
          data: { event_type: 'step.start', index: 0, step: { type: 'thought' } },
        },
        {
          event: 'step.delta',
          data: {
            event_type: 'step.delta',
            index: 0,
            delta: { type: 'text', text: 'PRIVATE_GEMINI_THOUGHT_SENTINEL' },
          },
        },
        { event: 'step.stop', data: { event_type: 'step.stop', index: 0 } },
        {
          event: 'step.start',
          data: { event_type: 'step.start', index: 1, step: { type: 'function_call', name: 'danger' } },
        },
        {
          event: 'step.delta',
          data: {
            event_type: 'step.delta',
            index: 1,
            delta: { type: 'arguments_delta', arguments: '{"secret":"PRIVATE_GEMINI_TOOL_SENTINEL"}' },
          },
        },
        { event: 'step.stop', data: { event_type: 'step.stop', index: 1 } },
        {
          event: 'step.start',
          data: { event_type: 'step.start', index: 2, step: { type: 'model_output' } },
        },
        {
          event: 'step.delta',
          data: {
            event_type: 'step.delta',
            index: 2,
            delta: { type: 'text', text: 'Visible Gemini answer' },
          },
        },
        { event: 'step.stop', data: { event_type: 'step.stop', index: 2 } },
        {
          event: 'interaction.completed',
          data: {
            event_type: 'interaction.completed',
            interaction: {
              status: 'completed',
              usage: { total_input_tokens: 9, total_cached_tokens: 2, total_output_tokens: 3 },
            },
          },
        },
        {
          event: 'done',
          data: '[DONE]',
        },
      ]);
    });

    const { request, session } = await executeGoogle(fetchImpl);
    expect(body(fetchImpl.mock.calls[0]![1]).input).toBe(request.prompt);
    const output = await collect(session.events);
    expect(output.filter((event) => event.kind === 'text-delta').map((event) => event.text))
      .toEqual(['Visible Gemini answer']);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('PRIVATE_GEMINI_THOUGHT_SENTINEL');
    expect(serialized).not.toContain('PRIVATE_GEMINI_TOOL_SENTINEL');
    expect(output.at(-1)).toMatchObject({
      kind: 'terminal',
      terminalStatus: 'completed',
      usage: { inputTokens: 7, cacheReadTokens: 2, outputTokens: 3 },
    });
  });

  it.each([
    ['openai', executeOpenAI],
    ['anthropic', executeAnthropic],
    ['google', executeGoogle],
  ] as const)('%s reports HTTP rejection once and never invents stream events', async (_provider, execute) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('private rejection', {
      status: 429,
      headers: { 'retry-after': '2', 'content-type': 'application/json' },
    }));
    const { session } = await execute(fetchImpl);

    expect(session).toMatchObject({
      httpStatus: 429,
      retryAfterMs: 2_000,
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'rejected', evidence: 'transport-reported' },
    });
    expect(await collect(session.events)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails closed when a 2xx response is not SSE', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"not":"sse"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(executeOpenAI(fetchImpl)).rejects.toMatchObject({
      code: 'stream-transport-error',
      transportInvoked: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails an SSE stream that closes after text without a provider terminal event', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'partial only' },
      },
    ]));
    const { session } = await executeOpenAI(fetchImpl);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-interrupted',
      transportInvoked: true,
    });
  });

  it('does not expose unknown SSE payloads, only their safe event type', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sse([
      {
        event: 'response.future_event',
        data: { type: 'response.future_event', private: 'PRIVATE_UNKNOWN_PAYLOAD' },
      },
      {
        event: 'response.completed',
        data: { type: 'response.completed', response: {} },
      },
    ]));
    const { session } = await executeOpenAI(fetchImpl);
    const output = await collect(session.events);

    expect(output[0]).toMatchObject({
      kind: 'provider-event',
      providerEventType: 'response.future_event',
    });
    expect(JSON.stringify(output)).not.toContain('PRIVATE_UNKNOWN_PAYLOAD');
  });

  it('fails closed when SSE event name and JSON event type disagree', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.completed', delta: 'ambiguous' },
      },
    ]));
    const { session } = await executeOpenAI(fetchImpl);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-event-invalid',
      transportInvoked: true,
    });
  });

  it('fails closed if a provider text delta contains the active credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'offline-openai-stream-key' },
      },
      {
        event: 'response.completed',
        data: { type: 'response.completed', response: {} },
      },
    ]));
    const { session } = await executeOpenAI(fetchImpl);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-event-invalid',
      transportInvoked: true,
    });
  });

  it('rejects an oversized unterminated SSE frame before exposing any payload', async () => {
    const huge = 'event: response.future_event\ndata: ' + 'x'.repeat(300_000);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(huge, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const { session } = await executeOpenAI(fetchImpl);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-event-too-large',
      transportInvoked: true,
    });
  });
});
