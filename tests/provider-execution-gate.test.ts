import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_REGISTRY,
  createProviderRegistry,
  createProviderRuntimeState,
} from '../src/core/index.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const at = 1_000;

function authorizeError(
  request: ReturnType<typeof makeRequest>,
  runtime: ReturnType<typeof makeRuntime>,
  policy: unknown = makePolicy(request),
) {
  const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
  try {
    gate.authorize(request, policy as never);
  } catch (error) {
    return error;
  }
  throw new Error('expected policy to be denied');
}

describe('provider execution authorization gate', () => {
  it('denies by default when the host supplies no policy', () => {
    const request = makeRequest();
    const gate = createProviderExecutionGate({ providerRuntime: makeRuntime(), now: () => at });
    expect(() => gate.authorize(request, undefined as never))
      .toThrowError(expect.objectContaining({ code: 'execution-not-authorized' }));
  });

  it('denies explicit false authority', () => {
    const request = makeRequest();
    expect(authorizeError(request, makeRuntime(), makePolicy(request, { allowProviderRequest: false })))
      .toMatchObject({ code: 'execution-not-authorized' });
  });

  it('denies malformed or unknown policy fields', () => {
    const request = makeRequest();
    expect(authorizeError(request, makeRuntime(), { ...makePolicy(request), expiresInMs: 'forever' }))
      .toMatchObject({ code: 'execution-not-authorized' });
    expect(authorizeError(request, makeRuntime(), { ...makePolicy(request), auditOnly: true }))
      .toMatchObject({ code: 'execution-not-authorized' });
  });

  it('denies a policy missing explicit permission or bounded lifetime', () => {
    const request = makeRequest();
    const { allowProviderRequest: _allow, expiresInMs: _expiry, ...incomplete } = makePolicy(request);
    expect(authorizeError(request, makeRuntime(), incomplete)).toMatchObject({ code: 'execution-not-authorized' });
  });

  it('denies an unknown or unregistered provider before permit issuance', () => {
    const request = makeRequest();
    const runtime = createProviderRuntimeState(createProviderRegistry([]));
    const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });

    expect(() => gate.authorize(request, makePolicy(request))).toThrowError(
      expect.objectContaining({ code: 'provider-not-registered' }),
    );
  });

  it('denies unknown health evidence', () => {
    const request = makeRequest();
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);

    expect(authorizeError(request, runtime)).toMatchObject({ code: 'provider-health-not-fresh' });
  });

  it('denies stale health evidence', () => {
    const request = makeRequest();

    expect(authorizeError(request, makeRuntime({ expiresAt: 900 })))
      .toMatchObject({ code: 'provider-health-not-fresh' });
  });

  it('denies health evidence timestamped in the future', () => {
    const request = makeRequest();
    const runtime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
    runtime.observeHealth({
      providerId: 'openai', availability: 'available',
      observedAt: at + 1, expiresAt: at + 1_000,
      source: 'future-test-observation', evidenceKind: 'operator-config',
    });

    expect(authorizeError(request, runtime)).toMatchObject({ code: 'provider-health-not-fresh' });
  });

  it('denies an explicitly unavailable provider', () => {
    const request = makeRequest();

    expect(authorizeError(request, makeRuntime({ availability: 'unavailable' })))
      .toMatchObject({ code: 'provider-unavailable' });
  });

  it('denies a model not supported by the exact provider runtime', () => {
    const request = makeRequest({ model: 'vendor-model-without-profile' });

    expect(authorizeError(request, makeRuntime())).toMatchObject({ code: 'model-not-supported' });
  });

  it('denies an exact model-family mismatch', () => {
    const request = makeRequest({ providerId: 'openai', model: 'claude-opus-5' });

    expect(authorizeError(request, makeRuntime())).toMatchObject({ code: 'model-family-mismatch' });
  });

  it('issues a process-local permit only for fresh, available, supported exact scope', () => {
    const request = makeRequest();
    const gate = createProviderExecutionGate({ providerRuntime: makeRuntime(), now: () => at });
    const permit = gate.authorize(request, makePolicy(request));

    expect(permit).toMatchObject({
      format: 'furypipe-provider-execution-permit/v1',
      providerId: request.providerId,
      model: request.model,
      workloadId: request.workloadId,
      requestDigest: request.requestDigest,
      issuedAt: at,
      expiresAt: at + 1_000,
    });
    expect(Object.isFrozen(permit)).toBe(true);
  });

  it('never lets permit lifetime outlive the health evidence used for authorization', () => {
    const request = makeRequest();
    const runtime = makeRuntime({ expiresAt: 1_250 });
    const gate = createProviderExecutionGate({ providerRuntime: runtime, now: () => at });
    const permit = gate.authorize(request, makePolicy(request, { expiresInMs: 10_000 }));

    expect(permit.expiresAt).toBe(1_250);
  });

  it('binds host policy to exact provider, model and workload without alias matching', () => {
    const request = makeRequest();
    const gate = createProviderExecutionGate({ providerRuntime: makeRuntime(), now: () => at });

    for (const field of ['providerId', 'model', 'workloadId'] as const) {
      const policy = makePolicy(request, { [field]: `${request[field]}-other` });
      expect(() => gate.authorize(request, policy as never)).toThrowError(
        expect.objectContaining({ code: 'execution-not-authorized' }),
      );
    }
  });

  it('rejects missing, zero, unsafe and overlong permit lifetimes', () => {
    const request = makeRequest();
    const gate = createProviderExecutionGate({ providerRuntime: makeRuntime(), now: () => at });
    for (const expiresInMs of [0, 60_001, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(() => gate.authorize(request, makePolicy(request, { expiresInMs })))
        .toThrowError(expect.objectContaining({ code: 'execution-not-authorized' }));
    }
  });

  it('fails closed if the injected clock is invalid', () => {
    const request = makeRequest();
    const gate = createProviderExecutionGate({ providerRuntime: makeRuntime(), now: () => Number.POSITIVE_INFINITY });

    expect(() => gate.authorize(request, makePolicy(request)))
      .toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });
});
