import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROVIDER_REGISTRY,
  COST_UNKNOWN,
  createProviderRuntimeState,
} from '../src/core/index.js';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import { createOpenAIProviderTransport } from '../src/provider-transports/openai.js';
import { createAnthropicProviderTransport } from '../src/provider-transports/anthropic.js';
import { createGoogleProviderTransport } from '../src/provider-transports/google.js';
import { FuryGovernedProviderExecutorError } from '../src/provider-execution-errors.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;
const openAiModel = 'gpt-5.6-sol';
const anthropicModel = 'claude-opus-5';

function runtimeWithBothProviders() {
  const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  for (const providerId of ['openai', 'anthropic']) {
    runtime.observeHealth({
      providerId,
      availability: 'available',
      observedAt: 0,
      expiresAt: 10_000,
      source: 'local-executor-test',
      evidenceKind: 'operator-config',
    });
  }
  return runtime;
}

function authorizedExecutor(
  request: ReturnType<typeof makeRequest>,
  transports: ReturnType<typeof createProviderTransportRegistry>,
  options: {
    readonly runtime?: ReturnType<typeof makeRuntime>;
    readonly gateNow?: () => number;
    readonly executorNow?: () => number;
  } = {},
) {
  const runtime = options.runtime ?? makeRuntime({ providerId: request.providerId });
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: options.gateNow ?? (() => at) });
  const permit = gate.authorize(request, makePolicy(request));
  const executor = createGovernedProviderExecutor({
    transports,
    providerRuntime: runtime,
    now: options.executorNow ?? (() => at),
  });
  return { runtime, gate, permit, executor };
}

function openAiResult(overrides: Record<string, unknown> = {}) {
  return { providerId: 'openai', model: openAiModel, ...overrides };
}

