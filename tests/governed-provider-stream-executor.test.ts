import { describe, expect, it, vi } from 'vitest';

import { createGovernedProviderStreamExecutor } from '../src/governed-provider-stream-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import {
  createProviderStreamTransportRegistry,
  MAX_PROVIDER_STREAM_EVENT_BYTES,
  type ProviderStreamTransport,
} from '../src/provider-stream-transport.js';
import {
  isGeneratedGovernedProviderStreamEvent,
  isGeneratedGovernedProviderStreamSession,
} from '../src/governed-provider-stream-executor.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of source) output.push(value);
  return output;
}

function events(values: readonly unknown[]): AsyncIterable<unknown> {
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      for (const value of values) yield value;
    },
  });
}

function setup(transport: ProviderStreamTransport) {
  const request = makeRequest({
    providerId: transport.providerId,
    model: transport.providerId === 'anthropic'
      ? 'claude-opus-5'
      : transport.providerId === 'google'
        ? 'gemini-3.8-flash'
        : 'gpt-5.6-sol',
  });
  const runtime = makeRuntime({ providerId: request.providerId });
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  const executor = createGovernedProviderStreamExecutor({
    transports: createProviderStreamTransportRegistry([transport]),
    providerRuntime: runtime,
    now: () => at,
  });
  return { request, runtime, gate, permit, executor };
}

describe('governed provider stream executor', () => {
  it('consumes the exact permit before the transport callback can yield', async () => {
    let callbackStarted = false;
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: vi.fn(async (request) => {
        callbackStarted = true;
        return {
          providerId: 'openai',
          model: request.model,
          networkStatus: 'executed',
          providerRequestStatus: 'accepted',
          httpStatus: 200,
          events: events([{
            kind: 'terminal',
            providerEventType: 'response.completed',
            terminalStatus: 'completed',
          }]),
        };
      }),
    };
    const { request, permit, executor } = setup(transport);

    const session = await executor.open(request, permit);
    expect(callbackStarted).toBe(true);
    await expect(executor.open(request, permit)).rejects.toMatchObject({
      code: 'permit-already-consumed',
      transportInvoked: false,
    });
    expect((transport.open as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((await collect(session.events))[0]).toMatchObject({
      kind: 'terminal',
      terminalStatus: 'completed',
    });
  });

  it('marks sessions and events with process-local provenance only', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          { kind: 'text-delta', providerEventType: 'response.output_text.delta', text: 'Hello' },
          { kind: 'terminal', providerEventType: 'response.completed', terminalStatus: 'completed' },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);
    const output = await collect(session.events);

    expect(isGeneratedGovernedProviderStreamSession(session)).toBe(true);
    expect(isGeneratedGovernedProviderStreamSession(structuredClone({
      ...session,
      events: undefined,
    }))).toBe(false);
    expect(output.every(isGeneratedGovernedProviderStreamEvent)).toBe(true);
    expect(isGeneratedGovernedProviderStreamEvent(structuredClone(output[0]!))).toBe(false);
  });

  it('fails an accepted stream that ends without a terminal provider event', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          { kind: 'text-delta', providerEventType: 'response.output_text.delta', text: 'partial' },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-interrupted',
      transportInvoked: true,
    });
  });

  it('allows an HTTP rejection session to expose zero events without inventing interruption', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'rejected',
        httpStatus: 429,
        retryAfterMs: 2_000,
        events: events([]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);

    expect(session).toMatchObject({
      httpStatus: 429,
      retryAfterMs: 2_000,
      providerRequest: { status: 'rejected', evidence: 'transport-reported' },
    });
    expect(await collect(session.events)).toEqual([]);
  });

  it('rejects contradictory accepted/non-2xx session evidence', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 503,
        events: events([]),
      }),
    };
    const { request, permit, executor } = setup(transport);

    await expect(executor.open(request, permit)).rejects.toMatchObject({
      code: 'stream-session-invalid',
      transportInvoked: true,
    });
  });

  it('stops after a provider-error event and does not require a second terminal event', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([{
          kind: 'provider-error',
          providerEventType: 'error',
          errorCode: 'overloaded',
        }]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);
    const output = await collect(session.events);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      kind: 'provider-error',
      errorCode: 'overloaded',
      evidence: 'transport-reported',
      cost: { status: 'unknown' },
    });
  });

  it('rejects any event emitted after a terminal event', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          { kind: 'terminal', providerEventType: 'response.completed', terminalStatus: 'completed' },
          { kind: 'text-delta', providerEventType: 'response.output_text.delta', text: 'late' },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-event-invalid',
      transportInvoked: true,
    });
  });

  it('enforces the per-event text bound before exposing oversized output', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async (request) => ({
        providerId: 'openai',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          {
            kind: 'text-delta',
            providerEventType: 'response.output_text.delta',
            text: 'x'.repeat(MAX_PROVIDER_STREAM_EVENT_BYTES + 1),
          },
          { kind: 'terminal', providerEventType: 'response.completed', terminalStatus: 'completed' },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const session = await executor.open(request, permit);

    await expect(collect(session.events)).rejects.toMatchObject({
      code: 'stream-event-too-large',
      transportInvoked: true,
    });
  });

  it('never promotes provider-event metadata into assistant text', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'anthropic',
      protocol: 'anthropic',
      open: async (request) => ({
        providerId: 'anthropic',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          {
            kind: 'provider-event',
            providerEventType: 'content_block_delta:thinking_delta',
          },
          {
            kind: 'text-delta',
            providerEventType: 'content_block_delta',
            text: 'public answer',
          },
          {
            kind: 'terminal',
            providerEventType: 'message_stop',
            terminalStatus: 'completed',
          },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const output = await collect((await executor.open(request, permit)).events);

    expect(output[0]).not.toHaveProperty('text');
    expect(output[1]).toMatchObject({ kind: 'text-delta', text: 'public answer' });
  });

  it('preserves absent token categories as absent and keeps cost unknown', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'google',
      protocol: 'google',
      open: async (request) => ({
        providerId: 'google',
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        httpStatus: 200,
        events: events([
          {
            kind: 'usage',
            providerEventType: 'interaction.completed',
            usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 },
          },
          {
            kind: 'terminal',
            providerEventType: 'interaction.completed',
            terminalStatus: 'completed',
          },
        ]),
      }),
    };
    const { request, permit, executor } = setup(transport);
    const output = await collect((await executor.open(request, permit)).events);
    const terminal = output.at(-1)!;

    expect(terminal.cost).toMatchObject({
      status: 'unknown',
      reason: 'complete explicit token usage was not reported',
    });
    expect(output[0]?.usage).not.toHaveProperty('cacheWriteTokens');
  });

  it('sanitizes a thrown stream transport callback error', async () => {
    const transport: ProviderStreamTransport = {
      providerId: 'openai',
      protocol: 'openai',
      open: async () => {
        throw new Error('credential=DO_NOT_LEAK');
      },
    };
    const { request, permit, executor } = setup(transport);

    await expect(executor.open(request, permit)).rejects.toMatchObject({
      code: 'stream-transport-error',
      message: 'Provider stream transport failed.',
      transportInvoked: true,
    });
  });
});
