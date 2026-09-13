import { describe, expect, it, vi } from 'vitest';

import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import {
  createGovernedProviderExecutionReceipt,
  verifyGovernedProviderExecutionReceipt,
} from '../src/governed-provider-execution-receipt.js';
import { FuryGovernedProviderExecutorError } from '../src/provider-execution-errors.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;

function authorized(request = makeRequest({ task: 'PROMPT_PLAINTEXT_SENTINEL' })) {
  const runtime = makeRuntime();
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  const permit = gate.authorize(request, makePolicy(request));
  return { request, runtime, permit };
}

describe('Governed Provider Execution Receipt', () => {
  it('creates a deterministic plaintext-free success receipt from an actual governed execution', async () => {
    const { request, runtime, permit } = authorized();
    runtime.registerPrice({
      providerId: request.providerId,
      model: request.model,
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 3,
      cacheWriteUsdPerMillionTokens: 4,
      cacheReadUsdPerMillionTokens: 1,
      observedAt: at,
      source: 'PRICE_SOURCE_SENTINEL',
    });
    const providerRequestId = 'PROVIDER_REQUEST_ID_SENTINEL';
    const responseBytes = new TextEncoder().encode('RESPONSE_PLAINTEXT_SENTINEL');
    const transports = createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: vi.fn(async () => ({
        providerId: request.providerId,
        model: request.model,
        providerRequestId,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
        responseBytes,
        finishReason: 'FINISH_REASON_SENTINEL',
      })),
    }]);
    const executor = createGovernedProviderExecutor({ transports, providerRuntime: runtime, now: () => at });
    const result = await executor.execute(request, permit);

    const first = createGovernedProviderExecutionReceipt({ request, permit, outcome: result });
    const second = createGovernedProviderExecutionReceipt({ request, permit, outcome: result });

    expect(first).toEqual(second);
    expect(first.receiptDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.request.requestDigest).toBe(request.requestDigest);
    expect(first.authorization.permitIdDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.authorization.policyIdDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.outcome).toMatchObject({
      kind: 'success',
      transportInvoked: true,
      network: { status: 'executed', evidence: 'transport-reported' },
      providerRequest: { status: 'accepted', evidence: 'transport-reported' },
      providerRequestIdDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      response: {
        bytes: responseBytes.byteLength,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
      finishReasonDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      cost: { status: 'known', sourceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) },
    });
    expect(first.verification).toEqual({
      structuralConsistency: 'verified',
      requestProvenance: 'process-local-verified',
      permitProvenance: 'process-local-verified',
      outcomeProvenance: 'not-verified',
      providerResult: 'transport-reported',
    });

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('PROMPT_PLAINTEXT_SENTINEL');
    expect(serialized).not.toContain('RESPONSE_PLAINTEXT_SENTINEL');
    expect(serialized).not.toContain('PROVIDER_REQUEST_ID_SENTINEL');
    expect(serialized).not.toContain('FINISH_REASON_SENTINEL');
    expect(serialized).not.toContain('PRICE_SOURCE_SENTINEL');
    expect(serialized).not.toContain(permit.permitId);
    expect(serialized).not.toContain(permit.policyId);
  });

  it('keeps unreported provider evidence explicitly unreported', async () => {
    const { request, runtime, permit } = authorized();
    const transports = createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => ({ providerId: request.providerId, model: request.model }),
    }]);
    const result = await createGovernedProviderExecutor({
      transports,
      providerRuntime: runtime,
      now: () => at,
    }).execute(request, permit);

    const receipt = createGovernedProviderExecutionReceipt({ request, permit, outcome: result });
    expect(receipt.verification.providerResult).toBe('not-reported');
    expect(receipt.outcome).toMatchObject({
      kind: 'success',
      network: { status: 'unknown', evidence: 'not-reported' },
      providerRequest: { status: 'unknown', evidence: 'not-reported' },
      cost: { status: 'unknown' },
    });
  });

  it('distinguishes partially transport-reported evidence from complete transport reporting', async () => {
    const { request, runtime, permit } = authorized();
    const transports = createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => ({
        providerId: request.providerId,
        model: request.model,
        networkStatus: 'executed',
      }),
    }]);
    const result = await createGovernedProviderExecutor({
      transports,
      providerRuntime: runtime,
      now: () => at,
    }).execute(request, permit);

    const receipt = createGovernedProviderExecutionReceipt({ request, permit, outcome: result });
    expect(receipt.verification.providerResult).toBe('partially-transport-reported');
  });

  it('records a stable execution error without copying thrown secret text', async () => {
    const { request, runtime, permit } = authorized();
    const transports = createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => {
        throw new Error('TRANSPORT_SECRET_SENTINEL');
      },
    }]);
    const executor = createGovernedProviderExecutor({ transports, providerRuntime: runtime, now: () => at });

    let outcome: FuryGovernedProviderExecutorError | undefined;
    try {
      await executor.execute(request, permit);
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGovernedProviderExecutorError);
      outcome = error as FuryGovernedProviderExecutorError;
    }
    expect(outcome).toBeDefined();

    const receipt = createGovernedProviderExecutionReceipt({ request, permit, outcome: outcome! });
    expect(receipt.outcome).toEqual({
      kind: 'error',
      code: 'transport-error',
      transportInvoked: true,
    });
    expect(receipt.verification.providerResult).toBe('not-reported');
    expect(JSON.stringify(receipt)).not.toContain('TRANSPORT_SECRET_SENTINEL');
  });

  it('records pre-transport errors as not executed', () => {
    const { request, permit } = authorized();
    const error = new FuryGovernedProviderExecutorError('transport-not-registered', {
      transportInvoked: false,
    });

    const receipt = createGovernedProviderExecutionReceipt({ request, permit, outcome: error });
    expect(receipt.verification.providerResult).toBe('not-executed');
    expect(receipt.outcome).toMatchObject({
      kind: 'error',
      code: 'transport-not-registered',
      transportInvoked: false,
    });
    expect(receipt.verification.outcomeProvenance).toBe('not-verified');
  });

  it('rejects copied request envelopes and copied permits', () => {
    const { request, permit } = authorized();
    const error = new FuryGovernedProviderExecutorError('transport-not-registered');
    expect(() => createGovernedProviderExecutionReceipt({
      request: { ...request },
      permit,
      outcome: error,
    } as never)).toThrow(/process-local FuryPipe request envelope/);

    expect(() => createGovernedProviderExecutionReceipt({
      request,
      permit: { ...permit },
      outcome: error,
    } as never)).toThrow(/process-local FuryPipe execution permit/);
  });

  it('rejects a success outcome bound to another request digest', async () => {
    const first = authorized(makeRequest({ task: 'first exact request' }));
    const transports = createProviderTransportRegistry([{
      providerId: first.request.providerId,
      protocol: first.request.protocol,
      execute: async () => ({
        providerId: first.request.providerId,
        model: first.request.model,
      }),
    }]);
    const result = await createGovernedProviderExecutor({
      transports,
      providerRuntime: first.runtime,
      now: () => at,
    }).execute(first.request, first.permit);

    const second = authorized(makeRequest({ task: 'second exact request' }));
    expect(() => createGovernedProviderExecutionReceipt({
      request: second.request,
      permit: second.permit,
      outcome: result,
    })).toThrow(/does not match the exact request/);
  });

  it('verifies exact receipt binding and rejects tampering or extra fields', async () => {
    const { request, runtime, permit } = authorized();
    const transports = createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => ({ providerId: request.providerId, model: request.model }),
    }]);
    const result = await createGovernedProviderExecutor({
      transports,
      providerRuntime: runtime,
      now: () => at,
    }).execute(request, permit);
    const input = { request, permit, outcome: result };
    const receipt = createGovernedProviderExecutionReceipt(input);

    expect(verifyGovernedProviderExecutionReceipt(receipt, input)).toBe(true);

    const reordered = Object.fromEntries(Object.entries(receipt).reverse());
    expect(verifyGovernedProviderExecutionReceipt(reordered as typeof receipt, input)).toBe(true);

    const tampered = { ...receipt, model: 'gpt-5.6-luna' };
    expect(verifyGovernedProviderExecutionReceipt(tampered as typeof receipt, input)).toBe(false);

    const extended = { ...receipt, plaintext: 'should-never-be-accepted' };
    expect(verifyGovernedProviderExecutionReceipt(extended as unknown as typeof receipt, input)).toBe(false);
  });

  it('hashes response bytes so content mutation changes the receipt identity', async () => {
    const first = authorized();
    const firstBytes = new Uint8Array([1, 2, 3]);
    const firstResult = await createGovernedProviderExecutor({
      transports: createProviderTransportRegistry([{
        providerId: first.request.providerId,
        protocol: first.request.protocol,
        execute: async () => ({
          providerId: first.request.providerId,
          model: first.request.model,
          responseBytes: firstBytes,
        }),
      }]),
      providerRuntime: first.runtime,
      now: () => at,
    }).execute(first.request, first.permit);
    const firstReceipt = createGovernedProviderExecutionReceipt({
      request: first.request,
      permit: first.permit,
      outcome: firstResult,
    });

    const second = authorized(makeRequest({ task: 'PROMPT_PLAINTEXT_SENTINEL' }));
    const secondResult = await createGovernedProviderExecutor({
      transports: createProviderTransportRegistry([{
        providerId: second.request.providerId,
        protocol: second.request.protocol,
        execute: async () => ({
          providerId: second.request.providerId,
          model: second.request.model,
          responseBytes: new Uint8Array([1, 2, 4]),
        }),
      }]),
      providerRuntime: second.runtime,
      now: () => at,
    }).execute(second.request, second.permit);
    const secondReceipt = createGovernedProviderExecutionReceipt({
      request: second.request,
      permit: second.permit,
      outcome: secondResult,
    });

    expect(
      firstReceipt.outcome.kind === 'success' ? firstReceipt.outcome.response?.sha256 : undefined,
    ).not.toBe(
      secondReceipt.outcome.kind === 'success' ? secondReceipt.outcome.response?.sha256 : undefined,
    );
    expect(firstReceipt.receiptDigest).not.toBe(secondReceipt.receiptDigest);
  });
});