describe('governed provider executor', () => {
  it('invokes exactly one exact registered transport with the final Context Runtime prompt', async () => {
    const request = makeRequest({ task: 'FINAL_CONTEXT_PROMPT' });
    const execute = vi.fn(async (received: typeof request) => openAiResult({
      networkStatus: 'executed', providerRequestStatus: 'accepted',
      providerRequestId: 'request-123', finishReason: 'stop',
    }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const result = await executor.execute(request, permit);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].prompt).toBe(request.prompt);
    expect(result).toMatchObject({
      state: 'TRANSPORT_RESULT',
      transportInvoked: true,
      providerId: request.providerId,
      model: request.model,
      workloadId: request.workloadId,
      requestDigest: request.requestDigest,
      providerRequestId: 'request-123',
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'accepted', evidence: 'transport-reported' },
      cost: { status: COST_UNKNOWN },
    });
  });

  it('passes optional host cancellation through and preserves HTTP retry metadata', async () => {
    const request = makeRequest();
    const controller = new AbortController();
    const execute = vi.fn(async (_received: typeof request, context: { signal?: AbortSignal }) => openAiResult({
      httpStatus: 429,
      retryAfterMs: 3_000,
    }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const result = await executor.execute(request, permit, { signal: controller.signal });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![1].signal).toBe(controller.signal);
    expect(result).toMatchObject({ httpStatus: 429, retryAfterMs: 3_000 });
  });

  it('executes the real OpenAI adapter through the governed permit and keeps response identity exact', async () => {
    const request = makeRequest({ task: 'GOVERNED_REAL_ADAPTER_PROMPT' });
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 2,
        },
      }), { status: 200, headers: { 'x-request-id': 'req-governed-adapter' } });
    });
    const transport = createOpenAIProviderTransport({
      getCredential: () => 'fake-provider-key',
      fetchImpl,
      maxOutputTokens: 100,
    });
    const { permit, executor } = authorizedExecutor(request, createProviderTransportRegistry([transport]));
    const result = await executor.execute(request, permit);

    expect(sentBody).toEqual({
      model: request.model,
      input: request.prompt,
      store: false,
      max_output_tokens: 100,
    });
    expect(result).toMatchObject({
      providerId: request.providerId,
      model: request.model,
      requestDigest: request.requestDigest,
      httpStatus: 200,
      providerRequestId: 'req-governed-adapter',
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(result.network).toEqual({ status: 'executed', evidence: 'transport-reported' });
    expect(result.providerRequest).toEqual({ status: 'accepted', evidence: 'transport-reported' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('preserves the real adapter streaming byte-limit error through the governed boundary', async () => {
    const request = makeRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
      }),
      { status: 200, headers: { 'content-length': '1' } },
    ));
    const transport = createOpenAIProviderTransport({ getCredential: () => 'fake-provider-key', fetchImpl });
    const { permit, executor } = authorizedExecutor(request, createProviderTransportRegistry([transport]));

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'response-too-large',
      transportInvoked: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    {
      providerId: 'anthropic' as const,
      model: 'claude-opus-5',
      create: (fetchImpl: typeof fetch) => createAnthropicProviderTransport({
        getCredential: () => 'fake-anthropic-key', fetchImpl, maxOutputTokens: 128,
      }),
      response: { usage: { input_tokens: 3, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      providerId: 'google' as const,
      model: 'gemini-3.8-flash',
      create: (fetchImpl: typeof fetch) => createGoogleProviderTransport({
        getCredential: () => 'fake-google-key', fetchImpl,
      }),
      response: { usage: { total_input_tokens: 3, total_cached_tokens: 0, total_output_tokens: 2 } },
    },
  ])('runs the $providerId production transport under its exact governed permit', async ({ providerId, model, create, response }) => {
    const request = makeRequest({ providerId, model, task: `EXACT_${providerId.toUpperCase()}_PROMPT` });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: providerId === 'anthropic' ? { 'request-id': 'req-integration-anthropic' } : {},
    }));
    const transport = create(fetchImpl);
    const { permit, executor } = authorizedExecutor(request, createProviderTransportRegistry([transport]));
    const result = await executor.execute(request, permit);

    expect(result).toMatchObject({
      providerId,
      model,
      requestDigest: request.requestDigest,
      httpStatus: 200,
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'accepted', evidence: 'transport-reported' },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not invent network execution, provider acceptance, or cost when unreported', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult());
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const result = await executor.execute(request, permit);

    expect(result.transportInvoked).toBe(true);
    expect(result.network).toEqual({ status: 'unknown', evidence: 'not-reported' });
    expect(result.providerRequest).toEqual({ status: 'unknown', evidence: 'not-reported' });
    expect(result.cost.status).toBe(COST_UNKNOWN);
    expect(result.usage).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('networkCallExecuted');
  });

  it('rejects a hand-crafted permit', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult());
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const executor = createGovernedProviderExecutor({
      transports, providerRuntime: makeRuntime(), now: () => at,
    });

    await expect(executor.execute(request, {
      format: 'furypipe-provider-execution-permit/v1',
      permitId: 'forged', policyId: 'host', providerId: 'openai', model: openAiModel,
      workloadId: 'coding', requestDigest: request.requestDigest, issuedAt: at, expiresAt: 10_000,
    } as never)).rejects.toMatchObject({ code: 'execution-not-authorized', transportInvoked: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects an unregistered transport without consuming the request through any callback', async () => {
    const request = makeRequest();
    const transports = createProviderTransportRegistry([]);
    const { permit, executor } = authorizedExecutor(request, transports);

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'transport-not-registered', transportInvoked: false,
    });
  });

  it('rejects a registry response whose provider does not exactly match the request', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult());
    const { permit, runtime } = authorizedExecutor(request, createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]));
    const executor = createGovernedProviderExecutor({
      transports: { get: () => ({ providerId: 'anthropic', protocol: 'openai', execute }) } as never,
      providerRuntime: runtime,
      now: () => at,
    });

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'transport-provider-mismatch', transportInvoked: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a protocol mismatch before invoking a transport', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult());
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'anthropic', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'transport-protocol-mismatch', transportInvoked: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('binds a permit to the request digest and exact provider/model/workload scope', async () => {
    const request = makeRequest();
    const executeOpenAi = vi.fn(async () => openAiResult());
    const executeAnthropic = vi.fn(async () => ({ providerId: 'anthropic', model: anthropicModel }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute: executeOpenAi },
      { providerId: 'anthropic', protocol: 'anthropic', execute: executeAnthropic },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports, { runtime: runtimeWithBothProviders() });

    for (const changed of [
      makeRequest({ task: 'different prompt' }),
      makeRequest({ providerId: 'anthropic', model: anthropicModel }),
      makeRequest({ model: 'gpt-5.6-luna' }),
      makeRequest({ workloadId: 'research' }),
    ]) {
      await expect(executor.execute(changed, permit)).rejects.toMatchObject({
        code: 'permit-request-mismatch', transportInvoked: false,
      });
    }
    expect(executeOpenAi).not.toHaveBeenCalled();
    expect(executeAnthropic).not.toHaveBeenCalled();
  });

  it('rejects a permit at and after expiration while accepting it immediately before', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult());
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const expired = authorizedExecutor(request, transports, { executorNow: () => at + 1_001 });

    await expect(expired.executor.execute(request, expired.permit))
      .rejects.toMatchObject({ code: 'permit-expired', transportInvoked: false });
    expect(execute).not.toHaveBeenCalled();

    const boundary = authorizedExecutor(request, transports, { executorNow: () => at + 1_000 });
    await expect(boundary.executor.execute(request, boundary.permit))
      .rejects.toMatchObject({ code: 'permit-expired', transportInvoked: false });
    expect(execute).not.toHaveBeenCalled();

    const beforeBoundary = authorizedExecutor(request, transports, { executorNow: () => at + 999 });
    await expect(beforeBoundary.executor.execute(request, beforeBoundary.permit)).resolves.toMatchObject({ transportInvoked: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('invokes only once when two concurrent executions race for one permit', async () => {
    const request = makeRequest();
    let release!: (value: ReturnType<typeof openAiResult>) => void;
    const waiting = new Promise<ReturnType<typeof openAiResult>>((resolve) => { release = resolve; });
    const execute = vi.fn(() => waiting);
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const results = Promise.all([
      executor.execute(request, permit),
      executor.execute(request, permit).then(
        () => ({ rejected: false as const }),
        (error: unknown) => ({ rejected: true as const, error }),
      ),
    ]);

    expect(execute).toHaveBeenCalledOnce();
    release(openAiResult());
    const [first, second] = await results;
    expect(first.transportInvoked).toBe(true);
    expect(second).toMatchObject({
      rejected: true,
      error: { code: 'permit-already-consumed', transportInvoked: false },
    });
  });

  it('consumes a permit on transport failure, reports a safe error, and never retries or falls back', async () => {
    const request = makeRequest();
    const primary = vi.fn(async () => { throw new Error('authorization=private'); });
    const fallback = vi.fn(async () => ({ providerId: 'anthropic', model: anthropicModel }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute: primary },
      { providerId: 'anthropic', protocol: 'anthropic', execute: fallback },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'transport-error', transportInvoked: true,
    });
    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'permit-already-consumed', transportInvoked: false,
    });
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('allows a retry only as a separately authorized new attempt and permit', async () => {
    const request = makeRequest();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('first transport attempt failed'))
      .mockResolvedValueOnce(openAiResult({ providerRequestStatus: 'accepted' }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const first = authorizedExecutor(request, transports);
    await expect(first.executor.execute(request, first.permit)).rejects.toMatchObject({ code: 'transport-error' });

    const retryRequest = makeRequest({ task: 'new exact retry attempt' });
    const second = authorizedExecutor(retryRequest, transports);
    await expect(second.executor.execute(retryRequest, second.permit))
      .resolves.toMatchObject({ providerRequest: { status: 'accepted', evidence: 'transport-reported' } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('requires a newly built Anthropic attempt after OpenAI failure and prevents prompt crossover', async () => {
    const openAiRequest = makeRequest({
      providerId: 'openai', model: openAiModel, task: 'OPENAI_TASK_ONLY',
      adapterMarker: 'OPENAI_ADAPTER_ONLY', contextText: 'OPENAI_CONTEXT_ONLY',
    });
    const anthropicRequest = makeRequest({
      providerId: 'anthropic', model: anthropicModel, task: 'ANTHROPIC_TASK_ONLY',
      adapterMarker: 'ANTHROPIC_ADAPTER_ONLY', contextText: 'ANTHROPIC_CONTEXT_ONLY',
    });
    const openAi = vi.fn(async () => { throw new Error('unavailable'); });
    const anthropic = vi.fn(async (request: typeof anthropicRequest) => ({
      providerId: 'anthropic', model: anthropicModel,
      providerRequestStatus: 'accepted',
    }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute: openAi },
      { providerId: 'anthropic', protocol: 'anthropic', execute: anthropic },
    ]);
    const runtime = runtimeWithBothProviders();
    const first = authorizedExecutor(openAiRequest, transports, { runtime });
    await expect(first.executor.execute(openAiRequest, first.permit)).rejects.toMatchObject({ code: 'transport-error' });
    await expect(first.executor.execute(anthropicRequest, first.permit)).rejects.toMatchObject({ code: 'permit-request-mismatch' });
    expect(anthropic).not.toHaveBeenCalled();
    expect(openAiRequest.prompt).toContain('OPENAI_ADAPTER_ONLY');
    expect(openAiRequest.prompt).toContain('OPENAI_CONTEXT_ONLY');

    const retry = authorizedExecutor(anthropicRequest, transports, { runtime });
    const result = await retry.executor.execute(anthropicRequest, retry.permit);
    expect(anthropic).toHaveBeenCalledOnce();
    expect(anthropic.mock.calls[0]![0].prompt).toContain('ANTHROPIC_TASK_ONLY');
    expect(anthropic.mock.calls[0]![0].prompt).toContain('ANTHROPIC_ADAPTER_ONLY');
    expect(anthropic.mock.calls[0]![0].prompt).toContain('ANTHROPIC_CONTEXT_ONLY');
    expect(anthropic.mock.calls[0]![0].prompt).not.toContain('OPENAI_TASK_ONLY');
    expect(anthropic.mock.calls[0]![0].prompt).not.toContain('OPENAI_ADAPTER_ONLY');
    expect(anthropic.mock.calls[0]![0].prompt).not.toContain('OPENAI_CONTEXT_ONLY');
    expect(result.providerId).toBe('anthropic');
  });

  it('keeps partial token usage partial and cost unknown instead of treating absent fields as zero', async () => {
    const request = makeRequest();
    const runtime = makeRuntime();
    runtime.registerPrice({
      providerId: 'openai', model: openAiModel,
      inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 3,
      cacheWriteUsdPerMillionTokens: 4, cacheReadUsdPerMillionTokens: 1,
      observedAt: 0, source: 'test-approved-price',
    });
    const execute = vi.fn(async () => openAiResult({ usage: { inputTokens: 10, outputTokens: 2 } }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports, { runtime });
    const result = await executor.execute(request, permit);

    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(result.cost).toMatchObject({ status: COST_UNKNOWN });
  });

  it('keeps cost unknown when complete usage has no exact provider/model price', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult({ usage: {
      inputTokens: 100, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0,
    } }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const result = await executor.execute(request, permit);

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 });
    expect(result.cost).toMatchObject({ status: COST_UNKNOWN });
    if (result.cost.status === COST_UNKNOWN) expect(result.cost.reason).not.toMatch(/\$0|zero/iu);
  });

  it('estimates cost only from exact registered pricing and complete explicit usage', async () => {
    const request = makeRequest();
    const runtime = makeRuntime();
    runtime.registerPrice({
      providerId: 'openai', model: openAiModel,
      inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 3,
      cacheWriteUsdPerMillionTokens: 4, cacheReadUsdPerMillionTokens: 1,
      observedAt: 0, source: 'test-approved-price',
    });
    const execute = vi.fn(async () => openAiResult({ usage: {
      inputTokens: 1_000_000, outputTokens: 500_000, cacheWriteTokens: 100_000, cacheReadTokens: 200_000,
    } }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports, { runtime });
    const result = await executor.execute(request, permit);

    expect(result.cost).toMatchObject({
      status: 'known', totalUsd: 4.1, source: 'test-approved-price',
      providerId: 'openai', model: openAiModel,
    });
  });

  it('does not report a non-finite cost calculation as known', async () => {
    const request = makeRequest();
    const runtime = makeRuntime();
    runtime.registerPrice({
      providerId: 'openai', model: openAiModel,
      inputUsdPerMillionTokens: Number.MAX_VALUE, outputUsdPerMillionTokens: 0,
      cacheWriteUsdPerMillionTokens: 0, cacheReadUsdPerMillionTokens: 0,
      observedAt: 0, source: 'test-overflow-price',
    });
    const execute = vi.fn(async () => openAiResult({ usage: {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    } }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports, { runtime });
    const result = await executor.execute(request, permit);

    expect(result.cost.status).toBe(COST_UNKNOWN);
  });

  it('marks response-limit and invalid-result failures as invoked without claiming verified network status', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => openAiResult({ responseBytes: new Uint8Array(1_048_577) }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);

    await expect(executor.execute(request, permit)).rejects.toMatchObject({
      code: 'response-too-large', transportInvoked: true,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns a fresh response-byte snapshot independent of the transport-owned buffer', async () => {
    const request = makeRequest();
    const responseBytes = new Uint8Array([7, 8, 9]);
    const execute = vi.fn(async () => openAiResult({ responseBytes }));
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);
    const result = await executor.execute(request, permit);

    responseBytes[0] = 0;
    expect([...result.responseBytes!]).toEqual([7, 8, 9]);
    expect(result.responseBytes).not.toBe(responseBytes);
  });

  it('uses structured safe error codes without attaching thrown transport details', async () => {
    const request = makeRequest();
    const execute = vi.fn(async () => { throw new Error('secret=do-not-expose'); });
    const transports = createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute },
    ]);
    const { permit, executor } = authorizedExecutor(request, transports);

    try {
      await executor.execute(request, permit);
      expect.fail('expected safe transport error');
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGovernedProviderExecutorError);
      expect(error).toMatchObject({ code: 'transport-error', transportInvoked: true });
      expect((error as Error).message).not.toContain('secret=');
      expect(error).not.toHaveProperty('cause');
    }
  });
});
